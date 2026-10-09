import type { WebhookEvent } from "@bachs/sdk";
import type { SubscriptionRecord } from "./store";

export type BachsEvent = WebhookEvent;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type EventStore = {
  isEventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string): Promise<void>;
  getSubscription(userId: string): Promise<SubscriptionRecord | undefined>;
  saveSubscription(record: SubscriptionRecord): Promise<void>;
};

// True when the stored record came from a later event than this one.
function isOlder(eventCreatedAt: string, stored: SubscriptionRecord | undefined) {
  if (!stored) return false;
  const incoming = Date.parse(eventCreatedAt);
  const current = Date.parse(stored.updatedAt);
  return Number.isFinite(incoming) && Number.isFinite(current) && incoming < current;
}

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/**
 * Applies one verified event. Each subscription event carries the whole
 * subscription, so the record is replaced, not patched. An event older than
 * the stored record is skipped, in case deliveries arrive out of order.
 * Returns what happened, which the route logs and the tests check.
 */
export async function handleEvent(
  event: BachsEvent,
  store: EventStore,
): Promise<"duplicate" | "saved" | "stale" | "ignored"> {
  if (await store.isEventProcessed(event.id)) return "duplicate";

  let result: "saved" | "stale" | "ignored" = "ignored";
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    const sub = event.data;
    const metadata = record(sub.metadata) ? sub.metadata : undefined;
    const customer = record(sub.customer) ? sub.customer : undefined;
    const userId = metadata?.user_id;
    if (userId && (typeof userId !== "string" || typeof sub.subscription_id !== "string" || typeof customer?.customer_id !== "string" || typeof sub.product_id !== "string" ||
        typeof sub.status !== "string" || !Number.isFinite(Date.parse(event.created_at)))) {
      throw new Error("Incomplete subscription event");
    }
    if (userId && isOlder(event.created_at, await store.getSubscription(String(userId)))) {
      result = "stale";
    } else if (userId) {
      await store.saveSubscription({
        userId: String(userId),
        subscriptionId: sub.subscription_id as string,
        customerId: customer!.customer_id as string,
        productId: sub.product_id as string,
        status: sub.status as string,
        currentPeriodEnd: typeof sub.current_period_end === "string" ? sub.current_period_end : null,
        cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        updatedAt: event.created_at,
      });
      result = "saved";
    }
  }
  // invoice.paid and invoice.payment_failed need no change here: the
  // subscription events that follow them carry the new status. Add your own
  // receipts or "update your card" banner here if you want them.

  await store.markEventProcessed(event.id);
  return result;
}
