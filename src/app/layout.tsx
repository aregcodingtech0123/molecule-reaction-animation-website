import { headers } from "next/headers";
import { Inter, Syne } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { AppProviders } from "@/components/providers/AppProviders";
import { themeInitScript } from "@/lib/theme/pre-hydration";
import { rootMetadata } from "@/lib/seo/metadata";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const syne = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["600", "700", "800"],
});

// Per request (SEO-20): robots, metadataBase and canonical URLs follow SITE_URL, which is read at runtime.
export function generateMetadata() {
  return rootMetadata();
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The proxy's per-request CSP nonce (Part 2B). Reading request headers renders every page per request,
  // which a nonce-based CSP requires: Next puts the same nonce on its own scripts.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" className="dark" data-theme="night-lab" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint (FINDING-26). Key = THEME_STORAGE_KEY. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript("moleculestudio-theme") }} />
      </head>
      <body
        className={`${inter.variable} ${syne.variable} font-sans antialiased transition-colors duration-500`}
      >
        <AppProviders>
          <Navbar />
          <div className="flex flex-1 flex-col">{children}</div>
          <Footer />
        </AppProviders>
      </body>
    </html>
  );
}
