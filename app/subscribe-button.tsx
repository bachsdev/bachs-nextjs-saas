"use client";
import { useState } from "react";
import type { PlanKey } from "@/lib/plans";

export function SubscribeButton({ plan, label }: { plan: PlanKey; label: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function subscribe() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.checkout_url) window.location.href = body.checkout_url;
      else if (body.portal) window.location.reload();
      else setError(body.error || "Could not start checkout. Try again.");
    } catch {
      setError("Could not confirm checkout. Refresh the page to check its status.");
    } finally { setLoading(false); }
  }

  return (
    <>
      <button onClick={subscribe} disabled={loading}>
        {loading ? "Opening checkout..." : label}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
