import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as checkout } from "@/app/api/checkout/route";
import { POST as portal } from "@/app/api/billing/portal/route";
import { POST as webhook } from "@/app/api/webhooks/bachs/route";
import { createCheckoutSession, createPortalSession } from "@/lib/bachs";
import { BachsApiError, BachsNetworkError, BachsConfigError } from "@bachs/sdk";
import * as store from "@/lib/store";

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "user_1", email: "jane@example.com", name: "Jane" })),
}));
vi.mock("@/lib/store", () => ({
  getCustomerId: vi.fn(), getSubscription: vi.fn(), reserveCheckout: vi.fn(),
  completeCheckout: vi.fn(), releaseCheckout: vi.fn(), markCheckoutUncertain: vi.fn(),
  processWebhookEvent: vi.fn(),
}));
vi.mock("@/lib/bachs", async (original) => ({
  ...await original<typeof import("@/lib/bachs")>(),
  createCheckoutSession: vi.fn(), createPortalSession: vi.fn(),
}));

const session = {
  checkout_id: "chk_test", checkout_url: "https://checkout.bachs.io/c/test",
  status: "open", expires_at: "2099-10-09T10:00:00Z",
  created_at: "2026-10-09T09:00:00Z", reference: null,
};
const request = (body: string) => new Request("http://localhost:3000/api/checkout", {
  method: "POST", headers: { "Content-Type": "application/json" }, body,
});
const event = {
  id: "evt_1", type: "invoice.paid", created_at: "2026-10-09T09:00:00Z", organization_id: "org_test", data: {},
};
function signed(body = JSON.stringify(event), valid = true) {
  const time = Math.floor(Date.now() / 1000);
  const mac = createHmac("sha256", "whsec_test").update(`${time}.${body}`).digest("hex");
  return new Request("http://localhost:3000/api/webhooks/bachs", {
    method: "POST", body,
    headers: { "X-Bachs-Signature-V2": `t=${time},v1=${valid ? mac : "bad"}` },
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BACHS_PRO_MONTHLY", "prod_monthly");
  vi.stubEnv("BACHS_PRO_YEARLY", "prod_yearly");
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("CHECKOUT_SUCCESS_URL", "https://app.example.com/billing/success");
  vi.stubEnv("CHECKOUT_CANCEL_URL", "https://app.example.com/");
  vi.stubEnv("BACHS_WEBHOOK_SECRET", "whsec_test");
  vi.mocked(store.reserveCheckout).mockResolvedValue({
    created: true, attempt: { key: "operation_1", productId: "prod_monthly", state: "pending" },
  });
  vi.mocked(createCheckoutSession).mockResolvedValue(session);
  vi.mocked(createPortalSession).mockResolvedValue({ id: "psn_1", url: "https://portal.bachs.io/s/test" });
  vi.mocked(store.processWebhookEvent).mockResolvedValue("saved");
  vi.mocked(store.completeCheckout).mockResolvedValue(undefined);
  vi.mocked(store.markCheckoutUncertain).mockResolvedValue(undefined);
  vi.mocked(store.releaseCheckout).mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("checkout route", () => {
  it("ignores client prices, product IDs, customer IDs, and user IDs", async () => {
    const res = await checkout(request(JSON.stringify({
      plan: "monthly", product_id: "prod_attacker", amount: "0.01",
      customer_id: "cust_attacker", user_id: "someone_else",
    })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checkout_url: session.checkout_url });
    expect(createCheckoutSession).toHaveBeenCalledWith({
      productId: "prod_monthly", customer: { email: "jane@example.com", name: "Jane" },
      userId: "user_1", successUrl: "https://app.example.com/billing/success",
      cancelUrl: "https://app.example.com/", idempotencyKey: "operation_1",
    });
    expect(store.completeCheckout).toHaveBeenCalledWith("user_1", "operation_1", session);
  });
  it("uses the signed-in user's saved customer", async () => {
    vi.mocked(store.getCustomerId).mockResolvedValue("cust_saved");
    await checkout(request('{"plan":"yearly"}'));
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      productId: "prod_yearly", customer: { customer_id: "cust_saved" },
    }));
  });
  it.each(["null", "[]", "{}", '{"plan":"unknown"}', '{"plan":{}}', "bad json", '{"plan":"__proto__"}'])(
    "rejects an invalid plan payload %s without creating checkout", async (body) => {
      expect((await checkout(request(body))).status).toBe(400);
      expect(createCheckoutSession).not.toHaveBeenCalled();
      expect(store.reserveCheckout).not.toHaveBeenCalled();
    },
  );
  it("refuses a new subscription when the user already has access", async () => {
    vi.mocked(store.getSubscription).mockResolvedValue({ status: "active" } as any);
    const res = await checkout(request('{"plan":"monthly"}'));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ portal: true });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
  it("returns an existing checkout after a repeated click", async () => {
    vi.mocked(store.reserveCheckout).mockResolvedValue({
      created: false, attempt: { key: "same", productId: "prod_monthly", state: "ready", session },
    });
    const res = await checkout(request('{"plan":"monthly"}'));
    expect(await res.json()).toEqual({ checkout_url: session.checkout_url });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
  it.each(["pending", "uncertain"] as const)("blocks a replacement for a %s operation", async (state) => {
    vi.mocked(store.reserveCheckout).mockResolvedValue({
      created: false, attempt: { key: "same", productId: "prod_monthly", state },
    });
    expect((await checkout(request('{"plan":"monthly"}'))).status).toBe(409);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
  it("preserves an uncertain operation instead of clearing it", async () => {
    vi.mocked(createCheckoutSession).mockRejectedValue(new BachsNetworkError("Lost response", undefined, true));
    const res = await checkout(request('{"plan":"monthly"}'));
    expect(res.status).toBe(502);
    expect(store.markCheckoutUncertain).toHaveBeenCalledWith("user_1", "operation_1");
    expect(store.releaseCheckout).not.toHaveBeenCalled();
  });
  it("allows a new attempt after an explicit API refusal", async () => {
    vi.mocked(createCheckoutSession).mockRejectedValue(new BachsApiError(400, { error_code: "INVALID", detail: "Invalid" }));
    expect((await checkout(request('{"plan":"monthly"}'))).status).toBe(502);
    expect(store.releaseCheckout).toHaveBeenCalledWith("user_1", "operation_1");
  });
  it("keeps an operation uncertain if saving its successful response fails", async () => {
    vi.mocked(store.completeCheckout).mockRejectedValue(new Error("disk unavailable"));
    expect((await checkout(request('{"plan":"monthly"}'))).status).toBe(502);
    expect(store.markCheckoutUncertain).toHaveBeenCalled();
    expect(store.releaseCheckout).not.toHaveBeenCalled();
  });
});

describe("portal route", () => {
  it("opens the saved customer's portal with a form-compatible redirect", async () => {
    vi.mocked(store.getCustomerId).mockResolvedValue("cust_saved");
    const res = await portal();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://portal.bachs.io/s/test");
    expect(createPortalSession).toHaveBeenCalledWith("cust_saved");
  });
  it("returns home when the user has no billing customer yet", async () => {
    const res = await portal();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    expect(createPortalSession).not.toHaveBeenCalled();
  });
  it("reports an API failure without redirecting to an invalid session", async () => {
    vi.mocked(store.getCustomerId).mockResolvedValue("cust_saved");
    vi.mocked(createPortalSession).mockRejectedValue(new Error("offline"));
    expect((await portal()).status).toBe(502);
  });
  it("logs the status code of an API refusal", async () => {
    vi.mocked(store.getCustomerId).mockResolvedValue("cust_saved");
    vi.mocked(createPortalSession).mockRejectedValue(new BachsApiError(404, { error_code: "CUSTOMER_NOT_FOUND", detail: "No customer" }));
    expect((await portal()).status).toBe(502);
    expect(console.error).toHaveBeenCalledWith("Bachs portal session failed",
      expect.objectContaining({ statusCode: 404, code: "CUSTOMER_NOT_FOUND" }));
  });
  it("names a configuration error instead of calling it a network failure", async () => {
    vi.mocked(store.getCustomerId).mockResolvedValue("cust_saved");
    vi.mocked(createPortalSession).mockRejectedValue(new BachsConfigError("environment is \"sandbox\" but the API key is a production key"));
    expect((await portal()).status).toBe(502);
    expect(console.error).toHaveBeenCalledWith("Bachs portal session failed",
      'environment is "sandbox" but the API key is a production key');
  });
});

describe("webhook route", () => {
  it("verifies the original raw JSON before handing it to the store", async () => {
    const body = JSON.stringify(event, null, 2);
    expect((await webhook(signed(body))).status).toBe(200);
    expect(store.processWebhookEvent).toHaveBeenCalledWith(event);
  });
  it("rejects a bad signature without processing it", async () => {
    expect((await webhook(signed(undefined, false))).status).toBe(400);
    expect(store.processWebhookEvent).not.toHaveBeenCalled();
  });
  it.each(["bad json", "null", "[]", "{}", JSON.stringify({ ...event, created_at: "invalid" })])(
    "rejects a signed malformed event %s", async (body) => {
      expect((await webhook(signed(body))).status).toBe(400);
      expect(store.processWebhookEvent).not.toHaveBeenCalled();
    },
  );
  it("returns 5xx for missing configuration so a delivery can be retried", async () => {
    vi.stubEnv("BACHS_WEBHOOK_SECRET", "");
    expect((await webhook(signed())).status).toBe(500);
    expect(store.processWebhookEvent).not.toHaveBeenCalled();
  });
  it("returns 5xx when state persistence fails", async () => {
    vi.mocked(store.processWebhookEvent).mockRejectedValue(new Error("database unavailable"));
    expect((await webhook(signed())).status).toBe(500);
  });
  it("acknowledges a successfully processed duplicate", async () => {
    vi.mocked(store.processWebhookEvent).mockResolvedValue("duplicate");
    expect((await webhook(signed())).status).toBe(200);
  });
});

it("does not send the local APP_URL as a checkout redirect", async () => {
  vi.stubEnv("CHECKOUT_SUCCESS_URL", "");
  vi.stubEnv("CHECKOUT_CANCEL_URL", "");
  expect((await checkout(request('{"plan":"monthly"}'))).status).toBe(200);
  expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
    successUrl: undefined, cancelUrl: undefined,
  }));
});

it("releases a checkout reservation when SDK configuration rejects before sending", async () => {
  vi.mocked(createCheckoutSession).mockRejectedValue(new BachsConfigError("Missing key"));
  expect((await checkout(request('{"plan":"monthly"}'))).status).toBe(502);
  expect(store.releaseCheckout).toHaveBeenCalledWith("user_1", "operation_1");
  expect(store.markCheckoutUncertain).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledWith("Bachs refused the checkout", "Missing key");
});
it("keeps an SDK 5xx refusal uncertain", async () => {
  vi.mocked(createCheckoutSession).mockRejectedValue(new BachsApiError(503, {}, undefined, undefined, true));
  expect((await checkout(request('{"plan":"monthly"}'))).status).toBe(502);
  expect(store.releaseCheckout).not.toHaveBeenCalled();
  expect(store.markCheckoutUncertain).toHaveBeenCalledWith("user_1", "operation_1");
});
it("accepts the matching rotation signature through the SDK webhook helper", async () => {
  const req = signed();
  req.headers.set("X-Bachs-Signature-V2",
    req.headers.get("X-Bachs-Signature-V2")!.replace(",v1=", ",v1=" + "0".repeat(64) + ",v1="));
  expect((await webhook(req)).status).toBe(200);
  expect(store.processWebhookEvent).toHaveBeenCalledWith(event);
});
it("rejects a stale signed delivery before accessing billing state", async () => {
  const body = JSON.stringify(event);
  const time = Math.floor(Date.now() / 1000) - 301;
  const mac = createHmac("sha256", "whsec_test").update(String(time) + "." + body).digest("hex");
  const req = new Request("http://localhost/api/webhooks/bachs", { method: "POST", body,
    headers: { "X-Bachs-Signature-V2": "t=" + time + ",v1=" + mac } });
  expect((await webhook(req)).status).toBe(400);
  expect(store.processWebhookEvent).not.toHaveBeenCalled();
});
