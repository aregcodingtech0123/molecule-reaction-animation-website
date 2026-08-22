import type { LedgerTransactionType, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { env } from "../config/env.js";
import { AppError, type BalanceResult, type LedgerMutationResult } from "../types/index.js";

async function findIdempotentResult(
  idempotencyKey: string,
  userId: string,
): Promise<LedgerMutationResult | null> {
  const existing = await prisma.ledgerTransaction.findUnique({
    where: { idempotencyKey },
    include: { entries: { where: { accountId: { not: null } }, take: 1 } },
  });

  if (!existing) return null;

  const account = await prisma.creditAccount.findUnique({ where: { userId } });
  return {
    userId,
    balance: account?.balance ?? 0,
    transactionId: existing.id,
    idempotentReplay: true,
  };
}

async function ensureUserAccount(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<{ id: string; balance: number }> {
  const account = await tx.creditAccount.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
    select: { id: true, balance: true },
  });
  return account;
}

interface PostLedgerParams {
  userId: string;
  amount: number;
  type: LedgerTransactionType;
  idempotencyKey?: string;
  externalRef?: string;
  description?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Credits a user wallet inside a balanced double-entry transaction.
 * User CREDIT + platform DEBIT (liability issued).
 */
export async function creditUserLedger(params: PostLedgerParams): Promise<LedgerMutationResult> {
  if (params.idempotencyKey) {
    const replay = await findIdempotentResult(params.idempotencyKey, params.userId);
    if (replay) return replay;
  }

  return prisma.$transaction(async (tx) => {
    if (params.idempotencyKey) {
      const dup = await tx.ledgerTransaction.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (dup) {
        const account = await tx.creditAccount.findUnique({ where: { userId: params.userId } });
        return {
          userId: params.userId,
          balance: account?.balance ?? 0,
          transactionId: dup.id,
          idempotentReplay: true,
        };
      }
    }

    const account = await ensureUserAccount(tx, params.userId);

    const updated = await tx.creditAccount.update({
      where: { userId: params.userId },
      data: { balance: { increment: params.amount } },
      select: { balance: true },
    });

    const transaction = await tx.ledgerTransaction.create({
      data: {
        idempotencyKey: params.idempotencyKey,
        type: params.type,
        externalRef: params.externalRef,
        description: params.description,
        metadata: params.metadata,
        entries: {
          create: [
            {
              accountId: account.id,
              direction: "CREDIT",
              amount: params.amount,
            },
            {
              systemId: env.systemAccountId,
              direction: "DEBIT",
              amount: params.amount,
            },
          ],
        },
      },
    });

    return {
      userId: params.userId,
      balance: updated.balance,
      transactionId: transaction.id,
      idempotentReplay: false,
    };
  });
}

/**
 * Atomically debits credits — uses conditional update to prevent race conditions
 * and double-spending when concurrent AI requests hit the same wallet.
 */
export async function debitUserLedger(params: PostLedgerParams): Promise<LedgerMutationResult> {
  if (params.idempotencyKey) {
    const replay = await findIdempotentResult(params.idempotencyKey, params.userId);
    if (replay) return replay;
  }

  return prisma.$transaction(async (tx) => {
    if (params.idempotencyKey) {
      const dup = await tx.ledgerTransaction.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (dup) {
        const account = await tx.creditAccount.findUnique({ where: { userId: params.userId } });
        return {
          userId: params.userId,
          balance: account?.balance ?? 0,
          transactionId: dup.id,
          idempotentReplay: true,
        };
      }
    }

    const account = await ensureUserAccount(tx, params.userId);

    const debited = await tx.creditAccount.updateMany({
      where: {
        userId: params.userId,
        balance: { gte: params.amount },
      },
      data: {
        balance: { decrement: params.amount },
      },
    });

    if (debited.count === 0) {
      throw new AppError(402, "Insufficient credits.", "INSUFFICIENT_CREDITS");
    }

    const updated = await tx.creditAccount.findUniqueOrThrow({
      where: { userId: params.userId },
      select: { balance: true },
    });

    const transaction = await tx.ledgerTransaction.create({
      data: {
        idempotencyKey: params.idempotencyKey,
        type: params.type,
        externalRef: params.externalRef,
        description: params.description,
        metadata: params.metadata,
        entries: {
          create: [
            {
              accountId: account.id,
              direction: "DEBIT",
              amount: params.amount,
            },
            {
              systemId: env.systemAccountId,
              direction: "CREDIT",
              amount: params.amount,
            },
          ],
        },
      },
    });

    return {
      userId: params.userId,
      balance: updated.balance,
      transactionId: transaction.id,
      idempotentReplay: false,
    };
  });
}

export async function getUserBalance(userId: string): Promise<BalanceResult> {
  const account = await prisma.creditAccount.findUnique({
    where: { userId },
    select: { balance: true },
  });

  const balance = account?.balance ?? 0;
  return {
    userId,
    balance,
    hasCredits: balance > 0,
  };
}
