import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: "primary" | "secondary" | "ghost" }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "primary", ...props }, ref) {
  return <button ref={ref} className={cn("inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50", variant === "primary" && "bg-[var(--brand)] text-white hover:bg-[var(--brand-dark)]", variant === "secondary" && "border bg-white hover:bg-slate-50", variant === "ghost" && "hover:bg-emerald-50", className)} {...props} />;
});
