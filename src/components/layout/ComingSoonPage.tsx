import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

interface ComingSoonPageProps {
  title: string;
  description?: string;
}

export function ComingSoonPage({ title, description }: ComingSoonPageProps) {
  return (
    <main className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-teal-400/30 bg-teal-500/10 mb-6">
        <Construction className="h-7 w-7 text-teal-300" aria-hidden />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-white mb-3">{title}</h1>
      <p className="max-w-md text-sm text-gray-400 mb-8">
        {description ?? "This section is under construction. Check back soon for new learning content and showcases."}
      </p>
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-gray-200 transition-colors hover:bg-white/10"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to home
      </Link>
    </main>
  );
}
