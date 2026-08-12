"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import { callAdministration } from "@/features/administration/api";
import { getFirebaseServices } from "@/lib/firebase/client";
import { hasPermission } from "@/lib/permissions/roles";
import type { Organization } from "@/types/domain";

const schema = z.object({
  legalName: z.string().min(2),
  tradingName: z.string().optional(),
  registrationNumber: z.string().optional(),
  contactEmail: z.union([z.string().email(), z.literal("")]).optional(),
  phoneNumbersText: z.string().optional(),
  address: z.string().optional(),
  timezone: z.string().min(1),
  status: z.enum(["active", "inactive"]),
});
type Values = z.infer<typeof schema>;

export default function OrganizationPage() {
  const { profile } = useAuth(); const [message, setMessage] = useState<string | null>(null); const canManage = profile ? hasPermission(profile, "organization.manage") : false;
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { legalName: "", timezone: "Africa/Lagos", status: "active" } });
  useEffect(() => { if (!profile) return; return onSnapshot(doc(getFirebaseServices().db, "organizations", profile.organizationId), (snapshot) => { if (snapshot.exists()) { const organization = snapshot.data() as Organization; reset({ legalName: organization.legalName, tradingName: organization.tradingName ?? "", registrationNumber: organization.registrationNumber ?? "", contactEmail: organization.contactEmail ?? "", phoneNumbersText: organization.phoneNumbers.join(", "), address: organization.address ?? "", timezone: organization.timezone, status: organization.status }); } }); }, [profile, reset]);
  const submit = handleSubmit(async (values) => { try { const phoneNumbers = values.phoneNumbersText?.split(",").map((phone) => phone.trim()).filter(Boolean) ?? []; const payload = Object.fromEntries(Object.entries({ ...values, phoneNumbers, defaultCurrency: "NGN" }).filter(([key, value]) => key !== "phoneNumbersText" && value !== "" && value !== undefined)); await callAdministration("updateOrganization", { ...payload, reason: "Organization profile update" }); setMessage("Organization updated."); } catch { setMessage("The organization update was rejected."); } });
  return <form onSubmit={submit} className="max-w-3xl space-y-5"><div><h1 className="text-3xl font-semibold">Organization</h1><p className="text-[var(--muted)]">Update approved organization profile fields. Currency is fixed to NGN.</p></div>{message && <p className="rounded-lg bg-emerald-50 p-3 text-sm">{message}</p>}<div className="grid gap-4 rounded-xl border bg-white p-6 md:grid-cols-2"><label className="text-sm">Legal name<input {...register("legalName")} disabled={!canManage} className="mt-1 w-full rounded-lg border p-2.5"/>{errors.legalName && <span className="text-xs text-red-700">Legal name is required.</span>}</label><label className="text-sm">Trading name<input {...register("tradingName")} disabled={!canManage} className="mt-1 w-full rounded-lg border p-2.5"/></label><label className="text-sm">Registration number<input {...register("registrationNumber")} disabled={!canManage} className="mt-1 w-full rounded-lg border p-2.5"/></label><label className="text-sm">Contact email<input {...register("contactEmail")} disabled={!canManage} className="mt-1 w-full rounded-lg border p-2.5"/>{errors.contactEmail && <span className="text-xs text-red-700">Enter a valid email.</span>}</label><label className="text-sm">Phone numbers (comma separated)<input {...register("phoneNumbersText")} disabled={!canManage} className="mt-1 w-full rounded-lg border p-2.5"/></label><label className="text-sm">Time zone<input {...register("timezone")} disabled={!canManage} className="mt-1 w-full rounded-lg border p-2.5"/></label><label className="text-sm md:col-span-2">Address<input {...register("address")} disabled={!canManage} className="mt-1 w-full rounded-lg border p-2.5"/></label><label className="text-sm">Status<select {...register("status")} disabled={!canManage} className="mt-1 w-full rounded-lg border p-2.5"><option>active</option><option>inactive</option></select></label><label className="text-sm">Default currency<input value="NGN" readOnly className="mt-1 w-full rounded-lg border bg-slate-50 p-2.5"/></label>{canManage && <div className="md:col-span-2"><Button disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save organization"}</Button></div>}</div></form>;
}
