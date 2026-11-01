import { CREDIT_PACKAGES } from "@/lib/billing/checkout";

/**
 * Every page route and what search engines may do with it (SEO-03, -04, -05, -06, -09).
 *
 * One list drives the per-route metadata, the sitemap and the tests; `tests/unit/seo/routes.test.ts` fails when
 * a page exists under `src/app` that is not classified here, so a new page cannot silently become indexable or
 * silently miss the sitemap.
 *
 * Descriptions are written from what each page really shows (no claims, ratings or numbers that the code does
 * not back); the pricing one is built from the same CREDIT_PACKAGES the page renders.
 */
export type RouteRobots =
  /** Indexed: canonical URL, in the sitemap. */
  | "index"
  /** Not indexed, links still followed (public pages that are not ready: "coming soon"). */
  | "noindex-follow"
  /** Not indexed, links not followed (sign-in flows and signed-in areas). */
  | "noindex";

export interface SeoRoute {
  path: string;
  /** Page title (the site name is appended by the title template). */
  title: string;
  description: string;
  robots: RouteRobots;
}

const packs = CREDIT_PACKAGES.map((p) => `${p.name} $${p.priceUsd} for ${p.credits} credits`).join(", ");

export const SEO_ROUTES: readonly SeoRoute[] = [
  {
    path: "/",
    title: "Interactive 3D chemistry",
    description:
      "Explore molecules, the history of the atom and the periodic table in interactive 3D, and describe any molecule in plain language to an AI lab assistant powered by Gemini.",
    robots: "index",
  },
  {
    path: "/explore",
    title: "Explore molecules in 3D",
    description:
      "Rotate molecules such as water, caffeine and glucose in 3D, click any atom to inspect it, switch between ball-and-stick and space-filling views, and read quick facts for each molecule and reaction.",
    robots: "index",
  },
  {
    path: "/atom-models",
    title: "Evolution of atomic models",
    description:
      "Step through the history of the atom in 3D: Dalton's solid sphere, Thomson's plum pudding, Rutherford's nuclear model, the Bohr model and the quantum mechanical model, with the key ideas and limits of each.",
    robots: "index",
  },
  {
    path: "/periodic-table",
    title: "Interactive periodic table",
    description:
      "An interactive periodic table of the 118 elements. Select an element to see its atomic number, atomic mass, category and a short description.",
    robots: "index",
  },
  {
    path: "/pricing",
    title: "AI Lab credit packs and pricing",
    description: `Credit packs for the AI Lab: ${packs}. Browse freely as a guest and sign in only to purchase. Payments are handled by Lemon Squeezy.`,
    robots: "index",
  },
  { path: "/learn", title: "Learn", description: "Guided chemistry lessons and interactive tutorials are on the way.", robots: "noindex-follow" },
  {
    path: "/showcase",
    title: "Showcase",
    description: "Community molecule galleries and featured structures will appear here soon.",
    robots: "noindex-follow",
  },
  { path: "/login", title: "Sign in", description: "Sign in to Molecule Architecture Studio.", robots: "noindex" },
  { path: "/signup", title: "Create your account", description: "Create a Molecule Architecture Studio account.", robots: "noindex" },
  { path: "/forgot-password", title: "Forgot your password", description: "Request a password reset link.", robots: "noindex" },
  { path: "/reset-password", title: "Choose a new password", description: "Set a new password for your account.", robots: "noindex" },
  { path: "/verify-email", title: "Verify your email", description: "Confirm your email address.", robots: "noindex" },
  { path: "/dashboard", title: "Dashboard", description: "Your credit balance and purchase history.", robots: "noindex" },
  { path: "/ai-lab", title: "AI Lab", description: "Chat with the lab assistant and see molecules in 3D.", robots: "noindex" },
  { path: "/profile", title: "Profile", description: "Your account details.", robots: "noindex" },
];

export const INDEXABLE_ROUTES = SEO_ROUTES.filter((r) => r.robots === "index");

export function seoRoute(path: string): SeoRoute {
  const route = SEO_ROUTES.find((r) => r.path === path);
  if (!route) throw new Error(`No SEO route registered for ${path}`);
  return route;
}
