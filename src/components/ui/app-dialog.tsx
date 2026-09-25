"use client";

import type { ComponentProps } from "react";
import { createPortal } from "react-dom";

/** Render overlays at the document root so page layouts cannot crop them. */
export function AppDialog({ children, className = "", ...props }: ComponentProps<"div">) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={`app-dialog-backdrop ${className}`} {...props}>
      {children}
    </div>,
    document.body,
  );
}
