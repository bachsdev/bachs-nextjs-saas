// Runs the built Next.js app against a local Bachs API fixture.
// No real API key, external payment, or production deployment is used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, readdir, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = path.join(root, ".test-data", "smoke-" + randomUUID());
await mkdir(dataDirectory, { recursive: true });
let writes = 0;
let refuseCheckout = false;
let apiUrl;
const fixture = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, "Bearer sk_sandbox_smoke");
    assert.ok(req.headers["idempotency-key"]);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (req.url === "/v1/checkout-sessions") {
      writes++;
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.product_cart[0].product_id, "prod_monthly");
      assert.equal(body.billing_currency, "USD");
      assert.equal(body.metadata.user_id, "demo-user");
      assert.equal(body.amount, undefined);
      if (refuseCheckout) { res.writeHead(503); res.end("lost response"); return; }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        checkout_id: "chk_smoke", checkout_url: apiUrl + "/checkout/smoke",
        created_at: new Date().toISOString(), reference: null,
        status: "open", expires_at: new Date(Date.now() + 3600000).toISOString(),
      }));
      return;
    }
    assert.equal(req.url, "/v1/customers/cust_smoke/portal-sessions");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: "psn_smoke", url: apiUrl + "/portal/smoke" }));
  } catch (err) {
    console.error("Fixture assertion failed:", err.message);
    res.writeHead(500); res.end("fixture failure");
  }
});
await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
apiUrl = "http://127.0.0.1:" + fixture.address().port;

const probe = createServer();
await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
const appPort = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const appUrl = "http://127.0.0.1:" + appPort;
const child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(appPort)], {
  cwd: root, windowsHide: true,
  env: { ...process.env, BACHS_ENVIRONMENT: "sandbox", BACHS_API_URL: apiUrl, BACHS_API_KEY: "sk_sandbox_smoke",
    BACHS_WEBHOOK_SECRET: "whsec_smoke", BACHS_PRO_MONTHLY: "prod_monthly",
    BACHS_PRO_YEARLY: "prod_yearly", APP_URL: appUrl, BACHS_DATA_DIR: dataDirectory,
    NEXT_TELEMETRY_DISABLED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });
const exit = once(child, "exit");
const jsonPost = (endpoint, body) => fetch(appUrl + endpoint, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
let step = 0;
const passed = (name) => { step++; console.log("PASS " + name); };
async function deliver(id, status, createdAt, cancelAtPeriodEnd = false, valid = true) {
  const body = JSON.stringify({
    id, organization_id: "org_smoke", type: status === "canceled" ? "customer.subscription.deleted" : "customer.subscription.updated",
    created_at: createdAt,
    data: { subscription_id: "sub_smoke", customer: { customer_id: "cust_smoke" },
      product_id: "prod_monthly", status, current_period_end: "2099-11-09T09:00:00Z",
      cancel_at_period_end: cancelAtPeriodEnd, metadata: { user_id: "demo-user" } },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", "whsec_smoke").update(timestamp + "." + body).digest("hex");
  return fetch(appUrl + "/api/webhooks/bachs", {
    method: "POST", body,
    headers: { "X-Bachs-Signature-V2": "t=" + timestamp + ",v1=" + (valid ? signature : "wrong") },
  });
}
const home = async () => (await fetch(appUrl)).text();

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(appUrl)).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "Next.js failed to start: " + output);
  assert.match(await home(), /Pick a plan/);
  assert.match(await (await fetch(appUrl + "/billing/success")).text(), /Activating your plan/);
  passed("visiting the success page cannot grant access");

  assert.equal((await jsonPost("/api/checkout", { plan: "__proto__" })).status, 400);
  const checkout = await jsonPost("/api/checkout", { plan: "monthly", amount: "0.01", product_id: "attacker" });
  assert.equal(checkout.status, 200);
  assert.equal((await checkout.json()).checkout_url, apiUrl + "/checkout/smoke");
  assert.equal((await jsonPost("/api/checkout", { plan: "monthly" })).status, 200);
  assert.equal(writes, 1);
  passed("server product mapping and repeated-click recovery");

  assert.equal((await deliver("evt_bad", "active", "2026-10-09T09:00:00Z", false, false)).status, 400);
  assert.match(await home(), /Pick a plan/);
  passed("invalid webhook cannot grant access");

  assert.equal((await deliver("evt_active", "active", "2026-10-09T09:00:00Z")).status, 200);
  assert.match(await home(), /Status:.*active/);
  assert.match(await (await fetch(appUrl + "/billing/success")).text(), /You're subscribed/);
  assert.equal((await jsonPost("/api/checkout", { plan: "monthly" })).status, 409);
  passed("signed webhook grants access and prevents another subscription");

  const portal = await fetch(appUrl + "/api/billing/portal", { method: "POST", redirect: "manual" });
  assert.equal(portal.status, 303);
  assert.equal(portal.headers.get("location"), apiUrl + "/portal/smoke");
  passed("customer portal uses the saved customer");

  assert.equal((await deliver("evt_active", "active", "2026-10-09T09:00:00Z")).status, 200);
  assert.equal((await deliver("evt_cancel", "active", "2026-10-10T09:00:00Z", true)).status, 200);
  assert.match(await home(), /Your plan ends on/);
  passed("duplicate delivery and cancellation at period end");

  assert.equal((await deliver("evt_failed", "past_due", "2026-10-11T09:00:00Z")).status, 200);
  assert.match(await home(), /Update your card/);
  assert.equal((await deliver("evt_recovered", "active", "2026-10-12T09:00:00Z")).status, 200);
  assert.doesNotMatch(await home(), /Update your card/);
  passed("renewal failure and recovery follow the access policy");

  const simultaneous = await Promise.all([
    deliver("evt_deleted", "canceled", "2026-10-14T09:00:00Z"),
    deliver("evt_late", "active", "2026-10-13T09:00:00Z"),
  ]);
  assert.ok(simultaneous.every((res) => res.status === 200));
  assert.match(await home(), /Pick a plan/);
  assert.match(await home(), /Previous plan:.*canceled/);
  passed("concurrent late events cannot undo immediate cancellation");

  refuseCheckout = true;
  assert.equal((await jsonPost("/api/checkout", { plan: "monthly" })).status, 502);
  assert.equal((await jsonPost("/api/checkout", { plan: "monthly" })).status, 409);
  assert.equal(writes, 2);
  passed("uncertain checkout is retained without a replacement POST");
  console.log(step + " local HTTP smoke checks passed. Bachs API responses were fixtures.");
} finally {
  child.kill();
  await exit;
  await new Promise((resolve) => fixture.close(resolve));
  // Only this run's known files are removed; no recursive deletion.
  for (const name of await readdir(dataDirectory)) await unlink(path.join(dataDirectory, name));
  await rmdir(dataDirectory);
}
