"use client";

import { doc, getDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { getFirebaseServices } from "@/lib/firebase/client";
import { useAuth } from "./auth-context";
import {
  availableOperatingContexts,
  type OperatingContext,
} from "./operating-context";

export type OperatingContextOption = OperatingContext & {
  value: string;
  name: string;
  typeLabel: "Warehouse" | "Store / branch";
};

export function useOperatingContextOptions() {
  const { accessProfile, operatingContext, setOperatingContext } = useAuth();
  const contexts = useMemo(
    () => (accessProfile ? availableOperatingContexts(accessProfile) : []),
    [accessProfile],
  );
  const [contextNames, setContextNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    if (contexts.length === 0) {
      queueMicrotask(() => {
        if (active) setContextNames({});
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
          snapshot.exists()
            ? String(snapshot.get("name") || snapshot.get("code") || context.id)
            : context.id,
        ] as const;
      }),
    )
      .then((entries) => {
        if (active) setContextNames(Object.fromEntries(entries));
      })
      .catch(() => {
        if (active) setContextNames({});
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
      name: contextNames[value] ?? context.id,
      typeLabel: context.type === "warehouse" ? "Warehouse" : "Store / branch",
    };
  });
  const activeValue = operatingContext
    ? `${operatingContext.type}:${operatingContext.id}`
    : "";
  const activeOption = options.find((option) => option.value === activeValue);

  function selectValue(value: string) {
    const selected = options.find((option) => option.value === value);
    if (selected) setOperatingContext({ type: selected.type, id: selected.id });
  }

  return { options, activeValue, activeOption, selectValue };
}
