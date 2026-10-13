"use client";
import { forwardRef, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes } from "react";
import { ActionGuidanceContext, buttonIsBusy, buttonText, PrerequisiteText } from "@/features/guidance/action-guidance";
import { prerequisiteForAction } from "@/features/guidance/action-prerequisites";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { disabledReason?: string; variant?: "primary" | "secondary" | "outline" | "destructive" | "ghost"; size?: "default" | "compact" | "sm" | "icon" }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(allProps, ref) {
  const { className, variant = "primary", size = "default", disabledReason, ...props } = allProps;
  const hasExplicitReason = Object.prototype.hasOwnProperty.call(allProps, "disabledReason");
  const context = useContext(ActionGuidanceContext), local = useRef<HTMLButtonElement | null>(null), helpId = useId();
  const [inheritedDisabled, setInheritedDisabled] = useState(false);
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const rule = context ? prerequisiteForAction(context.pathname, buttonText(props.children) || String(props["aria-label"] ?? "")) : undefined;
  const attach = useCallback((node: HTMLButtonElement | null) => { local.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node; }, [ref]);
  useEffect(() => {
    if (!rule && !disabledReason) return;
    const button = local.current; if (!button) return;
    const check = () => setInheritedDisabled(button.matches(":disabled"));
    check();
    const parents: HTMLFieldSetElement[] = [];
    let parent = button.closest("fieldset");
    while (parent) { parents.push(parent); parent = parent.parentElement?.closest("fieldset") ?? null; }
    if (!parents.length) return;
    const observer = new MutationObserver(check); parents.forEach(parent => observer.observe(parent, {attributes:true, attributeFilter:["disabled"]}));
    return () => observer.disconnect();
  }, [rule, disabledReason, props.disabled]);
  const showHelp = Boolean((props.disabled || inheritedDisabled) && props["aria-busy"] !== true && props["aria-busy"] !== "true" && !buttonIsBusy(props.children) && (disabledReason || rule));
  const button = <button ref={attach} className={cn("inline-flex min-h-11 shrink-0 self-start items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50", size === "default" && "px-4", (size === "compact" || size === "sm") && "min-h-9 px-3 text-xs", size === "icon" && "size-11 p-0", variant === "primary" && "bg-[var(--brand-fill)] text-white hover:bg-[var(--brand-fill-hover)]", variant === "secondary" && "bg-indigo-50 text-[var(--brand-dark)] hover:bg-indigo-100", variant === "outline" && "border bg-white hover:bg-slate-50", variant === "destructive" && "bg-red-700 text-white hover:bg-red-800", variant === "ghost" && "hover:bg-indigo-50", className)} {...props} aria-describedby={[props["aria-describedby"], showHelp ? helpId : undefined].filter(Boolean).join(" ") || undefined} />;
  return rule || hasExplicitReason ? <span className={cn("inline-flex min-w-0 flex-col items-start", className?.includes("w-full") && "w-full", className?.includes("flex-1") && "flex-1")} data-action-prerequisite>
    {button}{rule && size !== "icon" && !showHelp && !props.disabled && !inheritedDisabled && !buttonIsBusy(props.children) && props["aria-busy"] !== true && props["aria-busy"] !== "true" && <details className="mt-1 max-w-xl text-left text-xs leading-5" onToggle={event => setRequirementsOpen(event.currentTarget.open)}><summary className="min-h-9 cursor-pointer py-2 text-[var(--muted)]">Action requirements</summary>{requirementsOpen && <div className="rounded-lg border p-3"><PrerequisiteText rule={rule}/><p className="mt-2">If the server rejects this action, keep its diagnostic code and ask the responsible team to review current state, scope and original evidence. This browser cannot inspect protected records or determine every server condition. If the outcome is uncertain, use the saved same-action retry before starting another instruction.</p></div>}</details>}{showHelp && <span id={helpId} className="mt-2 block max-w-xl break-words rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs leading-5 text-amber-950">{disabledReason ?? (rule && <PrerequisiteText rule={rule}/>)}</span>}
  </span> : button;
});
