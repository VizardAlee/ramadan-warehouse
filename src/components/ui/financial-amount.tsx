import type { ReactNode } from "react";

export type FinancialTone = "income" | "outflow" | "attention" | "balance" | "neutral";

const toneClass: Record<FinancialTone, string> = {
  income: "finance-income",
  outflow: "finance-outflow",
  attention: "finance-attention",
  balance: "finance-balance",
  neutral: "finance-neutral",
};

export function FinancialAmount({ children, tone, className = "" }: {
  children: ReactNode;
  tone: FinancialTone;
  className?: string;
}) {
  return <span className={`${toneClass[tone]} tabular-nums ${className}`}>{children}</span>;
}
