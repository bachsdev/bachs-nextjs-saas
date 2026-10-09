import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { hasAccess } from "@/lib/access";
import { getSubscription } from "@/lib/store";

export const dynamic = "force-dynamic";

// Bachs sends the customer here after they pay. This page never gives access
// itself: it reads the subscription the webhook saved, and refreshes until
// the webhook has arrived.
export default async function Success() {
  const user = await getCurrentUser();
  const active = hasAccess(await getSubscription(user.id));

  if (!active) {
    return (
      <section>
        <meta httpEquiv="refresh" content="2" />
        <h1>Activating your plan...</h1>
        <p>This usually takes a few seconds.</p>
      </section>
    );
  }

  return (
    <section>
      <h1>You're subscribed</h1>
      <p>Thanks! Your plan is active.</p>
      <Link href="/">Continue</Link>
    </section>
  );
}
