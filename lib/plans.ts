// The plans you sell. The browser only ever sends a plan key; the server maps it
// to a Bachs product ID, so nobody can change the price from the browser.
// Prices here are for display. Bachs charges the price on the product.
export const PLANS = {
  monthly: { name: "Pro", price: "29.00", interval: "month", env: "BACHS_PRO_MONTHLY" },
  yearly: { name: "Pro", price: "290.00", interval: "year", env: "BACHS_PRO_YEARLY" },
} as const;

export type PlanKey = keyof typeof PLANS;

export function productIdFor(plan: string): string | undefined {
  if (!Object.hasOwn(PLANS, plan)) return undefined;
  return process.env[PLANS[plan as PlanKey].env] || undefined;
}
