import type { SubscriptionRecord } from "./store";

/**
 * Whether a user can use the paid product. This is the only place that
 * decides, so change it here.
 *
 * past_due means a renewal failed and Bachs is retrying it. Keeping access
 * during recovery is common; remove "past_due" if you prefer to stop access.
 */
export function hasAccess(subscription: SubscriptionRecord | undefined): boolean {
  if (!subscription) return false;
  return ["trialing", "active", "past_due"].includes(subscription.status);
}
