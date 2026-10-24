/**
 * Inline `<head>` script that applies the persisted theme to `<html>` while the
 * HTML is still being parsed — before first paint and before React hydrates —
 * so White Lab users never see a Night Lab flash (FINDING-26).
 *
 * Mirrors `resolveAppTheme`: only "white-lab" changes the server default; a
 * missing, legacy or unknown value stays Night Lab. Never throws (storage can
 * be blocked). `<html suppressHydrationWarning>` covers the attribute change;
 * ThemeProvider then adopts the same value after hydration.
 */
export function themeInitScript(storageKey: string): string {
  return `(function(){try{if(localStorage.getItem(${JSON.stringify(storageKey)})==="white-lab"){var r=document.documentElement;r.setAttribute("data-theme","white-lab");r.classList.remove("dark");}}catch(e){}})();`;
}
