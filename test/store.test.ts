import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BachsEvent } from "@/lib/webhooks";
import type { CheckoutSession } from "@/lib/bachs";

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(), writeFailure: false, readFailure: false,
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (file: string) => {
    if (disk.readFailure) throw Object.assign(new Error("denied"), { code: "EACCES" });
    if (!disk.files.has(file)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return disk.files.get(file);
  }),
  mkdir: vi.fn(async () => {}),
  writeFile: vi.fn(async (file: string, content: string) => {
    if (disk.writeFailure) throw new Error("disk full");
    disk.files.set(file, content);
  }),
  rename: vi.fn(async (from: string, to: string) => {
    disk.files.set(to, disk.files.get(from)!);
    disk.files.delete(from);
  }),
  unlink: vi.fn(async (file: string) => { disk.files.delete(file); }),
}));
let store: typeof import("@/lib/store");
beforeEach(async () => {
  disk.files.clear(); disk.writeFailure = false; disk.readFailure = false;
  vi.resetModules();
  store = await import("@/lib/store");
});
const event = (id: string, status = "active", createdAt = "2026-10-09T09:00:00Z"): BachsEvent => ({
  id, type: "customer.subscription.updated", created_at: createdAt, organization_id: "org_test",
  data: {
    subscription_id: "sub_test", customer: { customer_id: "cust_test" },
    product_id: "prod_test", status, metadata: { user_id: "user_1" },
    current_period_end: "2026-11-09T09:00:00Z", cancel_at_period_end: false,
  },
});
const session: CheckoutSession = {
  checkout_id: "chk_test", checkout_url: "https://checkout.bachs.io/c/test",
  status: "open", expires_at: "2099-10-09T10:00:00Z",
  created_at: "2026-10-09T09:00:00Z", reference: null,
};

describe("local billing persistence", () => {
  it("treats only a missing file as an empty store", async () => {
    expect(await store.getSubscription("user_1")).toBeUndefined();
    disk.readFailure = true;
    await expect(store.getSubscription("user_1")).rejects.toThrow("denied");
  });
  it("does not erase corrupt billing data", async () => {
    await store.reserveCheckout("user_1", "prod_test");
    const file = [...disk.files.keys()][0];
    disk.files.set(file, "broken JSON");
    await expect(store.getSubscription("user_1")).rejects.toThrow();
    expect(disk.files.get(file)).toBe("broken JSON");
  });
  it("commits the subscription, customer and event ID in one file replacement", async () => {
    expect(await store.processWebhookEvent(event("evt_1"))).toBe("saved");
    expect(await store.getCustomerId("user_1")).toBe("cust_test");
    expect(await store.getSubscription("user_1")).toMatchObject({ status: "active" });
    expect(disk.files.size).toBe(1);
    expect(await store.processWebhookEvent(event("evt_1"))).toBe("duplicate");
  });
  it("serializes simultaneous deliveries of the same event", async () => {
    const result = await Promise.all([
      store.processWebhookEvent(event("evt_1")), store.processWebhookEvent(event("evt_1")),
    ]);
    expect(result).toEqual(["saved", "duplicate"]);
  });
  it("does not let a concurrent older update undo cancellation", async () => {
    const result = await Promise.all([
      store.processWebhookEvent(event("evt_new", "canceled", "2026-10-10T09:00:00Z")),
      store.processWebhookEvent(event("evt_old", "active")),
    ]);
    expect(result).toEqual(["saved", "stale"]);
    expect((await store.getSubscription("user_1"))?.status).toBe("canceled");
  });
  it("does not mark a delivery processed after a failed commit", async () => {
    disk.writeFailure = true;
    await expect(store.processWebhookEvent(event("evt_1"))).rejects.toThrow("disk full");
    disk.writeFailure = false;
    expect(await store.getSubscription("user_1")).toBeUndefined();
    expect(await store.processWebhookEvent(event("evt_1"))).toBe("saved");
    expect(await store.processWebhookEvent(event("evt_1"))).toBe("duplicate");
  });
});

describe("checkout operations", () => {
  it("reserves one key for concurrent clicks and keeps it across module reload", async () => {
    const [one, two] = await Promise.all([
      store.reserveCheckout("user_1", "prod_test"), store.reserveCheckout("user_1", "prod_test"),
    ]);
    expect(one.created).toBe(true);
    expect(two.created).toBe(false);
    expect(one.attempt.key).toBe(two.attempt.key);
    vi.resetModules();
    const reloaded = await import("@/lib/store");
    expect((await reloaded.reserveCheckout("user_1", "prod_test")).attempt.key).toBe(one.attempt.key);
  });
  it("reuses a completed open checkout", async () => {
    const { attempt } = await store.reserveCheckout("user_1", "prod_test");
    await store.completeCheckout("user_1", attempt.key, session);
    const again = await store.reserveCheckout("user_1", "prod_test");
    expect(again.created).toBe(false);
    expect(again.attempt.session).toEqual(session);
  });
  it("allows a new checkout after the saved one expires", async () => {
    const { attempt } = await store.reserveCheckout("user_1", "prod_test");
    await store.completeCheckout("user_1", attempt.key, { ...session, expires_at: "2020-01-01T00:00:00Z" });
    const again = await store.reserveCheckout("user_1", "prod_test");
    expect(again.created).toBe(true);
    expect(again.attempt.key).not.toBe(attempt.key);
  });
  it("keeps an uncertain attempt blocked even when another plan is selected", async () => {
    const { attempt } = await store.reserveCheckout("user_1", "prod_test");
    await store.markCheckoutUncertain("user_1", attempt.key);
    const again = await store.reserveCheckout("user_1", "prod_other");
    expect(again.created).toBe(false);
    expect(again.attempt.state).toBe("uncertain");
    expect(again.attempt.key).toBe(attempt.key);
  });
  it("does not let a stale failure clear another operation", async () => {
    const { attempt } = await store.reserveCheckout("user_1", "prod_test");
    await store.releaseCheckout("user_1", "wrong_key");
    expect((await store.reserveCheckout("user_1", "prod_test")).attempt.key).toBe(attempt.key);
    await store.releaseCheckout("user_1", attempt.key);
    expect((await store.reserveCheckout("user_1", "prod_test")).created).toBe(true);
  });
});

it("clears a paid checkout so a canceled user can subscribe again", async () => {
  const { attempt } = await store.reserveCheckout("user_1", "prod_test");
  await store.completeCheckout("user_1", attempt.key, session);
  await store.processWebhookEvent(event("evt_paid"));
  await store.processWebhookEvent(event("evt_canceled", "canceled", "2026-10-10T09:00:00Z"));
  const next = await store.reserveCheckout("user_1", "prod_test");
  expect(next.created).toBe(true);
  expect(next.attempt.key).not.toBe(attempt.key);
});
