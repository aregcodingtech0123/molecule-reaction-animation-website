# Element data review (SEO-19, SEO-21)

Status: **owner decisions applied** (2026-11-01). Every change to what the site publishes is listed below as
*old → new, with its source*. Nothing was changed silently, and anything not listed here is unchanged.

Method: the reference values were downloaded from the sources below on 2026-11-01 and parsed by script (no hand
transcription): `src/lib/periodic-table/nist-ground-shells.ts` and `tests/fixtures/element-reference.json`. The tests
in `tests/unit/periodic-table/` compare the site's data with them for all 118 elements.

## 0. Rule for sources (owner decision)

* **What is shown on the site comes from NIST** (US government data, public domain / NIST SRD terms, with an
  acknowledgement on the page).
* **CIAAW / IUPAC values are not displayed** anywhere (page, metadata, structured data, share image). The licence
  constraint is in section 5. CIAAW's tables stay in `tests/fixtures/element-reference.json` **only as a
  cross-check inside the test suite** (never imported by `src/`, never shipped); a test asserts the periodic-table page
  text mentions neither CIAAW nor IUPAC.
* If NIST and CIAAW disagree, the site follows NIST and the difference is listed here (Zr, section 2).

## 1. Electron shells

* Shells per principal quantum number are derived from NIST's measured ground-state configurations (NIST ASD 5.12,
  "Ground Shells"): K 2,8,8,1 · Cr 2,8,13,1 · Fe 2,8,14,2 · Cu 2,8,18,1 · Pd 2,8,18,18 · Au 2,8,18,32,18,1 …
  Before (SEO-21) a fill-in-order estimate was wrong from potassium on (K 2,8,9; Cr 2,8,14; Fe 2,8,16; Cu 2,8,18,1 …).
  All 108 elements NIST lists sum to Z and respect 2n² (test), plus 17 known exceptions checked against textbook values.
* **Z = 109–118 (Mt … Og): nucleus only, with a note (owner decision 1).** NIST has no entry (its database stops at
  hassium, Z = 108; those configurations are predicted, not measured). **No shell data is published for them
  anywhere**: `NIST_GROUND_SHELLS` has no key above 108, `electronShells(109…118)` is `null`, the orbit animation draws
  only the nucleus and says "Electron shells are not shown: the ground-state configuration of this element has not been
  measured". Tests cover all ten elements (`element-data.test.ts`, `orbit-animation.test.tsx`).
* Lawrencium (Z = 103): NIST's ground state is `[Rn] 5f14 7s2 7p` (shells 2,8,18,32,32,8,3), not the 6d textbook
  configuration. Followed NIST.

## 2. Atomic masses — changes (old → new, source)

NIST source for all rows: *Atomic Weights and Isotopic Compositions for All Elements*,
https://physics.nist.gov/cgi-bin/Compositions/stand_alone.pl (the page prints no version or date; re-read 2026-11-01).

| Element | Old | New | Source and its label | Why |
| --- | --- | --- | --- | --- |
| **Ytterbium (Yb, 70)** | 173.045 | **173.054** | NIST: Standard Atomic Weight **173.054(5)** | Digits were transposed (typo) |
| **Zirconium (Zr, 40)** | 91.224 | **91.224 (unchanged, decided)** | NIST: Standard Atomic Weight **91.224(2)**, note *g* (geologically exceptional samples) | CIAAW revised Zr to 91.222(3) in 2024, but CIAAW values are not displayed (rule above). NIST's page still carries 91.224(2); the site follows NIST. The page states the NIST source. **Revisit** when NIST's table adopts the 2024 value (the test `KNOWN_DIFFERENCES.Zr` then fails and forces this row to be updated). |
| **Hassium (Hs, 108)** | 277 shown as "Atomic Mass 277 u" | **270, shown as "Mass number 270 — No stable isotope — longest-lived isotope"** | NIST lists a single hassium isotope, **²⁷⁰Hs, relative atomic mass 270.13429(27#)** (`#` = value from systematic trends, not measured) and **no** standard atomic weight. | 277 was a heavier, shorter-lived isotope, shown as if it were a standard mass. 270 is the isotope NIST publishes for Hs; it is also one of the two most-stable hassium isotopes in the Nubase 2020 evaluation (269 and 270 — checked in the test only, not displayed). I chose 270 over the 269 suggested in the first review because NIST, the only source shown, lists 270 and not 269. |

### Presentation change for every element with no standard atomic weight

Elements with no stable isotope have no standard atomic weight (34 of 118: Tc, Pm, Po, At, Rn, Fr, Ra, Ac, Np–Og). The
site used to show their mass number exactly like a standard weight ("Atomic Mass 98 u", "277.00" in the grid). Now:

* Detail panel: label **"Mass number"**, value without a unit, and the note **"No stable isotope — longest-lived
  isotope"** (Hs and the other 33). Standard weights keep "Atomic Mass … u".
* Periodic-table cell: bracketed mass number (`[270]`), the IUPAC/NIST convention, instead of `270.00`.
* New field `atomicMassKind: "standard-weight" | "mass-number"` on every element (test: it is exactly the set CIAAW/NIST
  give no standard weight for, and every such number is an integer that appears among the evaluated most-stable isotopes).

**Where the label rests on NIST and where it does not.** For Tc, Pm, Po–Ac, Np and Pu, NIST itself prints the mass
number in brackets (e.g. Tc [98], Pu [244]); the test compares each of the 10 with the site. For Z 95–118 the NIST
table lists isotope masses but does **not** flag which isotope is the longest-lived, so for those 24 elements
"longest-lived" rests on the Nubase 2020 evaluation (test cross-check, not displayed) and the numbers are the ones the
site already had. If you want a strictly NIST-only claim, the note for Z 95–118 should be weakened to "mass number of a
known isotope"; tell me and it is a one-line change.

### Masses that stay and why

After this change every one of the 118 elements is consistent with NIST (tests, all 118): 72 elements with a numeric
NIST weight match it to the precision both print (Zr included: 91.224 = 91.224(2)); the 12 with a NIST *interval* (H, Li,
B, C, N, O, Mg, Si, S, Cl, Br, Tl) show one conventional value inside it, allowing half a unit of the site's last digit
(e.g. O 15.999 for [15.99903, 15.99977]); the 10 with a bracketed NIST mass number (Tc, Pm, Po, At, Rn, Fr, Ra, Ac,
Np, Pu) match it; the remaining 24 (Z 95–118) are mass numbers with no NIST weight (above). 72 + 12 + 10 + 24 = 118.

Informational, unchanged:

* **Names:** "Aluminum" and "Cesium" are the US spellings; IUPAC uses "aluminium" and "caesium". Not an error; matters if
  names go into structured data for an international audience.
* **Period and group** follow the standard 18-column layout (test). Lanthanides/actinides have no group; La and Ac sit in
  group 3. IUPAC's 2021 provisional recommendation puts Lu and Lr in group 3 instead — a convention choice, not an error.

## 3. Category labels (unchanged, unverified)

No authority defines the **category** labels (alkali metal … metalloid …); they follow common textbook convention.
Debatable ones: polonium and germanium/antimony as "metalloid" (IUPAC treats Po as a metal), astatine as "halogen"
(properties unmeasured), Lr as "actinide", and the predicted classes of Rf–Cn (transition metals), Nh–Lv
(post-transition), Ts (halogen), Og (noble gas). Not changed in this commit.

## 4. One-line descriptions — corrections (old → new)

All 118 were re-read. Those below were wrong or stronger than the sources support. Source column: where a figure is
given it is a standard reference value; none of these corrections quotes CIAAW. (`tests/unit/periodic-table/element-data.test.ts`
fails if any of the old wordings returns.)

| Element | Old | New | Why |
| --- | --- | --- | --- |
| O | "…— Earth's most abundant element **by mass**." | "…— the most abundant element **in Earth's crust** by mass." | True for the crust; for the whole planet iron is more abundant by mass |
| Ir | "…— **defines the kilogram standard** and survives meteor impacts." | "…— the **former kilogram prototype** was a platinum–iridium alloy, and an iridium-rich layer marks the asteroid impact 66 million years ago." | Since 2019 the kilogram is defined by the Planck constant |
| Ar | "…the fill inside **energy-efficient** incandescent bulbs." | "…and a common fill gas inside incandescent bulbs." | Argon fill is common; "energy-efficient" was a stretch |
| Li | "**The softest metal**, essential for…" | "**The lightest metal**, essential for…" | False: caesium and the other heavier alkali metals are softer than lithium; lithium is the least dense metal |
| Gd | "…sits at the **center of the lanthanide contraction**." | "…sits **in the middle of the lanthanide series**." | The contraction spans the whole series; gadolinium is its midpoint |
| Cm | "…**generates heat for space probe power sources**." | "…its isotope **curium-244 powers the alpha-particle X-ray spectrometers on Mars rovers**." | Cm was studied, not used, as an RTG heat source; Cm-244 is the APXS source on Mars rovers |
| Sr | "…strengthens **dental ceramics** and ferrite magnets." | "…**flares** and is a key ingredient of **ferrite magnets**." | "Dental ceramics" had no basis |
| Ho | "Has **the highest** magnetic moment of any element" | "Has **one of the highest** magnetic moments of any element" | Commonly stated (10.6 μB) but not verified here; hedged |
| Os | "**The densest** naturally occurring element" | "**Together with iridium**, the densest naturally occurring element" | Os and Ir are within measurement error of each other |
| At | "**The rarest** naturally occurring element" | "**Among the rarest** naturally occurring elements" | Commonly stated; hedged |
| Cu | "**Humanity's first** worked metal" | "**One of the first** metals worked by humans" | Gold and meteoritic iron may be earlier |
| S | "…industry's **most-produced chemical**." | "…**one of** industry's most-produced chemicals." | Sulfuric acid ranks first or near it depending on the count |
| I | "…a powerful **violet antiseptic**" | "…a **dark-violet solid that serves as an antiseptic**" | The antiseptic (tincture) is brown, the solid is violet |
| Yb | "Used in **stainless steel stress monitoring** and atomic clocks." | "Its atoms drive some of the most precise optical atomic clocks, and it is used in fiber lasers." | The old wording was muddled |
| Po | "discovered by **Marie Curie**" | "discovered by **Marie and Pierre Curie**" | Joint discovery (1898) |
| Pu | "**Synthetic** fissile fuel…" | "**Largely synthetic** fissile fuel…" | Traces occur naturally |
| No | "…exists for **only seconds** before decaying." | "…even its **longest-lived known isotope has a half-life of only about an hour**." | ²⁵⁹No has a half-life of ~58 min |
| Sg | "…**among the first** elements named for a living person." | "…**the first** element named for a person who was still alive." | Seaborg was alive when the name was approved (1997) |
| Bh | "…decays **within seconds** of synthesis." | "…short-lived: its longest-lived known isotope has a half-life of about a minute." | ²⁷⁰Bh ≈ 61 s |
| Mc | "…decays **in milliseconds**." | "…its longest-lived known isotopes decay within about a second." | ²⁹⁰Mc ≈ 0.65 s |
| Og | "…**likely exhibits unusual** noble-gas and relativistic effects." | "…**predicted to behave unlike the lighter noble gases** because of relativistic effects." | Predicted, not observed |

Left as written (checked, defensible): every description not in the table, including Tc "the
lightest element with no stable isotopes", Si "second-most abundant crustal element", W "highest melting point of all
metals", Cs "defines the SI second", Hg "only liquid metal at room temperature", U "heaviest element found in
meaningful natural abundance". Hs "predicted to resemble osmium chemically" stays (HsO₄ chemistry has been observed to
resemble OsO₄; the sentence is still true as written).

## 5. Licences and attribution (what the sources require)

| Source | Terms found (read 2026-11-01) | What this repo does |
| --- | --- | --- |
| **NIST Atomic Spectra Database 5.12** (SRD 78) — ground-state shells | NIST SRD may be copied, modified and redistributed; "explicitly acknowledge" NIST; modified works must say what changed ([NIST licence page](https://www.nist.gov/open/license)); offered "AS IS". Recommended reference: *Kramida, A., Ralchenko, Yu., Reader, J. and NIST ASD Team (2024). NIST Atomic Spectra Database (version 5.12), [Online]. Available: https://physics.nist.gov/asd [11/8/2024]. National Institute of Standards and Technology, Gaithersburg, MD. DOI: https://doi.org/10.18434/T4W30F* | **Shown on the periodic-table page** (since this commit): the citation, the link, and what changed ("electrons are grouped by principal quantum number"; "NIST lists no measured ground state for elements 109–118"). Also in the header of `nist-ground-shells.ts`; values unmodified. Part 2's element pages must carry the same text. |
| **NIST Atomic Weights and Isotopic Compositions** | Public NIST data, acknowledge NIST. The page prints no version or date | **Shown on the periodic-table page**: "standard atomic weights from NIST, *Atomic Weights and Isotopic Compositions for All Elements*, rounded to three decimals (where NIST gives an interval, one conventional value inside it is shown)…" with the link |
| **CIAAW / IUPAC** (atomic weights, abridged 2024; radioactive elements, Nubase 2020) | No licence named. Impressum: contents "jointly copyrighted by CIAAW and IUPAC and can be freely used for educational purposes"; reproduction is allowed *on condition that an acknowledgement, with full reference to the source, the © symbol, the name IUPAC or CIAAW, and the year of publication are prominently visible*; **commercial use requires contacting the CIAAW Secretariat**; translations need prior approval | **Not displayed (owner decision).** Used only as a test cross-check; the fixture and tests are not shipped. The site sells credits, so it is arguably commercial: showing CIAAW values would need the Secretariat's permission and a "© CIAAW/IUPAC 2024" notice. Until then keep CIAAW out of `src/`, metadata, JSON-LD and the share image. |
| **lucide-react** (the Atom mark in the icons and share image) | ISC licence | Retain the licence notice (already shipped with the package) |
| **Wikipedia** (element photos and summaries, loaded at runtime) | Separate per-image Commons licences, not shown in the UI (SEO-19) | Open; Part 2 |

Everything in section 5 is documentation read from the sources' own pages; it is not legal advice.
