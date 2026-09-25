"use client";

import {
  Banknote,
  CheckCircle2,
  CircleAlert,
  Minus,
  PackagePlus,
  PauseCircle,
  Play,
  Plus,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  UserPlus,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import {
  calculatePosCart,
  provisionalReceiptReference,
  reconcileHeldCart,
} from "@/features/pos/calculations";
import { SaleDocumentDialog } from "@/features/pos/sale-document";
import {
  listQueuedSales,
  listHeldSales,
  queueOfflineSale,
  readCachedWorkspace,
  removeHeldSale,
  removeQueuedSale,
  saveCachedWorkspace,
  saveHeldSale,
  updateQueuedSale,
} from "@/features/pos/offline-store";
import type {
  HeldPosSale,
  PosCartLine,
  PosCheckoutMethod,
  PosCustomer,
  PosPaymentMethod,
  PosSalePayload,
  SaleDocument,
  PosWorkspace,
  QueuedPosSale,
} from "@/features/pos/types";
import { formatNaira, nairaToKobo } from "@/features/inventory/format";
import { useConnectivity } from "@/lib/connectivity";
import { hasPermission } from "@/lib/permissions/roles";
import type { Branch } from "@/types/domain";

interface SaleResult {
  saleId: string;
  saleNumber: string;
  receiptNumber: string;
  posted: boolean;
}

interface SaleOrderResult {
  orderId: string;
  orderNumber: string;
  status: "order_received" | "payment_accepted";
  created?: boolean;
}

function deviceIdentity() {
  const key = "abr-pos-device-id";
  let value = window.localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    window.localStorage.setItem(key, value);
  }
  return value;
}

export default function PosPage() {
  const { user, profile, accessProfile, operatingContext } = useAuth();
  const { online } = useConnectivity();
  const branches = useOrganizationCollection<Branch>("branches");
  const [manualBranchId, setManualBranchId] = useState("");
  const [workspace, setWorkspace] = useState<PosWorkspace | null>(null);
  const [cart, setCart] = useState<PosCartLine[]>([]);
  const [heldSales, setHeldSales] = useState<HeldPosSale[]>([]);
  const [queued, setQueued] = useState<QueuedPosSale[]>([]);
  const [search, setSearch] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PosCheckoutMethod>("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentBankAccountId, setPaymentBankAccountId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    phone: "",
    email: "",
  });
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [creditPaidAmount, setCreditPaidAmount] = useState("0.00");
  const [creditUpfrontMethod, setCreditUpfrontMethod] = useState<
    "cash" | "card" | "bank_transfer"
  >("cash");
  const [openingCash, setOpeningCash] = useState("0.00");
  const [closingCash, setClosingCash] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{
    reference: string;
    totalMinor: number;
    queued: boolean;
    document?: SaleDocument;
  } | null>(null);
  const [priceProductId, setPriceProductId] = useState<string | null>(null);
  const [branchPrice, setBranchPrice] = useState("");
  const [priceReason, setPriceReason] = useState("");
  const customerDialogRef = useDialogFocus<HTMLFormElement>(
    customerDialogOpen,
    () => setCustomerDialogOpen(false),
  );
  const cartDialogRef = useDialogFocus<HTMLElement>(cartOpen && !customerDialogOpen, () => setCartOpen(false));
  const branchContextId =
    operatingContext?.type === "branch" ? operatingContext.id : undefined;
  const assignedBranchId =
    accessProfile?.branchIds.length === 1
      ? accessProfile.branchIds[0]
      : undefined;
  const firstActiveBranchId = branches.data.find(
    (branch) => branch.status === "active",
  )?.id;
  const selectedBranchId =
    branchContextId ??
    assignedBranchId ??
    (manualBranchId || firstActiveBranchId || "");
  const canReceiveOrder = Boolean(
    profile && hasPermission(profile, "sales.order.create"),
  );
  const canAcceptPayment = Boolean(
    profile && hasPermission(profile, "sales.payment.accept"),
  );
  const canConfirmPayment = Boolean(
    profile && hasPermission(profile, "sales.payment.confirm"),
  );
  const canUsePos = canReceiveOrder || canAcceptPayment || canConfirmPayment;
  const canManageBranchPrice = Boolean(
    profile && hasPermission(profile, "sales.price.branch.manage"),
  );
  const canCreateCredit = Boolean(
    profile && hasPermission(profile, "sales.credit.create"),
  );
  const canManageCustomers = Boolean(
    profile && hasPermission(profile, "customers.manage"),
  );
  const baseTotals = useMemo(() => calculatePosCart(cart), [cart]);
  const discountAmountMinor = useMemo(() => {
    try {
      return nairaToKobo(Number(discountAmount || 0));
    } catch {
      return -1;
    }
  }, [discountAmount]);
  const discountIsValid =
    discountAmountMinor >= 0 &&
    discountAmountMinor <= baseTotals.subtotalAmountMinor;
  const totals = useMemo(
    () =>
      calculatePosCart(
        cart,
        discountIsValid ? discountAmountMinor : 0,
      ),
    [cart, discountAmountMinor, discountIsValid],
  );
  const creditPaidAmountMinor = useMemo(() => {
    try {
      return nairaToKobo(Number(creditPaidAmount || 0));
    } catch {
      return -1;
    }
  }, [creditPaidAmount]);
  const creditAmountMinor =
    paymentMethod === "customer_credit"
      ? totals.grossAmountMinor - Math.max(0, creditPaidAmountMinor)
      : 0;
  const selectedCustomer = workspace?.customers.find(
    (customer) => customer.id === customerId,
  );

  const refreshQueue = useCallback(async () => {
    if (!selectedBranchId || !user) return;
    setQueued(await listQueuedSales(selectedBranchId, user.uid));
  }, [selectedBranchId, user]);

  const refreshHeldSales = useCallback(async () => {
    if (!selectedBranchId || !user) return;
    setHeldSales(await listHeldSales(selectedBranchId, user.uid));
  }, [selectedBranchId, user]);

  const loadWorkspace = useCallback(async () => {
    if (!selectedBranchId || !user) return;
    setBusy(true);
    setError(null);
    try {
      if (online) {
        const result = await callAdministration<
          { branchId: string },
          PosWorkspace
        >("getPosWorkspace", { branchId: selectedBranchId });
        setWorkspace(result);
        await saveCachedWorkspace(user.uid, result);
      } else {
        const cached = await readCachedWorkspace(user.uid, selectedBranchId);
        if (!cached)
          throw new Error(
            "This branch POS must be opened online once before it can sell offline.",
          );
        setWorkspace(cached);
        setMessage(
          `Offline catalogue loaded from ${new Date(cached.refreshedAt).toLocaleString("en-NG")}.`,
        );
      }
      await refreshQueue();
      await refreshHeldSales();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to load this branch POS.",
      );
    } finally {
      setBusy(false);
    }
  }, [online, refreshHeldSales, refreshQueue, selectedBranchId, user]);

  useEffect(() => {
    if (!selectedBranchId) return;
    const timeout = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timeout);
  }, [selectedBranchId, loadWorkspace]);

  const syncQueue = useCallback(async () => {
    if (!online || !selectedBranchId) return;
    if (!user) return;
    const pending = await listQueuedSales(selectedBranchId, user.uid);
    if (pending.length === 0) return;
    setBusy(true);
    let synchronized = 0;
    for (const sale of pending.filter((item) => item.status === "queued")) {
      try {
        await callAdministration<PosSalePayload, SaleOrderResult>(
          "createPosSaleOrder",
          sale.payload,
        );
        await removeQueuedSale(sale.id);
        synchronized += 1;
      } catch (cause) {
        const text =
          cause instanceof Error ? cause.message : "Synchronization failed.";
        const needsReview = /outdated price|stock|reconciliation|price/i.test(
          text,
        );
        if (needsReview)
          await updateQueuedSale({
            ...sale,
            status: "needs_review",
            lastError: text,
          });
        else break;
      }
    }
    await refreshQueue();
    if (synchronized > 0) {
      setMessage(
        `${synchronized} offline order${synchronized === 1 ? "" : "s"} submitted for payment acceptance.`,
      );
      await loadWorkspace();
    }
    setBusy(false);
  }, [loadWorkspace, online, refreshQueue, selectedBranchId, user]);

  useEffect(() => {
    const synchronize = () => void syncQueue();
    window.addEventListener("online", synchronize);
    return () => window.removeEventListener("online", synchronize);
  }, [syncQueue]);

  const queuedQuantityByProduct = useMemo(() => {
    const result = new Map<string, number>();
    for (const sale of queued)
      for (const line of sale.payload.lines)
        result.set(
          line.productId,
          (result.get(line.productId) ?? 0) + line.quantity,
        );
    return result;
  }, [queued]);

  const visibleProducts = useMemo(
    () =>
      (workspace?.products ?? []).filter((product) =>
        `${product.name} ${product.sku}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
    [search, workspace?.products],
  );

  function addProduct(productId: string) {
    const product = workspace?.products.find((item) => item.id === productId);
    if (!product) return;
    const alreadyQueued = queuedQuantityByProduct.get(product.id) ?? 0;
    const current =
      cart.find((line) => line.product.id === product.id)?.quantity ?? 0;
    if (current + alreadyQueued >= product.availableQuantity) {
      setError(
        `Only ${Math.max(0, product.availableQuantity - alreadyQueued)} ${product.unitOfMeasure} of ${product.name} remain for this device.`,
      );
      return;
    }
    setError(null);
    setCart((lines) => {
      const found = lines.find((line) => line.product.id === product.id);
      return found
        ? lines.map((line) =>
            line.product.id === product.id
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          )
        : [...lines, { product, quantity: 1 }];
    });
  }

  function changeQuantity(productId: string, delta: number) {
    setCart((lines) =>
      lines.flatMap((line) => {
        if (line.product.id !== productId) return [line];
        const quantity = line.quantity + delta;
        if (quantity <= 0) return [];
        const available =
          line.product.availableQuantity -
          (queuedQuantityByProduct.get(productId) ?? 0);
        return [{ ...line, quantity: Math.min(quantity, available) }];
      }),
    );
  }

  function setQuantity(productId: string, requestedQuantity: number) {
    if (!Number.isSafeInteger(requestedQuantity)) return;
    setCart((lines) =>
      lines.flatMap((line) => {
        if (line.product.id !== productId) return [line];
        if (requestedQuantity <= 0) return [];
        const available = Math.max(
          0,
          line.product.availableQuantity -
            (queuedQuantityByProduct.get(productId) ?? 0),
        );
        if (available === 0) {
          setError(
            `${line.product.name} has no stock remaining for this device.`,
          );
          return [];
        }
        if (requestedQuantity > available)
          setError(
            `Only ${available} ${line.product.unitOfMeasure} of ${line.product.name} remain for this device.`,
          );
        else setError(null);
        return [{ ...line, quantity: Math.min(requestedQuantity, available) }];
      }),
    );
  }

  function resetSaleDraft() {
    setCart([]);
    setPaymentMethod("cash");
    setPaymentReference("");
    setPaymentBankAccountId("");
    setCustomerId("");
    setDiscountAmount("");
    setDiscountReason("");
    setCreditPaidAmount("0.00");
    setCreditUpfrontMethod("cash");
  }

  async function holdSale() {
    if (!workspace || !user || cart.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      await saveHeldSale({
        id: crypto.randomUUID(),
        userId: user.uid,
        branchId: workspace.branch.id,
        lines: cart.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
        })),
        customerId: customerId || undefined,
        paymentMethod,
        paymentReference: paymentReference.trim() || undefined,
        bankAccountId: paymentBankAccountId || undefined,
        discountAmount,
        discountReason,
        creditPaidAmount,
        creditUpfrontMethod,
        grossAmountMinor: totals.grossAmountMinor,
        totalQuantity: totals.totalQuantity,
        createdAt: now,
        updatedAt: now,
      });
      resetSaleDraft();
      setCartOpen(false);
      await refreshHeldSales();
      setMessage("Sale held on this device. A new transaction is ready.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The sale could not be held.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function restoreHeldSale(heldSale: HeldPosSale) {
    if (!workspace) return;
    if (cart.length > 0) {
      setError("Hold the current sale before restoring another transaction.");
      return;
    }
    const restored = reconcileHeldCart(
      heldSale.lines,
      workspace.products,
      queuedQuantityByProduct,
    );
    if (restored.lines.length === 0) {
      setError(
        "None of the products in this held sale currently have available stock.",
      );
      return;
    }
    const customerStillAvailable = Boolean(
      heldSale.customerId &&
        workspace.customers.some((customer) => customer.id === heldSale.customerId),
    );
    const exchangeCreditStillAvailable = Boolean(
      heldSale.paymentReference &&
        workspace.salesCredits.some(
          (credit) => credit.id === heldSale.paymentReference,
        ),
    );
    let restoredPaymentMethod = heldSale.paymentMethod;
    if (
      (restoredPaymentMethod === "customer_credit" && !customerStillAvailable) ||
      (restoredPaymentMethod === "exchange_credit" &&
        !exchangeCreditStillAvailable)
    )
      restoredPaymentMethod = "cash";
    let restoredDiscountAmount = heldSale.discountAmount;
    let restoredDiscountReason = heldSale.discountReason;
    try {
      if (
        nairaToKobo(Number(restoredDiscountAmount || 0)) >
        calculatePosCart(restored.lines).subtotalAmountMinor
      ) {
        restoredDiscountAmount = "";
        restoredDiscountReason = "";
      }
    } catch {
      restoredDiscountAmount = "";
      restoredDiscountReason = "";
    }
    setCart(restored.lines);
    setCustomerId(customerStillAvailable ? heldSale.customerId ?? "" : "");
    setPaymentMethod(restoredPaymentMethod);
    setPaymentReference(
      restoredPaymentMethod === heldSale.paymentMethod
        ? heldSale.paymentReference ?? ""
        : "",
    );
    setPaymentBankAccountId(
      workspace.bankAccounts.some((account) => account.id === heldSale.bankAccountId)
        ? heldSale.bankAccountId ?? ""
        : "",
    );
    setDiscountAmount(restoredDiscountAmount);
    setDiscountReason(restoredDiscountReason);
    setCreditPaidAmount(heldSale.creditPaidAmount);
    setCreditUpfrontMethod(heldSale.creditUpfrontMethod);
    await removeHeldSale(heldSale.id);
    await refreshHeldSales();
    const changes = [
      restored.adjustedProductCount > 0
        ? `${restored.adjustedProductCount} quantity adjusted to available stock`
        : "",
      restored.omittedProductCount > 0
        ? `${restored.omittedProductCount} unavailable product removed`
        : "",
      !customerStillAvailable && heldSale.customerId
        ? "customer selection cleared"
        : "",
      restoredPaymentMethod !== heldSale.paymentMethod
        ? "payment method reset to cash"
        : "",
      restoredDiscountAmount !== heldSale.discountAmount
        ? "discount cleared because the basket changed"
        : "",
    ].filter(Boolean);
    setError(null);
    setMessage(
      `Held sale restored with current prices${changes.length > 0 ? `. ${changes.join("; ")}.` : "."}`,
    );
  }

  async function deleteHeldSale(heldSale: HeldPosSale) {
    if (!window.confirm("Delete this held sale from this device?")) return;
    await removeHeldSale(heldSale.id);
    await refreshHeldSales();
    setMessage("Held sale deleted.");
  }

  async function openShift() {
    if (!workspace || !online) return;
    setBusy(true);
    setError(null);
    try {
      const deviceId = deviceIdentity();
      await callAdministration("openPosShift", {
        branchId: workspace.branch.id,
        deviceId,
        deviceName: `${navigator.platform || "Browser"} POS`,
        openingCashMinor: nairaToKobo(Number(openingCash)),
        idempotencyKey: crypto.randomUUID(),
      });
      await loadWorkspace();
      setMessage(
        "Shift opened. This device is ready to sell online or offline.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The shift could not be opened.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function closeShift() {
    if (!workspace?.openShift || !online) return;
    setBusy(true);
    setError(null);
    try {
      await syncQueue();
      const stillPending = await listQueuedSales(
        workspace.branch.id,
        user?.uid,
      );
      if (stillPending.length > 0)
        throw new Error(
          "Synchronize or review every offline sale before closing this shift.",
        );
      await callAdministration("closePosShift", {
        shiftId: workspace.openShift.id,
        closingCashMinor: nairaToKobo(Number(closingCash)),
        idempotencyKey: crypto.randomUUID(),
      });
      setClosingCash("");
      setCartOpen(false);
      await loadWorkspace();
      setMessage("Shift closed and cash variance recorded.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The shift could not be closed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    if (
      !canReceiveOrder ||
      !workspace?.openShift ||
      cart.length === 0 ||
      totals.grossAmountMinor <= 0
    )
      return;
    if (!discountIsValid) {
      setError("Enter a valid discount that does not exceed the product subtotal.");
      return;
    }
    if (discountAmountMinor > 0 && discountReason.trim().length < 3) {
      setError("Enter a short reason so the discount remains auditable.");
      return;
    }
    if (paymentMethod === "customer_credit" && !online) {
      setError(
        "Customer credit requires an online approval and credit-limit check.",
      );
      return;
    }
    if (paymentMethod === "customer_credit" && !customerId) {
      setError(
        "Select an administrator-approved customer for this credit sale.",
      );
      return;
    }
    if (
      paymentMethod === "customer_credit" &&
      (creditPaidAmountMinor < 0 || creditPaidAmountMinor >= totals.grossAmountMinor)
    ) {
      setError(
        "The amount paid now must be zero or less than the sale total. Use a normal payment method when fully paid.",
      );
      return;
    }
    if (
      paymentMethod === "customer_credit" &&
      (!selectedCustomer ||
        selectedCustomer.creditStatus !== "approved" ||
        selectedCustomer.availableCreditMinor < creditAmountMinor)
    ) {
      setError("The selected customer does not have enough approved credit for the outstanding amount.");
      return;
    }
    if (paymentMethod === "exchange_credit" && (!online || !paymentReference)) {
      setError("Select an available exchange credit while online.");
      return;
    }
    const needsBankAccount =
      ["card", "bank_transfer"].includes(paymentMethod) ||
      (paymentMethod === "customer_credit" &&
        creditPaidAmountMinor > 0 &&
        ["card", "bank_transfer"].includes(creditUpfrontMethod));
    if (
      needsBankAccount &&
      !paymentBankAccountId
    ) {
      setError("Select the company bank account receiving this payment.");
      return;
    }
    setBusy(true);
    setError(null);
    const idempotencyKey = crypto.randomUUID();
    const provisional = provisionalReceiptReference(workspace.branch.code);
    const selectedExchangeCredit = workspace.salesCredits.find(
      (credit) => credit.id === paymentReference,
    );
    const exchangeCreditAmount = Math.min(
      selectedExchangeCredit?.remainingAmountMinor ?? 0,
      totals.grossAmountMinor,
    );
    const payload: PosSalePayload = {
      branchId: workspace.branch.id,
      shiftId: workspace.openShift.id,
      deviceId: workspace.openShift.deviceId,
      recordedAt: new Date().toISOString(),
      offline: !online,
      provisionalReceiptReference: !online ? provisional : undefined,
      lines: cart.map(({ product, quantity }) => ({
        productId: product.id,
        quantity,
        ...(!online
          ? {
              priceVersion: product.priceVersion,
              unitPriceMinor: product.unitPriceMinor,
              vatRateBasisPoints: product.vatRateBasisPoints,
            }
          : {}),
      })),
      payments:
        paymentMethod === "customer_credit"
          ? creditPaidAmountMinor > 0
            ? [
                {
                  method: creditUpfrontMethod,
                  amountMinor: creditPaidAmountMinor,
                  reference: paymentReference.trim() || undefined,
                  bankAccountId: paymentBankAccountId || undefined,
                },
              ]
            : []
          : paymentMethod === "exchange_credit"
            ? [
                {
                  method: "exchange_credit" as const,
                  amountMinor: exchangeCreditAmount,
                  reference: paymentReference,
                },
                ...(exchangeCreditAmount < totals.grossAmountMinor
                  ? [
                      {
                        method: "cash" as const,
                        amountMinor:
                          totals.grossAmountMinor - exchangeCreditAmount,
                      },
                    ]
                  : []),
              ]
            : [
                {
                  method: paymentMethod as PosPaymentMethod,
                  amountMinor: totals.grossAmountMinor,
                  reference: paymentReference.trim() || undefined,
                  bankAccountId: paymentBankAccountId || undefined,
                },
              ],
      customerId: customerId || undefined,
      creditAmountMinor,
      discountAmountMinor,
      discountReason:
        discountAmountMinor > 0 ? discountReason.trim() : undefined,
      idempotencyKey,
    };
    try {
      if (online) {
        const result = await callAdministration<
          PosSalePayload,
          SaleOrderResult
        >(
          "createPosSaleOrder",
          payload,
        );
        setMessage(
          `Order ${result.orderNumber} received. The next step is payment acceptance; inventory has not been released.`,
        );
        await loadWorkspace();
      } else {
        if (!user) throw new Error("Your signed-in session is unavailable.");
        const queuedSale: QueuedPosSale = {
          id: idempotencyKey,
          userId: user.uid,
          branchId: workspace.branch.id,
          provisionalReceiptReference: provisional,
          payload,
          grossAmountMinor: totals.grossAmountMinor,
          createdAt: payload.recordedAt,
          status: "queued",
        };
        await queueOfflineSale(queuedSale);
        await refreshQueue();
        setReceipt({
          reference: provisional,
          totalMinor: totals.grossAmountMinor,
          queued: true,
        });
      }
      resetSaleDraft();
      setCartOpen(false);
      if (online) window.requestAnimationFrame(() => document.getElementById("pos-orders")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The order could not be received.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function acceptOrderPayment(orderId: string) {
    if (!workspace?.openShift) {
      setError("Open your POS shift before accepting payment.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await callAdministration<
        {
          orderId: string;
          shiftId: string;
          deviceId: string;
          idempotencyKey: string;
        },
        SaleOrderResult
      >("acceptPosSaleOrderPayment", {
        orderId,
        shiftId: workspace.openShift.id,
        deviceId: workspace.openShift.deviceId,
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage(
        `Payment accepted for ${result.orderNumber}. It is ready for confirmation and inventory release.`,
      );
      await loadWorkspace();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Payment could not be accepted.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmOrderPayment(orderId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await callAdministration<
        { orderId: string; idempotencyKey: string },
        SaleResult & { orderNumber: string; status: "completed" }
      >("confirmPosSaleOrder", {
        orderId,
        idempotencyKey: crypto.randomUUID(),
      });
      const document = await callAdministration<
        { saleId: string },
        SaleDocument
      >("getSaleDocument", { saleId: result.saleId });
      setReceipt({
        reference: result.receiptNumber,
        totalMinor: document.sale.grossAmountMinor,
        queued: false,
        document,
      });
      setMessage(
        `Payment confirmed for ${result.orderNumber}. Inventory, receipt and accounts were posted together.`,
      );
      await loadWorkspace();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Payment confirmation and inventory release failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createCustomerFromPos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      const result = await callAdministration<
        {
          name: string;
          phone?: string;
          email?: string;
          active: boolean;
          idempotencyKey: string;
        },
        { customerId: string; customerNumber: string }
      >("saveCustomer", {
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim() || undefined,
        email: newCustomer.email.trim() || undefined,
        active: true,
        idempotencyKey: crypto.randomUUID(),
      });
      const createdCustomer: PosCustomer = {
        id: result.customerId,
        customerNumber: result.customerNumber,
        name: newCustomer.name.trim(),
        phone: newCustomer.phone.trim() || null,
        creditStatus: "pending",
        creditLimitMinor: 0,
        outstandingBalanceMinor: 0,
        availableCreditMinor: 0,
      };
      setWorkspace((current) =>
        current
          ? {
              ...current,
              customers: [
                ...current.customers.filter(
                  (customer) => customer.id !== result.customerId,
                ),
                createdCustomer,
              ].sort((left, right) => left.name.localeCompare(right.name)),
            }
          : current,
      );
      setCustomerId(result.customerId);
      setNewCustomer({ name: "", phone: "", email: "" });
      setCustomerDialogOpen(false);
      setMessage(
        `${newCustomer.name.trim()} was created and selected. Your current sale is unchanged.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The customer could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveBranchPrice() {
    const product = workspace?.products.find(
      (item) => item.id === priceProductId,
    );
    if (!workspace || !product) return;
    setBusy(true);
    setError(null);
    try {
      await callAdministration("saveBranchSalesPrice", {
        branchId: workspace.branch.id,
        productId: product.id,
        sellingPriceMinor: nairaToKobo(Number(branchPrice)),
        active: true,
        reason: priceReason.trim() || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      setPriceProductId(null);
      setPriceReason("");
      await loadWorkspace();
      setMessage(`Branch price updated for ${product.name}.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The branch price could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!canUsePos)
    return (
      <div className="rounded-xl border bg-white p-6">
        <h1 className="text-2xl font-semibold">Branch POS</h1>
        <p className="mt-2 text-[var(--muted)]">
          Your assigned roles do not include branch sales access.
        </p>
      </div>
    );

  return (
    <div className="space-y-5 pb-16 lg:pb-0">
      <header className="brand-hero flex flex-col gap-5 rounded-2xl p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.16em] text-emerald-100">
            <Sparkles className="size-4" />
            Branch sales
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">
            Point of sale
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-emerald-50">
            Sell from branch stock. VAT is shown separately and every confirmed
            sale posts inventory and accounts together.
          </p>
          <span
            className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${online ? "bg-white/15 text-white" : "bg-amber-300 text-amber-950"}`}
          >
            {online ? (
              <Wifi className="size-3.5" />
            ) : (
              <WifiOff className="size-3.5" />
            )}
            {online ? "Connected and ready" : "Offline sales available"}
          </span>
        </div>
        {!branchContextId && !assignedBranchId && (
          <label className="text-sm font-medium">
            Selling branch
            <select
              value={selectedBranchId}
              onChange={(event) => {
                setManualBranchId(event.target.value);
                resetSaleDraft();
                setHeldSales([]);
                setWorkspace(null);
              }}
              className="mt-1 block min-h-11 min-w-56 rounded-lg border border-white/30 bg-white px-3 text-slate-900"
            >
              {branches.data
                .filter((branch) => branch.status === "active")
                .map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
            </select>
          </label>
        )}
      </header>

      <nav aria-label="Point of sale workspace" className="sticky top-16 z-20 flex flex-wrap gap-2 rounded-xl border bg-white/95 p-2 shadow-sm backdrop-blur">
        <a href={workspace?.openShift ? "#pos-catalogue" : "#pos-shift"} className="inline-flex min-h-10 items-center rounded-lg bg-[var(--brand)] px-4 text-sm font-semibold text-white">New sale</a>
        <a href="#pos-orders" className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold text-slate-700">
          Awaiting action{workspace?.pendingOrders.length ? ` (${workspace.pendingOrders.length})` : ""}
        </a>
        <button type="button" disabled={!workspace?.openShift} onClick={() => {
          if (window.matchMedia("(max-width: 1023px)").matches) setCartOpen(true);
          document.getElementById("pos-cart")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }} className="inline-flex min-h-10 items-center rounded-lg border px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">
          Held sales{heldSales.length ? ` (${heldSales.length})` : ""}
        </button>
      </nav>

      {!online && (
        <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <WifiOff className="mt-0.5 size-5 shrink-0" />
          <div>
            <strong>Offline sales mode.</strong> Paid sales are saved on this
            device and synchronize after reconnecting. Prices and available
            quantities use the last trusted refresh.
          </div>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"
        >
          {message}
        </div>
      )}

      {queued.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Offline queue: {queued.length}</h2>
              <p className="text-sm text-amber-900">
                {queued.filter((sale) => sale.status === "needs_review").length}{" "}
                need manager review; the rest will retry safely.
              </p>
            </div>
            <Button
              variant="outline"
              disabled={!online || busy}
              onClick={() => void syncQueue()}
            >
              <RefreshCw className="mr-2 size-4" /> Synchronize now
            </Button>
          </div>
          {queued.some((sale) => sale.status === "needs_review") && (
            <ul className="mt-3 space-y-2 text-sm">
              {queued
                .filter((sale) => sale.status === "needs_review")
                .map((sale) => (
                  <li key={sale.id} className="rounded-lg bg-white p-3">
                    <strong>{sale.provisionalReceiptReference}</strong>:{" "}
                    {sale.lastError}
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      {workspace && (
        <section id="pos-orders" className="scroll-mt-40 rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-[var(--brand)]">
                Three-step sales control
              </p>
              <h2 className="mt-1 text-xl font-semibold">Sales workflow</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Users with multiple roles can complete every step their combined
                permissions allow. Every action records its own actor and time.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={!online || busy}
              onClick={() => void loadWorkspace()}
            >
              <RefreshCw className="mr-2 size-4" /> Refresh queue
            </Button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <div className="rounded-xl bg-sky-50 p-3 text-sm text-sky-950">
              <strong>1. Receive order</strong>
              <span className="mt-1 block">Capture products and customer.</span>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
              <strong>2. Accept payment</strong>
              <span className="mt-1 block">Acknowledge the payment details.</span>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950">
              <strong>3. Confirm &amp; release</strong>
              <span className="mt-1 block">Post receipt, accounts and stock.</span>
            </div>
          </div>
          {workspace.pendingOrders.length > 0 ? (
            <ul className="mt-4 grid gap-3 xl:grid-cols-2">
              {workspace.pendingOrders.map((order) => {
                const customer = workspace.customers.find(
                  (item) => item.id === order.customerId,
                );
                const awaitingPayment = order.status === "order_received";
                return (
                  <li key={order.id} className="rounded-xl border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-semibold">
                          {order.orderNumber}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {customer?.name ?? "Walk-in customer"} ·{" "}
                          {order.totalQuantity} item
                          {order.totalQuantity === 1 ? "" : "s"} ·{" "}
                          {formatNaira(order.grossAmountMinor)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          {order.paymentMethods.join(", ").replaceAll("_", " ") ||
                            "Customer credit"}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${awaitingPayment ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}
                      >
                        {awaitingPayment
                          ? "Awaiting payment acceptance"
                          : "Awaiting confirmation"}
                      </span>
                    </div>
                    {awaitingPayment ? (
                      canAcceptPayment ? (
                        <Button
                          type="button"
                          className="mt-3 w-full"
                          disabled={!online || busy || !workspace.openShift}
                          onClick={() => void acceptOrderPayment(order.id)}
                        >
                          Accept payment
                        </Button>
                      ) : (
                        <p className="mt-3 text-xs text-[var(--muted)]">
                          Waiting for a cashier or manager with payment access.
                        </p>
                      )
                    ) : canConfirmPayment ? (
                      <Button
                        type="button"
                        className="mt-3 w-full"
                        disabled={!online || busy}
                        onClick={() => void confirmOrderPayment(order.id)}
                      >
                        Confirm payment &amp; release stock
                      </Button>
                    ) : (
                      <p className="mt-3 text-xs text-[var(--muted)]">
                        Waiting for a branch manager or administrator.
                      </p>
                    )}
                    {awaitingPayment && canAcceptPayment && !workspace.openShift && (
                      <p className="mt-2 text-xs text-amber-800">
                        Open your shift below before accepting payment.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 rounded-xl bg-slate-50 p-4 text-center text-sm text-[var(--muted)]">
              No orders are waiting for payment or release.
            </p>
          )}
        </section>
      )}

      {!workspace ? (
        <div className="grid min-h-64 place-items-center rounded-xl border bg-white p-6 text-center">
          <div>
            <RefreshCw
              className={`mx-auto mb-3 size-7 ${busy ? "animate-spin" : ""}`}
            />
            <p>
              {busy
                ? "Loading branch POS…"
                : "Choose an active selling branch."}
            </p>
          </div>
        </div>
      ) : !workspace.openShift ? (
        <section id="pos-shift" className="mx-auto max-w-xl scroll-mt-40 rounded-2xl border bg-white p-6 shadow-sm">
          <Banknote className="mb-4 size-9 text-[var(--brand)]" />
          <h2 className="text-2xl font-semibold">Open the sales shift</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Count the cash physically in this till before the first sale. This
            opening figure is used only for cash reconciliation.
          </p>
          <label className="mt-5 block text-sm font-medium">
            Opening cash (₦)
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={openingCash}
              onChange={(event) => setOpeningCash(event.target.value)}
              className="mt-1 w-full rounded-lg border p-3 text-lg"
            />
          </label>
          <Button
            className="mt-5 w-full"
            disabled={!online || busy}
            onClick={() => void openShift()}
          >
            Open shift and start selling
          </Button>
          {!online && (
            <p className="mt-2 text-center text-xs text-amber-800">
              A new shift must be opened online. An already-open cached shift
              continues offline.
            </p>
          )}
        </section>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section id="pos-catalogue" className="scroll-mt-40 space-y-4">
            <div className="glass-panel rounded-2xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{workspace.branch.name}</h2>
                  <p className="text-sm text-[var(--muted)]">
                    Stock source: {workspace.location.name}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={!online || busy}
                  onClick={() => void loadWorkspace()}
                >
                  <RefreshCw className="mr-2 size-4" /> Refresh stock &amp;
                  prices
                </Button>
              </div>
              <label className="relative mt-4 block">
                <Search className="absolute left-3 top-3.5 size-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search product name or SKU"
                  className="w-full rounded-lg border py-3 pl-10 pr-3"
                />
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleProducts.map((product) => {
                const available = Math.max(
                  0,
                  product.availableQuantity -
                    (queuedQuantityByProduct.get(product.id) ?? 0),
                );
                return (
                  <article
                    key={product.id}
                    className="interactive-card relative min-h-44 overflow-hidden rounded-2xl border bg-white p-4 text-left shadow-[var(--shadow-sm)]"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                        <PackagePlus className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <span className="block font-semibold">
                          {product.name}
                        </span>
                        <span className="mt-1 block truncate font-mono text-xs text-[var(--muted)]">
                          {product.sku}
                        </span>
                      </div>
                    </div>
                    <span className="mt-4 block text-2xl font-semibold tracking-tight">
                      {formatNaira(product.unitPriceMinor)}
                    </span>
                    <span className="block text-xs text-[var(--muted)]">
                      before VAT · {product.priceSource} price
                    </span>
                    <div className="mt-3 flex items-center justify-between gap-2 text-sm">
                      <span>
                        {available} {product.unitOfMeasure} available
                      </span>
                      <span
                        className={`size-2.5 rounded-full ${available > 0 ? "bg-emerald-500" : "bg-red-400"}`}
                      />
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className={`block h-full rounded-full ${available > 0 ? "bg-emerald-500" : "bg-red-400"}`}
                        style={{
                          width:
                            available > 0
                              ? `${Math.min(100, Math.max(12, available * 5))}%`
                              : "100%",
                        }}
                      />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button
                        className="flex-1"
                        disabled={available <= 0}
                        onClick={() => addProduct(product.id)}
                      >
                        Add
                      </Button>
                      {canManageBranchPrice && online && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setPriceProductId(product.id);
                            setBranchPrice(
                              String(product.unitPriceMinor / 100),
                            );
                            setPriceReason("");
                          }}
                        >
                          Price
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
              {visibleProducts.length === 0 && (
                <div className="col-span-full rounded-xl border bg-white p-8 text-center text-[var(--muted)]">
                  No sale-ready products match. Products require an active
                  central selling price and branch stock.
                </div>
              )}
            </div>
          </section>

          {cartOpen && <button type="button" aria-label="Close sale cart" onClick={() => setCartOpen(false)} className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden" />}
          <aside
            id="pos-cart"
            ref={cartDialogRef}
            role={cartOpen ? "dialog" : undefined}
            aria-modal={cartOpen ? true : undefined}
            aria-label={cartOpen ? "Current sale and held sales" : undefined}
            className={`glass-panel scroll-mt-40 h-fit overflow-y-auto rounded-t-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-7rem)] lg:rounded-2xl ${cartOpen ? "fixed inset-x-0 bottom-0 z-50 max-h-[min(88dvh,48rem)]" : "hidden"}`}
          >
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-xl font-semibold">
                <ShoppingCart className="size-5" /> Current sale
              </h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--muted)]">{totals.totalQuantity} items</span>
                <button type="button" onClick={() => setCartOpen(false)} aria-label="Close cart" className="grid size-9 place-items-center rounded-lg border lg:hidden"><X className="size-4" /></button>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-4 w-full"
              disabled={busy || cart.length === 0}
              onClick={() => void holdSale()}
            >
              <PauseCircle className="mr-2 size-4" /> Hold sale &amp; start new
            </Button>
            {heldSales.length > 0 && (
              <details className="mt-3 rounded-xl border bg-amber-50 p-3" open>
                <summary className="cursor-pointer text-sm font-semibold text-amber-950">
                  Held sales ({heldSales.length})
                </summary>
                <p className="mt-1 text-xs text-amber-900">
                  Held baskets stay on this device and do not reserve stock.
                </p>
                <ul className="mt-3 space-y-2">
                  {heldSales.map((heldSale) => (
                    <li
                      key={heldSale.id}
                      className="rounded-lg border border-amber-200 bg-white p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {heldSale.totalQuantity} item
                            {heldSale.totalQuantity === 1 ? "" : "s"} ·{" "}
                            {formatNaira(heldSale.grossAmountMinor)}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--muted)]">
                            Held{" "}
                            {new Date(heldSale.updatedAt).toLocaleString("en-NG")}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() => void deleteHeldSale(heldSale)}
                          aria-label="Delete held sale"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        className="mt-2 w-full"
                        disabled={busy || cart.length > 0}
                        onClick={() => void restoreHeldSale(heldSale)}
                      >
                        <Play className="mr-2 size-4" /> Resume sale
                      </Button>
                    </li>
                  ))}
                </ul>
                {cart.length > 0 && (
                  <p className="mt-2 text-xs text-amber-900">
                    Hold the current basket before resuming another sale.
                  </p>
                )}
              </details>
            )}
            <div className="my-4 max-h-72 space-y-3 overflow-y-auto">
              {cart.length === 0 ? (
                <p className="rounded-lg bg-slate-50 p-5 text-center text-sm text-[var(--muted)]">
                  Tap a product to add it.
                </p>
              ) : (
                cart.map((line) => (
                  <div key={line.product.id} className="rounded-lg border p-3">
                    <div className="flex justify-between gap-3">
                      <strong className="text-sm">{line.product.name}</strong>
                      <span className="text-sm">
                        {formatNaira(
                          line.quantity * line.product.unitPriceMinor,
                        )}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-[var(--muted)]">
                        {formatNaira(line.product.unitPriceMinor)} each
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => changeQuantity(line.product.id, -1)}
                          aria-label={`Remove one ${line.product.name}`}
                        >
                          <Minus className="size-4" />
                        </Button>
                        <label className="sr-only" htmlFor={`quantity-${line.product.id}`}>
                          Quantity for {line.product.name}
                        </label>
                        <input
                          id={`quantity-${line.product.id}`}
                          type="number"
                          min="1"
                          max={Math.max(
                            1,
                            line.product.availableQuantity -
                              (queuedQuantityByProduct.get(line.product.id) ?? 0),
                          )}
                          step="1"
                          inputMode="numeric"
                          value={line.quantity}
                          onFocus={(event) => event.currentTarget.select()}
                          onChange={(event) => {
                            if (event.target.value === "") return;
                            setQuantity(
                              line.product.id,
                              Number(event.target.value),
                            );
                          }}
                          className="h-10 w-16 rounded-lg border px-2 text-center font-semibold tabular-nums"
                          aria-label={`Quantity for ${line.product.name}`}
                        />
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => changeQuantity(line.product.id, 1)}
                          aria-label={`Add one ${line.product.name}`}
                        >
                          <Plus className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <dl className="space-y-2 rounded-xl bg-gradient-to-br from-emerald-950 to-emerald-700 p-4 text-sm text-white shadow-lg">
              <div className="flex justify-between">
                <dt>Product subtotal</dt>
                <dd>{formatNaira(totals.subtotalAmountMinor)}</dd>
              </div>
              {totals.discountAmountMinor > 0 && (
                <div className="flex justify-between text-emerald-100">
                  <dt>Discount</dt>
                  <dd>−{formatNaira(totals.discountAmountMinor)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt>Net sales</dt>
                <dd>{formatNaira(totals.netAmountMinor)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>VAT</dt>
                <dd>{formatNaira(totals.vatAmountMinor)}</dd>
              </div>
              <div className="flex justify-between border-t border-white/20 pt-3 text-xl font-semibold">
                <dt>Total</dt>
                <dd>{formatNaira(totals.grossAmountMinor)}</dd>
              </div>
            </dl>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <label className="block text-sm font-medium">
                Discount (₦)
                <input
                  type="number"
                  min="0"
                  max={baseTotals.subtotalAmountMinor / 100}
                  step="0.01"
                  inputMode="decimal"
                  value={discountAmount}
                  onChange={(event) => setDiscountAmount(event.target.value)}
                  className={`mt-1 w-full rounded-lg border p-3 ${discountIsValid ? "" : "border-red-400"}`}
                  placeholder="0.00"
                />
              </label>
              <label className="block text-sm font-medium">
                Discount reason
                <input
                  value={discountReason}
                  onChange={(event) => setDiscountReason(event.target.value)}
                  disabled={discountAmountMinor <= 0}
                  required={discountAmountMinor > 0}
                  className="mt-1 w-full rounded-lg border p-3 disabled:bg-slate-100"
                  placeholder="e.g. Trade discount"
                />
              </label>
            </div>
            <div className="mt-4 rounded-xl border bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <label className="min-w-0 flex-1 text-sm font-medium">
                  Customer
                  <select
                    value={customerId}
                    onChange={(event) => setCustomerId(event.target.value)}
                    className="mt-1 w-full rounded-lg border p-3"
                  >
                    <option value="">Walk-in customer</option>
                    {(workspace.customers ?? []).map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name} · {customer.customerNumber}
                      </option>
                    ))}
                  </select>
                </label>
                {canManageCustomers && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-6 shrink-0"
                    disabled={!online || busy}
                    onClick={() => setCustomerDialogOpen(true)}
                  >
                    <UserPlus className="mr-2 size-4" /> New customer
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-[var(--muted)]">
                Attach named customers to cash, card, transfer, or credit sales.
                Leave as walk-in only when no customer record is needed.
              </p>
            </div>
            <label className="mt-4 block text-sm font-medium">
              Payment method
              <select
                value={paymentMethod}
                onChange={(event) => {
                  setPaymentMethod(event.target.value as PosCheckoutMethod);
                  setPaymentReference("");
                  setPaymentBankAccountId("");
                  setCreditPaidAmount("0.00");
                }}
                className="mt-1 w-full rounded-lg border p-3"
              >
                <option value="cash">Cash</option>
                <option value="card">Card / POS terminal</option>
                <option value="bank_transfer">Bank transfer</option>
                {canCreateCredit && (
                  <option value="customer_credit" disabled={!online}>
                    Approved customer credit
                  </option>
                )}
                <option value="exchange_credit" disabled={!online}>
                  Exchange credit
                </option>
              </select>
            </label>
            {paymentMethod === "customer_credit" ? (
              <div className="mt-3 space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-950">
                  Customer credit
                </p>
                <p className="text-xs text-amber-900">
                  {selectedCustomer?.creditStatus === "approved"
                    ? `${selectedCustomer.name} has ${formatNaira(selectedCustomer.availableCreditMinor)} available.`
                    : "Select a customer with administrator-approved credit above."}
                </p>
                <label className="block text-sm font-medium">
                  Amount paid now (₦)
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, totals.grossAmountMinor - 1) / 100}
                    step="0.01"
                    inputMode="decimal"
                    value={creditPaidAmount}
                    onChange={(event) => setCreditPaidAmount(event.target.value)}
                    className="mt-1 w-full rounded-lg border p-3"
                  />
                </label>
                {creditPaidAmountMinor > 0 && (
                  <>
                    <label className="block text-sm font-medium">
                      Payment method now
                      <select
                        value={creditUpfrontMethod}
                        onChange={(event) =>
                          setCreditUpfrontMethod(
                            event.target.value as typeof creditUpfrontMethod,
                          )
                        }
                        className="mt-1 w-full rounded-lg border p-3"
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card / POS terminal</option>
                        <option value="bank_transfer">Bank transfer</option>
                      </select>
                    </label>
                    {creditUpfrontMethod !== "cash" && (
                      <>
                        <label className="block text-sm font-medium">
                          Company bank account
                          <select
                            value={paymentBankAccountId}
                            onChange={(event) => setPaymentBankAccountId(event.target.value)}
                            className="mt-1 w-full rounded-lg border p-3"
                          >
                            <option value="">Select account</option>
                            {workspace.bankAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.bankName} · {account.accountName} · ••••{account.accountNumberLast4}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block text-sm font-medium">
                          Payment reference (optional)
                          <input
                            value={paymentReference}
                            onChange={(event) => setPaymentReference(event.target.value)}
                            className="mt-1 w-full rounded-lg border p-3"
                          />
                        </label>
                      </>
                    )}
                  </>
                )}
                <div className="flex justify-between border-t border-amber-200 pt-2 text-sm font-semibold">
                  <span>Balance going to customer account</span>
                  <span>{formatNaira(Math.max(0, creditAmountMinor))}</span>
                </div>
              </div>
            ) : paymentMethod === "exchange_credit" ? (
              <label className="mt-3 block text-sm font-medium">
                Exchange credit
                <select
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  className="mt-1 w-full rounded-lg border p-3"
                >
                  <option value="">Select credit</option>
                  {(workspace.salesCredits ?? []).map((credit) => (
                    <option key={credit.id} value={credit.id}>
                      {credit.creditNumber} ·{" "}
                      {formatNaira(credit.remainingAmountMinor)} remaining
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-[var(--muted)]">
                  The credit is applied first. If it is below the sale total,
                  the remaining amount is recorded as cash.
                </span>
              </label>
            ) : paymentMethod !== "cash" ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  Company bank account
                  <select
                    value={paymentBankAccountId}
                    onChange={(event) => setPaymentBankAccountId(event.target.value)}
                    className="mt-1 w-full rounded-lg border p-3"
                  >
                    <option value="">Select account</option>
                    {workspace.bankAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.bankName} · {account.accountName} · ••••{account.accountNumberLast4}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium">
                  Payment reference (optional)
                  <input
                    value={paymentReference}
                    onChange={(event) => setPaymentReference(event.target.value)}
                    className="mt-1 w-full rounded-lg border p-3"
                    placeholder="Terminal or transfer reference"
                  />
                </label>
              </div>
            ) : null}
            <Button
              className="mt-5 w-full"
              disabled={
                busy ||
                !canReceiveOrder ||
                cart.length === 0 ||
                !discountIsValid ||
                (discountAmountMinor > 0 && discountReason.trim().length < 3) ||
                (paymentMethod === "customer_credit" &&
                  (!online ||
                    !customerId ||
                    creditPaidAmountMinor < 0 ||
                    creditPaidAmountMinor >= totals.grossAmountMinor ||
                    selectedCustomer?.creditStatus !== "approved" ||
                    selectedCustomer.availableCreditMinor < creditAmountMinor)) ||
                (paymentMethod === "exchange_credit" &&
                  (!online || !paymentReference)) ||
                ((["card", "bank_transfer"].includes(paymentMethod) ||
                  (paymentMethod === "customer_credit" &&
                    creditPaidAmountMinor > 0 &&
                    ["card", "bank_transfer"].includes(creditUpfrontMethod))) &&
                  !paymentBankAccountId)
              }
              onClick={() => void checkout()}
            >
              {online ? "Receive order" : "Save order offline"} ·{" "}
              {formatNaira(totals.grossAmountMinor)}
            </Button>
            <p className="mt-2 text-center text-xs text-[var(--muted)]">
              {online
                ? "This records the order only. Payment acceptance and final confirmation happen in the workflow queue above."
                : "The order is kept on this device and joins the payment queue after synchronization."}
            </p>
            <details className="mt-5 border-t pt-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Close shift
              </summary>
              <label className="mt-3 block text-sm">
                Counted closing cash (₦)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={closingCash}
                  onChange={(event) => setClosingCash(event.target.value)}
                  className="mt-1 w-full rounded-lg border p-2.5"
                />
              </label>
              <Button
                className="mt-3 w-full"
                variant="outline"
                disabled={!online || !closingCash || busy}
                onClick={() => void closeShift()}
              >
                Close and reconcile shift
              </Button>
            </details>
          </aside>
        </div>
      )}

      {workspace?.openShift && (
        <button type="button" onClick={() => setCartOpen(true)} className="fixed inset-x-4 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 flex min-h-12 items-center justify-between rounded-xl bg-[var(--brand)] px-4 font-semibold text-white shadow-xl lg:hidden">
          <span className="flex items-center gap-2"><ShoppingCart className="size-5" /> Current sale · {totals.totalQuantity} items</span>
          <span>{formatNaira(totals.grossAmountMinor)}</span>
        </button>
      )}

      {customerDialogOpen && (
        <div
          className="app-dialog-backdrop app-dialog-backdrop-high"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-customer-title"
        >
          <form
            ref={customerDialogRef}
            className="app-dialog-panel max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
            onSubmit={(event) => void createCustomerFromPos(event)}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="pos-customer-title" className="text-xl font-semibold">
                  Create customer
                </h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  The cart, prices, discount, and payment details stay exactly as
                  they are.
                </p>
              </div>
              <UserPlus className="size-6 shrink-0 text-[var(--brand)]" />
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium sm:col-span-2">
                Customer name
                <input
                  autoFocus
                  required
                  minLength={2}
                  maxLength={160}
                  value={newCustomer.name}
                  onChange={(event) =>
                    setNewCustomer((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border p-3"
                  placeholder="Customer or business name"
                />
              </label>
              <label className="text-sm font-medium">
                Phone
                <input
                  type="tel"
                  inputMode="tel"
                  pattern="0[0-9]{10}"
                  maxLength={11}
                  value={newCustomer.phone}
                  onChange={(event) =>
                    setNewCustomer((current) => ({
                      ...current,
                      phone: event.target.value.replace(/\D/g, "").slice(0, 11),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border p-3"
                  placeholder="07012345678"
                />
              </label>
              <label className="text-sm font-medium">
                Email
                <input
                  type="email"
                  maxLength={254}
                  value={newCustomer.email}
                  onChange={(event) =>
                    setNewCustomer((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border p-3"
                  placeholder="customer@example.com"
                />
              </label>
            </div>
            <p className="mt-3 text-xs text-[var(--muted)]">
              Enter at least a phone number or an email address. Credit remains
              unavailable until an administrator approves it.
            </p>
            <div className="safe-bottom mt-6 flex flex-wrap justify-end gap-3 border-t pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setCustomerDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  newCustomer.name.trim().length < 2 ||
                  (!newCustomer.phone.trim() && !newCustomer.email.trim())
                }
              >
                {busy ? "Saving…" : "Save and select"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {receipt?.document ? (
        <SaleDocumentDialog
          document={receipt.document}
          onClose={() => setReceipt(null)}
        />
      ) : receipt ? (
        <div
          className="app-dialog-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Sale receipt"
        >
          <section
            className="app-dialog-panel max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl"
            data-print-document
          >
            {receipt.queued ? (
              <CircleAlert className="mx-auto size-12 text-amber-600" />
            ) : (
              <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
            )}
            <h2 className="mt-3 text-2xl font-semibold">
              {receipt.queued ? "Order saved offline" : "Sale completed"}
            </h2>
            <p className="mt-2 font-mono text-sm">{receipt.reference}</p>
            <p className="mt-4 text-3xl font-semibold">
              {formatNaira(receipt.totalMinor)}
            </p>
            <p className="mt-3 text-sm text-[var(--muted)]">
              {receipt.queued
                ? "This provisional order reference will enter the payment-acceptance queue after synchronization."
                : "Inventory, VAT, settlement or receivable, and accounting records were posted."}
            </p>
            <div className="mt-5 flex gap-3" data-no-print>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.print()}
              >
                <Printer className="mr-2 size-4" /> Print provisional
              </Button>
              <Button className="flex-1" onClick={() => setReceipt(null)}>
                New sale
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {priceProductId &&
        workspace &&
        (() => {
          const product = workspace.products.find(
            (item) => item.id === priceProductId,
          );
          if (!product) return null;
          const enteredMinor = Number.isFinite(Number(branchPrice))
            ? Math.round(Number(branchPrice) * 100)
            : 0;
          const belowBase = enteredMinor < product.basePriceMinor;
          return (
            <div
              className="app-dialog-backdrop"
              role="dialog"
              aria-modal="true"
              aria-label="Branch selling price"
            >
              <section className="app-dialog-panel max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                <h2 className="text-xl font-semibold">Set branch price</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {product.name} · Central base{" "}
                  {formatNaira(product.basePriceMinor)}
                </p>
                <label className="mt-5 block text-sm font-medium">
                  Branch price before VAT (₦)
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={branchPrice}
                    onChange={(event) => setBranchPrice(event.target.value)}
                    className="mt-1 w-full rounded-lg border p-3 text-lg"
                  />
                </label>
                {belowBase && (
                  <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                    This is below the central base. Only a system administrator
                    may approve it, and a reason is mandatory.
                  </div>
                )}
                <label className="mt-3 block text-sm font-medium">
                  Approval reason {belowBase ? "(required)" : "(optional)"}
                  <textarea
                    value={priceReason}
                    onChange={(event) => setPriceReason(event.target.value)}
                    className="mt-1 w-full rounded-lg border p-3"
                  />
                </label>
                <div className="mt-5 flex justify-end gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setPriceProductId(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={
                      busy ||
                      !branchPrice ||
                      (belowBase && priceReason.trim().length < 3)
                    }
                    onClick={() => void saveBranchPrice()}
                  >
                    Save branch price
                  </Button>
                </div>
              </section>
            </div>
          );
        })()}
    </div>
  );
}
