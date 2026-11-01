import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/ai-lab");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
