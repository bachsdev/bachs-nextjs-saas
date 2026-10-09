import { randomUUID } from "node:crypto";
import { Bachs, BachsConfigError, type CustomerInput, type CheckoutSessionCreated } from "@bachs/sdk";

// App-specific mapping only. HTTP, validation and retries belong to the SDK.
export function getBachs() {
  const environment = process.env.BACHS_ENVIRONMENT || "sandbox";
  if (environment !== "sandbox" && environment !== "production") {
    throw new BachsConfigError("Set BACHS_ENVIRONMENT to sandbox or production.");
  }
  return new Bachs({
    apiKey: process.env.BACHS_API_KEY || "",
    environment,
    baseURL: process.env.BACHS_API_URL || undefined,
  });
}
export type CheckoutSession = CheckoutSessionCreated;
export type CheckoutCustomer = CustomerInput;
export async function createCheckoutSession(input: {
  productId: string;
  customer: CheckoutCustomer;
  userId: string;
  successUrl?: string;
  cancelUrl?: string;
  idempotencyKey: string;
}) {
  return getBachs().checkoutSessions.create({
    product_cart: [{ product_id: input.productId, quantity: 1 }],
    customer: input.customer,
    billing_currency: "USD",
    metadata: { user_id: input.userId },
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  }, { idempotencyKey: input.idempotencyKey });
}
export function createPortalSession(customerId: string) {
  return getBachs().customerPortal.createSession(customerId, { idempotencyKey: randomUUID() });
}