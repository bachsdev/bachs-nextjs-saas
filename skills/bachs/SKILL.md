---
name: bachs
description: Build or review Bachs one-time checkout, SaaS subscriptions, and marketplace payments with Connect. Use for payment integrations, webhook handling, billing access, seller onboarding, and testing these flows.
---

# Build with Bachs

Implement the requested Bachs flow in the user's existing app. Use the current
docs for API fields, product availability, and account requirements.

## Understand the app

Read project instructions and existing authentication, order or billing records,
payment code, and tests. Reuse the app's framework and data layer.
Establish the requested flow, currency, product or plan, and account ownership.
Ask only for missing decisions that affect implementation. Explain the proposed
flow briefly, then carry out the authorized work.

## Read the relevant workflow

Read the selected guide and the references needed for the task. If web access
is unavailable, ask the user to paste the pages using Copy page. Do not invent
endpoints, fields, events, or eligibility.

| Task | Start here |
| --- | --- |
| One-time payment | https://docs.bachs.io/guides/checkout/checkout-sessions.md |
| SaaS subscriptions | https://docs.bachs.io/build/use-cases/saas-subscriptions.md |
| Marketplace | https://docs.bachs.io/build/use-cases/marketplace.md |

Shared references:
- Webhooks: https://docs.bachs.io/guides/webhooks/overview.md
- Local testing: https://docs.bachs.io/developer-portal/local-testing.md
- Write recovery: https://docs.bachs.io/guides/idempotency.md
- Page index: https://docs.bachs.io/llms.txt

Include dashboard setup such as products, capability requests, webhook endpoints,
or portal settings. Separate dashboard setup from routes in the user's app.

## Use the official SDK when supported

For a Node.js or TypeScript server, use the official @bachs/sdk for products,
checkout sessions, subscriptions, customer portal sessions and webhook
verification. Read https://github.com/bachsdev/bachs-node before choosing methods
or types. Construct Bachs with apiKey and an explicit environment. Use
webhooks.constructEvent on the raw body and request headers; keep event
persistence and business decisions in the app.

Check the package's actual exports and version. The npm 0.0.1 package is a
placeholder, not the tested implementation. Until the 1.0.0 implementation is
released on npm, the public starter includes its packaged copy and provenance:
https://github.com/bachsdev/bachs-nextjs-saas/tree/main/vendor
Do not install the placeholder or add a dependency on a local sibling repository.
After the matching release is available, use its exact npm version.

The SDK sends writes once and reports outcomeUnknown on uncertain writes.
Persist operation keys in the app and reconcile before sending again. Do not
build another transport, response decoder or signature verifier for supported
SDK operations. Do not log full provider error bodies or portal URLs.

The current SDK does not support Connect account context, seller onboarding or
checkout split fields. Use documented API requests for those marketplace
operations; do not invent SDK methods or pass unsupported fields through casts.
Other server languages can use the documented API.

## Integration rules

- Start in the sandbox: https://sandbox-api.bachs.io with an sk_sandbox_ key.
  Production uses https://api.bachs.io and an sk_live_ key. Keep secrets on the
  server in environment variables. Never log them or put them in client code.
- Send amounts as decimal strings with an ISO currency at its precision.
  Choose or validate prices and product mappings on the server.
- Checkout redirects must be publicly accessible, even in sandbox. For a fully
  local app, omit them and return manually after payment. Use a public deployment
  or tunnel for automatic return; CLI webhook forwarding is separate.
- Link the local order or user to checkout and save Bachs IDs. Match a payment
  to its order, expected amount, and currency before fulfilling it. A virtual
  account deposit without an order reference does not pay an order automatically.
- Verify X-Bachs-Signature-V2 against the original raw request body before
  parsing JSON. Check timestamp tolerance and all v1 signatures as documented.
- Fulfil orders and grant access from verified webhook state. A success redirect
  or browser event is only a display signal.
- Deduplicate event IDs durably and prevent older state replacing newer state,
  including concurrent deliveries. Commit state and event completion atomically
  in the app's database, or use a durable queue with equivalent recovery.
  Failed processing must remain eligible for redelivery.
- Return 2xx after handling or durably accepting an event; return 5xx on processing
  failure. Follow the documented retry policy: 408 and 429 are exceptions to the
  usual non-retry behavior for 4xx.
- Persist one Idempotency-Key per business operation for public POST/PATCH calls.
  Reuse it with the same request when recovery establishes a retry is needed.
  A timeout or 5xx is an uncertain outcome. Reconcile before resubmitting;
  only successful JSON responses are cached.

## Workflow decisions

### One-time payment
Use hosted checkout first unless an overlay is requested. Create it on the
server using product_cart and a local order reference. Fulfil once from
collection.succeeded after matching the order. Show pending, paid, and
unsuccessful outcomes from stored order state.

### SaaS subscriptions
A recurring product checkout creates the subscription; there is no separate
create-subscription endpoint. A recurring checkout needs a customer. Confirm
supported billing methods and currencies in the current guide.
Save the customer and full subscription state against the signed-in user from
customer.subscription.created, updated, and deleted events.
Make trialing, active, past_due, and cancellation access policy explicit.
Create each portal session on the server for the user's own customer.
Check dashboard settings for card updates and plan switching, and read current
cancellation semantics before implementing API cancellation.

### Marketplace
Confirm destination charges fit the business: the platform owns the sale and
the seller sub account receives a share at settlement. Read
https://docs.bachs.io/connect/choose-your-integration.md if the business should
own the sale instead. Read onboarding, capabilities, refunds, and payouts.
Start with one seller per order unless the user needs and the docs support
another arrangement. Save its account ID and choose destination and fee on
the server. Let the destination charge generate its transfer at settlement;
do not add a second manual transfer.
Payment, seller balance credit, and payout delivery are separate states. A
payout uses the seller's balance and its usable destination. This is not an
escrow integration.

## Verify and hand off

Test observable behavior for the selected flow: success, unsuccessful payment,
invalid signatures, duplicate delivery, older events arriving late, processing
failure followed by redelivery, and uncertain writes. For subscriptions include
renewal failure and cancellation; for marketplaces include blocked onboarding,
settlement, and payout failure.

Use existing test tools and the sandbox instructions. A synthetic webhook checks
handling, not completed checkout or settlement. Do not describe mocks or a code
review as a real sandbox payment.
Report changes, tests actually run, dashboard setup still needed, and unverified
steps. Production transactions and deployment require the user's authorization.
