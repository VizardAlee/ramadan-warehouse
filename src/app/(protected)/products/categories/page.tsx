"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { useDialogFocus } from "@/components/ui/use-dialog-focus";
import { callAdministration } from "@/features/administration/api";
import { useOrganizationCollection } from "@/features/administration/use-organization-collection";
import { useAuth } from "@/features/auth/auth-context";
import { hasPermission } from "@/lib/permissions/roles";
import type { ProductCategory } from "@/types/domain";
const schema = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  description: z.string().optional(),
  active: z.boolean(),
});
type Values = z.infer<typeof schema>;
const defaults: Values = { name: "", code: "", description: "", active: true };
export default function CategoriesPage() {
  const { profile } = useAuth();
  const categories =
    useOrganizationCollection<ProductCategory>("productCategories");
  const [editing, setEditing] = useState<ProductCategory | null>(null);
  const [open, setOpen] = useState(false);
  const dialogRef = useDialogFocus<HTMLFormElement>(open, () => setOpen(false));
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });
  const canManage = profile
    ? hasPermission(profile, editing ? "products.update" : "products.create")
    : false;
  function edit(category?: ProductCategory) {
    setEditing(category ?? null);
    form.reset(
      category
        ? {
            name: category.name,
            code: category.code,
            description: category.description ?? "",
            active: category.active,
          }
        : defaults,
    );
    setOpen(true);
  }
  const submit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await callAdministration("saveProductCategory", {
        ...values,
        description: values.description || undefined,
        ...(editing ? { id: editing.id } : {}),
        idempotencyKey: crypto.randomUUID(),
      });
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The category could not be saved. Review the form and try again.",
      );
    }
  });
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Product categories</h1>
          <p className="text-[var(--muted)]">
            Simple organization-scoped catalogue grouping.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => edit()}>
            <Plus className="mr-2 size-4" />
            Create category
          </Button>
        )}
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {categories.data.map((category) => (
          <article key={category.id} className="rounded-xl border bg-white p-5">
            <div className="flex justify-between">
              <div>
                <h2 className="font-semibold">{category.name}</h2>
                <p className="font-mono text-xs">{category.code}</p>
              </div>
              <StatusBadge tone={category.active ? "success" : "warning"}>
                {category.active ? "active" : "inactive"}
              </StatusBadge>
            </div>
            <p className="mt-3 text-sm text-[var(--muted)]">
              {category.description || "No description"}
            </p>
            {profile && hasPermission(profile, "products.update") && (
              <Button
                className="mt-4"
                variant="ghost"
                onClick={() => edit(category)}
              >
                Edit
              </Button>
            )}
          </article>
        ))}
      </div>
      {!categories.loading && categories.data.length === 0 && (
        <p className="rounded-xl border bg-white p-8 text-center text-[var(--muted)]">
          No categories configured.
        </p>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Product category editor">
          <form
            ref={dialogRef}
            onSubmit={submit}
            className="safe-bottom max-h-[calc(100dvh-1rem)] w-full max-w-lg space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl sm:p-6"
          >
            <h2 className="text-xl font-semibold">
              {editing ? "Edit" : "Create"} category
            </h2>
            <label className="block text-sm">
              Name
              <input
                {...form.register("name")}
                className="mt-1 w-full rounded-lg border p-2.5"
              />
            </label>
            <label className="block text-sm">
              Code (optional)
              <input
                {...form.register("code")}
                placeholder="Generated from the name if blank"
                className="mt-1 w-full rounded-lg border p-2.5 uppercase"
              />
            </label>
            <label className="block text-sm">
              Description
              <textarea
                {...form.register("description")}
                className="mt-1 w-full rounded-lg border p-2.5"
              />
            </label>
            <label className="flex gap-2 text-sm">
              <input type="checkbox" {...form.register("active")} />
              Active
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button>Save securely</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
