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

# Probe several representative routes, not just `/`. The entry Worker starts
# answering before its assets have fully propagated, so `/` can return 200
# while an asset-backed or prerendered route is still 500ing — which is
# exactly how a deploy raced past this gate and failed the smoke test.
paths=("/" "/blog/" "/works/" "/air/")

for attempt in $(seq 1 "$attempts"); do
  all_ready=1
  status_line=""

  for path in "${paths[@]}"; do
    # Assign the fallback separately: `$(curl … || echo 000)` would concatenate
    # curl's own "000" output with the echo, yielding "000000" — which is not
    # equal to "000" and would pass the check against a host that never
    # answered.
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${url%/}${path}")" || code="000"
    status_line="${status_line} ${path}:${code}"

    # Not ready if unreachable (000) or still erroring (5xx). A 302 to the
    # Cloudflare Access login counts as ready — DNS and TLS are live.
    if [ "$code" = "000" ] || [ "$code" -ge 500 ] 2>/dev/null; then
      all_ready=0
    fi
  done

  if [ "$all_ready" -eq 1 ]; then
    echo "${url} ready after ${attempt} attempt(s):${status_line}"
    exit 0
  fi

  echo "  attempt ${attempt}/${attempts}: not ready yet —${status_line}"
  sleep "$delay"
done

echo "::error::${url} did not become ready within $((attempts * delay))s."
exit 1
