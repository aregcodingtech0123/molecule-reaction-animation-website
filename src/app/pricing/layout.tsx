import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/pricing");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
