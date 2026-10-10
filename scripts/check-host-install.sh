#!/bin/sh
# End-to-end check of the install flow: install.sh runs against a fake CDN (a
# curl stub serving a temp copy of host/dist), then the files are broken.
# Usage: sh scripts/check-host-install.sh   (after `npm run build:host`)
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/host/dist"
VERSION="$(tr -d ' \r\n' < "$DIST/latest.txt")"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/cdn"
cp -R "$DIST/." "$T/cdn/"
# curl stub: maps https://cdn.test/host/<path> to $T/cdn/<path>
cat > "$T/bin/curl" <<EOF
#!/bin/sh
out=""; url=""
while [ \$# -gt 0 ]; do case "\$1" in -o) out="\$2"; shift 2 ;; -*) shift ;; *) url="\$1"; shift ;; esac; done
path="\${url#https://cdn.test/host/}"
[ -f "$T/cdn/\$path" ] || exit 22
cp "$T/cdn/\$path" "\$out"
EOF
chmod +x "$T/bin/curl"

run() {
  rm -rf "$T/home"
  PATH="$T/bin:$PATH" HOME="$T/home" DOUCHAT_HOST_URL=https://cdn.test/host DOUCHAT_HOST_VERSION="${PIN-}" \
    sh "$T/cdn/install.sh" >"$T/log" 2>&1
}
expect_ok() { if run; then echo "ok    $1"; else echo "FAIL  $1"; cat "$T/log"; exit 1; fi; }
expect_fail() { if run; then echo "FAIL  $1 (installed)"; exit 1; elif grep -q "$2" "$T/log"; then echo "ok    $1"; else echo "FAIL  $1"; cat "$T/log"; exit 1; fi; }

expect_ok "latest.txt release installs"
grep -q "\"version\": \"$VERSION\"" "$T/home/.douchat-host/install.json" || { echo "FAIL  installed version"; exit 1; }
PIN="$VERSION" expect_ok "pinned version installs"
printf '\n// corrupted\n' >> "$T/cdn/$VERSION/douchat-host.mjs"
expect_fail "mismatched bundle is rejected" "failed verification"
