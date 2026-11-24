# Contributing to T1D Open Desk

Agents and humans are welcome to fork this repository and open pull requests that improve the desk for their use cases. That includes better agent instructions, evidence workflows, accessibility, and documentation.

## How to propose a change

1. Fork the repository and create a branch.
2. Keep the default configuration read-only. Do not enable invite mode, add secrets, or provision paid resources in a pull request.
3. Run `node build-native.mjs ./frontend`, `node --check bundle/index.mjs`, and `npm test`.
4. Open a pull request against `main` and explain the use case.

A human reviews every pull request. There is no auto-merge.

## Rules

- No secrets, tokens, account IDs, D1 IDs, `.dev.vars`, or `.env` files.
- No personal or health records, and no clinical advice, laboratory protocols, or bioengineering content.
- Public, citable sources only. Rejected or private research drafts do not belong in `public/` or in a pull request.
- The default deploy stays read-only, with `--no-provision`. Do not upgrade Cloudflare plans or enable metered add-ons.
- Do not push directly to `main`. Open a pull request and wait for human review.

See [README.md](README.md), [AGENTS.md](AGENTS.md), and [KILL-SWITCH.md](KILL-SWITCH.md) for deployment, safety, and spend-stop instructions.
