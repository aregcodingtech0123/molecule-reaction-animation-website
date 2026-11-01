/**
 * `npm run check:launch-content` — fails (exit 1) while the trust pages still contain owner placeholders (D6).
 *
 * The four trust pages (/about, /contact, /privacy, /terms) and the Organization JSON-LD read the operator's details
 * from src/lib/legal/site-owner.ts. Until every value there is real, those pages are drafts: noindex, out of the
 * sitemap, no Organization JSON-LD, and this check fails. It prints field names only, and reminds that the legal text
 * itself still needs a lawyer's review (which no script can check).
 */
import { pathToFileURL } from "node:url";
import { remainingPlaceholders, SITE_OWNER, type SiteOwner } from "../src/lib/legal/site-owner";

export function checkLaunchContent(owner: SiteOwner = SITE_OWNER): { problems: string[] } {
  return {
    problems: remainingPlaceholders(owner).map(
      (field) => `trust pages: SITE_OWNER.${field} is still a placeholder (src/lib/legal/site-owner.ts)`,
    ),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { problems } = checkLaunchContent();
  for (const p of problems) console.error(`PROBLEM  ${p}`);
  if (problems.length) {
    console.error(`[check:launch-content] ${problems.length} placeholder(s) — the trust pages are drafts; not ready for launch.`);
    process.exit(1);
  }
  console.log("[check:launch-content] no placeholders left. The privacy policy and terms still need legal review before launch.");
}
