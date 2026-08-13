"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useAuth } from "./auth-context";
import { toUserFacingError } from "@/lib/firebase/user-facing-error";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
type LoginValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const { login } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try { await login(values.email, values.password); router.replace("/dashboard"); }
    catch (error) { setFormError(toUserFacingError(error, "Sign-in failed. Check your credentials and account access.").message); }
  });

  return <form onSubmit={submit} className="space-y-5" noValidate>
    <label className="block text-sm font-medium">Email address<input {...register("email")} autoComplete="email" className="mt-2 w-full rounded-lg border bg-white px-3 py-2.5" />{errors.email && <span className="mt-1 block text-xs text-red-700">Enter a valid email address.</span>}</label>
    <label className="block text-sm font-medium">Password<input {...register("password")} type="password" autoComplete="current-password" className="mt-2 w-full rounded-lg border bg-white px-3 py-2.5" />{errors.password && <span className="mt-1 block text-xs text-red-700">Password must have at least 8 characters.</span>}</label>
    {formError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{formError}</p>}
    <Button className="w-full" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in securely"}</Button>
  </form>;
}
