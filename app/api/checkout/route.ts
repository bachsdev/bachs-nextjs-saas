import { createCheckoutSession } from "@/lib/bachs";
import { BachsApiError, BachsConfigError } from "@bachs/sdk";
import { getCurrentUser } from "@/lib/auth";
import { hasAccess } from "@/lib/access";
import { productIdFor } from "@/lib/plans";
import {
  getCustomerId, getSubscription, reserveCheckout, completeCheckout,
  markCheckoutUncertain, releaseCheckout,
} from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  const input = await req.json().catch(() => null);
  const plan = input && typeof input === "object" && !Array.isArray(input) ? input.plan : undefined;
  if (typeof plan !== "string" || !productIdFor(plan)) {
    return Response.json({ error: "Unknown plan" }, { status: 400 });
  }
  const productId = productIdFor(plan)!;
  if (hasAccess(await getSubscription(user.id))) {
    return Response.json({ error: "Already subscribed", portal: true }, { status: 409 });
  }

  const customerId = await getCustomerId(user.id);
  const { created, attempt } = await reserveCheckout(user.id, productId);
  if (!created) {
    if (attempt.state === "ready" && attempt.session) {
      return Response.json({ checkout_url: attempt.session.checkout_url });
    }
    return Response.json({
      error: "A checkout is awaiting confirmation. Check Bachs before starting another.",
    }, { status: 409 });
  }

  try {
    const session = await createCheckoutSession({
      productId,
      customer: customerId ? { customer_id: customerId } : { email: user.email, name: user.name },
      userId: user.id,
      successUrl: process.env.CHECKOUT_SUCCESS_URL || undefined,
      cancelUrl: process.env.CHECKOUT_CANCEL_URL || undefined,
      idempotencyKey: attempt.key,
    });
    await completeCheckout(user.id, attempt.key, session);
    return Response.json({ checkout_url: session.checkout_url });
  } catch (err) {
    if ((err instanceof BachsApiError && !err.outcomeUnknown) || err instanceof BachsConfigError) {
      await releaseCheckout(user.id, attempt.key);
      return Response.json({ error: "Could not start checkout" }, { status: 502 });
    }
    // This also covers a local write failing after Bachs created the session.
    await markCheckoutUncertain(user.id, attempt.key).catch(() => undefined);
    console.error("Bachs checkout outcome uncertain");
    return Response.json({
      error: "Could not confirm checkout. Check Bachs before starting another.",
    }, { status: 502 });
  }
}
