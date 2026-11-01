import { ImageResponse } from "next/og";
import { SITE_NAME } from "@/lib/seo/site";

/**
 * SEO-07. The one share image for every page (1200 × 630, the 1.91:1 size Meta recommends), generated at build
 * time: product name and tagline only, plus the Atom mark the navbar uses. No claims, ratings or statistics.
 */
export const alt = `${SITE_NAME}: interactive 3D chemistry`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TEAL = "#2dd4bf";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          padding: "0 96px",
          background: "linear-gradient(135deg, #020617 0%, #0f172a 60%, #042f2e 100%)",
          color: "#f8fafc",
        }}
      >
        <svg width="260" height="260" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="1" fill={TEAL} />
          <path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z" />
          <path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z" />
        </svg>
        <div style={{ display: "flex", flexDirection: "column", marginLeft: 72 }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>{SITE_NAME}</div>
          <div style={{ fontSize: 38, marginTop: 28, color: "#94a3b8" }}>Interactive 3D chemistry</div>
        </div>
      </div>
    ),
    size,
  );
}
