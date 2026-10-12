"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";
import { normalizeTheme } from "./theme";
export function ThemeSwitch() {
  const { preference, setPreference } = useTheme();
  const Icon = preference === "system" ? Monitor : preference === "dark" ? Moon : Sun;
  return <label className="theme-switch" title="Choose appearance"><Icon className="size-4 shrink-0" aria-hidden="true" /><span className="sr-only">Appearance</span><select value={preference} onChange={event => setPreference(normalizeTheme(event.target.value))}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>;
}
