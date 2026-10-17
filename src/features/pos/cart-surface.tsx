"use client";

import type { ReactNode } from "react";
import { AppDialog } from "@/components/ui/app-dialog";
import styles from "./pos-layout.module.css";

/** The mobile cart must escape the animated workspace's stacking context. */
export function PosCartSurface({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return <>{children}</>;
  return (
    <AppDialog className={styles.cartOverlay} onClick={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      {children}
    </AppDialog>
  );
}
