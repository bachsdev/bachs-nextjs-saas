import { createPortalSession } from "@/lib/bachs";
import { BachsApiError } from "@bachs/sdk";
import { getCurrentUser } from "@/lib/auth";
import { getCustomerId } from "@/lib/store";

export const runtime = "nodejs";

// A form POST from the "Manage billing" button. Sessions are short-lived, so a
// new one is created on every click.
export async function POST() {
  const user = await getCurrentUser();
  const customerId = await getCustomerId(user.id);
  if (!customerId) return Response.redirect(`${process.env.APP_URL}/`, 303);

  try {
    const { url } = await createPortalSession(customerId);
    return Response.redirect(url, 303);
  } catch (err) {
    console.error("Bachs portal session failed", err instanceof BachsApiError ? { status: err.status, code: err.errorCode, requestId: err.requestId } : "Request did not complete");
    return new Response("Could not open billing. Try again.", { status: 502 });
  }
}
