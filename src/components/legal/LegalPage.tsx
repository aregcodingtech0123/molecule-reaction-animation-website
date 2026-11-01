import Link from "next/link";
import type { ReactNode } from "react";
import { display, SITE_OWNER, TRUST_PAGES_ARE_DRAFTS } from "@/lib/legal/site-owner";

/**
 * Shared frame of the trust pages (D6). Server-rendered; while any owner detail is a placeholder it carries a visible
 * draft notice (and the routes are noindex, see src/lib/seo/routes.ts).
 */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-28 sm:px-6">
      {TRUST_PAGES_ARE_DRAFTS && (
        <p role="note" className="mb-6 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          <strong>Draft — needs legal review.</strong> This page is not final. Text in [brackets] has not been provided
          yet.
        </p>
      )}
      <h1 className="font-display text-3xl font-bold sm:text-4xl">{title}</h1>
      <div className="legal-prose mt-6 space-y-4 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
      <p className="mt-10 text-xs text-muted-foreground">
        Effective date: {display(SITE_OWNER.effectiveDate)} ·{" "}
        <Link href="/about" className="underline">About</Link> ·{" "}
        <Link href="/contact" className="underline">Contact</Link> ·{" "}
        <Link href="/privacy" className="underline">Privacy</Link> ·{" "}
        <Link href="/terms" className="underline">Terms</Link>
      </p>
    </main>
  );
}

/** A value from the owner config: a placeholder renders as "[to be provided: …]". */
export function Owner({ value }: { value: string }) {
  return <>{display(value)}</>;
}
