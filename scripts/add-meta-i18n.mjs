import fs from "fs";
import path from "path";

const meta = {
  en: {
    meta_title: "Molecule Architecture Studio",
    meta_description:
      "A premium interactive chemistry platform to explore molecules in 3D.",
  },
  tr: {
    meta_title: "Molekül Mimari Stüdyosu",
    meta_description:
      "Molekülleri 3B ortamda keşfetmeniz için premium etkileşimli kimya platformu.",
  },
  de: {
    meta_title: "Molecule Architecture Studio",
    meta_description:
      "Eine Premium-Plattform für interaktive Chemie – Moleküle in 3D erkunden.",
  },
  es: {
    meta_title: "Molecule Architecture Studio",
    meta_description:
      "Una plataforma química interactiva premium para explorar moléculas en 3D.",
  },
  pt: {
    meta_title: "Molecule Architecture Studio",
    meta_description:
      "Uma plataforma química interativa premium para explorar moléculas em 3D.",
  },
  ko: {
    meta_title: "분자 구조 스튜디오",
    meta_description: "3D로 분자를 탐험하는 프리미엄 인터랙티브 화학 플랫폼.",
  },
  ja: {
    meta_title: "分子アーキテクチャスタジオ",
    meta_description:
      "3Dで分子を探索するプレミアムなインタラクティブ化学プラットフォーム。",
  },
  fr: {
    meta_title: "Molecule Architecture Studio",
    meta_description:
      "Une plateforme chimique interactive premium pour explorer les molécules en 3D.",
  },
  ru: {
    meta_title: "Студия молекулярной архитектуры",
    meta_description:
      "Премиальная интерактивная химическая платформа для изучения молекул в 3D.",
  },
  zh: {
    meta_title: "分子架构工作室",
    meta_description: "在三维空间中探索分子的优质互动化学平台。",
  },
  it: {
    meta_title: "Molecule Architecture Studio",
    meta_description:
      "Una piattaforma chimica interattiva premium per esplorare le molecole in 3D.",
  },
  hi: {
    meta_title: "मॉलिक्युल आर्किटेक्चर स्टूडियो",
    meta_description:
      "3D में अणुओं का अन्वेषण करने के लिए प्रीमियम इंटरैक्टिव रसायन विज्ञान मंच।",
  },
};

for (const [loc, m] of Object.entries(meta)) {
  const p = path.join("src/lib/i18n/content", `${loc}.json`);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  Object.assign(j.ui, m);
  fs.writeFileSync(p, `${JSON.stringify(j, null, 2)}\n`);
}

console.log("meta keys added to all locale JSON files");
