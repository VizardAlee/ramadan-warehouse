"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { normalizeTheme, resolveTheme, THEME_STORAGE_KEY, type ThemePreference, type ResolvedTheme } from "./theme";
const ThemeContext = createContext<{ preference: ThemePreference; resolved: ResolvedTheme; setPreference: (value: ThemePreference) => void }>({ preference: "system", resolved: "light", setPreference: () => {} });
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setChoice] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const apply = useCallback((choice: ThemePreference) => {
    const theme = resolveTheme(choice, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = choice;
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => { meta.content = theme === "dark" ? "#0e1625" : "#f5f7fc"; });
    setChoice(choice); setResolved(theme);
  }, []);
  useEffect(() => {
    let active = true;
    const read = () => { try { return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY)); } catch { return normalizeTheme(document.documentElement.dataset.themePreference); } };
    queueMicrotask(() => { if (active) apply(read()); });
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const systemChanged = () => { if (document.documentElement.dataset.themePreference === "system") apply("system"); };
    const storageChanged = (event: StorageEvent) => { if (event.key === THEME_STORAGE_KEY || event.key === null) apply(read()); };
    media?.addEventListener("change", systemChanged);
    window.addEventListener("storage", storageChanged);
    return () => { active = false; media?.removeEventListener("change", systemChanged); window.removeEventListener("storage", storageChanged); };
  }, [apply]);
  const setPreference = useCallback((choice: ThemePreference) => {
    try { window.localStorage.setItem(THEME_STORAGE_KEY, choice); } catch { /* Choice still applies for this visit. */ }
    apply(choice);
  }, [apply]);
  return <ThemeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
