#!/usr/bin/env bash
# Wait until a URL answers over HTTP.
#
# A freshly-created Cloudflare Custom Domain needs DNS and edge-certificate
# propagation before it responds at all, so deploys wait here rather than
# letting the smoke test fail against a cold hostname.
#
# Any HTTP status counts as "responding" — a 302 to the Cloudflare Access
# login page still proves DNS and TLS are live. Content assertions are the
# smoke test's job.
#
# Set EXPECT_BUILD_SHA to also require that the *new* build is the one being
# served. Reachability alone is not enough: the previous Worker version keeps
# answering 200 for a moment after `wrangler deploy` returns, so this gate
# used to pass under a second and hand the smoke test a stale page. That is
# how the production deploy of the section-gating commit failed — the gate
# saw /air/:200, which only the pre-gating build ever returned.
#
# Asserting the build stamp through Cloudflare Access needs the CI service
# token: set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET and the probes
# authenticate the way the smoke test does. Without them Access answers with
# its own login page, which carries no build stamp, so the gate can never be
# satisfied — that is how the staging deploy failed once Access started
# covering staging.eddie.engineering: 300s of `build:unknown` for a Worker
# that had deployed correctly. When that happens now the gate says so and
# stops rather than waiting out the clock.
#
# Reachability alone (no EXPECT_BUILD_SHA) still works through Access without
# credentials, which is all the per-PR previews ask for.
#
# Usage: wait-for-http.sh <url> [attempts] [sleep-seconds]

set -euo pipefail

url="${1:-}"
attempts="${2:-30}"
delay="${3:-10}"

if [ -z "$url" ]; then
  echo "Usage: wait-for-http.sh <url> [attempts] [sleep-seconds]" >&2
  exit 1
fi

# Probe several representative routes, not just `/`. The entry Worker starts
# answering before its assets have fully propagated, so `/` can return 200
# while an asset-backed or prerendered route is still 500ing — which is
# exactly how a deploy raced past this gate and failed the smoke test.
paths=("/" "/blog/" "/works/" "/cv/air/")

# Layout.astro stamps this into every page.
expect_sha="${EXPECT_BUILD_SHA:-}"
served_sha=""

# The CI service token, when the hostname is behind Access. Empty is fine for
# an ungated hostname — Access simply has no opinion about the headers.
auth=()
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  auth=(-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}"
        -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}")
fi

if [ -n "$expect_sha" ]; then
  echo "Waiting for build ${expect_sha} to be the version served."
  if [ ${#auth[@]} -eq 0 ]; then
    echo "  (no CF_ACCESS_* service token — probing anonymously)"
  fi
fi

# Reads <meta name="build-sha" content="..."> from the served home page.
read_served_sha() {
  curl -s --max-time 10 ${auth[@]+"${auth[@]}"} "${url%/}/" \
    | sed -n 's/.*<meta name="build-sha" content="\([^"]*\)".*/\1/p' \
    | head -1
}

# True when Access served its login interstitial instead of the site. Mirrors
# isAccessInterstitial() in smoke-test.mjs; the response headers are enough,
# so there is no need to also sniff the body.
served_by_access() {
  curl -s -D - -o /dev/null --max-time 10 ${auth[@]+"${auth[@]}"} "${url%/}/" \
    | grep -qiE '^(www-authenticate:.*Cloudflare-Access|location:.*cloudflareaccess\.com)'
}

access_strikes=0
routes_ok=0

for attempt in $(seq 1 "$attempts"); do
  all_ready=1
  status_line=""

  for path in "${paths[@]}"; do
    # Authenticated, because through Access an anonymous probe returns 302 for
    # every path — including the ones a broken Worker is 500ing on — so the
    # loop would report "ready" while asserting nothing at all.
    #
    # Assign the fallback separately: `$(curl … || echo 000)` would concatenate
    # curl's own "000" output with the echo, yielding "000000" — which is not
    # equal to "000" and would pass the check against a host that never
    # answered.
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 ${auth[@]+"${auth[@]}"} "${url%/}${path}")" || code="000"
    status_line="${status_line} ${path}:${code}"

    # Not ready if unreachable (000) or still erroring (5xx). A 302 to the
    # Cloudflare Access login counts as ready — DNS and TLS are live.
    if [ "$code" = "000" ] || [ "$code" -ge 500 ] 2>/dev/null; then
      all_ready=0
    fi
  done

  # Remembered past the loop so the closing diagnosis can tell "wrong version"
  # apart from "never answered".
  routes_ok="$all_ready"

  # Routes answering is necessary but not sufficient — confirm the version.
  if [ "$all_ready" -eq 1 ] && [ -n "$expect_sha" ]; then
    served_sha="$(read_served_sha)" || served_sha=""
    if [ "$served_sha" != "$expect_sha" ]; then
      all_ready=0
      status_line="${status_line} build:${served_sha:-unknown}"

      # No stamp at all, because Access answered instead of the site. Waiting
      # cannot fix that, so say what is actually wrong and stop. Confirm it
      # twice first — one bad read should not end a deploy.
      if [ -z "$served_sha" ] && served_by_access; then
        access_strikes=$((access_strikes + 1))
        if [ "$access_strikes" -ge 2 ]; then
          echo "::error::${url} is behind Cloudflare Access and served the login" \
            "page instead of the site, so there is no build stamp to check." \
            "$(if [ ${#auth[@]} -eq 0 ]; then
                 echo 'Pass CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET to this step.'
               else
                 echo 'The service token was sent and rejected — the Access application needs a Service Auth policy for it (see docs/ACCESS.md).'
               fi)"
          exit 1
        fi
      else
        access_strikes=0
      fi
    fi
  fi

  if [ "$all_ready" -eq 1 ]; then
    echo "${url} ready after ${attempt} attempt(s):${status_line}"
    exit 0
  fi

  echo "  attempt ${attempt}/${attempts}: not ready yet —${status_line}"
  sleep "$delay"
done

# Only blame the version when the host was actually answering. A host that
# never responded is an unreachable host, and saying it "is still serving
# build 'unknown'" sends the reader looking for a deploy that never landed.
if [ "$routes_ok" -eq 1 ] && [ -n "$expect_sha" ] && [ "$served_sha" != "$expect_sha" ]; then
  echo "::error::${url} is still serving build '${served_sha:-unknown}' rather" \
    "than '${expect_sha}' after $((attempts * delay))s. The deploy may have" \
    "succeeded without the new version taking effect."
  exit 1
fi

echo "::error::${url} did not become ready within $((attempts * delay))s."
exit 1
