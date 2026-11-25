# Kill switch

Use this when a $50 spend alert arrives, then stop and reassess the plan before putting the site back online.

The $50 alerts are the trigger. Do not wait for the $100 hard cap or a later invoice. Cloudflare may also email at 80% of a product spending alert (~$40). The $100 Workers and Durable Objects limits will block new usage of those products if they are reached.

## Current thresholds

All of the following notify **nick@nickbytes.com**, the Nickbytes Cloudflare account billing email.

**Hard caps** (they can stop usage; they are not an exact invoice cap):

- Workers spending limit: $100 (`usage_block`). This is account-wide and can also pause other Workers on the same account, including nanocode.
- Durable Objects spending limit: $100 (`usage_block`). Account-wide for Durable Objects.

Reporting and blocking can lag, so recorded spend can go past $100. The Workers Paid subscription fee and other products (D1, KV, R2, Workers AI, Workers Logs, and so on) are not included in these product limits.

**Alerts** (email only; they do not stop traffic or charges):

- Workers spending alert: $50
- Durable Objects spending alert: $50
- Account budget alert: $50 (account-wide usage-based spend)
- Account budget alert: $200 (higher account-wide backup)
- A Cloudflare auto-created $10 account budget alert is also enabled

This kill switch is narrower than the account-wide $100 caps: it only takes T1D Open Desk offline so you can reassess without leaving this Worker serving traffic.

## Stop spend for this project

From the project root, on the Mac mini:

```sh
chmod +x scripts/kill-switch.sh
./scripts/kill-switch.sh --dry-run   # preview
./scripts/kill-switch.sh --execute   # actually stop it
```

The script uses the project's `cf` CLI (`npx --no-install cf`) to delete the `t1d-open-desk` Worker, including its `workers.dev` route. That removes this project's Worker invocations, static assets, and any `run_worker_first` API routes. It does not delete account-wide spend policies, and it does not delete a D1 database (this project's default deploy has none). If invite mode was later enabled, review any `t1d-open-desk` D1 database by hand after the Worker is gone.

Do not run `--execute` unless you intend to take the site down.

## Verify it is off

After `--execute`:

- `npx --no-install cf workers list` no longer includes `t1d-open-desk`.
- The live URL, `https://t1d-open-desk.nickbytes.workers.dev`, does not serve the homepage. A request should fail or return a Cloudflare error, not the Open Desk UI or `/api/forum` data.

The script prints these checks. You can also set `T1D_OPEN_DESK_URL` to that URL for the script's HTTP check.

## Restore

After you have reassessed the plan, deploy the default read-only configuration again. Do not provision resources:

```sh
node build-native.mjs ./frontend
node --check bundle/index.mjs
npm test
npx --no-install cf deploy --no-provision
```

Then confirm the homepage loads, `GET /api/forum` works, and `POST /api/forum` is rejected.
