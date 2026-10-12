export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
export const THEME_STORAGE_KEY = "warehouse-appearance";
export function normalizeTheme(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "system" ? systemDark ? "dark" : "light" : preference;
}
// Static trusted code executes in the document head before its first paint.
export const THEME_INIT_SCRIPT = `(function(){var p="system";try{var v=localStorage.getItem("warehouse-appearance");if(v==="light"||v==="dark")p=v}catch(e){}var d=false;try{d=matchMedia("(prefers-color-scheme: dark)").matches}catch(e){}var t=p==="system"?(d?"dark":"light"):p;document.documentElement.dataset.theme=t;document.documentElement.dataset.themePreference=p;document.documentElement.style.colorScheme=t;document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=t==="dark"?"#0e1625":"#f5f7fc"})})()`;
