import { Suspense } from "react";
import LoginForm from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="auth-wrap">
      <h1 style={{ textAlign: "center" }}>
        <span style={{ color: "var(--primary)" }}>commentbox</span>
      </h1>
      <p className="muted small" style={{ textAlign: "center", marginTop: 0 }}>
        Sign in to manage your sites and comments.
      </p>
      <div className="card" style={{ marginTop: "1.5rem" }}>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
