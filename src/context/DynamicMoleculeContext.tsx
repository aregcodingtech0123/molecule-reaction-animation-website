"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import type { MoleculeData } from "@/lib/molecules/types";

interface DynamicMoleculeContextType {
  dynamicMolecule: MoleculeData | null;
  setDynamicMolecule: (molecule: MoleculeData | null) => void;
}

const DynamicMoleculeContext = createContext<DynamicMoleculeContextType | undefined>(undefined);

export function DynamicMoleculeProvider({ children }: { children: ReactNode }) {
  const [dynamicMolecule, setDynamicMolecule] = useState<MoleculeData | null>(null);

  return (
    <DynamicMoleculeContext.Provider value={{ dynamicMolecule, setDynamicMolecule }}>
      {children}
    </DynamicMoleculeContext.Provider>
  );
}

export function useDynamicMolecule() {
  const context = useContext(DynamicMoleculeContext);
  if (context === undefined) {
    throw new Error("useDynamicMolecule must be used within a DynamicMoleculeProvider");
  }
  return context;
}
