import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../support/mocks";

// External image lookups (Wikipedia) are not this suite's concern and must not hit the network.
vi.mock("@/components/periodic-table/RealWorldView", () => ({ RealWorldView: () => <div data-testid="real-world-view" /> }));
// R3F: never render WebGL internals in jsdom — mount an inert stand-in and record the props.
const canvasProps = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));
vi.mock("@react-three/fiber", async (orig) => ({
  ...(await orig<typeof import("@react-three/fiber")>()),
  Canvas: (props: Record<string, unknown>) => {
    canvasProps.calls.push(props);
    return <div data-testid="r3f-canvas" />;
  },
}));

import PeriodicTablePage from "@/app/periodic-table/page";
import AtomModelsPage from "@/app/atom-models/page";
import { ELEMENTS, buildPeriodicGrid } from "@/lib/periodic-table/elements";
import { LanguageProvider, useLanguage } from "@/context/LanguageContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { render } from "@testing-library/react";
import { ATOM_MODEL_IDS } from "@/lib/atom-models/types";

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  canvasProps.calls.length = 0;
  consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
  expect(consoleError, "unexpected console.error during render").not.toHaveBeenCalled();
});

describe("periodic table data", () => {
  it("has all 118 elements with unique atomic numbers and symbols", () => {
    expect(ELEMENTS).toHaveLength(118);
    expect(new Set(ELEMENTS.map((e) => e.atomicNumber)).size).toBe(118);
    expect(new Set(ELEMENTS.map((e) => e.symbol)).size).toBe(118);
    expect(ELEMENTS.map((e) => e.atomicNumber)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
  });

  it("grid places every element exactly once (18 columns, f-block rows separated)", () => {
    const grid = buildPeriodicGrid();
    const placed = grid.flat().filter((c): c is (typeof ELEMENTS)[number] => typeof c === "object" && c !== null);
    expect(placed).toHaveLength(118);
    expect(grid.every((row) => row.length === 18)).toBe(true);
    const at = (n: number) => grid.findIndex((row) => row.some((c) => typeof c === "object" && c?.atomicNumber === n));
    expect(at(1)).toBe(0); // H in period 1
    expect(at(58)).toBeGreaterThanOrEqual(7); // Ce in the lanthanide row below the main table
  });
});

describe("periodic table page", () => {
  it("starts with the explorer placeholder; selecting an element shows its details and marks it pressed", async () => {
    renderWithProviders(<PeriodicTablePage />);
    expect(screen.getByText("Element Explorer")).toBeInTheDocument();

    const oxygen = screen.getByRole("button", { name: "Oxygen, atomic number 8" });
    await userEvent.click(oxygen);

    expect(oxygen).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("heading", { level: 2, name: "Oxygen" })).toBeInTheDocument();
    expect(screen.getByText("Atomic #8")).toBeInTheDocument();
    expect(screen.getByText("Electrons").nextSibling).toHaveTextContent("8");
    expect(screen.getByText("Period").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Group").nextSibling).toHaveTextContent("16");
  });

  it("selecting another element moves the selection (single active cell)", async () => {
    renderWithProviders(<PeriodicTablePage />);
    await userEvent.click(screen.getByRole("button", { name: "Iron, atomic number 26" }));
    await userEvent.click(screen.getByRole("button", { name: "Gold, atomic number 79" }));
    const pressed = screen.getAllByRole("button", { pressed: true });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName("Gold, atomic number 79");
  });

  it("lanthanides/actinides have no group → shown as —", async () => {
    renderWithProviders(<PeriodicTablePage />);
    await userEvent.click(screen.getByRole("button", { name: "Cerium, atomic number 58" }));
    await screen.findByRole("heading", { level: 2, name: "Cerium" });
    expect(screen.getByText("Group").nextSibling).toHaveTextContent("—");
  });

  it("the 'Try Carbon' demo button selects carbon and then disappears", async () => {
    renderWithProviders(<PeriodicTablePage />);
    await userEvent.click(screen.getByRole("button", { name: /Try Carbon/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Carbon" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Try Carbon/ })).not.toBeInTheDocument();
  });
});

describe("atom models timeline", () => {
  it("lists the five models in historical order and starts on Dalton", () => {
    renderWithProviders(<AtomModelsPage />);
    const timeline = screen.getByText(/timeline/i).closest("aside")!;
    const names = within(timeline).getAllByRole("button").map((b) => b.querySelector("span")!.textContent);
    expect(names).toHaveLength(ATOM_MODEL_IDS.length);
    expect(names[0]).toMatch(/Dalton/i);
    expect(names[4]).toMatch(/Quantum/i);
  });

  it("selecting a model updates the info panel and the 3D scene model", async () => {
    renderWithProviders(<AtomModelsPage />);
    const timeline = screen.getByText(/timeline/i).closest("aside")!;
    const bohr = within(timeline).getAllByRole("button").find((b) => /Bohr/i.test(b.textContent ?? ""))!;
    await userEvent.click(bohr);
    expect(await screen.findByText(/Niels Bohr/)).toBeInTheDocument();
  });

  it("timeline follows the active locale", () => {
    function SwitchTo({ to }: { to: "tr" }) {
      const { setLocale } = useLanguage();
      return <button onClick={() => setLocale(to)}>switch</button>;
    }
    render(
      <LanguageProvider>
        <ThemeProvider>
          <SwitchTo to="tr" />
          <AtomModelsPage />
        </ThemeProvider>
      </LanguageProvider>,
    );
    expect(screen.getByText("Historical Timeline")).toBeInTheDocument();
    screen.getByRole("button", { name: "switch" }).click();
    return expect(screen.findByText("Tarihsel Zaman Çizelgesi")).resolves.toBeInTheDocument();
  });
});

describe("3D canvas smoke (WebGL mocked)", () => {
  it("the atom model scene mounts a Canvas without console errors", () => {
    renderWithProviders(<AtomModelsPage />);
    expect(screen.getByTestId("r3f-canvas")).toBeInTheDocument();
    expect(canvasProps.calls.length).toBeGreaterThan(0);
  });
});
