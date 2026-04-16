# Doppler Setup Guide

Doppler is the single source of truth for all ClimateFlow AI secrets. Secrets
flow from Doppler to three places:

- **Local dev** — via `doppler run` (CLI injects env vars before Node starts)
- **Railway prod** — via native Doppler → Railway sync integration (secrets
  appear as Railway env vars automatically on every deploy)
- **CI** — smoke tests use dummy values; real secrets are never needed in CI

---

## 1 — Account and project (one-time)

```bash
# Install CLI (already done if you're reading this from the repo)
# See: https://docs.doppler.com/docs/install-cli

# Log in (opens browser)
doppler login

# Create the project
doppler projects create climateflow-ai

# Create configs for each environment
doppler configs create dev    --project climateflow-ai
doppler configs create prd    --project climateflow-ai
```

---

## 2 — Import secrets from .env

Do this once to bootstrap Doppler from the existing `.env` file.

```bash
cd hvac-agency/automations

# Import to dev config
doppler secrets upload .env --project climateflow-ai --config dev

# Manually promote to prd, swapping test keys for live keys
# (never import .env directly to prd — use test keys in dev, live keys in prd)
```

After importing, verify in the Doppler dashboard that:
- `dev` config has Stripe `sk_test_...` keys
- `prd` config has Stripe `sk_live_...` keys
- Twilio, Anthropic, Google, SMTP, and all other secrets are populated in both

---

## 3 — Link the repo for local dev

The `doppler.yaml` in `hvac-agency/automations/` already sets the project/config.
Run this once per machine:

```bash
cd hvac-agency/automations
doppler setup    # confirms project=climateflow-ai config=dev
```

From then on, local dev is:

```bash
npm run dev      # runs: doppler run -- node src/server.js
```

You can stop committing `.env` locally — Doppler replaces it. Delete it:

```bash
rm hvac-agency/automations/.env
```

---

## 4 — Railway production integration

1. Go to **doppler.com → climateflow-ai → prd config → Integrations**
2. Click **Add Integration → Railway**
3. Authenticate with your Railway account
4. Select the ClimateFlow AI Railway service
5. Set sync direction: Doppler → Railway

Railway will now automatically receive updated secrets whenever you change them
in Doppler. No redeploy needed for secret updates — Railway restarts the service.

---

## 5 — Rotating a secret

```bash
# Update in Doppler
doppler secrets set STRIPE_SECRET_KEY=sk_live_newvalue --config prd

# Railway syncs automatically within ~30s.
# For local dev, the new value is picked up on the next `npm run dev`.
```

---

## 6 — Generating required secrets

These must be unique random values. Generate them and paste directly into
Doppler (never store them in files):

```bash
# API_KEY, TOKEN_ENCRYPTION_KEY, SIGNED_URL_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run that three times, assign each output to the corresponding secret in Doppler.

---

## 7 — CI (no changes needed)

The smoke tests in `test/` use dummy values and never call real services. No
`DOPPLER_TOKEN` is needed in GitHub Actions. If you add integration tests later
that need real credentials, create a `ci` Doppler config with test-mode keys and
inject via:

```yaml
- uses: dopplerhq/secrets-fetch-action@v1
  with:
    doppler-token: ${{ secrets.DOPPLER_TOKEN_CI }}
```

---

## Reference

- Doppler dashboard: https://dashboard.doppler.com
- Railway integration docs: https://docs.doppler.com/docs/railway
- CLI reference: https://docs.doppler.com/docs/cli
