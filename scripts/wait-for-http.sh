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
# Usage: wait-for-http.sh <url> [attempts] [sleep-seconds]

set -euo pipefail

url="${1:-}"
attempts="${2:-30}"
delay="${3:-10}"

if [ -z "$url" ]; then
  echo "Usage: wait-for-http.sh <url> [attempts] [sleep-seconds]" >&2
  exit 1
fi

for attempt in $(seq 1 "$attempts"); do
  # Assign the fallback separately: `$(curl … || echo 000)` would concatenate
  # curl's own "000" output with the echo, yielding "000000" — which is not
  # equal to "000" and would pass the check against a host that never answered.
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url")" || code="000"

  if [ "$code" != "000" ]; then
    echo "$url responding after ${attempt} attempt(s) (HTTP ${code})."
    exit 0
  fi

  echo "  attempt ${attempt}/${attempts}: no response yet, waiting ${delay}s…"
  sleep "$delay"
done

echo "::error::${url} did not respond within $((attempts * delay))s."
exit 1
