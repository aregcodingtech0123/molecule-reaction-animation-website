"use client";

import { cn } from "@/lib/utils";
import type { ExploreSidebarContentProps } from "@/components/explore/ExploreSidebarContent";
import { ExploreSidebarContent } from "@/components/explore/ExploreSidebarContent";

interface ExploreSidebarPanelProps extends ExploreSidebarContentProps {
  className?: string;
}

/**
 * Desktop sidebar shell — reuses ExploreSidebarContent.
 * Fixed to the workbench viewport height; scrolls independently of the 3D stage.
 * Hidden below `lg`; mobile uses ExploreMobileDrawer instead.
 */
export function ExploreSidebarPanel({ className, ...contentProps }: ExploreSidebarPanelProps) {
  return (
    <aside
      className={cn(
        "hidden min-h-0 w-60 shrink-0 flex-col overflow-y-auto overscroll-contain pr-1 scrollbar-thin lg:flex xl:w-64",
        className,
      )}
    >
      <ExploreSidebarContent {...contentProps} />
    </aside>
  );
}
