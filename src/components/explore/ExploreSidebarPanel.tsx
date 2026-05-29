"use client";

import { cn } from "@/lib/utils";
import type { ExploreSidebarContentProps } from "@/components/explore/ExploreSidebarContent";
import { ExploreSidebarContent } from "@/components/explore/ExploreSidebarContent";

interface ExploreSidebarPanelProps extends ExploreSidebarContentProps {
  className?: string;
}

/**
 * Desktop sidebar shell — reuses ExploreSidebarContent.
 * Hidden below `lg`; mobile uses ExploreMobileDrawer instead.
 */
export function ExploreSidebarPanel({ className, ...contentProps }: ExploreSidebarPanelProps) {
  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col gap-3 w-64 flex-shrink-0 overflow-y-auto max-h-full pr-1",
        className,
      )}
    >
      <ExploreSidebarContent {...contentProps} />
    </aside>
  );
}
