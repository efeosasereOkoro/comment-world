"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get("redirect") || "/dashboard";
  const confirmed = params.get("confirmed");

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // After a visitor confirms their email, Supabase sends them back here with
  // ?confirmed=1. Land them on the sign-in form with a clear next step.
  useEffect(() => {
    if (confirmed) {
      setMode("signin");
      setNotice("You've confirmed your email address. Sign in to get started.");
    }
  }, [confirmed]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      router.push(redirectTo);
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // When they confirm from their inbox, bring them back to this page
          // (the sign-up / sign-in page) with a clear next step.
          emailRedirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/login?confirmed=1`
              : undefined,
        },
      });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      // If email confirmation is on, there's no session yet.
      if (data.session) {
        router.push(redirectTo);
        router.refresh();
      } else {
        setNotice(
          `Check your email. We've sent a confirmation link to ${email}. Select it to confirm your account, then come back here to sign in.`
        );
        setMode("signin");
        setBusy(false);
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="stack">
      {error && <div className="notice notice--error">{error}</div>}
      {notice && <div className="notice notice--ok">{notice}</div>}

      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>

      <p className="small muted" style={{ textAlign: "center", margin: 0 }}>
        {mode === "signin" ? "No account yet? " : "Already have an account? "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setError(null);
            setNotice(null);
            setMode(mode === "signin" ? "signup" : "signin");
          }}
        >
          {mode === "signin" ? "Create one" : "Sign in"}
        </a>
      </p>
    </form>
  );
}
