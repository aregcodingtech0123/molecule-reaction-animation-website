import Link from "next/link";
import type { ReactNode } from "react";
import { CREDIT_PACKAGES } from "@/lib/billing/checkout";
import { cn } from "@/lib/utils";

/**
 * Visible, server-rendered answers (AEO, Part 2 §6). Every answer is a fact the code backs; nothing that needs a
 * policy decision (refunds, credit expiry, data deletion) is answered here — those point to the draft terms. No
 * FAQPage markup: Google ended FAQ rich results on May 7, 2026; the text is for readers and answer engines.
 */
interface Question {
  q: string;
  a: ReactNode;
}

const cheapest = [...CREDIT_PACKAGES].sort((a, b) => a.priceUsd - b.priceUsd)[0];
const packList = CREDIT_PACKAGES.map((p) => `${p.name}: ${p.credits} credits for $${p.priceUsd}`).join("; ");

export const HOME_QUESTIONS: Question[] = [
  {
    q: "Is Molecule Architecture Studio free to use?",
    a: (
      <>
        Browsing is free and needs no account: the 3D molecule explorer, the atomic models, the periodic table and the{" "}
        <Link href="/molecules" className="underline">molecule pages</Link>. Only the AI Lab uses credits, sold in packs
        from ${cheapest.priceUsd} ({cheapest.credits} credits) on the <Link href="/pricing" className="underline">pricing page</Link>.
      </>
    ),
  },
  {
    q: "What is the AI Lab?",
    a: "A chat assistant for chemistry, biology and materials questions, powered by Google's Gemini model. When an answer names a molecule by its structure, the 3D model is loaded from PubChem and shown next to the chat. It needs an account with a verified email address.",
  },
  {
    q: "Where do the facts on the site come from?",
    a: (
      <>
        The periodic table uses atomic weights and electron configurations from NIST. Molecule formulas, molar masses and
        melting and boiling points were checked against PubChem. Seven of the 3D molecule models are PubChem's computed 3D conformers; the other seven are hand-built illustrations. More
        on the <Link href="/about" className="underline">about page</Link>.
      </>
    ),
  },
  {
    q: "Do I need to install anything?",
    a: "No. Everything runs in the web browser; the 3D views use WebGL, which current desktop and mobile browsers support.",
  },
];

export const PRICING_QUESTIONS: Question[] = [
  {
    q: "How much do AI Lab credits cost?",
    a: `${packList}. Prices are in US dollars.`,
  },
  {
    q: "Do I need an account to look around?",
    a: "No. You can browse the explorer, the atomic models, the periodic table and the molecule pages as a guest. You sign in to buy credits and to use the AI Lab.",
  },
  {
    q: "Who processes the payment?",
    a: "Lemon Squeezy, the merchant of record. You pay on their checkout page; your card details never reach this site.",
  },
  {
    q: "What happens to my credits if an AI request fails?",
    a: "Credits are reserved when you send a message and charged when the model has produced an answer. If the request fails, times out or comes back empty, the reservation is released and nothing is charged.",
  },
  {
    q: "Can I get a refund?",
    a: (
      <>
        The refund policy is in the <Link href="/terms" className="underline">terms of use</Link>.
      </>
    ),
  },
];

export function CommonQuestions({ questions, className }: { questions: Question[]; className?: string }) {
  return (
    <section aria-labelledby="common-questions" className={cn("mx-auto w-full max-w-3xl", className)}>
      <h2 id="common-questions" className="text-2xl font-semibold">
        Common questions
      </h2>
      <dl className="mt-4 space-y-5">
        {questions.map(({ q, a }) => (
          <div key={q}>
            <dt className="font-semibold">{q}</dt>
            <dd className="mt-1 text-sm leading-relaxed opacity-90">{a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Links to the molecule pages and the trust pages (home page: Google's OAuth branding rules want the privacy policy linked there). */
export function SiteInfoLinks({ className }: { className?: string }) {
  const links = [
    ["/molecules", "Molecules"],
    ["/about", "About"],
    ["/contact", "Contact"],
    ["/privacy", "Privacy policy"],
    ["/terms", "Terms of use"],
  ] as const;
  return (
    <nav aria-label="Site information" className={cn("mx-auto flex max-w-3xl flex-wrap justify-center gap-x-4 gap-y-2 text-sm", className)}>
      {links.map(([href, label]) => (
        <Link key={href} href={href} className="underline-offset-2 hover:underline">
          {label}
        </Link>
      ))}
    </nav>
  );
}
