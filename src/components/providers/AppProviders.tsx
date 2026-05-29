"use client";

import type { ReactNode } from "react";
import { StudioModeProvider } from "@/context/StudioModeContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { DocumentMeta } from "@/components/layout/DocumentMeta";
import { LabAssistantChat } from "@/components/ai/LabAssistantChat";
import { DynamicMoleculeProvider } from "@/context/DynamicMoleculeContext";
import { RenderModeProvider } from "@/context/RenderModeContext";
import { MeasurementProvider } from "@/context/MeasurementContext";
import { FocusProvider } from "@/context/FocusContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ThemeShell } from "@/components/layout/ThemeShell";
import { ExploreSidebarProvider } from "@/context/ExploreSidebarContext";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <DocumentMeta />
      <ThemeProvider>
        <RenderModeProvider>
          <MeasurementProvider>
            <FocusProvider>
              <StudioModeProvider>
                <DynamicMoleculeProvider>
                  <ExploreSidebarProvider>
                    <ThemeShell>
                      {children}
                      <LabAssistantChat />
                    </ThemeShell>
                  </ExploreSidebarProvider>
                </DynamicMoleculeProvider>
              </StudioModeProvider>
            </FocusProvider>
          </MeasurementProvider>
        </RenderModeProvider>
      </ThemeProvider>
    </LanguageProvider>
  );
}
