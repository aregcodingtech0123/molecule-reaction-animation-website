"use client";

import type { ReactNode } from "react";
import { StudioModeProvider } from "@/context/StudioModeContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { AuthProvider } from "@/context/AuthContext";
import { DocumentMeta } from "@/components/layout/DocumentMeta";
import { LabAssistantChat } from "@/components/ai/LabAssistantChat";
import { AuthModal } from "@/components/auth/AuthModal";
import { BillingModal } from "@/components/billing/BillingModal";
import { WelcomeModal } from "@/components/onboarding/WelcomeModal";
import { DynamicMoleculeProvider } from "@/context/DynamicMoleculeContext";
import { RenderModeProvider } from "@/context/RenderModeContext";
import { MeasurementProvider } from "@/context/MeasurementContext";
import { FocusProvider } from "@/context/FocusContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { ThemeShell } from "@/components/layout/ThemeShell";
import { ThemeToaster } from "@/components/providers/ThemeToaster";
import { ExploreSidebarProvider } from "@/context/ExploreSidebarContext";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <DocumentMeta />
      <ThemeProvider>
        <AuthProvider>
          <RenderModeProvider>
            <MeasurementProvider>
              <FocusProvider>
                <StudioModeProvider>
                  <DynamicMoleculeProvider>
                    <ExploreSidebarProvider>
                      <ThemeShell>
                        {children}
                        <ThemeToaster />
                        <LabAssistantChat />
                        <AuthModal />
                        <BillingModal />
                        <WelcomeModal />
                      </ThemeShell>
                    </ExploreSidebarProvider>
                  </DynamicMoleculeProvider>
                </StudioModeProvider>
              </FocusProvider>
            </MeasurementProvider>
          </RenderModeProvider>
        </AuthProvider>
      </ThemeProvider>
    </LanguageProvider>
  );
}
