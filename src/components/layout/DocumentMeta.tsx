"use client";

import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";

/** Updates document title from locale dictionary (static layout metadata stays as fallback). */
export function DocumentMeta() {
  const { t } = useLanguage();

  useEffect(() => {
    if (t.meta_title) document.title = t.meta_title;
    const desc = document.querySelector('meta[name="description"]');
    if (desc && t.meta_description) {
      desc.setAttribute("content", t.meta_description);
    }
  }, [t]);

  return null;
}
