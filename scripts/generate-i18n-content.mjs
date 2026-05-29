import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { en } from "./i18n/en.mjs";
import { uiEn } from "./i18n/ui-en.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../src/lib/i18n/content");

const LOCALES = ["en", "tr", "de", "es", "pt", "ko", "ja", "fr", "ru", "zh", "it", "hi"];

async function loadLocale(code) {
  if (code === "en") {
    return { ...en, ui: uiEn };
  }
  const mod = await import(`./i18n/${code}.mjs`);
  return mod.default;
}

function countLines(obj) {
  return JSON.stringify(obj, null, 2).split("\n").length;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const summary = [];

  for (const locale of LOCALES) {
    const data = await loadLocale(locale);
    const outPath = path.join(OUT_DIR, `${locale}.json`);
    const json = JSON.stringify(data, null, 2) + "\n";
    fs.writeFileSync(outPath, json, "utf8");
    summary.push({ locale, path: outPath, lines: countLines(data) });
  }

  console.log("Created i18n content files:\n");
  for (const { locale, path: p, lines } of summary) {
    console.log(`  ${locale}.json — ${lines} lines — ${p}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
