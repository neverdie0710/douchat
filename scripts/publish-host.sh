#!/usr/bin/env bash
# Upload a douchat-host release (host/dist from `npm run build:host`) to the
# public Douchat R2 bucket under host/:
#
#   host/<version>/{douchat-host.mjs,install.sh,manifest.json}   immutable
#   host/install.sh, host/latest.txt                             short cache / never cached
#
# A version is never overwritten. The root install.sh and latest.txt are
# uploaded last, so nobody is pointed at a version before all of its files exist.
#
# Required environment (same R2 token as scripts/publish-release.sh):
#   CLOUDFLARE_ACCOUNT_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
set -euo pipefail

: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
: "${AWS_ACCESS_KEY_ID:?set AWS_ACCESS_KEY_ID}"
: "${AWS_SECRET_ACCESS_KEY:?set AWS_SECRET_ACCESS_KEY}"
command -v aws >/dev/null 2>&1 || { echo "aws CLI is required" >&2; exit 1; }

DIST="${1:?usage: scripts/publish-host.sh <host/dist>}"
R2_BUCKET="douchat"
R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"
CDN_BASE="https://cdn.douchat.ai/host"
VERSION="$(tr -d ' \r\n' < "$DIST/latest.txt")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "invalid version in $DIST/latest.txt" >&2; exit 1; }
FILES=(douchat-host.mjs install.sh manifest.json)
for name in "${FILES[@]}"; do
  [ -s "$DIST/$VERSION/$name" ] || { echo "missing $DIST/$VERSION/$name" >&2; exit 1; }
done

status="$(curl -s -o /dev/null -w '%{http_code}' "$CDN_BASE/$VERSION/manifest.json")"
if [ "$status" != "404" ]; then
  echo "douchat-host $VERSION is already published (HTTP $status); bump HOST_VERSION instead of overwriting." >&2
  exit 1
fi

content_type() {
  case "$1" in
    *.mjs) echo "text/javascript; charset=utf-8" ;;
    *.sh) echo "text/x-shellscript; charset=utf-8" ;;
    *.json) echo "application/json" ;;
    *) echo "text/plain; charset=utf-8" ;;
  esac
}
upload() {
  echo "==> Uploading host/$2"
  AWS_EC2_METADATA_DISABLED=true aws s3 cp "$1" "s3://${R2_BUCKET}/host/$2" \
    --endpoint-url "$R2_ENDPOINT" --region auto \
    --content-type "$(content_type "$2")" --cache-control "$3" \
    --no-progress --only-show-errors
}
fetch() { curl --fail --silent --show-error --retry 8 --retry-all-errors --retry-delay 5 -o "$2" "$1"; }

for name in "${FILES[@]}"; do
  upload "$DIST/$VERSION/$name" "$VERSION/$name" "public, max-age=31536000, immutable"
done
upload "$DIST/install.sh" "install.sh" "public, max-age=300"
upload "$DIST/latest.txt" "latest.txt" "no-store, max-age=0"

# Verify what the CDN serves byte for byte.
for name in "${FILES[@]}"; do
  fetch "$CDN_BASE/$VERSION/$name" "$DIST/.served"
  cmp -s "$DIST/.served" "$DIST/$VERSION/$name" || { echo "CDN serves a different $VERSION/$name" >&2; exit 1; }
done
fetch "$CDN_BASE/latest.txt" "$DIST/.served"
[ "$(tr -d ' \r\n' < "$DIST/.served")" = "$VERSION" ] || { echo "CDN latest.txt is not $VERSION" >&2; exit 1; }
rm -f "$DIST/.served"
echo "Published douchat-host $VERSION to $CDN_BASE/"
