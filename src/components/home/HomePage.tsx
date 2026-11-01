"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Scene } from "@/components/canvas/Scene";
import { HomeMoleculePreview } from "@/components/home/HomeMoleculePreview";
import { ArrowRight, Dna, Atom, Hexagon } from "lucide-react";
import Link from "next/link";
import { ALL_MOLECULES } from "@/lib/molecules/data";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage, localizeMolecule } from "@/lib/i18n/localize";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";
import { HomeAiLabSection } from "@/components/ai/HomeAiLabSection";
import { HomeStudioShowcases } from "@/components/home/HomeStudioShowcases";

export function HomePage() {
  const { locale, t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();

  const molecules = useMemo(
    () => ALL_MOLECULES.map((m) => localizeMolecule(m, locale)),
    [locale],
  );

  const features = useMemo(
    () => [
      { icon: Atom, title: t.feature_atomic_title, desc: t.feature_atomic_desc },
      { icon: Hexagon, title: t.feature_crystal_title, desc: t.feature_crystal_desc },
      { icon: Dna, title: t.feature_macro_title, desc: t.feature_macro_desc },
    ],
    [t],
  );

  const showcaseBullets = useMemo(
    () => [t.showcase_bullet_1, t.showcase_bullet_2, t.showcase_bullet_3],
    [t],
  );

  return (
    <main className="min-h-screen overflow-hidden">
      <section className="relative h-screen flex flex-col items-center justify-center">
        <Scene />

        <div className="relative z-10 flex flex-col items-center text-center px-4 max-w-5xl mx-auto mt-20 pointer-events-none">
          {/* Entrance animations are CSS (PERF-23): framer-motion's initial opacity 0 kept the hero — the
              page's LCP element — invisible until all JavaScript had loaded and hydrated. The title only
              slides (no fade): an element first painted at opacity 0 is not an LCP candidate at all. */}
          <p
            className={cn(
              "home-kicker mb-8 inline-flex items-center gap-3 border px-3 py-1.5 rounded-sm",
              "animate-in fade-in ease-out fill-mode-both motion-reduce:animate-none slide-in-from-bottom-2 duration-800",
              ui.accent.heroBadge,
            )}
          >
            <span className={cn("h-px w-6", ui.accent.heroBadgeRule)} aria-hidden />
            {t.hero_badge}
          </p>

          <h1
            className="home-hero-title text-5xl md:text-7xl lg:text-[5.5rem] mb-8 animate-in ease-out fill-mode-both motion-reduce:animate-none slide-in-from-bottom-8 duration-800 delay-200"
          >
            {t.hero_title_prefix} <br className="hidden md:block" />
            <span className={ui.accent.headline}>{t.hero_title_highlight}</span>
          </h1>

          <p
            className={cn(
              "text-lg md:text-xl max-w-2xl mb-12 font-light leading-relaxed",
              "animate-in fade-in ease-out fill-mode-both motion-reduce:animate-none slide-in-from-bottom-5 duration-800 delay-400",
              ui.typography.subtitle,
            )}
          >
            {t.hero_subtitle}
          </p>

          <div className="flex flex-col sm:flex-row gap-4 pointer-events-auto animate-in fade-in ease-out fill-mode-both motion-reduce:animate-none slide-in-from-bottom-5 duration-800 delay-600">
            <Link
              href="/explore"
              className={cn(
                "group px-8 py-3.5 rounded-sm font-medium transition-all border",
                ui.nav.cta,
              )}
            >
              <span className="flex items-center gap-2">
                {t.hero_launch_studio}{" "}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>
            <Link
              href="/showcase"
              className={cn(
                "px-8 py-3.5 rounded-sm font-medium border transition-all",
                ui.accent.secondaryButton,
              )}
            >
              {t.hero_view_showcase}
            </Link>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <span className={cn("text-xs uppercase tracking-widest", ui.typography.muted)}>{t.hero_scroll}</span>
          <div className={cn("w-px h-12", ui.accent.scrollCue)} />
        </motion.div>
      </section>

      <HomeAiLabSection />

      <section className="relative z-10 py-32 px-6 max-w-7xl mx-auto">
        <div className="mb-16 md:mb-20 max-w-3xl">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="home-section-title text-3xl md:text-5xl mb-4"
          >
            {t.featured_title_prefix}{" "}
            <span className={ui.accent.section}>{t.featured_title_highlight}</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className={cn("text-base md:text-lg max-w-2xl", ui.typography.subtitle)}
          >
            {t.featured_subtitle}
          </motion.p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
          {molecules.map((mol, idx) => (
            <motion.div
              key={mol.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: idx * 0.06 }}
            >
              <Link
                href={`/explore?molecule=${mol.id}`}
                className={cn(
                  "block p-5 group",
                  ui.marketing.catalogCard,
                  ui.marketing.catalogCardHover,
                )}
              >
                <div
                  className={cn(
                    "flex items-baseline justify-between gap-3 mb-3 pb-3 border-b",
                    ui.marketing.catalogDivider,
                  )}
                >
                  <h3 className={cn("font-display text-lg font-semibold tracking-tight", ui.typography.title)}>
                    {mol.name}
                  </h3>
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[10px] px-2 py-0.5 rounded-sm border",
                      ui.accent.formulaChip,
                    )}
                  >
                    {mol.formula}
                  </span>
                </div>
                <p className={cn("text-sm leading-relaxed mb-4 line-clamp-3", ui.typography.subtitle)}>
                  {mol.description}
                </p>
                <div className={cn("flex items-center justify-between text-xs", ui.typography.muted)}>
                  <span>
                    {formatMessage(t.card_atoms_bonds, {
                      atoms: mol.atoms.length,
                      bonds: mol.bonds.length,
                    })}
                  </span>
                  <span
                    className={cn(
                      "flex items-center gap-1 font-medium opacity-0 group-hover:opacity-100 transition-opacity",
                      ui.accent.link,
                    )}
                  >
                    {t.card_explore} <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <HomeStudioShowcases />

      <section className={cn("relative z-10 py-32 px-6 max-w-7xl mx-auto border-t", ui.borders.divider)}>
        <div className="mb-16 md:mb-20 text-center max-w-3xl mx-auto">
          <h2 className="home-section-title text-3xl md:text-5xl mb-4">
            {t.elements_title_prefix}{" "}
            <span className={ui.accent.section}>{t.elements_title_highlight}</span>
          </h2>
          <p className={cn("text-base md:text-lg", ui.typography.subtitle)}>{t.elements_subtitle}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-10 md:gap-8">
          {features.map((feature, idx) => (
            <motion.article
              key={feature.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.12 }}
              className={ui.marketing.featurePanel}
            >
              <span
                className={cn(
                  "font-display text-5xl font-bold leading-none block mb-5",
                  ui.accent.featureIndex,
                )}
                aria-hidden
              >
                {String(idx + 1).padStart(2, "0")}
              </span>
              <div className="flex items-center gap-2 mb-3">
                <feature.icon className={cn("w-4 h-4 shrink-0", ui.accent.icon)} strokeWidth={1.75} />
                <h3 className={cn("font-display text-xl font-semibold tracking-tight", ui.typography.title)}>
                  {feature.title}
                </h3>
              </div>
              <p className={cn("text-sm leading-relaxed max-w-sm", ui.typography.subtitle)}>{feature.desc}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <section
        className={cn(
          "relative z-10 py-32 px-6 border-t",
          ui.borders.divider,
          ui.marketing.showcaseSection,
        )}
      >
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center gap-12 md:gap-16">
          <div className="flex-1 space-y-8">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="home-section-title text-4xl md:text-5xl leading-tight"
            >
              {t.showcase_title_prefix} <br />
              <span className={cn("font-normal", ui.typography.muted)}>{t.showcase_title_suffix}</span>
            </motion.h2>
            <p className={cn("text-lg max-w-lg", ui.typography.subtitle)}>{t.showcase_body}</p>

            <ul className={cn("space-y-3 border-l-2 pl-5", ui.accent.rule)}>
              {showcaseBullets.map((item) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className={cn("text-sm leading-relaxed", ui.typography.body)}
                >
                  {item}
                </motion.li>
              ))}
            </ul>

            <Link
              href="/showcase"
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-semibold transition-all",
                isWhiteLab
                  ? "border-teal-300 bg-teal-50 text-teal-900 hover:bg-teal-100"
                  : "border-teal-400/40 bg-teal-500/10 text-teal-100 hover:bg-teal-500/20",
              )}
            >
              {t.nav_showcase}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <div className={cn("flex-1 w-full aspect-square p-1.5", ui.marketing.showcaseChassis)}>
            <HomeMoleculePreview
              molecule="caffeine"
              className="h-full w-full"
              frameClassName="rounded-sm border-0 shadow-none"
              rounded="sm"
              lazy
              reduceEffects
              showMetadata
            />
          </div>
        </div>
      </section>

      <section className={cn("relative z-10 py-32 px-6 border-t", ui.borders.divider)}>
        <div className="max-w-7xl mx-auto mb-14 md:mb-16">
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="home-section-title text-3xl md:text-5xl mb-4 text-center"
          >
            {t.compare_title_prefix}{" "}
            <span className={ui.accent.section}>{t.compare_title_highlight}</span>
          </motion.h2>
          <p className={cn("max-w-xl mx-auto text-center text-base", ui.typography.subtitle)}>
            {t.compare_subtitle}
          </p>
        </div>

        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-6">
          {[molecules[0], molecules[3]].map((mol, i) => (
            <motion.div
              key={mol.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
            >
              <Link
                href={`/explore?molecule=${mol.id}`}
                className={cn(
                  "flex flex-col p-4 md:p-5 block group",
                  ui.marketing.compareTile,
                  ui.marketing.compareTileHover,
                )}
              >
                <HomeMoleculePreview
                  molecule={mol.id}
                  className="w-full aspect-video mb-4"
                  rounded="sm"
                  lazy
                  reduceEffects
                  pointerEventsNone
                />
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className={cn("font-display text-xl font-semibold tracking-tight", ui.typography.title)}>
                    {mol.name}
                  </h3>
                  <span className={cn("font-mono text-xs", ui.typography.monoMuted)}>{mol.formula}</span>
                </div>
                <p className={cn("text-xs mt-2", ui.typography.muted)}>
                  {formatMessage(t.card_atoms_bonds, {
                    atoms: mol.atoms.length,
                    bonds: mol.bonds.length,
                  })}
                </p>
                <span
                  className={cn(
                    "mt-3 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1",
                    ui.accent.link,
                  )}
                >
                  {t.card_explore} <ArrowRight className="w-3 h-3" />
                </span>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </main>
  );
}
