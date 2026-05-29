"use client";

import { Html } from "@react-three/drei";
import type { AtomData, ElementSymbol } from "@/lib/molecules/types";
import { ELEMENT_PROPERTIES } from "@/lib/molecules/elements";
import { useTheme } from "@/context/ThemeContext";

interface AtomLabelProps {
  atom: AtomData;
  visible: boolean;
  isSelected?: boolean;
}

export function AtomLabel({ atom, visible, isSelected = false }: AtomLabelProps) {
  const { scene, isWhiteLab } = useTheme();
  const props = ELEMENT_PROPERTIES[atom.element as ElementSymbol] ?? ELEMENT_PROPERTIES.C;
  const label = scene.label;

  if (!visible) return null;

  const symbolColor =
    label.symbolColor === "inherit" ? props.color : label.symbolColor;

  return (
    <group position={atom.position}>
      <Html
        center
        distanceFactor={8}
        style={{
          pointerEvents: "none",
          transition: "all 0.3s ease",
          opacity: visible ? 1 : 0,
          transform: `translateY(-${isSelected ? 45 : 35}px)`,
        }}
      >
        <div
          style={{
            background: isSelected ? label.bgSelected : label.bg,
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: `1px solid ${isSelected ? label.borderSelected : label.border}`,
            borderRadius: "8px",
            padding: "4px 10px",
            whiteSpace: "nowrap",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "2px",
            boxShadow: isWhiteLab
              ? "0 2px 8px rgba(15, 23, 42, 0.12)"
              : "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          <span
            style={{
              color: isSelected && isWhiteLab ? "#ffffff" : symbolColor,
              fontSize: "13px",
              fontWeight: 700,
              fontFamily: "'Inter', sans-serif",
              letterSpacing: "0.5px",
              textShadow: label.textShadow,
            }}
          >
            {atom.element}
          </span>
          {isSelected && (
            <span
              style={{
                color: label.detailColor,
                fontSize: "10px",
                fontFamily: "'Inter', sans-serif",
                fontWeight: 500,
              }}
            >
              {props.name} (#{props.atomicNumber})
            </span>
          )}
        </div>
      </Html>
    </group>
  );
}
