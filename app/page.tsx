import { getCurrentUser } from "@/lib/auth";
import { hasAccess } from "@/lib/access";
import { PLANS, type PlanKey } from "@/lib/plans";
import { getSubscription } from "@/lib/store";
import { SubscribeButton } from "./subscribe-button";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getCurrentUser();
  const subscription = await getSubscription(user.id);

  if (hasAccess(subscription)) {
    return (
      <section>
        <h1>Acme Pro</h1>
        <p className="badge">Status: {subscription!.status}</p>
        <p>You have access to everything in Pro.</p>
        {subscription!.status === "past_due" && (
          <p className="error">Your last payment failed. Update your card to keep access.</p>
        )}
        {subscription!.cancelAtPeriodEnd && subscription!.currentPeriodEnd && (
          <p>Your plan ends on {new Date(subscription!.currentPeriodEnd).toDateString()}.</p>
        )}
        <form action="/api/billing/portal" method="post">
          <button type="submit">Manage billing</button>
        </form>
      </section>
    );
  }

  return (
    <section>
      <h1>Acme Pro</h1>
      <p>Signed in as {user.email}. Pick a plan to get access.</p>
      {subscription && <p className="badge">Previous plan: {subscription.status}</p>}
      <div className="plans">
        {(Object.keys(PLANS) as PlanKey[]).map((key) => {
          const plan = PLANS[key];
          return (
            <div className="plan" key={key}>
              <h2>
                {plan.name}, {key}
              </h2>
              <p className="price">
                ${plan.price} / {plan.interval}
              </p>
              <SubscribeButton plan={key} label={`Subscribe ${key}`} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
