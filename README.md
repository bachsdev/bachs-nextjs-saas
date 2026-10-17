# Bachs Next.js SaaS starter

A Next.js App Router starter for monthly and yearly [Bachs](https://bachs.io)
subscriptions using the official [Bachs SDK](https://github.com/bachsdev/bachs-node): hosted checkout, access from verified webhooks, and customer
billing through the Bachs customer portal.

Follow the [SaaS subscriptions walkthrough](https://docs.bachs.io/build/use-cases/saas-subscriptions)
for the payment flow and the [subscription prompt](https://docs.bachs.io/build/ai/prompts#sell-subscriptions)
for a prompt that adapts it to your app.

**This is a local development starter.** Every visitor shares one demo user,
and billing data lives in one local JSON file. Replace authentication and the
store before deploying. Demo authentication refuses live API keys.

## SDK dependency

This starter imports @bachs/sdk for checkout, product setup, the customer
portal and webhook verification. `npm ci` installs it from npm, pinned to
version 1.0.0 in package.json and package-lock.json.

## Run in sandbox

You need Node.js 22 or later, a [sandbox API key](https://docs.bachs.io/authentication),
and the [Bachs CLI](https://docs.bachs.io/cli/overview#install).
The key needs `products:write`, `payments:write`, and `customers:write`.

```bash
npm ci
cp .env.example .env
# Set BACHS_API_KEY in .env, then:
npm run setup:products
```

On Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`.
Copy the two product IDs printed by the setup script into `.env`. You can also
create the recurring products in the Bachs dashboard and save their IDs there.

In a second terminal:

```bash
npm run listen
```

Copy the `whsec_` secret it prints into `BACHS_WEBHOOK_SECRET` in `.env`,
then start the app:

```bash
npm run dev
```

Open http://localhost:3000, click **Subscribe**, and complete the sandbox
checkout using its test controls. Subscription webhooks activate access.
Return to http://localhost:3000 after paying to see access activate. Click
**Manage billing** to open the portal.

Bachs refuses localhost and private-IP checkout redirect URLs, even in sandbox.
The starter leaves checkout redirects unset for local development. If you
want an automatic return, use a public deployment or tunnel and set
`CHECKOUT_SUCCESS_URL` and `CHECKOUT_CANCEL_URL` in `.env`. `APP_URL` remains
the app's own URL; the CLI forwards webhooks without a public webhook URL.

Each new `listen` session has a new signing secret. Update `.env` and restart
the app when you restart the listener. Do not paste keys into chats or commit
`.env`.

## How it works

| File | Responsibility |
| --- | --- |
| `app/api/checkout/route.ts` | Maps the plan on the server, reserves a persistent operation key, and creates checkout. Client prices and product IDs are ignored. |
| `app/api/webhooks/bachs/route.ts` | Uses SDK webhooks.constructEvent to verify the raw body and event envelope, then processes the event. |
| `lib/webhooks.ts` | Saves subscription state; skips duplicates and older events. |
| `lib/store.ts` | Commits state and processed-event IDs together in a serialized, atomic local file replacement. |
| `lib/access.ts` | Decides access. The default gives a grace period while a renewal is past due. |
| `app/api/billing/portal/route.ts` | Creates a fresh session for the demo user's saved Bachs customer. |
| `app/billing/success/page.tsx` | Reads stored access and waits for the webhook; never grants access. |
| `lib/bachs.ts` | Maps app inputs to the official SDK; the SDK handles transport, typed responses and uncertain errors. |

### When a checkout response is lost

The starter saves a checkout attempt before calling Bachs. A repeated click
reuses a confirmed, unexpired checkout. A timeout, 5xx, or failure to save the
response leaves the attempt awaiting confirmation and blocks another POST.

Check the checkout or subscription in Bachs and allow its webhook to arrive.
Keep the stored operation key while investigating. Only after confirming the
original checkout had no effect should you clear that user's entry in
`checkouts` in `.data/store.json`. Stop the app before editing that local file.
In a production implementation, replace this manual step with an authenticated
reconciliation process following the [idempotency guide](https://docs.bachs.io/guides/idempotency).
Do not delete the store or generate a replacement key just because a response
was lost.

## Verification

```bash
npm run verify
```

This runs:

1. Unit and route tests for signatures, secret rotation, checkout and portal
   ownership, access, renewal recovery, cancellation, duplicate and concurrent
   events, failed persistence, and uncertain checkout recovery.
2. TypeScript checks.
3. A production build.
4. HTTP smoke checks against the built Next.js server and a local Bachs API
   fixture, with isolated billing data.

The smoke test uses dummy keys and fixture API responses. It makes no real
Bachs payment. Run the sandbox checkout above to verify a real integration.
CI runs the same gates on Node.js 22 and 24 without secrets.

A manual SDK-backed sandbox check on October 9, 2026 also passed: hosted
checkout and the first payment, a real signed subscription event forwarded
through the CLI after replay, stored access activation, and the signed-in
demo customer's billing portal. The user submitted the simulated card payment.
A subsequent billing-cycle renewal remains unverified. Lifecycle tests above
use fixture events; they are not evidence of a real second charge.

To run an individual gate:

```bash
npm test
npm run typecheck
npm run build
npm run test:smoke  # requires npm run build first
```

## Make it yours

- Replace `lib/auth.ts` with authenticated users and protect billing routes.
- Replace `lib/store.ts` with a transactional database. Its local serialization
  applies to one Node.js process; it cannot coordinate multiple instances or
  serverless storage. Preserve atomic event completion and stale-event checks.
- Set your plans in `lib/plans.ts` and create matching Bachs products. Prices
  displayed in the app should match those products.
- Choose the access policy in `lib/access.ts`.
- Configure the [customer portal](https://docs.bachs.io/guides/customer-portal/overview#configuring-the-portal)
  for card updates and plan switching if needed.
- Add your app's session, authorization and deployment tests. This starter's
  tests exercise a shared demo identity.

## Go live

After replacing the demo components, follow the
[go-live checklist](https://docs.bachs.io/build/use-cases/saas-subscriptions#go-live-checklist).
Create products in production, set BACHS_ENVIRONMENT=production, use the production API URL and live key, and
register the five subscription/invoice events in `npm run listen` on your
production webhook endpoint. Its signing secret differs from the local one.
Production subscriptions are not shared with sandbox.

## Building with an AI assistant

`AGENTS.md` explains the project and checks; `CLAUDE.md` points to it.

To extend this starter with a coding assistant, use the
[Bachs prompts](https://docs.bachs.io/build/ai/prompts), or install the
[Bachs skill](https://github.com/bachsdev/bachs-skills) so your assistant follows
the Bachs rules on every task. The skill works in any app, not only this
starter. See [docs.bachs.io/build/ai/skills](https://docs.bachs.io/build/ai/skills)
for install commands for Claude Code, Cursor, GitHub Copilot and Codex.

## License

MIT. See [LICENSE](LICENSE).
