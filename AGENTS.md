# AGENTS.md

A Next.js (App Router) SaaS starter that sells subscriptions with Bachs. The
flow it implements is documented at
https://docs.bachs.io/build/use-cases/saas-subscriptions.

## Commands

- `npm test`: unit tests (Vitest). Run after every change to `lib/`.
- `npm run typecheck` and `npm run build`: must pass before you finish.
- `npm run test:smoke`: HTTP checks of the built app against fixture API responses.
- `npm run listen`: forwards sandbox webhooks to the local webhook route.
- `npm run setup:products`: creates the two plans in the sandbox.

## Where things are

- `lib/plans.ts`: plan keys and their product ID environment variables.
- `app/api/checkout/route.ts`: creates checkout sessions.
- `app/api/webhooks/bachs/route.ts` and `lib/webhooks.ts`: webhook handling.
- `lib/access.ts`: `hasAccess()`, the only access decision.
- `lib/store.ts`: the data layer. Other code only uses its exported functions.
- `lib/auth.ts`: demo authentication, to be replaced.
- `lib/bachs.ts`: a thin application adapter over @bachs/sdk.

## Bachs integration rules

- Use @bachs/sdk for supported server operations and webhooks.constructEvent for
  signature verification. Do not reimplement the HTTP transport or verifier.
- @bachs/sdk installs from npm at an exact version. When upgrading it, update
  package.json and package-lock.json together and run npm run verify.

- Docs: read the Bachs page for the task. Every page is available as Markdown
  by adding .md to its URL, and https://docs.bachs.io/llms.txt lists every
  page. Do not invent endpoints, fields, events or error codes. If the docs
  don't cover something, ask.
- Environments: build against the sandbox, https://sandbox-api.bachs.io, with an
  sk_sandbox_ key. Production is https://api.bachs.io with an sk_live_ key.
  Read keys from environment variables. Never send a secret key to the browser
  and never put one in a NEXT_PUBLIC_ variable.
- Money: amounts are decimal strings at the currency's precision ("29.00"),
  always with an ISO 4217 currency. Never use numbers or minor units.
- Prices come from the server. The browser sends a plan key; the server maps it
  to a Bachs product ID. Never accept an amount or product ID from the client.
- Webhooks are the source of truth. Give access from webhooks, never from the
  success_url redirect or a client-side event.
- Verify every webhook on the raw body before parsing it. Accept a delivery if
  any v1= value in X-Bachs-Signature-V2 matches. Keep the 5-minute timestamp
  check.
- Delivery is at least once and not always in order. Keep the processed-event
  check and the created_at comparison in lib/webhooks.ts. Ignore fields you
  don't recognise.
- Return 2xx only after the event is handled, and 5xx when handling fails, so
  Bachs retries. Return 400 for invalid signatures or malformed events. Most 4xx are not retried; 408 and 429 are exceptions.
- Persist one Idempotency-Key per operation. The checkout route reserves its key before calling Bachs; uncertain writes are reconciled before retrying.
- Subscriptions start from a checkout session for a recurring product. There is
  no create-subscription endpoint. A recurring checkout needs a customer.
