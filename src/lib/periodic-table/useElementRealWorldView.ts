"use client";

import { useEffect, useState } from "react";
import type { ChemicalElement } from "@/lib/periodic-table/types";
import { isGaseousAtSTP } from "@/lib/periodic-table/physical-state";
import {
  fetchWikipediaElementImage,
  type WikipediaImageResult,
} from "@/lib/periodic-table/wikipedia-image";

export type RealWorldViewStatus = "idle" | "loading" | "ready" | "fallback";

export interface RealWorldViewState {
  status: RealWorldViewStatus;
  wiki: WikipediaImageResult | null;
  error: string | null;
}

export function useElementRealWorldView(element: ChemicalElement | null): RealWorldViewState {
  const [state, setState] = useState<RealWorldViewState>({
    status: "idle",
    wiki: null,
    error: null,
  });

  useEffect(() => {
    if (!element) {
      setState({ status: "idle", wiki: null, error: null });
      return;
    }

    if (isGaseousAtSTP(element.atomicNumber)) {
      setState({ status: "ready", wiki: null, error: null });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading", wiki: null, error: null });

    void (async () => {
      try {
        const wiki = await fetchWikipediaElementImage(element.name, controller.signal);
        if (controller.signal.aborted) return;

        if (wiki) {
          setState({ status: "ready", wiki, error: null });
        } else {
          setState({
            status: "fallback",
            wiki: null,
            error: "No Wikipedia image found for this element.",
          });
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          status: "fallback",
          wiki: null,
          error: err instanceof Error ? err.message : "Image could not be loaded.",
        });
      }
    })();

    return () => controller.abort();
  }, [element]);

  return state;
}
