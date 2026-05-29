"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Scene } from "@/components/canvas/Scene";
import { Brain, Cuboid, ArrowRight, Dna, Atom, FlaskConical, Hexagon, Microscope } from "lucide-react";
import Link from "next/link";
import { ALL_MOLECULES } from "@/lib/molecules/data";
import { useLanguage } from "@/context/LanguageContext";
import { formatMessage, localizeMolecule } from "@/lib/i18n/localize";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";
import { HomeAiLabSection } from "@/components/ai/HomeAiLabSection";

export default function Home() {
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
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full glass border-indigo-500/30 text-indigo-300 text-sm font-medium tracking-wide shadow-[0_0_20px_rgba(99,102,241,0.2)]"
          >
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            {t.hero_badge}
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight mb-8"
          >
            {t.hero_title_prefix} <br className="hidden md:block" />
            <span className="text-gradient text-glow">{t.hero_title_highlight}</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className={cn("text-lg md:text-xl max-w-2xl mb-12 font-light leading-relaxed", ui.typography.subtitle)}
          >
            {t.hero_subtitle}
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="flex flex-col sm:flex-row gap-6 pointer-events-auto"
          >
            <Link
              href="/explore"
              className="group relative px-8 py-4 bg-white text-black rounded-full font-medium overflow-hidden transition-all hover:scale-105"
            >
              <span className="relative z-10 flex items-center gap-2">
                {t.hero_launch_studio} <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </Link>
            <Link
              href="/learn"
              className={cn("px-8 py-4 glass rounded-full font-medium transition-all", ui.typography.title, "hover:opacity-90")}
            >
              {t.hero_view_showcase}
            </Link>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 1 }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        >
          <span className={cn("text-xs uppercase tracking-widest", ui.typography.muted)}>{t.hero_scroll}</span>
          <div className="w-[1px] h-12 bg-gradient-to-b from-gray-500 to-transparent" />
        </motion.div>
      </section>

      <HomeAiLabSection />

      <section className="relative z-10 py-32 px-6 max-w-7xl mx-auto">
        <div className="text-center mb-20">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl md:text-5xl font-bold mb-6"
          >
            {t.featured_title_prefix}{" "}
            <span className="text-gradient">{t.featured_title_highlight}</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className={cn("max-w-2xl mx-auto", ui.typography.subtitle)}
          >
            {t.featured_subtitle}
          </motion.p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {molecules.map((mol, idx) => (
            <motion.div
              key={mol.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: idx * 0.1 }}
            >
              <Link
                href={`/explore?molecule=${mol.id}`}
                className="glass-card p-6 block group hover:border-indigo-500/30 transition-all duration-300 hover:shadow-[0_0_30px_rgba(99,102,241,0.1)]"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center group-hover:bg-indigo-500/20 transition-colors">
                    <FlaskConical className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h3 className={cn("font-semibold group-hover:text-indigo-700 transition-colors", ui.typography.title)}>
                      {mol.name}
                    </h3>
                    <p className={cn("text-xs font-mono", ui.typography.monoMuted)}>{mol.formula}</p>
                  </div>
                </div>
                <p className={cn("text-sm leading-relaxed mb-4", ui.typography.subtitle)}>{mol.description}</p>
                <div className={cn("flex items-center justify-between text-xs", ui.typography.muted)}>
                  <span>
                    {formatMessage(t.card_atoms_bonds, {
                      atoms: mol.atoms.length,
                      bonds: mol.bonds.length,
                    })}
                  </span>
                  <span className="text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    {t.card_explore} <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      <section className={cn("relative z-10 py-32 px-6 max-w-7xl mx-auto border-t", ui.borders.divider)}>
        <div className="text-center mb-20">
          <h2 className="text-3xl md:text-5xl font-bold mb-6">
            {t.elements_title_prefix}{" "}
            <span className="text-gradient">{t.elements_title_highlight}</span>
          </h2>
          <p className={cn("max-w-2xl mx-auto", ui.typography.subtitle)}>{t.elements_subtitle}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {features.map((feature, idx) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: idx * 0.2 }}
              className="glass-card p-8 group hover:border-indigo-500/30 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-indigo-500/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <feature.icon className="w-6 h-6 text-indigo-400" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
              <p className={cn("text-sm leading-relaxed", ui.typography.subtitle)}>{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section
        className={cn(
          "relative z-10 py-32 px-6 border-t",
          ui.borders.divider,
          isWhiteLab ? "bg-gradient-to-b from-slate-50 to-indigo-50/40" : "bg-gradient-to-b from-black to-indigo-950/20",
        )}
      >
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center gap-16">
          <div className="flex-1 space-y-8">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-4xl md:text-5xl font-bold leading-tight"
            >
              {t.showcase_title_prefix} <br />
              <span className={ui.typography.muted}>{t.showcase_title_suffix}</span>
            </motion.h2>
            <p className={cn("text-lg", ui.typography.subtitle)}>{t.showcase_body}</p>

            <ul className="space-y-4">
              {showcaseBullets.map((item) => (
                <motion.li
                  key={item}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className={cn("flex items-center gap-3", ui.typography.body)}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  {item}
                </motion.li>
              ))}
            </ul>
          </div>

          <div className="flex-1 w-full aspect-square relative glass-card p-2 rounded-3xl overflow-hidden neon-border">
            <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 to-purple-500/10 animate-pulse" />
            <div className="w-full h-full rounded-2xl bg-black/60 backdrop-blur-sm border border-white/5 flex items-center justify-center relative overflow-hidden">
              <Microscope className={cn("w-24 h-24", isWhiteLab ? "text-slate-300" : "text-white/10")} />
              <div className="absolute bottom-6 left-6 right-6 glass p-4 rounded-xl">
                <div className="h-2 w-1/3 bg-indigo-500/50 rounded-full mb-2" />
                <div className="h-2 w-full bg-white/10 rounded-full mb-1" />
                <div className="h-2 w-2/3 bg-white/10 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={cn("relative z-10 py-32 px-6 border-t", ui.borders.divider)}>
        <div className="max-w-7xl mx-auto text-center mb-16">
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-3xl md:text-5xl font-bold mb-6"
          >
            {t.compare_title_prefix}{" "}
            <span className="text-gradient">{t.compare_title_highlight}</span>
          </motion.h2>
          <p className={cn("max-w-xl mx-auto", ui.typography.subtitle)}>{t.compare_subtitle}</p>
        </div>

        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-8">
          {[molecules[0], molecules[3]].map((mol, i) => (
            <motion.div
              key={mol.id}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.2 }}
            >
              <Link
                href={`/explore?molecule=${mol.id}`}
                className="glass-card p-6 flex flex-col items-center block group hover:border-indigo-500/30 transition-all duration-300"
              >
                <div className="w-full aspect-video rounded-xl bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border border-white/5 flex items-center justify-center mb-5 group-hover:border-indigo-500/20 transition-colors">
                  <FlaskConical className="w-16 h-16 text-indigo-500/20 group-hover:text-indigo-500/35 transition-colors" />
                </div>
                <h3 className={cn("text-lg font-semibold", ui.typography.title)}>{mol.name}</h3>
                <p className={cn("text-sm font-mono", ui.typography.monoMuted)}>{mol.formula}</p>
                <p className={cn("text-xs mt-2", ui.typography.muted)}>
                  {formatMessage(t.card_atoms_bonds, {
                    atoms: mol.atoms.length,
                    bonds: mol.bonds.length,
                  })}
                </p>
                <span className="mt-3 text-indigo-400 text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
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
