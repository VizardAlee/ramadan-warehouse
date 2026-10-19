"use client";
import { Eye, EyeOff } from "lucide-react";
import { useFinancialPrivacy } from "./financial-privacy";
export function FinancialPrivacyToggle() {
  const { hidden, ready, persistent, setHidden } = useFinancialPrivacy();
  const Icon = hidden ? EyeOff : Eye;
  return <div className="financial-privacy-control" data-no-print>
    <button className="financial-privacy-eye" type="button" disabled={!ready} aria-pressed={hidden} aria-label="Hide financial values" aria-describedby="financial-privacy-explanation" onClick={() => setHidden(!hidden)}><Icon size={18} aria-hidden="true" /><span>{hidden ? "Amounts hidden" : "Amounts visible"}</span></button>
    <details><summary aria-label="About hiding financial values">About</summary><p id="financial-privacy-explanation">Hides displayed money, financial percentages and money charts on this device. Counts and quantities remain visible. Review amount inputs, action amounts or document details explicitly when needed. Print and export use actual values. This is a screen preference, not access control or encryption. {!persistent && "Device storage is unavailable; this choice lasts for this visit only."}</p></details>
    <span role="status" className="sr-only">{ready ? hidden ? "Financial values hidden" : "Financial values visible" : "Loading financial display preference"}</span>
  </div>;
}
