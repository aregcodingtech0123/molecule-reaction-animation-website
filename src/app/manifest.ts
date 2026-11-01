import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/seo/site";

/**
 * SEO-08. Names and colours only. `display: "browser"` on purpose: this is a website, not an installable app, and
 * the CSP already allows `manifest-src 'self'`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: "MoleculeStudio",
    description: "Interactive 3D chemistry: molecules, atomic models and the periodic table.",
    start_url: "/",
    display: "browser",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
