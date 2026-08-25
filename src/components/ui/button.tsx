import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: "primary" | "secondary" | "outline" | "destructive" | "ghost"; size?: "default" | "compact" | "sm" | "icon" }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "primary", size = "default", ...props }, ref) {
  return <button ref={ref} className={cn("inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50", size === "default" && "px-4", (size === "compact" || size === "sm") && "min-h-9 px-3 text-xs", size === "icon" && "size-11 p-0", variant === "primary" && "bg-[var(--brand)] text-white hover:bg-[var(--brand-dark)]", variant === "secondary" && "bg-emerald-50 text-[var(--brand-dark)] hover:bg-emerald-100", variant === "outline" && "border bg-white hover:bg-slate-50", variant === "destructive" && "bg-red-700 text-white hover:bg-red-800", variant === "ghost" && "hover:bg-emerald-50", className)} {...props} />;
});
