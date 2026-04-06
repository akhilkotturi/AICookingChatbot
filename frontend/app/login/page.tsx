"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--bg)" }} />}>
      <LoginPageContent />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function LoginPageContent() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const router       = useRouter();
  const searchParams = useSearchParams();
  const next         = searchParams.get("next") || "/dashboard";
  const callbackError = searchParams.get("error");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); }
    else { router.push(next); router.refresh(); }
  }

  async function handleGoogle() {
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setError(error.message);
    }
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>

      {/* Left panel */}
      <div
        className="auth-split-left"
        style={{
          flex: "0 0 44%",
          background: "var(--text)",
          display: "flex",
          flexDirection: "column",
          padding: "40px 48px",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Decorative circle */}
        <div style={{
          position: "absolute",
          top: -100,
          right: -100,
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "rgba(194,82,43,0.12)",
          pointerEvents: "none",
        }} />

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", position: "relative", zIndex: 1 }}>
          <span style={{ fontSize: "1.4rem" }}>🍳</span>
          <span className="font-serif" style={{ fontSize: "1.15rem", fontStyle: "italic", color: "var(--bg)" }}>
            Mise en Place
          </span>
        </div>

        {/* Center quote */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", zIndex: 1 }}>
          <div
            className="font-serif"
            style={{
              fontSize: "2rem",
              fontStyle: "italic",
              color: "rgba(240,235,228,0.9)",
              lineHeight: 1.3,
              marginBottom: "0",
            }}
          >
            "Everything in its place."
          </div>
          <hr style={{
            width: "40px",
            height: "1px",
            background: "var(--accent)",
            border: "none",
            margin: "20px 0",
          }} />
          <p style={{
            fontSize: "0.9rem",
            color: "rgba(240,235,228,0.5)",
            lineHeight: 1.7,
            margin: 0,
            maxWidth: "320px",
          }}>
            The French culinary concept that transformed professional kitchens. Now it's your AI cooking companion.
          </p>
        </div>

        {/* Feature list */}
        <div style={{ position: "relative", zIndex: 1 }}>
          {["Cookware-aware recipes", "Conversational memory", "Step-by-step Cook Mode"].map((feat, i) => (
            <div key={i} style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              color: "rgba(240,235,228,0.6)",
              fontSize: "0.875rem",
              marginBottom: "10px",
            }}>
              <span style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: "var(--accent)",
                display: "inline-block",
                flexShrink: 0,
              }} />
              {feat}
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px",
        background: "var(--bg)",
      }}>
        <div style={{ maxWidth: "380px", width: "100%" }}>

          {/* Mobile logo (visible when left panel is hidden) */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            justifyContent: "center",
            marginBottom: "28px",
          }}>
            <span style={{ fontSize: "1.4rem" }}>🍳</span>
            <span className="font-serif" style={{ fontSize: "1.1rem", fontStyle: "italic", color: "var(--text)" }}>
              Mise en Place
            </span>
          </div>

          {/* Form card (no border/shadow — floats clean) */}
          <div>
            <h2 className="font-serif" style={{ fontSize: "1.75rem", fontStyle: "italic", margin: "0 0 4px", color: "var(--text)" }}>
              Welcome back
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0 0 28px" }}>
              Sign in to continue cooking
            </p>

            {(error || callbackError) && (
              <div className="animate-fade-in" style={{
                padding: "12px 14px",
                background: "var(--accent-light)",
                border: "1px solid rgba(194,82,43,0.2)",
                borderRadius: "var(--radius)",
                color: "var(--accent)",
                fontSize: "0.875rem",
                marginBottom: "16px",
              }}>
                {error || callbackError}
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text-muted)" }}>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input"
                  required
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text-muted)" }}>Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary btn-lg"
                style={{ width: "100%", justifyContent: "center" }}
              >
                {loading ? <><span className="auth-spinner" /> Signing in…</> : "Sign in"}
              </button>
            </form>

            <div className="divider" style={{ margin: "20px 0" }}>or</div>

            <button
              onClick={handleGoogle}
              className="btn btn-secondary btn-lg"
              style={{ width: "100%", justifyContent: "center" }}
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <p style={{ textAlign: "center", marginTop: "20px", fontSize: "0.875rem", color: "var(--text-muted)" }}>
              <Link href="/signup" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>
                No account? Create one free →
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
