// Creates the template's two plans in your Bachs sandbox and prints the
// product IDs to put in .env. Run: npm run setup:products
import { Bachs, BachsApiError } from "@bachs/sdk";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// Load .env without a dependency.
try {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
} catch {
  // No .env file: use the shell environment.
}

const apiUrl = process.env.BACHS_API_URL || "https://sandbox-api.bachs.io";
const apiKey = process.env.BACHS_API_KEY;
if (!apiKey || apiKey === "sk_sandbox_...") {
  console.error("Set BACHS_API_KEY in .env to your sandbox key (sk_sandbox_...).");
  process.exit(1);
}
if (!apiKey.startsWith("sk_sandbox_")) {
  console.error("This script only runs against the sandbox. Use an sk_sandbox_ key.");
  process.exit(1);
}

const plans = [
  { env: "BACHS_PRO_MONTHLY", name: "Pro (monthly)", amount: "29.00", interval: "month" },
  { env: "BACHS_PRO_YEARLY", name: "Pro (yearly)", amount: "290.00", interval: "year" },
];

const bachs = new Bachs({ apiKey, environment: "sandbox", baseURL: apiUrl });

for (const plan of plans) {
  let body;
  try {
    body = await bachs.products.create({
      name: plan.name,
      price: { currency: "USD", amount: plan.amount },
      billing_cycle: { interval: plan.interval, frequency: 1 },
      metadata: { plan: "pro", template: "bachs-nextjs-saas" },
    }, { idempotencyKey: randomUUID() });
  } catch (err) {
    console.error("Could not confirm product creation.",
      err instanceof BachsApiError ? { statusCode: err.statusCode, code: err.errorCode } : "Request did not complete");
    console.error("Check products in the dashboard before rerunning; a lost response may still have created one.");
    process.exit(1);
  }
  console.log(`${plan.env}=${body.id}`);
}

console.log("\nCopy the lines above into .env.");
