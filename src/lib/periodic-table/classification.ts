/**
 * How the element categories are labelled (SEO-19, owner decision after Part 2): the site keeps the common textbook
 * grouping, and says so. Sources, read 2026-11-01 (docs/seo/DATA_REVIEW.md §7):
 *  - IUPAC, Nomenclature of Inorganic Chemistry (Red Book), 2005, IR-3.5: approves alkali metals, alkaline earth metals,
 *    chalcogens (O, S, Se, Te, Po), halogens (F, Cl, Br, I, At), noble gases (He, Ne, Ar, Kr, Xe, Rn), lanthanoids and
 *    actinoids; defines no "metalloid", "nonmetal" or "post-transition metal".
 *  - IUPAC, 30 November 2016, "IUPAC announces the names of the elements 113, 115, 117, and 118": the name ends in
 *    "-ine" for element 117 "belonging to group 17" and in "-on" for element 118 "belonging to group 18".
 */
export const CLASSIFICATION_NOTE = "Common classification, not an IUPAC designation";

const IUPAC_NOTES: Readonly<Record<string, string>> = {
  Po: "IUPAC lists polonium among the chalcogens (group 16) and does not classify it as a metalloid; “metalloid” here is the common classification. (IUPAC Red Book 2005, IR-3.5)",
  Ts: "IUPAC places tennessine in group 17; the “halogen” label here reflects that group position. (IUPAC, 30 Nov 2016)",
  Og: "IUPAC places oganesson in group 18; the “noble gas” label here reflects that group position. (IUPAC, 30 Nov 2016)",
};

/** IUPAC's own wording where it differs from, or does not cover, the site's label (Po, Ts, Og); null otherwise. */
export function iupacNote(symbol: string): string | null {
  return Object.hasOwn(IUPAC_NOTES, symbol) ? IUPAC_NOTES[symbol] : null;
}
