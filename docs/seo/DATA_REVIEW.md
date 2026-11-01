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

**For your decision — 8 shown numbers that are not in NIST's isotope list.** The NIST isotope lists for Z 95–118 are now in
the test fixture (`nistIsotopeMassNumbers`, same NIST page, retrieved 2026-11-01). For 16 of the 24 the shown number is one
of NIST's listed isotopes. For these 8 it is not; each is a known isotope only per Nubase 2020 (test-only), so even "a known
isotope" is not NIST-supported for them. **Values unchanged**; the test pins this list.

| Element | Shown | NIST lists (only) | Option |
| --- | --- | --- | --- |
| Lr (103) | 266 | 262 | show 262, or keep 266 |
| Sg (106) | 269 | 271 | show 271, or keep 269 |
| Bh (107) | 270 | 272 | show 272, or keep 270 |
| Mt (109) | 278 | 276 | show 276, or keep 278 |
| Rg (111) | 282 | 280 | show 280, or keep 282 |
| Nh (113) | 286 | 284 | show 284, or keep 286 |
| Mc (115) | 290 | 288 | show 288, or keep 290 |
| Ts (117) | 294 | 292 | show 292, or keep 294 |

Switching to NIST's numbers makes every shown value NIST-supported; the cost is that these are not the most stable known
isotopes in current evaluations (e.g. Ts-294 vs NIST's Ts-292). Your call.

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
| **Wikipedia** (element photos and summaries, loaded at runtime) | Separate per-image Commons licences, not shown in the UI (SEO-19) | Open; Part 2 |

Everything in section 5 is documentation read from the sources' own pages; it is not legal advice.

## 6. Molecules (Part 2) — checked against PubChem; differences for your decision

Method: PubChem PUG REST (computed formula and molecular weight) and PUG View (the "Melting Point" / "Boiling Point"
sections, i.e. the values PubChem shows from its depositors), retrieved by script on 2026-11-01 into
`tests/fixtures/molecule-reference.json` (not shipped). `tests/unit/molecules/molecule-data.test.ts` compares all 14
molecules. **No value in `src/lib/molecules` was changed.** Items listed "withheld" stay in the data and in Explore exactly as
before, but the new indexable `/molecules/<id>` pages leave them out until you decide (`src/lib/molecules/page-facts.ts`).

**Count:** the data has **14** molecules (`ALL_MOLECULES`), not 15 as the Part 0 audit said (the home page links them in
two places). There are 14 molecule pages.

### 6.1 What agrees (shown on the pages)

| Check | Result |
| --- | --- |
| Formula (atoms per element) | 12 of 12 real formulas match PubChem exactly (ethanol's `C₂H₅OH` = C2H6O). The base pair ("Adenine–Thymine") and the dipeptide ("Gly-Ala") show names, not formulas |
| Molar mass | 13 of 13 agree with PubChem's computed value to the precision both print (serotonin 176.22 vs PubChem 176.21 and C₆₀ 720.66 vs 720.6 are rounding) |
| Melting / boiling points shown | all 11 within 3 °C of a PubChem value: water 0 / 100 °C · methane −182.5 / −161.5 °C · glucose mp 146 °C · caffeine 235–238 °C / 178 °C (sublimes) · ethanol −114.1 / 78.37 °C · aspirin mp 135 °C · capsaicin mp 65–67 °C (PubChem: 65 °C) |

### 6.2 Differences and unverified claims — **your decision** (withheld from the pages, unchanged in the data)

| Molecule | Item | In the data | Finding | Options |
| --- | --- | --- | --- | --- |
| Glucose | boiling point | "Decomposes at 146°C" | PubChem gives no boiling point; 146 °C is its *melting* point (α-D-glucose). The statement conflates the two | remove, or "decomposes on strong heating (no boiling point)" |
| DNA base pair | molar mass | "~600 g/mol (pair)" | Adenine + thymine (the bases the model shows) = 135.13 + 126.11 = **261.24 g/mol**. ~600 g/mol fits a nucleotide pair with the sugar–phosphate backbone, which the model does not show | 261.24 g/mol "for the two free bases", or keep ~600 and say "as nucleotides" |
| DNA base pair | bond type | "Glycosidic Bond" | the pair shown has no sugar, so no glycosidic bond | remove |
| DNA base pair | fun fact | "…from Earth to the Sun and back ~600 times" | published estimates vary widely; I could not confirm "~600 round trips" (my own estimate ≈ 250) | remove, or cite a source |
| Water | fun fact | "the only natural substance that exists in all three physical states at temperatures normally found on Earth" | popular claim, not a sourced fact | remove or soften ("one of the few…") |
| Water | fun fact | "Hot water can freeze faster than cold water — the Mpemba effect" | the effect is disputed in the literature | remove or "is reported to… (disputed)" |
| Caffeine | fun fact | "about 63 mg per espresso — a lethal dose would require ~80 cups" | 80 × 63 mg ≈ 5 g; commonly cited lethal estimates are around 10 g or more. Internally inconsistent | remove |
| Peptide (Gly-Ala) | fun fact | "over 100,000 distinct human proteins" | ~20 000 protein-coding genes; higher counts depend on how isoforms are counted | remove or reword |
| Peptide (Gly-Ala) | fun fact | "a new peptide bond roughly every 0.05 seconds" | right order of magnitude for bacteria (~15–20 amino acids/s); eukaryotic ribosomes are slower (~5/s) | add "in bacteria" or remove |
| Ethanol | fun fact | "Ethanol disrupts membrane fluidity … part of why it's such a broad biological solvent" | mixes two unrelated properties | remove or reword |
| Aspirin | fun fact | "Its acetyl group helps it survive stomach acid better than salicylic acid alone" | not supported; acetylation was meant to reduce the irritation salicylic acid causes | remove or reword |
| C₆₀ | description | "…a Nobel-celebrated cage that taught us aromaticity doesn't require flat hexagons" | the Nobel (1996) is right; C₆₀'s aromaticity is weak and debated | the page shows its answer-first summary instead of this description until you decide |

Checked and kept: methane "80× more potent than CO₂ over 20 years" (IPCC AR6 gives ≈ 80 for fossil methane), the two
hydrogen bonds of A–T, ~3 billion base pairs, the brain's ~120 g glucose/day, 12 pentagons + 20 hexagons, serotonin in
gut/platelets, epinephrine/adrenaline naming, avian TRPV1, all "uses" lists. Playful wording ("nociceptor theater",
"mesolimbic myths") is tone, not a fact, and is unchanged.

### 6.3 The 3D models — **8 of 14 do not contain the formula's atoms** (unchanged; nothing about them is stated on the pages)

The atom positions are schematic. Element counts compared with PubChem's formula:

| Molecule | Model has | Formula needs | Note |
| --- | --- | --- | --- |
| Glucose | C6 H7 O6 | C6 H12 O6 | the five hydroxyl H are missing |
| Caffeine | C8 H1 N4 O2 | C8 H10 N4 O2 | the three methyl groups are drawn as bare C |
| DNA base pair | C10 N7 O2 (no H) | C10 H11 N7 O2 (A + T) | no hydrogens |
| Gly-Ala | C5 H6 N2 O3 | C5 H10 N2 O3 | |
| Capsaicin | H28 | H27 | one H too many |
| Dopamine | H9 | H11 | |
| Adrenaline | **C10** H12 | C9 H13 | one extra carbon |
| Heme b | H31 | H32 | |

Several models also have bond lengths far outside chemical ranges (e.g. aspirin C3–C7 4.35 Å, capsaicin C4–O9 0.36 Å, heme
Fe–N 1.41 Å where ~2.0 Å is typical). Water (H–O–H 104.5°) and methane (109.3–109.9°) are correct. Explore's "atoms" /
"bonds" totals come from these models. **Options:** (a) regenerate the eight from PubChem 3D conformers (the same source the
AI Lab already loads at runtime), (b) label them "schematic" in Explore, (c) leave as is.

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

**Your decision (nothing changed):** (a) keep the textbook categories and add a one-line note on the periodic-table page that
metalloid / nonmetal / post-transition are conventional, not IUPAC, groupings; (b) move Po to "post-transition metal" and
mark Ts, Og and Nh–Lv as "predicted"; (c) both. "lanthanide/actinide" is common usage; "lanthanoid/actinoid" is optional.
