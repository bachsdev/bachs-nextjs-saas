import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCheckoutSession, createPortalSession } from "@/lib/bachs";

import { BachsApiError, BachsNetworkError } from "@bachs/sdk";

const input = {
  productId: "prod_8f3a2c9d1e4b7a6c5d0f",
  customer: { email: "jane@example.com", name: "Jane" },
  userId: "8812",
  successUrl: "https://app.example.com/billing/success",
  cancelUrl: "https://app.example.com/",
  idempotencyKey: "checkout-operation-1",
};
const session = {
  checkout_id: "chk_123", checkout_url: "https://checkout.bachs.io/c/test",
  status: "open", expires_at: "2099-10-09T10:00:00Z",
  created_at: "2026-10-09T09:00:00Z", reference: null,
};
const send = vi.fn();
beforeEach(() => {
  send.mockReset();
  vi.stubGlobal("fetch", send);
  vi.stubEnv("BACHS_API_URL", "https://sandbox-api.bachs.io/");
  vi.stubEnv("BACHS_API_KEY", "sk_sandbox_test");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Bachs client", () => {
  it("uses the server's product, customer and persistent operation key", async () => {
    send.mockResolvedValue(Response.json(session));
    expect(await createCheckoutSession(input)).toEqual(session);
    const [url, options] = send.mock.calls[0];
    expect(String(url)).toBe("https://sandbox-api.bachs.io/v1/checkout-sessions");
    expect(options.headers.get("Authorization")).toBe("Bearer sk_sandbox_test");
    expect(options.headers.get("Idempotency-Key")).toBe(input.idempotencyKey);
    expect(JSON.parse(options.body)).toEqual({
      product_cart: [{ product_id: input.productId, quantity: 1 }],
      customer: input.customer, billing_currency: "USD", metadata: { user_id: "8812" },
      success_url: input.successUrl, cancel_url: input.cancelUrl,
    });
  });
  it.each(["network", "5xx", "non-json", "missing-fields"])(
    "keeps a %s outcome uncertain without resubmitting", async (failure) => {
      if (failure === "network") send.mockRejectedValue(new TypeError("lost response"));
      if (failure === "5xx") send.mockResolvedValue(new Response("Unavailable", { status: 503 }));
      if (failure === "non-json") send.mockResolvedValue(new Response("<html>proxy</html>"));
      if (failure === "missing-fields") send.mockResolvedValue(Response.json({}));
      await expect(createCheckoutSession(input)).rejects.toMatchObject({
        outcomeUnknown: true,
      });
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it("returns a typed API refusal with its documentation link", async () => {
    send.mockResolvedValue(Response.json({
      detail: "Invalid product", error_code: "PRODUCT_NOT_FOUND", doc_url: "https://docs.bachs.io/errors",
    }, { status: 400 }));
    await expect(createCheckoutSession(input)).rejects.toMatchObject({
      status: 400, errorCode: "PRODUCT_NOT_FOUND", message: "Invalid product",
      body: expect.objectContaining({ doc_url: "https://docs.bachs.io/errors" }),
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("keeps non-JSON 4xx responses as refusals", async () => {
    send.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await expect(createCheckoutSession(input)).rejects.toBeInstanceOf(BachsApiError);
  });
  it("exposes a distinct uncertain outcome", async () => {
    send.mockRejectedValue(new Error("offline"));
    await expect(createCheckoutSession(input)).rejects.toBeInstanceOf(BachsNetworkError);
  });
  it("refuses missing credentials before making a request", async () => {
    vi.stubEnv("BACHS_API_KEY", "");
    await expect(createCheckoutSession(input)).rejects.toThrow("A server API key is required");
    expect(send).not.toHaveBeenCalled();
  });
  it("encodes the customer ID and creates a fresh portal session", async () => {
    send.mockImplementation(() => Promise.resolve(Response.json({ id: "psn_1", url: "https://portal.bachs.io/s/test" })));
    await createPortalSession("cust_test/slash");
    await createPortalSession("cust_test/slash");
    expect(String(send.mock.calls[0][0])).toContain("/customers/cust_test%2Fslash/portal-sessions");
    expect(send.mock.calls[0][1].headers.get("Idempotency-Key"))
      .not.toBe(send.mock.calls[1][1].headers.get("Idempotency-Key"));
    expect(send.mock.calls[0][1].body).toBeUndefined();
  });
});

it("omits optional redirects for a fully local sandbox app", async () => {
  send.mockResolvedValue(Response.json(session));
  await createCheckoutSession({ ...input, successUrl: undefined, cancelUrl: undefined });
  const body = JSON.parse(send.mock.calls[0][1].body);
  expect(body).not.toHaveProperty("success_url");
  expect(body).not.toHaveProperty("cancel_url");
});
