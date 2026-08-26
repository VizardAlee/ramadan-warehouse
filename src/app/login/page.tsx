import type { Metadata } from "next";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Building2,
  CheckCircle2,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  Truck,
  WifiOff,
} from "lucide-react";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Secure access to AB Ramadan's connected warehouse, branch, inventory, and sales operations.",
};

const capabilities = [
  { icon: Boxes, label: "Live inventory" },
  { icon: ShoppingCart, label: "Branch POS" },
  { icon: BarChart3, label: "Financial control" },
  { icon: WifiOff, label: "Offline-ready sales" },
];

export default function LoginPage() {
  return (
    <main className="login-stage">
      <div className="login-glow login-glow-one" />
      <div className="login-glow login-glow-two" />
      <div className="login-noise" />

      <header className="login-header">
        <div className="login-brand">
          <span className="login-brand-mark"><Boxes aria-hidden="true" /></span>
          <span>
            <strong>AB Ramadan</strong>
            <small>Warehouse &amp; Retail OS</small>
          </span>
        </div>
        <div className="login-secure-pill">
          <span className="login-live-dot" />
          Secure operations portal
        </div>
      </header>

      <section className="login-content">
        <div className="login-story">
          <div className="login-kicker"><Sparkles className="size-4" /> One connected operating system</div>
          <h1>
            Every product.<br />
            Every movement.<br />
            <span>Completely accountable.</span>
          </h1>
          <p className="login-lede">
            Run warehouses, stores, sales, purchasing and finance from one auditable source of truth—built for the speed of real business.
          </p>

          <div className="login-capabilities" aria-label="Platform capabilities">
            {capabilities.map(({ icon: Icon, label }) => (
              <span key={label}><Icon aria-hidden="true" />{label}</span>
            ))}
          </div>

          <div className="login-flow" aria-label="Live warehouse-to-store workflow illustration">
            <div className="login-flow-grid" />
            <div className="login-route login-route-one" />
            <div className="login-route login-route-two" />

            <article className="login-node login-node-warehouse">
              <span className="login-node-icon"><Building2 /></span>
              <div><small>ORIGIN</small><strong>Central warehouse</strong><span>Stock verified</span></div>
              <CheckCircle2 className="login-node-check" />
            </article>

            <div className="login-moving-truck" aria-hidden="true"><Truck /></div>

            <article className="login-node login-node-branch">
              <span className="login-node-icon login-node-icon-gold"><Store /></span>
              <div><small>DESTINATION</small><strong>Retail branch</strong><span>Ready to sell</span></div>
              <CheckCircle2 className="login-node-check" />
            </article>

            <article className="login-float-card login-float-stock">
              <span><PackageCheck /></span>
              <div><small>TRANSFER</small><strong>20 units received</strong></div>
            </article>
            <article className="login-float-card login-float-sale">
              <span><BarChart3 /></span>
              <div><small>LIVE POSITION</small><strong>Balanced &amp; posted</strong></div>
            </article>
          </div>
        </div>

        <div className="login-access-wrap">
          <div className="login-access-halo" />
          <section className="login-access-card" aria-labelledby="sign-in-title">
            <div className="login-card-topline">
              <span className="login-card-icon"><ShieldCheck /></span>
              <span>Invitation-only access</span>
            </div>
            <p className="login-eyebrow">WELCOME BACK</p>
            <h2 id="sign-in-title">Sign in to your workspace</h2>
            <p className="login-card-copy">Use the account securely provisioned by your administrator.</p>
            <LoginForm />
            <div className="login-trust-row">
              <span><ShieldCheck />Role-based access</span>
              <span><CheckCircle2 />Audited activity</span>
            </div>
          </section>
          <p className="login-access-note"><ArrowRight /> Your role and assigned locations load automatically after sign-in.</p>
        </div>
      </section>

      <footer className="login-footer">
        <span>AB Ramadan Ltd.</span>
        <span>Inventory · Sales · Finance · Control</span>
      </footer>
    </main>
  );
}
