"use client";

import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getFirebaseServices } from "@/lib/firebase/client";

export function PasswordSetup() {
  const params = useSearchParams();
  const code = params.get("oobCode") ?? "";
  const mode = params.get("mode");
  // A new link must remount the form, clearing previous passwords and verification.
  return <PasswordSetupForm key={`${mode}:${code}`} code={code} mode={mode} />;
}

function PasswordSetupForm({ code, mode }: { code: string; mode: string | null }) {
  const [status, setStatus] = useState<"checking" | "ready" | "invalid" | "saving" | "success">(!code || mode !== "resetPassword" ? "invalid" : "checking");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    if (code && mode === "resetPassword") {
      Promise.resolve().then(() => verifyPasswordResetCode(getFirebaseServices().auth, code))
        .then(() => { if (active) setStatus("ready"); })
        .catch(() => { if (active) setStatus("invalid"); });
    }
    return () => { active = false; mounted.current = false; };
  }, [code, mode]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || status !== "ready") return;
    setError("");
    if (password.length < 8) { setError("Use at least 8 characters for your password."); return; }
    if (password !== confirmation) { setError("Passwords do not match. Enter the same password in both fields."); return; }
    inFlight.current = true;
    setStatus("saving");
    try {
      await confirmPasswordReset(getFirebaseServices().auth, code, password);
      if (!mounted.current) return;
      setPassword(""); setConfirmation(""); setStatus("success");
      // Stay on the success screen; never follow an untrusted continueUrl.
    } catch (cause) {
      if (!mounted.current) return;
      const failure = (cause as { code?: string }).code;
      if (failure === "auth/expired-action-code" || failure === "auth/invalid-action-code") setStatus("invalid");
      else {
        setStatus("ready");
        setError(failure === "auth/weak-password" || failure === "auth/password-does-not-meet-requirements"
          ? "Choose a stronger password that meets the account's password requirements."
          : "Password could not be saved. Check your connection and try again.");
      }
    } finally { inFlight.current = false; }
  }

  if (status === "checking") return <p role="status">Checking your setup link…</p>;
  if (status === "invalid") return <><p role="alert">This password setup link is invalid or has expired. Ask your administrator for a new link.</p><Link href="/login" className="mt-4 inline-block underline">Go to login</Link></>;
  if (status === "success") return <><p role="status">Password saved. You can now sign in.</p><Link href="/login">Go to login</Link></>;
  const busy = status === "saving";
  return <form onSubmit={submit} className="space-y-5" noValidate aria-busy={busy}>
    <p className="text-sm text-slate-600">Choose a password with at least 8 characters, then enter it again to confirm.</p>
    <label className="block text-sm font-medium">New password<input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} required className="mt-2 w-full rounded-lg border px-3 py-2.5" aria-describedby={error ? "password-setup-error" : undefined} /></label>
    <label className="block text-sm font-medium">Confirm password<input type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} required className="mt-2 w-full rounded-lg border px-3 py-2.5" aria-describedby={error ? "password-setup-error" : undefined} /></label>
    {error && <p id="password-setup-error" role="alert" className="text-sm text-red-700">{error}</p>}
    <button type="submit" disabled={busy} className="w-full rounded-lg bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-60">{busy ? "Saving password…" : "Save password"}</button>
    <Link href="/login" className="block text-center text-sm underline">Back to login</Link>
  </form>;
}
