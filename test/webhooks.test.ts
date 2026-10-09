import { describe, expect, it } from "vitest";
import { handleEvent, type BachsEvent, type EventStore } from "@/lib/webhooks";
import { hasAccess } from "@/lib/access";
import type { SubscriptionRecord } from "@/lib/store";

function memoryStore(): EventStore & { subs: Map<string, SubscriptionRecord> } {
  const processed = new Set<string>();
  const subs = new Map<string, SubscriptionRecord>();
  return {
    subs,
    isEventProcessed: async (id) => processed.has(id),
    markEventProcessed: async (id) => void processed.add(id),
    getSubscription: async (userId) => subs.get(userId),
    saveSubscription: async (record) => void subs.set(record.userId, record),
  };
}

function subscriptionEvent(id: string, type: string, status: string, createdAt: string): BachsEvent {
  return {
    id,
    type,
    created_at: createdAt,
    organization_id: "org_test",
    data: {
      subscription_id: "sub_1a2b3c4d5e",
      customer: { customer_id: "cust_1a2b3c4d5e6f", email: "jane@example.com" },
      product_id: "prod_1a2b3c4d5e6f7g8h",
      status,
      current_period_end: "2026-11-09T09:00:00Z",
      cancel_at_period_end: false,
      metadata: { user_id: "8812" },
    },
  };
}

describe("handleEvent", () => {
  it("gives access when a subscription is created", async () => {
    const store = memoryStore();
    const event = subscriptionEvent("evt_1", "customer.subscription.created", "active", "2026-10-09T09:00:00Z");
    expect(await handleEvent(event, store)).toBe("saved");
    expect(store.subs.get("8812")?.customerId).toBe("cust_1a2b3c4d5e6f");
    expect(hasAccess(store.subs.get("8812"))).toBe(true);
  });

  it("removes access when a subscription is deleted", async () => {
    const store = memoryStore();
    await handleEvent(subscriptionEvent("evt_1", "customer.subscription.created", "active", "2026-10-09T09:00:00Z"), store);
    await handleEvent(subscriptionEvent("evt_2", "customer.subscription.deleted", "canceled", "2026-10-10T09:00:00Z"), store);
    expect(hasAccess(store.subs.get("8812"))).toBe(false);
  });

  it("skips an event it has already processed", async () => {
    const store = memoryStore();
    const event = subscriptionEvent("evt_1", "customer.subscription.created", "active", "2026-10-09T09:00:00Z");
    await handleEvent(event, store);
    expect(await handleEvent(event, store)).toBe("duplicate");
  });

  it("does not let an older event overwrite a newer one", async () => {
    const store = memoryStore();
    await handleEvent(subscriptionEvent("evt_2", "customer.subscription.deleted", "canceled", "2026-10-10T09:00:00Z"), store);
    const late = subscriptionEvent("evt_1", "customer.subscription.updated", "active", "2026-10-09T09:00:00Z");
    expect(await handleEvent(late, store)).toBe("stale");
    expect(store.subs.get("8812")?.status).toBe("canceled");
  });

  it("ignores events it does not use", async () => {
    const store = memoryStore();
    const event: BachsEvent = { id: "evt_3", type: "invoice.paid", created_at: "2026-10-09T09:00:00Z", organization_id: "org_test", data: {} };
    expect(await handleEvent(event, store)).toBe("ignored");
  });
});

describe("hasAccess", () => {
  const record = (status: string) => ({ status }) as SubscriptionRecord;
  it.each([
    ["trialing", true],
    ["active", true],
    ["past_due", true],
    ["unpaid", false],
    ["canceled", false],
  ])("%s -> %s", (status, expected) => {
    expect(hasAccess(record(status))).toBe(expected);
  });
});

describe("subscription lifecycle and recovery", () => {
  it("keeps access for scheduled cancellation, then removes it when deleted", async () => {
    const store = memoryStore();
    const scheduled = subscriptionEvent("evt_1", "customer.subscription.updated", "active", "2026-10-09T09:00:00Z");
    scheduled.data.cancel_at_period_end = true;
    await handleEvent(scheduled, store);
    expect(store.subs.get("8812")?.cancelAtPeriodEnd).toBe(true);
    expect(hasAccess(store.subs.get("8812"))).toBe(true);
    await handleEvent(subscriptionEvent("evt_2", "customer.subscription.deleted", "canceled", "2026-11-09T09:00:00Z"), store);
    expect(hasAccess(store.subs.get("8812"))).toBe(false);
  });
  it("applies the grace policy through a failed renewal and successful recovery", async () => {
    const store = memoryStore();
    await handleEvent(subscriptionEvent("evt_1", "customer.subscription.updated", "past_due", "2026-10-09T09:00:00Z"), store);
    expect(hasAccess(store.subs.get("8812"))).toBe(true);
    await handleEvent(subscriptionEvent("evt_2", "customer.subscription.updated", "active", "2026-10-10T09:00:00Z"), store);
    expect(store.subs.get("8812")?.status).toBe("active");
    await handleEvent(subscriptionEvent("evt_3", "customer.subscription.updated", "unpaid", "2026-10-11T09:00:00Z"), store);
    expect(hasAccess(store.subs.get("8812"))).toBe(false);
  });
  it("leaves failed processing eligible for redelivery", async () => {
    const store = memoryStore();
    const save = store.saveSubscription;
    store.saveSubscription = async () => { throw new Error("database unavailable"); };
    const event = subscriptionEvent("evt_1", "customer.subscription.created", "active", "2026-10-09T09:00:00Z");
    await expect(handleEvent(event, store)).rejects.toThrow("database unavailable");
    expect(await store.isEventProcessed(event.id)).toBe(false);
    store.saveSubscription = save;
    expect(await handleEvent(event, store)).toBe("saved");
  });
  it("ignores a subscription that does not belong to an app user", async () => {
    const store = memoryStore();
    const event = subscriptionEvent("evt_1", "customer.subscription.created", "active", "2026-10-09T09:00:00Z");
    event.data.metadata = {};
    expect(await handleEvent(event, store)).toBe("ignored");
    expect(store.subs.size).toBe(0);
  });
  it("does not acknowledge an incomplete subscription as saved", async () => {
    const store = memoryStore();
    const event = subscriptionEvent("evt_1", "customer.subscription.created", "active", "2026-10-09T09:00:00Z");
    delete event.data.customer;
    await expect(handleEvent(event, store)).rejects.toThrow("Incomplete");
    expect(await store.isEventProcessed(event.id)).toBe(false);
    expect(store.subs.size).toBe(0);
  });
  it("denies access without subscription state or for unknown states", () => {
    expect(hasAccess(undefined)).toBe(false);
    expect(hasAccess({ status: "future_status" } as SubscriptionRecord)).toBe(false);
  });
});
