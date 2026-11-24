# Kill switch

Use this when a ~$200 spend alert arrives, then stop and reassess the plan before putting the site back online.

The alert is the trigger. Do not wait for a later invoice. A Cloudflare email at 80% of a spending limit (~$160) is an early warning; the $200 threshold is the stop signal.

## Where the alerts go

Configured notifications should go to **nick@nickbytes.com**, the Nickbytes Cloudflare account billing email.

These alerts are not a complete invoice cap:

- A Workers or Durable Objects **spending limit** (`usage_block`) is a product-wide hard stop for the whole account, after included usage. Reporting and blocking can lag, so recorded spend can go past $200. The Workers Paid subscription fee and other products (D1, KV, R2, Workers AI, Workers Logs, and so on) are not included.
- A **budget alert** or product **usage alert** is email only. It does not stop traffic or charges.

If those account-wide limits are in place, hitting them can also pause other Workers on the same account. This kill switch is narrower: it only takes T1D Open Desk offline so you can reassess without leaving this Worker serving traffic.

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
- The site URL, usually `https://t1d-open-desk.<account>.workers.dev`, does not serve the homepage. A request should fail or return a Cloudflare error, not the Open Desk UI or `/api/forum` data.

The script prints these checks. Keep the live URL from the original deploy notes so you know what to request.

## Restore

After you have reassessed the plan, deploy the default read-only configuration again. Do not provision resources:

```sh
node build-native.mjs ./frontend
node --check bundle/index.mjs
npm test
npx --no-install cf deploy --no-provision
```

Then confirm the homepage loads, `GET /api/forum` works, and `POST /api/forum` is rejected.
