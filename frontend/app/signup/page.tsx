"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

export default function SignupPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [name, setName]         = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState(false);
  const router = useRouter();

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) { setError(error.message); setLoading(false); }
    else setSuccess(true);
  }

  async function handleGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  if (success) {
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px", position: "relative", zIndex: 1 }}>
            <span style={{ fontSize: "1.4rem" }}>🍳</span>
            <span className="font-serif" style={{ fontSize: "1.15rem", fontStyle: "italic", color: "var(--bg)" }}>
              Mise en Place
            </span>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", position: "relative", zIndex: 1 }}>
            <div className="font-serif" style={{ fontSize: "2rem", fontStyle: "italic", color: "rgba(240,235,228,0.9)", lineHeight: 1.3 }}>
              "Great cooking is where preparation meets curiosity."
            </div>
            <hr style={{ width: "40px", height: "1px", background: "var(--accent)", border: "none", margin: "20px 0" }} />
            <p style={{ fontSize: "0.9rem", color: "rgba(240,235,228,0.5)", lineHeight: 1.7, margin: 0, maxWidth: "320px" }}>
              Join home cooks who never stare at an empty fridge again. Your AI sous chef is ready.
            </p>
          </div>
          <div style={{ position: "relative", zIndex: 1 }}>
            {["Cookware-aware recipes", "Conversational memory", "Step-by-step Cook Mode"].map((feat, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", color: "rgba(240,235,228,0.6)", fontSize: "0.875rem", marginBottom: "10px" }}>
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--accent)", display: "inline-block", flexShrink: 0 }} />
                {feat}
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — success state */}
        <div style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px",
          background: "var(--bg)",
        }}>
          <div className="animate-fade-up" style={{ maxWidth: "380px", width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: "3.5rem", marginBottom: "20px" }}>✉️</div>
            <h2 className="font-serif" style={{ fontSize: "1.75rem", fontStyle: "italic", margin: "0 0 12px", color: "var(--text)" }}>
              Check your email
            </h2>
            <p style={{ color: "var(--text-muted)", lineHeight: 1.7, margin: "0 0 28px", fontSize: "0.9375rem" }}>
              We sent a confirmation link to <strong style={{ color: "var(--text)" }}>{email}</strong>. Click it to activate your account and start cooking.
            </p>
            <Link href="/login" className="btn btn-primary" style={{ justifyContent: "center", display: "inline-flex", borderRadius: "99px", padding: "12px 28px" }}>
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
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
            }}
          >
            "Great cooking is where preparation meets curiosity."
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
            Join home cooks who never stare at an empty fridge again. Your AI sous chef is ready.
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

          {/* Mobile logo */}
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

          {/* Form */}
          <div>
            <h2 className="font-serif" style={{ fontSize: "1.75rem", fontStyle: "italic", margin: "0 0 4px", color: "var(--text)" }}>
              Set up your kitchen
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", margin: "0 0 28px" }}>
              Create your free account
            </p>

            {error && (
              <div className="animate-fade-in" style={{
                padding: "12px 14px",
                background: "var(--accent-light)",
                border: "1px solid rgba(194,82,43,0.2)",
                borderRadius: "var(--radius)",
                color: "var(--accent)",
                fontSize: "0.875rem",
                marginBottom: "16px",
              }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text-muted)" }}>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Julia Child"
                  className="input"
                  autoComplete="name"
                />
              </div>
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
                  placeholder="At least 8 characters"
                  className="input"
                  required
                  minLength={8}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary btn-lg"
                style={{ width: "100%", justifyContent: "center" }}
              >
                {loading ? <><span className="auth-spinner" /> Creating account…</> : "Create account"}
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
              Already have an account?{" "}
              <Link href="/login" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 500 }}>Sign in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
