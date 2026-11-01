import { HomePage } from "@/components/home/HomePage";
import { JsonLd, organizationJsonLd, websiteJsonLd } from "@/lib/seo/json-ld";
import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/");

export default function Page() {
  return (
    <>
      {/* SEO-16: WebSite on the home page (Google: required there); Organization only once the owner details are real. */}
      <JsonLd data={[websiteJsonLd(), organizationJsonLd()]} />
      <HomePage />
    </>
  );
}
