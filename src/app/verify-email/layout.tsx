import { routeMetadata } from "@/lib/seo/metadata";

export const generateMetadata = routeMetadata("/verify-email");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
