import { HomePage } from "@/components/home/HomePage";
import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/");

export default function Page() {
  return <HomePage />;
}
