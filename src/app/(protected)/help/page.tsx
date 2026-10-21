"use client";
import { useAuth } from "@/features/auth/auth-context";
import { SupportWorkspace } from "@/features/support/workspace";

export default function HelpPage() {
  const { user, profile, operatingContext } = useAuth();
  if (!user || !profile) return <p>Sign in to use private help and feedback.</p>;
  const scopeKey = JSON.stringify([user.uid, profile.organizationId, profile.authorizationVersion, operatingContext]);
  return <SupportWorkspace key={scopeKey} />;
}
