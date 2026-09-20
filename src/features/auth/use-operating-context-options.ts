"use client";

import { doc, getDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { getFirebaseServices } from "@/lib/firebase/client";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import type { Branch, Warehouse as WarehouseRecord } from "@/types/domain";
import { useAuth } from "./auth-context";
import {
  availableOperatingContexts,
  hasOrganizationWideOperatingAccess,
  operatingContextTypeLabel,
  type OperatingContext,
} from "./operating-context";

export type OperatingContextOption = OperatingContext & {
  value: string;
  name: string;
  typeLabel: string;
};

interface ContextMetadata {
  name: string;
  branchType?: "head_office" | "store";
}

export function useOperatingContextOptions() {
  const { accessProfile, operatingContext, setOperatingContext } = useAuth();
  const organizationWide = Boolean(
    accessProfile && hasOrganizationWideOperatingAccess(accessProfile),
  );
  const branches = useOrganizationCollection<Branch>("branches", organizationWide);
  const warehouses = useOrganizationCollection<WarehouseRecord>(
    "warehouses",
    organizationWide,
  );
  const assignedContexts = useMemo(
    () => (accessProfile ? availableOperatingContexts(accessProfile) : []),
    [accessProfile],
  );
  const contexts = useMemo(
    () =>
      organizationWide
        ? [
            ...warehouses.data
              .filter((warehouse) => warehouse.status === "active")
              .map((warehouse) => ({
                type: "warehouse" as const,
                id: warehouse.id,
              })),
            ...branches.data
              .filter((branch) => branch.status === "active")
              .map((branch) => ({ type: "branch" as const, id: branch.id })),
          ]
        : assignedContexts,
    [assignedContexts, branches.data, organizationWide, warehouses.data],
  );
  const [contextMetadata, setContextMetadata] = useState<
    Record<string, ContextMetadata>
  >({});

  useEffect(() => {
    let active = true;
    if (contexts.length === 0) {
      queueMicrotask(() => {
        if (active) setContextMetadata({});
      });
      return () => {
        active = false;
      };
    }
    void Promise.all(
      contexts.map(async (context) => {
        const value = `${context.type}:${context.id}`;
        const snapshot = await getDoc(
          doc(
            getFirebaseServices().db,
            context.type === "warehouse" ? "warehouses" : "branches",
            context.id,
          ),
        );
        return [
          value,
          {
            name: snapshot.exists()
              ? String(
                  snapshot.get("name") || snapshot.get("code") || context.id,
                )
              : context.id,
            branchType:
              context.type === "branch" &&
              snapshot.get("branchType") === "head_office"
                ? ("head_office" as const)
                : context.type === "branch"
                  ? ("store" as const)
                  : undefined,
          },
        ] as const;
      }),
    )
      .then((entries) => {
        if (active) setContextMetadata(Object.fromEntries(entries));
      })
      .catch(() => {
        if (active) setContextMetadata({});
      });
    return () => {
      active = false;
    };
  }, [contexts]);

  const options = contexts.map<OperatingContextOption>((context) => {
    const value = `${context.type}:${context.id}`;
    return {
      ...context,
      value,
      name: contextMetadata[value]?.name ?? context.id,
      typeLabel: operatingContextTypeLabel(
        context,
        contextMetadata[value]?.branchType,
      ),
    };
  });
  const activeValue = operatingContext
    ? `${operatingContext.type}:${operatingContext.id}`
    : "";
  const activeOption = options.find((option) => option.value === activeValue);

  function selectValue(value: string) {
    if (!value && organizationWide) {
      setOperatingContext(null);
      return;
    }
    const selected = options.find((option) => option.value === value);
    if (selected) setOperatingContext({ type: selected.type, id: selected.id });
  }

  return {
    options,
    activeValue,
    activeOption,
    canSelectAll: organizationWide,
    selectValue,
  };
}
