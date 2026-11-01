import type { Metadata } from "next";
import Link from "next/link";
import { INDEXABLE_ROUTES } from "@/lib/seo/routes";

// SEO-14. One <title> (Next adds its own when this file has none), a descriptive h1 and links back into the site.
// The status stays 404 and Next adds `<meta name="robots" content="noindex">` for this page.
export const metadata: Metadata = { title: "Page not found", description: "This page does not exist." };

const LABELS: Record<string, string> = {
  "/": "Home",
  "/explore": "Explore molecules",
  "/atom-models": "Atomic models",
  "/periodic-table": "Periodic table",
  "/pricing": "Pricing",
};

export default function NotFound() {
  return (
    <main className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center px-4 py-24 text-center">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Page not found</h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground sm:text-base">
        The page you asked for does not exist or has moved. These pages do:
      </p>
      <ul className="mt-6 flex flex-wrap justify-center gap-3 text-sm">
        {INDEXABLE_ROUTES.map((route) => (
          <li key={route.path}>
            <Link href={route.path} className="rounded-full border border-current/20 px-4 py-2 hover:underline">
              {LABELS[route.path] ?? route.title}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
