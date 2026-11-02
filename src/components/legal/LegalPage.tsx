import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { paragraphsOf, readSiteOwner, singleHttpsUrl } from "@/lib/legal/site-owner";

/**
 * Shared frame of the trust pages (D6). Server-rendered on every request: the owner details come from SITE_OWNER_*
 * environment variables (src/lib/legal/site-owner.ts). A value that is not set is simply not shown; nothing in this file
 * or in the pages prints placeholder text. The "Draft - needs legal review" notice is on until SITE_OWNER_LEGAL_REVIEWED=true.
 * The pages are English only on purpose: legal text is not machine-translated (LAUNCH_CHECKLIST §1.7).
 */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const { owner, legalReviewed } = readSiteOwner();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-28 sm:px-6">
      {!legalReviewed && (
        <p role="note" className="mb-6 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm">
          <strong>Draft — needs legal review.</strong> This page is not final.
        </p>
      )}
      <h1 className="font-display text-3xl font-bold sm:text-4xl">{title}</h1>
      <div className="legal-prose mt-6 space-y-4 text-sm leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
      <p className="mt-10 text-xs text-muted-foreground">
        {owner.effectiveDate && <>Effective date: {owner.effectiveDate} · </>}
        {owner.lastUpdated && <>Last updated: {owner.lastUpdated} · </>}
        This page is available in English only. ·{" "}
        <Link href="/about" className="underline">About</Link> ·{" "}
        <Link href="/contact" className="underline">Contact</Link> ·{" "}
        <Link href="/privacy" className="underline">Privacy</Link> ·{" "}
        <Link href="/terms" className="underline">Terms</Link>
      </p>
    </main>
  );
}

/** Inline text: line breaks of the value become <br>. Rendered as text (escaped), never as HTML. */
export function OwnerLines({ value }: { value: string }) {
  const lines = value.split("\n").filter(Boolean);
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  );
}

/** Block text: a blank line in the value starts a new paragraph. Rendered as text (escaped), never as HTML. */
export function OwnerBlock({ value }: { value: string }) {
  return (
    <>
      {paragraphsOf(value).map((lines, i) => (
        <p key={i}>
          <OwnerLines value={lines.join("\n")} />
        </p>
      ))}
    </>
  );
}

/** A validated e-mail address as a mailto link (the format check admits no quote, angle bracket or space). */
export function OwnerEmail({ value }: { value: string }) {
  return (
    <a href={`mailto:${value}`} className="underline">
      {value}
    </a>
  );
}

/** The refund policy: a single https URL becomes a link, anything else is text paragraphs. */
export function OwnerPolicy({ value }: { value: string }) {
  const url = singleHttpsUrl(value);
  if (url) {
    return (
      <p>
        <a href={url} rel="noopener noreferrer" className="underline">
          {value}
        </a>
      </p>
    );
  }
  return <OwnerBlock value={value} />;
}

