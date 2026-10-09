import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser } from "@/lib/auth";
afterEach(() => vi.unstubAllEnvs());
describe("demo authentication", () => {
  it("returns the shared demo identity in sandbox", async () => {
    vi.stubEnv("BACHS_API_KEY", "sk_sandbox_test");
    vi.stubEnv("DEMO_USER_EMAIL", "demo@example.com");
    expect(await getCurrentUser()).toEqual({ id: "demo-user", email: "demo@example.com", name: "Demo User" });
  });
  it("requires real authentication before accepting a live key", async () => {
    vi.stubEnv("BACHS_API_KEY", "sk_live_test");
    await expect(getCurrentUser()).rejects.toThrow("Replace demo authentication");
  });
});