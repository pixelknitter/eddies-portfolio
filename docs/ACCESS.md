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

Access gates the whole hostname by default, `/api/air/*` included. Two things
that follow, one reassuring and one to decide:

**Your own session covers the API.** After you authenticate, Access sets a
`CF_Authorization` cookie on the hostname, and `fetch()` defaults to
`credentials: 'same-origin'` — so the page's calls to `/api/air/ask` and
`/api/air/request` carry it. Anyone who passes the gate gets the whole flow.
Nothing extra is needed to test it as yourself.

The Discord notification is unaffected either way: it is an outbound `fetch`
from the Worker, and Access only inspects inbound requests. The webhook URL
lives in a Worker secret and never reaches the browser.

**Strangers are a different question.** The point of the request flow is that
someone with no code can ask for one, and a gated hostname stops them before the
page loads. If you want that reachable on a gated hostname, scope a second
application to the paths and give it a Bypass policy:

```
App A:  staging.eddie.engineering            Allow (you) + Service Auth (CI)
App B:  staging.eddie.engineering/api/air/   Bypass (everyone)
App C:  staging.eddie.engineering/air        Bypass (everyone)
```

Overlapping applications resolve by specificity — [the more specific path
wins](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/).
Note the trade Cloudflare states plainly: Bypass "disables Access enforcement"
and those requests "are not logged". Those paths then rest on the endpoint's own
controls — 3 requests per 10 minutes, input validation, and HMAC-signed
approval tokens.

Worth asking what the gate is for before adding all three. Access on a preview
protects unpublished drafts and unfinished sections: `/`, `/blog/`, `/works/`.
A.I.R. is public in production regardless, so gating it on staging protects
nothing and costs you the ability to test it the way a visitor meets it.

`scripts/smoke-test.mjs` reports and skips when it sees an Access login page
rather than passing silently, so a gated hostname will not produce a false green.

---

## Related

- `docs/DEPLOYMENT.md` — hostnames, Workers, secrets per tier
- `.github/workflows/preview.yml` — the smoke step that needs Service Auth
