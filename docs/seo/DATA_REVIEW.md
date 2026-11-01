# Element data review (SEO-19, SEO-21)

For the owner's review. **Nothing here was changed silently**: electron shells were replaced (they were demonstrably
wrong, see 1); every other difference below is listed and the value is unchanged until you decide.

Method: the reference values were downloaded from the sources below on 2026-11-01 and parsed by script (no hand
transcription): `src/lib/periodic-table/nist-ground-shells.ts` and `tests/fixtures/element-reference.json`. The tests
in `tests/unit/periodic-table/` compare the site's data with them for all 118 elements.

## 1. Electron shells (fixed, SEO-21)

* Before: `estimateElectronShells()` filled shells 2, 8, 18, 32 … in order. Correct only up to argon; K → 2,8,9, Ca →
  2,8,10, Cr → 2,8,14, Fe → 2,8,16, Cu → 2,8,18,1 (all wrong). It drove the orbit animation (the counts were never
  written as text).
* After: shells per principal quantum number derived from NIST's measured ground-state configurations (NIST ASD 5.12,
  "Ground Shells"): K 2,8,8,1 · Cr 2,8,13,1 · Fe 2,8,14,2 · Cu 2,8,18,1 · Pd 2,8,18,18 · Au 2,8,18,32,18,1 …
  All 108 elements NIST lists sum to Z and respect 2n² (test), plus 17 known exceptions checked against textbook values.
* **Z = 109–118 (Mt … Og): NIST has no entry** (the database stops at hassium, Z = 108; those configurations are
  predicted, not measured). No other authoritative measured source exists, so the site draws only the nucleus for
  them and says why. **Your call:** keep that, or accept a theoretical source (e.g. relativistic calculations) and label
  it as predicted.
* Lawrencium (Z = 103): NIST's ground state is `[Rn] 5f14 7s2 7p` (shells 2,8,18,32,32,8,3), not the 6d textbook
  configuration. Followed NIST.

## 2. Atomic masses — differences for your decision

The site values look like NIST / IUPAC conventional values (3 decimals). Of 118 elements, 115 agree (within the
precision both sources print). Differences:

| Element | Site | Reference says | Likely cause | Suggested action (not applied) |
| --- | --- | --- | --- | --- |
| Ytterbium (Yb, 70) | 173.045 | NIST 173.054(5); CIAAW 173.05 ± 0.02 | **Digits transposed** (typo) | Change to 173.054 |
| Zirconium (Zr, 40) | 91.224 | CIAAW 2024: 91.222(3); NIST page (older): 91.224(2) | CIAAW revised Zr (and Gd, Lu) in 2024 | Change to 91.222 if you want the current IUPAC value |
| Hassium (Hs, 108) | 277 | CIAAW (Nubase 2020): most stable isotopes 269 and 270 | Different isotope chosen (277 is a heavier, shorter-lived one) | Change to 269 |

Informational (no difference on the site, but the standard is moving):

* **Argon:** the site shows 39.948 (= NIST page, 39.948(1)). CIAAW 2024 now gives an *interval* [39.792, 39.963] with an
  abridged value 39.95 ± 0.16 (argon's composition varies in nature). Same for H, Li, B, C, N, O, Mg, Si, S, Cl, Br, Tl,
  Pb: CIAAW gives intervals; the site shows single conventional values, which is the usual periodic-table practice.
* **Elements with no stable isotope** (Tc, Pm, Po … Og) have no standard atomic weight. The site shows the mass number of
  one isotope, as periodic tables do. All of them are in CIAAW's list of most-stable isotopes (Tc 98, Pm 145, Po 209, At 210,
  Rn 222, Fr 223, Ra 226, Ac 227, Np 237, Pu 244, Am 243, Cm 247, Bk 247, Cf 251, Es 252, Fm 257, Md 258, No 259, Lr 266,
  Rf 267, Db 268, Sg 269, Bh 270, Mt 278, Ds 281, Rg 282, Cn 285, Nh 286, Fl 289, Mc 290, Lv 293, Ts 294, Og 294)
  **except Hs** (above). The page should say "mass number of the most stable isotope" wherever it shows such a value.
* **Names:** "Aluminum" and "Cesium" are the US spellings; IUPAC uses "aluminium" and "caesium". Not an error; matters if
  names go into structured data for an international audience.
* **Period and group** follow the standard 18-column layout (test). Lanthanides/actinides have no group; La and Ac sit in
  group 3. IUPAC's 2021 provisional recommendation puts Lu and Lr in group 3 instead — a convention choice, not an error.

## 3. Other published facts — to check before they appear on indexable pages

No authority defines the **category** labels (alkali metal … metalloid …); they follow common textbook convention and
are unverified. Debatable ones: polonium and germanium/antimony as "metalloid" (IUPAC treats Po as a metal), astatine as
"halogen" (properties unmeasured), Lr as "actinide", and the predicted classes of Rf–Cn (transition metals), Nh–Lv
(post-transition), Ts (halogen), Og (noble gas).

Sentences in the one-line descriptions that look wrong or too strong (not changed):

* **O:** "Earth's most abundant element **by mass**" — true for the crust; for the whole planet iron is more abundant by mass.
* **Ir:** "defines the kilogram standard" — since 2019 the kilogram is defined by the Planck constant; the old prototype
  was a platinum–iridium alloy.
* **Ar:** "fill inside **energy-efficient** incandescent bulbs" — argon fill is common in incandescent bulbs; "energy-efficient" is a stretch.
* **Ho:** "highest magnetic moment of any element" — commonly stated; verify.
* **Os:** "densest naturally occurring element" — Os and Ir are within measurement error of each other; commonly stated.
* **At:** "rarest naturally occurring element" — commonly stated.

## 4. Licences and attribution (what the sources require)

| Source | Terms found (read 2026-11-01) | What this repo does |
| --- | --- | --- |
| **NIST Atomic Spectra Database 5.12** (SRD 78) — ground-state shells | NIST SRD may be copied, modified and redistributed; "explicitly acknowledge" NIST; modified works must say what changed and when ([NIST licence page](https://www.nist.gov/open/license)); NIST offers the data "AS IS". Recommended reference: *Kramida, A., Ralchenko, Yu., Reader, J. and NIST ASD Team (2024). NIST Atomic Spectra Database (version 5.12), [Online]. Available: https://physics.nist.gov/asd [11/8/2024]. National Institute of Standards and Technology, Gaithersburg, MD. DOI: https://doi.org/10.18434/T4W30F* | Citation and terms are in the header of `nist-ground-shells.ts`; values unmodified. **Before any element page or "Sources" note goes live (Part 2) the site must show the NIST acknowledgement.** |
| **NIST Atomic Weights and Isotopic Compositions** | Public NIST data, acknowledge NIST. The page prints no version or date (its argon value is older than CIAAW 2024) | Used only as a test reference |
| **CIAAW / IUPAC** (atomic weights, abridged 2024; radioactive elements, Nubase 2020) | No licence named. Impressum: contents "jointly copyrighted by CIAAW and IUPAC and can be freely used for educational purposes"; reproduction is allowed *on condition that an acknowledgement, with full reference to the source, the © symbol, the name IUPAC or CIAAW, and the year of publication are prominently visible*; **commercial use requires contacting the CIAAW Secretariat**; translations need prior approval | Used only as a test reference (the tests/fixture are not shipped). **If CIAAW values are ever displayed or put in structured data, the site (which sells credits) is arguably commercial: ask CIAAW first, and show "© CIAAW/IUPAC 2024".** |
| **lucide-react** (the Atom mark in the icons and share image) | ISC licence | Retain the licence notice (already shipped with the package); the mark is the navbar's existing icon |
| **Wikipedia** (element photos and summaries, loaded at runtime) | Separate per-image Commons licences, not shown in the UI (SEO-19) | Open; Part 2 |

Everything in section 4 is documentation read from the sources' own pages; it is not legal advice.
