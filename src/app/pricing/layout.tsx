import { JsonLd, webApplicationJsonLd } from "@/lib/seo/json-ld";
import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/pricing");

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* SEO-16: the app and the three credit packs exactly as this page renders them (no rating exists). */}
      <JsonLd data={[webApplicationJsonLd()]} />
      {children}
    </>
  );
}
