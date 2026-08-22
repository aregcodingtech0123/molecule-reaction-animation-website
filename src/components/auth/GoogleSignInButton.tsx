"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

const GSI_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";

type CredentialCallback = (idToken: string) => void | Promise<void>;

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              type?: string;
              theme?: string;
              size?: string;
              text?: string;
              width?: number;
              shape?: string;
            },
          ) => void;
        };
      };
    };
  }
}

let gsiScriptPromise: Promise<void> | null = null;

function loadGsiScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();

  if (!gsiScriptPromise) {
    gsiScriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SCRIPT_URL}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("Failed to load Google Identity Services.")));
        return;
      }

      const script = document.createElement("script");
      script.src = GSI_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Google Identity Services."));
      document.head.appendChild(script);
    });
  }

  return gsiScriptPromise;
}

interface GoogleSignInButtonProps {
  onCredential: CredentialCallback;
  disabled?: boolean;
  className?: string;
}

export function GoogleSignInButton({ onCredential, disabled, className }: GoogleSignInButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();
  const { isWhiteLab } = useTheme();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!CLIENT_ID || disabled) return;

    let cancelled = false;

    void loadGsiScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google?.accounts?.id) return;

        containerRef.current.innerHTML = "";

        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: (response) => {
            if (response.credential) {
              void onCredential(response.credential);
            }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });

        window.google.accounts.id.renderButton(containerRef.current, {
          type: "standard",
          theme: isWhiteLab ? "outline" : "filled_black",
          size: "large",
          text: "signin_with",
          shape: "pill",
          width: containerRef.current.offsetWidth || 320,
        });

        setReady(true);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Google sign-in unavailable.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [disabled, isWhiteLab, onCredential]);

  if (!CLIENT_ID) {
    return (
      <p className={cn("text-[11px] text-center opacity-60", className)}>
        {t.auth_google_unavailable ?? "Google sign-in is not configured for this environment."}
      </p>
    );
  }

  if (loadError) {
    return (
      <p className={cn("text-[11px] text-center text-red-500/90", className)} role="alert">
        {loadError}
      </p>
    );
  }

  return (
    <div className={cn("relative min-h-[44px] w-full", className)}>
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin opacity-60" />
        </div>
      )}
      <div
        ref={containerRef}
        className={cn("flex w-full justify-center transition-opacity", !ready && "opacity-0")}
        aria-label={t.auth_google_button ?? "Sign in with Google"}
      />
    </div>
  );
}
