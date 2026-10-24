import type { Metadata } from "next";
import { Inter, Syne } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { AppProviders } from "@/components/providers/AppProviders";
import { themeInitScript } from "@/lib/theme/pre-hydration";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const syne = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Molecule Architecture Studio",
  description: "A premium interactive chemistry platform to explore molecules in 3D.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" data-theme="night-lab" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint (FINDING-26). Key = THEME_STORAGE_KEY. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript("moleculestudio-theme") }} />
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
