import { webhooks, BachsWebhookError, type WebhookEvent } from "@bachs/sdk";
import { processWebhookEvent } from "@/lib/store";

export const runtime = "nodejs";
export async function POST(req: Request) {
  const secret = process.env.BACHS_WEBHOOK_SECRET;
  if (!secret || secret === "whsec_...") {
    return new Response("Webhook secret is not configured", { status: 500 });
  }
  let event: WebhookEvent;
  try {
    // The SDK verifies the original bytes before decoding JSON.
    event = webhooks.constructEvent(new Uint8Array(await req.arrayBuffer()), req.headers, secret);
    if (!Number.isFinite(Date.parse(event.created_at))) {
      return new Response("Invalid event timestamp", { status: 400 });
    }
  } catch (err) {
    return new Response(err instanceof BachsWebhookError ? "Invalid webhook" : "Webhook verification failed",
      { status: err instanceof BachsWebhookError ? 400 : 500 });
  }
  try {
    const result = await processWebhookEvent(event);
    console.log("Bachs webhook", event.type, event.id, result);
    return new Response("OK");
  } catch {
    console.error("Bachs webhook processing failed", event.id);
    return new Response("Could not handle event", { status: 500 });
  }
}