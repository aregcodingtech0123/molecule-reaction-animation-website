import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/atom-models");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
