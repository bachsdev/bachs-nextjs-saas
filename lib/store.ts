// Local development only: one process, one JSON file. Use a transactional
// database and real authentication before deploying this starter.
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { handleEvent, type BachsEvent } from "./webhooks";
import type { CheckoutSession } from "./bachs";

export type SubscriptionRecord = {
  userId: string;
  subscriptionId: string;
  customerId: string;
  productId: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  updatedAt: string;
};
type CheckoutAttempt = {
  key: string;
  productId: string;
  state: "pending" | "ready" | "uncertain";
  session?: CheckoutSession;
};
type Data = {
  customers: Record<string, string>;
  subscriptions: Record<string, SubscriptionRecord>;
  processedEvents: string[];
  checkouts: Record<string, CheckoutAttempt>;
};

const FILE = path.join(process.env.BACHS_DATA_DIR || path.join(process.cwd(), ".data"), "store.json");
const empty = (): Data => ({ customers: {}, subscriptions: {}, processedEvents: [], checkouts: {} });

async function read(): Promise<Data> {
  let raw: string;
  try { raw = await readFile(FILE, "utf8"); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw err; // Do not turn an unreadable store into empty billing state.
  }
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      !data.customers || !data.subscriptions || !Array.isArray(data.processedEvents)) {
    throw new Error("Invalid local billing store");
  }
  return { ...empty(), ...data };
}

let queue: Promise<unknown> = Promise.resolve();
function update<T>(change: (data: Data) => T | Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const data = await read();
    const result = await change(data);
    await mkdir(path.dirname(FILE), { recursive: true });
    const temporary = `${FILE}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(data, null, 2));
      await rename(temporary, FILE);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return result;
  });
  queue = next.catch(() => undefined);
  return next;
}

export async function getCustomerId(userId: string) { return (await read()).customers[userId]; }
export async function getSubscription(userId: string) { return (await read()).subscriptions[userId]; }

// State changes and event completion share one serialized, atomic file write.
// A failed write leaves the delivery eligible for another attempt.
export function processWebhookEvent(event: BachsEvent) {
  return update((data) => handleEvent(event, {
    isEventProcessed: async (id) => data.processedEvents.includes(id),
    markEventProcessed: async (id) => { data.processedEvents.push(id); },
    getSubscription: async (userId) => data.subscriptions[userId],
    saveSubscription: async (record) => {
      data.subscriptions[record.userId] = record;
      data.customers[record.userId] = record.customerId;
      if (data.checkouts[record.userId]?.productId === record.productId &&
          ["trialing", "active", "past_due"].includes(record.status)) {
        delete data.checkouts[record.userId];
      }
    },
  }));
}

export function reserveCheckout(userId: string, productId: string) {
  return update((data) => {
    const existing = data.checkouts[userId];
    if (existing && (existing.state !== "ready" ||
        (existing.productId === productId && existing.session &&
         Date.parse(existing.session.expires_at) > Date.now()))) {
      return { created: false, attempt: existing };
    }
    const attempt: CheckoutAttempt = { key: randomUUID(), productId, state: "pending" };
    data.checkouts[userId] = attempt;
    return { created: true, attempt };
  });
}

export function completeCheckout(userId: string, key: string, session: CheckoutSession) {
  return update((data) => {
    if (data.checkouts[userId]?.key !== key) throw new Error("Checkout operation changed");
    data.checkouts[userId] = { ...data.checkouts[userId], state: "ready", session };
  });
}

export function markCheckoutUncertain(userId: string, key: string) {
  return update((data) => {
    if (data.checkouts[userId]?.key === key) data.checkouts[userId].state = "uncertain";
  });
}

export function releaseCheckout(userId: string, key: string) {
  return update((data) => {
    if (data.checkouts[userId]?.key === key) delete data.checkouts[userId];
  });
}
