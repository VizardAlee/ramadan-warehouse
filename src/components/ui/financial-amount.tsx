"use client";
import { FinancialValue, useFinancialPrivacy } from "@/features/finance/financial-privacy";

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
  const { hidden } = useFinancialPrivacy();
  return <span className={`${toneClass[hidden ? "neutral" : tone]} tabular-nums ${className}`}><FinancialValue>{children}</FinancialValue></span>;
}
