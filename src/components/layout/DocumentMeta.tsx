"use client";

import { useEffect } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { DEFAULT_LOCALE } from "@/lib/i18n/languages";

/**
 * Updates the document title and description for a non-English locale. English keeps the server-rendered
 * per-route metadata (SEO-04): the dictionary holds one site-wide title, which would overwrite every route's
 * own title after hydration, including for crawlers that render JavaScript.
 */
export function DocumentMeta() {
  const { t, locale } = useLanguage();

  useEffect(() => {
    if (locale === DEFAULT_LOCALE) return;
    if (t.meta_title) document.title = t.meta_title;
    const desc = document.querySelector('meta[name="description"]');
    if (desc && t.meta_description) {
      desc.setAttribute("content", t.meta_description);
    }
  }, [t, locale]);

  return null;
}
