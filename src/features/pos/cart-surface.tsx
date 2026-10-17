"use client";

import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AppDialog } from "@/components/ui/app-dialog";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import styles from "./pos-layout.module.css";

interface CartSurfaceProps {
  open: boolean;
  focusActive?: boolean;
  onClose: () => void;
  children: ReactNode;
}

const subscribeToClient = () => () => undefined;

/** Keep server and hydration output identical before creating the portal host. */
export function PosCartSurface(props: CartSurfaceProps) {
  const client = useSyncExternalStore(subscribeToClient, () => true, () => false);
  return client ? <MountedCartSurface {...props} /> : <div className={styles.cartSlot} />;
}

function CartContent({ active, onClose, children }: { active: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useDialogFocus<HTMLDivElement>(active, onClose);
  return <div ref={ref} className={styles.cartSlot}>{children}</div>;
}

/** Move only an unmanaged host; React's portal target and child tree stay stable. */
function MountedCartSurface({ open, focusActive = true, onClose, children }: CartSurfaceProps) {
  const inlineRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = styles.cartSlot;
    return element;
  });

  useLayoutEffect(() => {
    const destination = open ? overlayRef.current : inlineRef.current;
    destination?.appendChild(host);
    return () => host.remove();
  }, [host, open]);

  return (
    <>
      <div ref={inlineRef} className={styles.cartSlot} />
      {open && <AppDialog ref={overlayRef} className={styles.cartOverlay} onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }} />}
      {createPortal(<CartContent active={open && focusActive} onClose={onClose}>{children}</CartContent>, host)}
    </>
  );
}
