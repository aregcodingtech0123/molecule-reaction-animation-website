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
| **Hassium (Hs, 108)** | 277 shown as "Atomic Mass 277 u" | **270, shown as "Mass number 270 — No stable isotope — mass number of a known isotope"** (wording revised by the owner decision below) | NIST lists a single hassium isotope, **²⁷⁰Hs, relative atomic mass 270.13429(27#)** (`#` = value from systematic trends, not measured) and **no** standard atomic weight. | 277 was a heavier, shorter-lived isotope, shown as if it were a standard mass. 270 is the isotope NIST publishes for Hs; it is also one of the two most-stable hassium isotopes in the Nubase 2020 evaluation (269 and 270 — checked in the test only, not displayed). I chose 270 over the 269 suggested in the first review because NIST, the only source shown, lists 270 and not 269. |

### Presentation change for every element with no standard atomic weight

Elements with no stable isotope have no standard atomic weight (34 of 118: Tc, Pm, Po, At, Rn, Fr, Ra, Ac, Np–Og). The
site used to show their mass number exactly like a standard weight ("Atomic Mass 98 u", "277.00" in the grid). Now:

* Detail panel: label **"Mass number"**, value without a unit, and a note: **"No stable isotope — longest-lived
  isotope"** for the 10 elements up to Pu (94), **"No stable isotope — mass number of a known isotope"** for the 24
  elements Am–Og (95–118). Standard weights keep "Atomic Mass … u".
* Periodic-table cell: bracketed mass number (`[270]`), the IUPAC/NIST convention, instead of `270.00`.
* New field `atomicMassKind: "standard-weight" | "mass-number"` on every element (test: it is exactly the set CIAAW/NIST
  give no standard weight for, and every such number is an integer that appears among the evaluated most-stable isotopes).

**Where the label rests on NIST (owner decision applied, Part 2 start).** For Tc, Pm, Po–Ac, Np and Pu, NIST itself prints the
mass number of the longest-lived isotope in brackets (e.g. Tc [98], Pu [244]); the test compares each of the 10 with the
site, and those keep "longest-lived isotope". For Z 95–118 NIST lists isotopes but marks none as longest-lived, so **the
note is "mass number of a known isotope"** and no longest-lived claim is shown for those 24 (asserted for all 24 on the
panel, the page text and the descriptions; three descriptions changed, section 4). The Nubase check stays in the tests only.

**Applied (owner decision after Part 2): the 8 shown numbers that were not in NIST's isotope list now are.** NIST lists a single
isotope for each of these elements; the site now shows it (source: the same NIST page, `tests/fixtures/element-reference.json`
`nistIsotopeMassNumbers`). Every one of the 24 elements Am–Og now shows a number NIST lists.

| Element | Old | New (NIST) |
| --- | --- | --- |
| Lr (103) | 266 | **262** |
| Sg (106) | 269 | **271** |
| Bh (107) | 270 | **272** |
| Mt (109) | 278 | **276** |
| Rg (111) | 282 | **280** |
| Nh (113) | 286 | **284** |
| Mc (115) | 290 | **288** |
| Ts (117) | 294 | **292** |

These are no longer all among the most stable known isotopes in current evaluations (Nubase 2020, test-only): for Bh, Mt, Rg, Nh
and Ts the NIST isotope is a different one (e.g. NIST Ts-292, Nubase Ts-294). That is why the note says only "a known isotope"
and why the test lists those five as decided differences.

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
| No (Part 2) | (Part 1 wording) "…even its longest-lived known isotope has a half-life of only about an hour." | "Named for Alfred Nobel — made only in particle accelerators, a few atoms at a time." | Owner decision: no longest-lived claim for Z 95–118 |
| Bh (Part 2) | (Part 1 wording) "…short-lived: its longest-lived known isotope has a half-life of about a minute." | "Honors Niels Bohr — a short-lived synthetic element made only a few atoms at a time." | Same |
| Mc (Part 2) | (Part 1 wording) "…its longest-lived known isotopes decay within about a second." | "Named for Moscow Oblast — synthetic and short-lived, observed only a few atoms at a time." | Same |
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
| **Wikipedia / Wikimedia Commons** (element photos, loaded at runtime until Part 2) | Each lead image is a Commons file with its own licence; reuse needs author, licence name and link (Commons: "the content creator who must be credited, not the uploader"). The REST summary the site used does not return them and the UI never showed them | **Resolved (Part 2): removed.** The panel shows the site's own phase illustration ("Illustration generated by this site, not a photograph"); no request goes to Wikipedia; the CSP no longer allows `upload.wikimedia.org` or `en.wikipedia.org` |

Everything in section 5 is documentation read from the sources' own pages; it is not legal advice.

## 6. Molecules (Part 2) — checked against PubChem; differences for your decision

Method: PubChem PUG REST (computed formula and molecular weight) and PUG View (the "Melting Point" / "Boiling Point"
sections, i.e. the values PubChem shows from its depositors), retrieved by script on 2026-11-01 into
`tests/fixtures/molecule-reference.json` (not shipped). `tests/unit/molecules/molecule-data.test.ts` compares all 14
molecules. **No value in `src/lib/molecules` was changed.** In Part 2 the doubtful items were withheld from the pages; after your review they were corrected or removed in the data itself (§6.2).

**Count:** the data has **14** molecules (`ALL_MOLECULES`), not 15 as the Part 0 audit said (the home page links them in
two places). There are 14 molecule pages.

### 6.1 What agrees (shown on the pages)

| Check | Result |
| --- | --- |
| Formula (atoms per element) | 12 of 12 real formulas match PubChem exactly (ethanol's `C₂H₅OH` = C2H6O). The base pair ("Adenine–Thymine") and the dipeptide ("Gly-Ala") show names, not formulas |
| Molar mass | 13 of 13 agree with PubChem's computed value to the precision both print (serotonin 176.22 vs PubChem 176.21 and C₆₀ 720.66 vs 720.6 are rounding) |
| Melting / boiling points shown | all 11 within 3 °C of a PubChem value: water 0 / 100 °C · methane −182.5 / −161.5 °C · glucose mp 146 °C · caffeine 235–238 °C / 178 °C (sublimes) · ethanol −114.1 / 78.37 °C · aspirin mp 135 °C · capsaicin mp 65–67 °C (PubChem: 65 °C) |

### 6.2 The 14 doubtful items — **resolved** (owner instruction after Part 2: fix with a cited source, otherwise remove)

Each item was corrected in `src/lib/molecules` itself, so Explore and the molecule pages show the same thing and none of the
old wordings remains anywhere (`molecule-data.test.ts` "corrected or removed claims" pins all 14). Sources were fetched
on 2026-11-01; where a source could not be read the claim was **removed**, not kept.

| # | Molecule | Item | Was | Now | Source or reason for removal |
| --- | --- | --- | --- | --- | --- |
| 1 | Glucose | boiling point | "Decomposes at 146°C" | **removed** (melting point 146 °C stays) | PubChem D-glucose lists no boiling point; the only entry is "greater than 212 °F at 760 mmHg (USCG, 1999)" (US Coast Guard CHRIS), which is not a boiling point. 146 °C is its melting point (PubChem) |
| 2 | DNA base pair | molar mass | "~600 g/mol (pair)" | **"261.24 g/mol (adenine + thymine, free bases)"** | PubChem computed molecular weights: adenine 135.13 (CID 190) + thymine 126.11 (CID 1135) |
| 3 | DNA base pair | bond type | "Glycosidic Bond" | **removed** | the pair shown has no sugar, so no glycosidic bond |
| 4 | DNA base pair | fun fact | "…Earth to the Sun and back ~600 times" | **removed** | no source found; my own estimate differed |
| 5 | DNA base pair | state | "solid" | **kept** (now consistent with item 2) | PubChem lists both free bases (adenine, thymine) as "Solid" |
| 6 | Water | fun fact | "the only natural substance… in all three states" | **replaced:** "Liquid water is densest at about 4 °C: water at 4 °C is denser than water at 0 °C." | USGS Water Science School, *Water density* (https://www.usgs.gov/special-topics/water-science-school/science/water-density): "water at about 39°F (4°C) is denser than water at 32°F (0°C)" |
| 7 | Water | fun fact | Mpemba effect | **removed** | disputed in the literature; no authoritative source for the claim as stated |
| 8 | Caffeine | fun fact | "63 mg per espresso… ~80 cups" | **removed** | internally inconsistent; no source |
| 9 | Peptide (Gly-Ala) | fun fact | "over 100,000 distinct human proteins" | **replaced:** "The human genome has about 20,000 protein-coding genes (19,878 in Ensembl release 116, June 2026)." | Ensembl, *Homo sapiens* annotation, release 116 (https://jun2026.archive.ensembl.org/Homo_sapiens/Info/Annotation): "Coding genes 19,878". The NHGRI and HGNC pages returned 404 |
| 10 | Peptide (Gly-Ala) | fun fact | "a peptide bond every 0.05 seconds" | **removed** | no source could be fetched for ribosome speed |
| 11 | Ethanol | fun fact | membrane fluidity / "broad solvent" | **replaced:** "Ethanol is miscible with water (PubChem lists it as miscible, citing HSDB, ICSC and NIOSH)." | PubChem CID 702 Solubility: "In water, miscible" (HSDB), "Solubility in water: miscible" (ICSC), "Miscible" (NIOSH Pocket Guide). The phrase "in all proportions" is not on the page, so it is not used |
| 12 | Aspirin | fun fact | "acetyl group helps it survive stomach acid" | **replaced:** "Its systematic name, 2-acetyloxybenzoic acid, describes a benzoic acid carrying an acetyloxy group (PubChem)." | PubChem computed IUPAC name for CID 2244 (in `tests/fixtures/molecule-reference.json`). The acetylation-synthesis page could not be read, so no synthesis claim is made |
| 13 | C₆₀ | description | "a Nobel-celebrated cage… aromaticity…" | **"A closed cage of 60 carbon atoms: a truncated icosahedron with 12 pentagonal and 20 hexagonal faces, one carbon at each of its 60 corners."** | geometry (a truncated icosahedron has 60 vertices, 12 pentagons, 20 hexagons: Euler's formula) and PubChem's name "(C60-Ih)[5,6]fullerene". The Nobel Prize (1996) and 1985 discovery claims are **not** made: nobelprize.org returned 403 and the Nature article redirected to a login |
| 14 | Heme b | fun fact | "axial histidine tug-of-war…CO competition" | **removed** | no source fetched (the PDB-101 page is about hemoglobin and does not discuss the distal histidine) |

Also removed with item 6 because its source failed: water's "A water molecule stays in the atmosphere for only about 9
days" (the USGS residence-time page returned 404); I had not listed it before.

**Update.** The "read and judged, not sourced" statements this paragraph described are dealt with one by one in §6.4 (owner decision after the second review).

### 6.3 The 3D models — 9 regenerated from PubChem (7 mismatched + aspirin and serotonin); heme left as is (owner decision)

Part 2 found that 8 of the 14 models did not contain their formula's atoms. Owner decision: hide the counts derived from them
(done first, `modelMatchesFormula`), regenerate the models from PubChem 3D data, test that each model matches its formula,
and restore the counts.

**Regenerated** (`scripts/molecules/generate-structures.mjs`, run by hand, output in `src/lib/molecules/structures/*.ts`):

| Molecule | PubChem | Atoms (= formula) | Bonds | Before |
| --- | --- | --- | --- | --- |
| Glucose (D-glucose, pyranose) | CID 5793 | 24 (C6 H12 O6) | 24 | C6 H7 O6 (19 atoms) |
| Caffeine | CID 2519 | 24 (C8 H10 N4 O2) | 25 | C8 H1 N4 O2 (15) |
| DNA base pair | CID 190 (adenine) + CID 1135 (thymine) | 30 (C10 H11 N7 O2) | 31 | C10 N7 O2, no H (19) |
| Gly-Ala | CID 98153 (N-glycylalanine) | 20 (C5 H10 N2 O3) | 19 | C5 H6 N2 O3 (16) |
| Capsaicin | CID 1548943 | 49 (C18 H27 N O3) | 49 | H28, 50 atoms |
| Dopamine | CID 681 | 22 (C8 H11 N O2) | 22 | H9 (20) |
| Adrenaline | CID 5816 | 26 (C9 H13 N O3) | 26 | C10 H12 (26 atoms, wrong ones) |
| Aspirin (added after review) | CID 2244 | 21 (C9 H8 O4) | 21 | formula-correct, but 9 of 21 bonds out of range (worst C3–C7 4.35 Å) |
| Serotonin (added after review) | CID 5202 | 25 (C10 H12 N2 O) | 26 | formula-correct, but 15 of 26 bonds out of range (worst N–H 0.66 Å) |

* Coordinates are PubChem's *computed 3D conformers* (record_type=3d), unchanged except for centring on the centroid. The base
  pair has no PubChem record, so adenine and thymine are rotated into their planes and placed side by side with a 2.6 Å gap;
  **their relative position is schematic** and the page says so. Bond orders are PubChem's (1, 2, 3).
* **Licence / attribution.** NCBI's policy page (read 2026-11-01) says "NCBI itself places no restrictions on the use or
  distribution of the data" and that submitters may hold rights; these conformers are computed by PubChem, not deposited. The
  molecule pages, the About page and the home FAQ credit PubChem (CIDs linked) and say which models use PubChem's conformer.
* **Tests** (`model-check.test.tsx`, `model-geometry.test.ts`): every model has exactly its PubChem formula's atoms (13 of 14);
  for the seven regenerated: unique ids, bonds between existing atoms, X–H bonds 0.90–1.15 Å, other bonds 1.15–1.60 Å, no
  non-bonded atoms closer than 1.0 Å, the right number of connected pieces (2 for the pair), centred. The counts are back
  on Explore, the sidebar and the home page for these seven.

**Heme b — owner decision: leave as is.** PubChem has **no 3D record for any heme** (17 CIDs with formula C34H32FeN4O4 or
variants all return 404 for `record_type=3d`). The wwPDB `HEM` coordinates are **not used** (owner decision; no licence statement
found for the CCD). The heme model stays the old hand-built one: 74 atoms, one hydrogen short of C34H32FeN4O4, with Fe–N bonds of
1.41 Å. Its counts, bond bars and element composition stay hidden (decided from the data) and a test pins "heme is the only model
that does not match". The heme page says the model is a hand-built illustration.

**Aspirin and serotonin — regenerated (owner decision after review).** Same pipeline and the same geometry tests (the seven
tests in `model-geometry.test.ts` now run for nine models). The old models had the right atoms but impossible bond lengths
(see the table). Of the 14 models, 9 are PubChem conformers and 5 are hand-built illustrations (water, methane, ethanol,
buckminsterfullerene, heme); About, the home FAQ and each page say so.

### 6.4 The ~40 unsourced "uses" and fun facts — each sourced, reworded, removed or listed as textbook (owner decision)

**Defect found first (my miss in the previous round).** The Explore panel, the quick-facts panel and the home page do not read
`src/lib/molecules/data.ts` for a molecule's description, bond types, uses and fun facts: `localizeMolecule` replaces them with the
text of the locale bundle (`src/lib/i18n/content/<locale>.json`), **English included**. I had corrected the 14 doubtful items in the
data and in the molecule pages, but the 12 bundles still carried the old wording, so Mpemba, "9 days", the C₆₀ "Nobel-celebrated"
description and the rest were **still visible in the Explore UI** (only the `/molecules/*` pages were clean). Fixed in this change:
the English bundle is now identical to the data (tested), and in the other 11 locales each statement keeps its translation only
where the English statement is unchanged; where a statement was added or reworded (18 per locale) the slot holds the **English
text**, not a stale translation. Those 18 slots in 11 languages need translating by a native reviewer (I did not machine-translate
source-bound claims). `tests/unit/i18n/molecule-content-sync.test.ts` keeps bundles and data in step and lists the removed claims
as forbidden text.

**Method.** PubChem's data API (PUG View, `/rest/pug_view/data/compound/<CID>/JSON`; the PubChem *web* pages sit behind a captcha)
returns the annotation text with the depositor named — those are the "source" below — plus the EPA, NHGRI, NIAAA, MedlinePlus and
OpenStax pages and Europe PMC abstracts (retrieved 2026-11-01). NCBI Bookshelf, NINDS, NIA, Nobel, IPCC PDFs and PNAS were
unreadable (captcha/403), so nothing rests on them. A statement is "sourced" only if I read a sentence that says it.

**A. Kept — a source says it** (wording unchanged)

| Molecule | Statement | Source (read) |
| --- | --- | --- |
| Methane | "The simplest hydrocarbon and a potent greenhouse gas" | MeSH via PubChem CID 297: "The simplest saturated hydrocarbon"; EPA *Methane emissions*: "Pound for pound, the comparative impact of CH4 is 28 times greater than CO2 over a 100-year period" |
| Glucose | α- and β-glucose differ in the hydroxyl at carbon 1 | OpenStax *Biology 2e* §3.2 |
| Glucose | "about 4 Calories per gram" | OpenStax §3.2: "a gram of carbohydrate provides 4.3 Kcal". **Rounded, and a carbohydrate figure, not glucose-specific — your call** |
| Caffeine | stimulant in coffee, tea, energy drinks | PubChem CID 2519, StatPearls: coffee beans, tea and cacao beans, "an additive to soda and energy drinks" |
| Caffeine | combined with aspirin for pain | MedlinePlus (aspirin entry lists "Anacin Advanced Headache Formula … Acetaminophen, Aspirin, Caffeine") |
| Caffeine | apnea in premature infants | HSDB via PubChem: "Caffeine citrate is used iv or orally … for apnea of prematurity" (FDA orphan drug) |
| Caffeine | performance in endurance sports | DrugBank via PubChem: "enhances athletic performance"; NIH ODS fact sheet "Caffeine for performance" is listed there |
| Caffeine | blocks adenosine receptors, warding off tiredness | NCIt: "binds to adenosine receptors in the central nervous system, which inhibits adenosine binding"; T3DB: "temporarily warding off drowsiness" |
| Caffeine | "most widely consumed psychoactive substance" | StatPearls: "most utilized psychoactive stimulant worldwide"; HSDB: "the most widely consumed … psychoactive drug in the world" |
| DNA pair | template for mRNA transcription | NHGRI glossary: "mRNA is made from a DNA template during the process of transcription" |
| DNA pair | DNA fingerprinting in forensics | NHGRI glossary: "…criminal investigations, other forensic purposes and paternity testing" |
| DNA pair | ~3 billion base pairs | NHGRI glossary *Genome*: "the human genome contains about 3 billion nucleotides" |
| Peptide | aspartame is a dipeptide | ChEBI via PubChem CID 134601: "Aspartame is a dipeptide…" |
| Ethanol | alcoholic beverages; solvent | DrugBank via CID 702: "widely used as a solvent … primary ingredient in alcoholic beverages"; ChEBI: "polar solvent" |
| Ethanol | liver turns it into acetaldehyde, then acetate | NIAAA *Alcohol metabolism* (June 2025) |
| Aspirin | analgesic, antipyretic, anti-inflammatory (NSAID), antiplatelet | DrugBank, MeSH, FDA Pharm Classes via CID 2244 |
| Aspirin | "irreversibly" changes platelet chemistry | DrugBank mechanism: acetyl group binds a serine of COX-1, "leading to irreversible inhibition" |
| Capsaicin | culinary heat | T3DB: "primary pungent principle in Capsicum fruits … among the most heavily consumed spices" |
| Capsaicin | topical analgesic creams (TRPV1) | ChEBI: "TRPV1 agonist, a non-narcotic analgesic"; DrugBank: "most often used as a topical analgesic" |
| Capsaicin | pest-deterrent formulations | Haz-Map (citing FDA): "Used as a repellent for birds, voles, deer, rabbits, squirrels, insects…" |
| Serotonin | neurotransmission and neuromodulation | MeSH: "Serotonin mediates … neurotransmission, gastrointestinal motility, hemostasis" |
| Serotonin | roles in the enteric nervous system | Gershon, *Serotonin, a Molecular Megillah* (Europe PMC PMC10322229) |
| Dopamine | neurotransmitter in reward and motor pathways | MeSH: "catecholamine neurotransmitters … regulating movement"; StatPearls: "mesocorticolimbic pathway … reward processing" |
| Dopamine | Parkinson's and substantia-nigra dopamine neuron loss | Europe PMC PMC13526957: "degeneration of substantia nigra dopaminergic neurons" |
| Adrenaline | anaphylaxis auto-injectors | MedlinePlus epinephrine injection; DrugBank "type I allergic reactions, including anaphylaxis" |
| Adrenaline | local-anaesthetic adjunct | MeSH: "to delay absorption of local anesthetics" |
| Adrenaline | acts on α- and β-adrenergic receptors (vasoconstriction, bronchodilation) | FDA Pharm Classes; NCIt; MedlinePlus |
| C₆₀ | 12 pentagons and 20 hexagons | the definition of a truncated icosahedron (geometry; also §6.2 item 13) |

**B. Reworded to what the source says** (old → new)

| Molecule | Old | New | Why |
| --- | --- | --- | --- |
| Methane | "80× more potent … over a 20-year period" | "about 81–83 times … (EPA, citing IPCC AR6)" | EPA *Understanding GWPs*: "the 20-year GWP of 81–83". The IPCC chapter PDF returned 403, so the fossil/non-fossil split is not checked |
| Methane | "Methanogenic archaea produce methane deep in ocean sediments and cow digestive systems" | "Cattle and other livestock produce methane as part of their normal digestion; microbes also make it where organic matter decays without oxygen, as in wetlands (EPA)." | EPA names livestock digestion and oxygen-free decay; no page I could read names archaea or deep sediments |
| Ethanol | "Antiseptic and fuel bio-additives" | "Antiseptic and disinfectant (topical)" | ChEBI/DrugBank say antiseptic and disinfectant; no readable source for fuel use |
| Capsaicin | description "…an evolutionary deterrent for mammals and a neuroscientist's favorite TRPV1 conversation starter" | "The pungent compound of chili peppers: a TRPV1 agonist that is also used in topical pain relief." | "mammals" is not in any readable source |
| Capsaicin | "Birds often lack the receptor sensitivity mammals have—chili seeds spread farther that way." | "Capsaicin selectively discourages vertebrate predators of chili fruit without deterring the more effective seed dispersers (Tewksbury & Nabhan, Nature 2001)." | the abstract (Europe PMC 11473305) says exactly that and does not mention birds; the paper itself was behind a 403 |
| Serotonin | description "…mood, sleep, and gut motility" | "5-HT: a monoamine messenger found in the brain, the gut and blood platelets, with roles in neurotransmission, gut motility and hemostasis." | MeSH wording; no readable source for mood or sleep |
| Serotonin | "SSRIs act upstream in pathways" | "Target of SSRI antidepressants (selective serotonin reuptake inhibitors)" | MedlinePlus lists SSRIs as an antidepressant class |
| Serotonin | "…a large share is entangled with the gut and platelets" | "Most of the body's serotonin is produced in the gut, not in the brain." | Gershon: "the gut produces most of the body's 5-HT"; no readable share figure |
| Dopamine | "Clinical shock support (as hydrochloride salt, IV, under care)" | "Clinical use in shock syndromes (as dopamine hydrochloride, under medical care)" | DrugBank indication: shock syndrome; "IV" is not stated there |
| Dopamine | "It's polar enough that free dopamine doesn't casually joyride across the blood–brain barrier" | "Dopamine in the bloodstream does not cross the blood–brain barrier to a substantial extent." | HSDB: "does not cross the blood-brain barrier to a substantial extent"; the "polar enough" cause is not in the source |
| Adrenaline | "'Adrenaline' vs 'epinephrine' is largely UK/US naming…" | "Adrenaline and epinephrine are two names for the same hormone." | DrugBank: "Epinephrine, also known as adrenaline"; the UK/US claim has no source |
| C₆₀ | "Electron acceptor motifs in organic electronics research" | "Electron acceptors (fullerene derivatives) in organic solar-cell research" | Europe PMC PMC13007892 (review "from fullerene dominance to non-fullerene innovation" in organic photovoltaics) |
| C₆₀ | "Named after architect Buckminster Fuller, who popularized geodesic domes." | "Named after Buckminster Fuller because its structure resembles his geodesic domes." | MeSH: "named after Buckminster Fuller because of structural resemblance to geodesic domes" |

**C. Removed — no readable source**

| Molecule | Removed |
| --- | --- |
| Methane | "all four C–H bonds equal length (1.09 Å)" (NIST CCCBDB returned 502) |
| Glucose | "Your brain consumes about 120g of glucose per day — roughly 60%…" |
| DNA pair | use: "CRISPR-Cas9 gene editing target sites" (NHGRI only says CRISPR modifies DNA) |
| Peptide | use: "Template for synthetic peptide drug design" |
| Aspirin | "Willow bark salicin is the plant-world ancestor…" (only "salicylate-containing willow" was readable, not salicin) |
| Capsaicin | "Spice 'heat' is not a taste on the tongue map; it's nociceptor theater" |
| Serotonin | "Its name nods to blood serum…" (etymology: no readable source) |
| Dopamine | use: "Teaching ligand for GPCR and transporter biology" |
| Adrenaline | use: "Physiology demos of fight-or-flight signaling" |
| C₆₀ | uses: "Materials science prototypes (thin films, composites)", "Nanoscale carbon allotrope teaching tool" |
| Heme | use: "Biochemistry teaching for ligand-field and cooperative binding" |

**D. Plain textbook chemistry, no source added — for you to confirm or cut**

* Water: description ("…essential for all known forms of life"; USGS says "essential for life") and its four uses.
* The bond-type labels of every molecule ("Polar Covalent", "Aromatic Ring", "Peptide Bond (C–N)", "Hydrogen Bond (×2 A–T)" …).
* Methane: its four uses (fuel, power generation, hydrogen production, feedstock). Glucose: its four uses (glycolysis, IV drips, sports drinks, fermentation).
* DNA pair: "Genetic information storage in all living organisms"; "Adenine always pairs with Thymine via 2 hydrogen bonds — Watson-Crick".
* Peptide: "Fundamental unit of all protein structures"; "Cell signaling via peptide hormones"; "partial double-bond character… planar" (NCBI Bookshelf was behind a captcha).
* Heme: "O₂ transport and storage in hemoproteins", "Enzyme active sites (e.g. catalase, cytochromes)", the four-heme cooperative binding fact.
* Descriptions that are structural or flavour text with no further claim: glucose, caffeine, DNA pair, dipeptide, ethanol, aspirin, dopamine, adrenaline, heme.

## 7. Element categories (Part 2) — against IUPAC

Source: IUPAC, *Nomenclature of Inorganic Chemistry — IUPAC Recommendations 2005* (Red Book), section IR-3.5 "Elements in
the periodic table" (read from the PDF on iupac.org; the Gold Book website refused automated access, so Gold Book
definitions were **not** checked). IR-3.5 approves these collective names: alkali metals (Li, Na, K, Rb, Cs, Fr), alkaline
earth metals (Be, Mg, Ca, Sr, Ba, Ra), pnictogens, chalcogens (O, S, Se, Te, Po), halogens (F, Cl, Br, I, At), noble gases
(He, Ne, Ar, Kr, Xe, Rn), lanthanoids (La–Lu), rare earth metals and actinoids (Ac–Lr). On transition elements: "the
elements of groups 3–12 are the d-block elements. These elements are also commonly referred to as the transition elements,
though the elements of group 12 are not always included." It prefers "lanthanoid/actinoid" to "lanthanide/actinide". It
defines no "metalloid", "nonmetal" or "post-transition metal".

| Site label | Elements | Against IR-3.5 |
| --- | --- | --- |
| alkali metal, alkaline earth metal | Li–Fr, Be–Ra | **agree** |
| lanthanide (15), actinide (15) | La–Lu, Ac–Lr | **agree** on membership (La and Ac included, as IUPAC notes); IUPAC prefers the spelling "lanthanoid"/"actinoid" |
| transition metal (38) | Sc–Zn, Y–Cd, Hf–Hg, Rf–Cn | consistent with "groups 3–12" (group 12 optional); Rf–Cn's chemistry is largely unmeasured |
| halogen | F, Cl, Br, I, At, **Ts** | Ts is **not** in IR-3.5's list (named in 2016, after the 2005 book); its group-17 placement is positional, its properties unknown |
| noble gas | He–Rn, **Og** | Og is **not** in IR-3.5's list (named in 2016); predicted not to behave like a noble gas |
| metalloid | B, Si, Ge, As, Sb, Te, **Po** | **no IUPAC definition**; IR-3.5 lists Po as a chalcogen and does not call it a metalloid; Po is commonly classed as a metal |
| nonmetal | H, C, N, O, P, S, Se | **no IUPAC collective name** |
| post-transition metal | Al, Ga, In, Sn, Tl, Pb, Bi, Nh, Fl, Mc, Lv | **no IUPAC collective name**; Nh–Lv are predicted |

**Applied (owner decision after Part 2): keep the common grouping, label it, and state IUPAC's wording for Po, Ts and Og.**

* Every element's panel says **"Common classification, not an IUPAC designation"** under its category badge; the legend under the
  table says "Categories: common classification, not an IUPAC designation."; the periodic-table page text says the categories follow
  the common textbook classification and names the sources. The categories themselves are unchanged (Po stays "metalloid", Ts
  "halogen", Og "noble gas").
* Three panels carry IUPAC's own wording (`src/lib/periodic-table/classification.ts`, pinned by test):
  * **Polonium** — "IUPAC lists polonium among the chalcogens (group 16) and does not classify it as a metalloid; “metalloid” here
    is the common classification." Source: IUPAC Red Book 2005, IR-3.5 (chalcogens: O, S, Se, Te, Po; no definition of "metalloid").
    No IUPAC page I could read says polonium is, or is not, a metal.
  * **Tennessine** — "IUPAC places tennessine in group 17; the “halogen” label here reflects that group position." Source: IUPAC,
    30 November 2016, *IUPAC announces the names of the elements 113, 115, 117, and 118*: the ending is “-ine” "for element 117
    and belonging to group 17" (https://iupac.org/iupac-announces-the-names-of-the-elements-113-115-117-and-118/). The page does not
    use the word "halogen"; IR-3.5 names group 17 "halogens" but predates tennessine (2005), so the label rests on the group number.
  * **Oganesson** — same, group 18 ("-on"), "noble gas" reflects the group position.
* **Not verified:** the IUPAC periodic table image (4 May 2022) could not be read as text; the 2016 *Names and symbols* paper
  (doi 10.1515/pac-2016-0501) returned 405; the Gold Book (403) was not read, so IUPAC's Gold Book definitions of "transition
  element" and "metalloid" remain unchecked.

## 8. The phase illustration (the only element visual) — resolved, one cutoff for you to confirm

* **Oganesson is no longer drawn as a gas.** It was in the "gas" list; PubChem's periodic table says only "Expected to be a Gas" (and
  "Expected to be a Solid" for Ds–Ts), relativistic calculations predict a solid, and no bulk sample exists. It now shows
  "State unknown / not produced in bulk".
* **"Crystalline solid" is no longer shown for elements never made in bulk.** The panel shows "State unknown / not produced in
  bulk" (and no crystal pattern) for **astatine, francium and every element from fermium (Z = 100) to oganesson: 21 elements**.
  States over all 118: 11 gases, 2 liquids (Br, Hg), 21 unknown, 84 solids (test).
* **Your call — the cutoff has no source.** I could not read an authoritative statement for "never made in bulk": the Royal
  Society of Chemistry element pages returned 403, and PubChem's table lists estimated melting points for Fm–Lr that nobody has
  measured. The set follows the site's own descriptions ("exists only in trace amounts", "too unstable for macroscopic
  applications"). If you would rather start at einsteinium (99), at Rf (104), or only at the "Expected to be…" elements
  (110–118) that PubChem itself marks as predicted, it is one constant (`FIRST_ELEMENT_NEVER_MADE_IN_BULK`, and `TRACE_ONLY`
  for At and Fr). A different list is a one-line change plus the test.
* The gas-cloud colours ("Simulated discharge glow") come from `emission-spectrum.ts` and were not checked.
