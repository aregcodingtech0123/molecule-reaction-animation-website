import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** HDR environment maps from @react-three/drei Environment presets */
const DREI_HDRI_ORIGINS = [
  "https://raw.githack.com",
  "https://raw.githubusercontent.com",
];

function buildContentSecurityPolicy(): string {
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "https://accounts.google.com",
    // React / Next.js dev tooling uses eval for stack traces and HMR
    ...(isDev ? ["'unsafe-eval'"] : []),
  ];

  // Google Identity Services injects a stylesheet from accounts.google.com/gsi/style.
  // Without the origin here, GSI renders unstyled or the button fails to mount.
  const styleSrc = ["'self'", "'unsafe-inline'", "https://accounts.google.com"];

  const frameSrc = ["'self'", "https://accounts.google.com"];

  const connectSrc = [
    "'self'",
    "https://pubchem.ncbi.nlm.nih.gov",
    "https://en.wikipedia.org",
    "https://accounts.google.com",
    ...DREI_HDRI_ORIGINS,
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    "img-src 'self' data: https: blob:",
    `connect-src ${connectSrc.join(" ")}`,
    `frame-src ${frameSrc.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  // Testability: the E2E suite runs its own `next dev` in `.next-e2e` so it never
  // collides with a developer's dev server (Next allows one dev server per distDir).
  // Unset → Next's default `.next`.
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: buildContentSecurityPolicy(),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
