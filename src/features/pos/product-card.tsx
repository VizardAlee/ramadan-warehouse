"use client";

import { useId } from "react";
import { PackagePlus } from "lucide-react";
import { formatNaira } from "@/features/inventory/format";
import type { PosProduct } from "./types";
import styles from "./pos-layout.module.css";

interface ProductCardProps {
  product: PosProduct;
  available: number;
  pending: boolean;
  ready: boolean;
  online: boolean;
  onAdd: () => void;
  onManagePrice?: () => void;
}

/** Catalogue guidance is opt-in so unavailable stock does not overwhelm the grid. */
export function PosProductCard({ product, available, pending, ready, online, onAdd, onManagePrice }: ProductCardProps) {
  const helpId = useId();
  const service = product.itemKind === "service";
  const disabled = pending || !ready || available <= 0 || (service && !online);
  const reasons = [
    ...(available <= 0 ? [product.availableQuantity <= 0
      ? "There is no available stock at this selling branch. Refresh when connected and ask inventory staff to review reservations or replenish real stock. Changing a price does not create stock."
      : "The available units are used by this device's queued orders. Reconnect and resolve those saved orders before adding more; do not delete saved orders to free stock."] : []),
    ...(pending ? ["The previous order has an unconfirmed result. Use Retry same order in Current sale before starting another; do not collect money again."] : []),
    ...(!ready ? ["The device is restoring its saved order state. Wait for it to finish before adding products."] : []),
    ...(service && !online ? ["Services require an internet connection for online confirmation. Reconnect before adding this service."] : []),
  ];

  return <article className={styles.productCard}>
    <div className={styles.productHeading}>
      <span className={styles.productIcon} aria-hidden="true"><PackagePlus size={20} /></span>
      <div className={styles.productIdentity}>
        <h3>{product.name}</h3>
        <p className={styles.sku}>{product.sku}</p>
      </div>
    </div>
    <div className={styles.productPrice}>{formatNaira(product.unitPriceMinor)}</div>
    <p className={styles.priceCaption}>before VAT · {product.priceSource} price</p>
    <p className={available <= 0 ? styles.outOfStock : styles.availability}>
      {available <= 0 ? "Out of stock" : service ? online ? "Service · online confirmation" : "Internet required" : `${available} ${product.unitOfMeasure} available`}
    </p>
    <div className={styles.productActions}>
      <button type="button" className={styles.addProduct} disabled={disabled} aria-describedby={disabled ? helpId : undefined} onClick={onAdd}>Add</button>
      {onManagePrice && <button type="button" className={styles.managePrice} onClick={onManagePrice}>Store-wide price</button>}
    </div>
    {disabled && <details className={styles.availabilityHelp}>
      <summary>Why unavailable?<span className="sr-only"> {product.name}</span></summary>
      <ul id={helpId}>{reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    </details>}
  </article>;
}
