# Cloudflare Access

Which hostnames are gated, and how to set the policies up without breaking
deploys.

The existing Access application was created for **Pages**. The adapter emits
Workers now, and each tier is its own Worker on its own Custom Domain, so the old
application does not cover any of them.

| Tier | Hostname | Should be gated |
|------|----------|-----------------|
| Production | `eddie.engineering` | **No** — it is the public site |
| Staging | `staging.eddie.engineering` | Yes |
| Dev preview | `<branch>-dev.eddie.engineering` | Yes |

As of 2026-07-29 no policy covers `*-dev.eddie.engineering`: a request with no
credentials returns 200. Previews are public.

---

## The one thing that breaks deploys

**Every gated application needs a Service Auth policy for the CI token, not just
an Allow policy for you.**

`preview.yml` smoke-tests the deployment using `CF_ACCESS_CLIENT_ID` /
`CF_ACCESS_CLIENT_SECRET`. Access evaluates Bypass and Service Auth policies
*before* Allow policies. With only an Allow policy, CI gets the Access login page
instead of the site and every deploy fails at the smoke step.

So each application gets two policies:

```
Policy 1 — "CI smoke test"       Action: Service Auth
    Include → Service Token → <the CI token>

Policy 2 — "Eddie"               Action: Allow
    Include → Emails → eddie@…
```

Order does not matter between these two — Service Auth is evaluated first
regardless — but both must exist.

---

## Setting it up

### 1. Create the service token (once)

Zero Trust → **Access → Service Auth → Create Service Token**. Name it something
like `github-actions-smoke`.

The Client Secret is shown **once**. Put both halves in GitHub:

```bash
gh secret set CF_ACCESS_CLIENT_ID
gh secret set CF_ACCESS_CLIENT_SECRET
```

These are already set — reuse the existing token unless you are rotating it.

### 2. Staging application

Zero Trust → **Access → Applications → Add an application → Self-hosted**.

- **Application name:** `Portfolio — staging`
- **Domain:** `staging.eddie.engineering` (no path)
- **Session duration:** 24 hours is plenty

Then add the two policies above. In the Builder, the empty `Selector is…` /
`Value is…` row is the thing to fill in — a policy with no selector matches
nobody, so `Allow` on its own grants nothing.

For Policy 2, `Selector: Emails` → `Value: eddie@…`. Use **Emails** rather than
**Email domain** unless you want everyone at a domain to get in.

### 3. Preview application

Same, but one application covers every PR:

- **Application name:** `Portfolio — dev previews`
- **Domain:** `*-dev.eddie.engineering`

A wildcard is what you want here. A per-PR application would have to be created
and torn down alongside each Worker, and `preview-cleanup.yml` does not do that.

### 4. Verify

```bash
# Should be a redirect to the Access login page, not 200.
curl -s -o /dev/null -w '%{http_code}\n' https://staging.eddie.engineering/

# Should be 200 — this is the path CI takes.
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  https://staging.eddie.engineering/
```

If the first returns 200, the application is not matching the hostname — check
for a typo in the domain, and that the record is proxied (orange cloud).

---

## What gating changes about A.I.R.

Access gates the **whole hostname**, including `/api/air/*`. On a gated preview a
visitor cannot reach the access-request flow at all, because they cannot reach the
page.

That is correct for staging, but it means the request → Discord → approve → code
walkthrough cannot be done as an outside visitor on a gated hostname. Options,
in preference order:

1. Walk it on **production**, which is public and is what visitors actually use.
2. Walk it on a preview **before** adding the wildcard application.
3. Drive it with the service token headers, which tests the endpoints but not the
   visitor's experience of them.

`scripts/smoke-test.mjs` already reports and skips when it sees an Access login
page rather than passing silently, so a gated hostname will not produce a
false green.

---

## Related

- `docs/DEPLOYMENT.md` — hostnames, Workers, secrets per tier
- `.github/workflows/preview.yml` — the smoke step that needs Service Auth
