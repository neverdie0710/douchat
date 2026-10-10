#!/bin/sh
# douchat-host installer (remote-connections.md 7.2).
#
#   curl -fsSL '<base>/install.sh' | DOUCHAT_HOST_URL='<base>' DOUCHAT_ENROLL='dch1_...' sh
#
# Installs into ~/.douchat-host for the current user (never root), registers
# with Douchat when DOUCHAT_ENROLL is set, and keeps it running as a user
# service. Without DOUCHAT_ENROLL on an existing install it upgrades in place.
#
# Environment:
#   DOUCHAT_HOST_URL      Download base holding manifest.json and the bundle (required)
#   DOUCHAT_ENROLL        One-time install token from Douchat
#   DOUCHAT_HOST_HOME     Install folder (default ~/.douchat-host)
#   DOUCHAT_NODE_MIRROR   Node.js download mirror (default https://nodejs.org/dist)
#   DOUCHAT_HOST_YES=1    Skip the fingerprint question
#   DOUCHAT_HOST_SERVICE=background   Do not use systemd or launchd
set -eu

NODE_VERSION="v22.20.0"
NODE_MAJOR_MIN=20

say() { printf '%s\n' "douchat-host: $*"; }
fail() { printf '%s\n' "douchat-host: $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] && [ "${DOUCHAT_HOST_ALLOW_ROOT:-}" != "1" ] && fail "Do not install as root. Run this as the user agents should run as."
BASE="${DOUCHAT_HOST_URL:-}"
[ -n "$BASE" ] || fail "DOUCHAT_HOST_URL is not set. Copy the install command from Douchat again."
BASE="${BASE%/}"
HOST_HOME="${DOUCHAT_HOST_HOME:-$HOME/.douchat-host}"
case "$HOST_HOME" in *\'*|'') fail "Unsupported install folder: $HOST_HOME" ;; esac
command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v tar >/dev/null 2>&1 || fail "tar is required."

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else openssl dgst -sha256 -r "$1" | cut -d' ' -f1; fi
}
fetch() { curl -fsSL --retry 3 --connect-timeout 20 -o "$2" "$1" || fail "Could not download $1"; }

case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *) fail "Unsupported system $(uname -s). Linux and macOS are supported." ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCH=x64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) fail "Unsupported CPU $(uname -m)." ;;
esac

umask 077
mkdir -p "$HOST_HOME/bin" "$HOST_HOME/versions" "$HOST_HOME/logs"
chmod 700 "$HOST_HOME"
WORK="$(mktemp -d "$HOST_HOME/.install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT INT TERM

# ── Node.js: use the system one when new enough, else a private copy ──
node_ok() { "$1" -e "process.exit(Number(process.versions.node.split('.')[0]) >= $NODE_MAJOR_MIN ? 0 : 1)" >/dev/null 2>&1; }
NODE=""
if [ -x "$HOST_HOME/runtime/bin/node" ] && node_ok "$HOST_HOME/runtime/bin/node"; then NODE="$HOST_HOME/runtime/bin/node"
elif command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then NODE="$(command -v node)"
else
  MIRROR="${DOUCHAT_NODE_MIRROR:-https://nodejs.org/dist}"
  NAME="node-$NODE_VERSION-$OS-$ARCH"
  say "Node.js $NODE_MAJOR_MIN+ not found; downloading $NAME…"
  fetch "$MIRROR/$NODE_VERSION/SHASUMS256.txt" "$WORK/SHASUMS256.txt"
  fetch "$MIRROR/$NODE_VERSION/$NAME.tar.gz" "$WORK/node.tar.gz"
  EXPECTED="$(grep " $NAME.tar.gz\$" "$WORK/SHASUMS256.txt" | cut -d' ' -f1)"
  [ -n "$EXPECTED" ] && [ "$(sha256 "$WORK/node.tar.gz")" = "$EXPECTED" ] || fail "The Node.js download failed verification."
  tar -xzf "$WORK/node.tar.gz" -C "$WORK"
  rm -rf "$HOST_HOME/runtime"
  mv "$WORK/$NAME" "$HOST_HOME/runtime"
  NODE="$HOST_HOME/runtime/bin/node"
  node_ok "$NODE" || fail "The downloaded Node.js does not run on this system."
fi

# ── douchat-host bundle ──
fetch "$BASE/manifest.json" "$WORK/manifest.json"
VERSION="$("$NODE" -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(!/^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?\$/.test(m.version)||!/^[0-9a-f]{64}\$/.test(m.sha256))process.exit(1);console.log(m.version)" "$WORK/manifest.json")" || fail "The release manifest is invalid."
SHA="$("$NODE" -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).sha256)" "$WORK/manifest.json")"
fetch "$BASE/douchat-host.mjs" "$WORK/douchat-host.mjs"
[ "$(sha256 "$WORK/douchat-host.mjs")" = "$SHA" ] || fail "The douchat-host download failed verification."
"$NODE" "$WORK/douchat-host.mjs" version >/dev/null 2>&1 || fail "douchat-host $VERSION does not run with $("$NODE" --version)."

PREVIOUS=""
[ -L "$HOST_HOME/current" ] && PREVIOUS="$(readlink "$HOST_HOME/current")"
mkdir -p "$HOST_HOME/versions/$VERSION"
mv "$WORK/douchat-host.mjs" "$HOST_HOME/versions/$VERSION/douchat-host.mjs"
ln -sfn "versions/$VERSION" "$HOST_HOME/current.new"
mv -f "$HOST_HOME/current.new" "$HOST_HOME/current" 2>/dev/null || { rm -f "$HOST_HOME/current"; mv "$HOST_HOME/current.new" "$HOST_HOME/current"; }

cat > "$HOST_HOME/bin/douchat-host.new" <<EOF
#!/bin/sh
DOUCHAT_HOST_HOME='$HOST_HOME'
export DOUCHAT_HOST_HOME
exec '$NODE' '$HOST_HOME/current/douchat-host.mjs' "\$@"
EOF
chmod 700 "$HOST_HOME/bin/douchat-host.new"
mv -f "$HOST_HOME/bin/douchat-host.new" "$HOST_HOME/bin/douchat-host"
"$NODE" -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ base: process.argv[2], node: process.argv[3], version: process.argv[4] }, null, 2) + '\n', { mode: 0o600 })" \
  "$HOST_HOME/install.json" "$BASE" "$NODE" "$VERSION"
BIN="$HOST_HOME/bin/douchat-host"
export DOUCHAT_HOST_HOME="$HOST_HOME" DOUCHAT_HOST_INSTALLER=1

# Keep only the current and previous versions.
for dir in "$HOST_HOME"/versions/*; do
  [ -d "$dir" ] || continue
  case "versions/$(basename "$dir")" in "versions/$VERSION"|"$PREVIOUS") ;; *) rm -rf "$dir" ;; esac
done

if [ -n "${DOUCHAT_ENROLL:-}" ]; then
  "$BIN" setup --force || fail "Registration failed."
  "$BIN" service install || fail "douchat-host was registered but the service did not start. Run: $BIN doctor"
elif [ -f "$HOST_HOME/state.json" ]; then
  if "$BIN" service status | grep -q '^no service installed'; then "$BIN" service install
  else "$BIN" service restart || fail "Upgraded to $VERSION but the restart failed. Run: $BIN doctor"; fi
  say "Upgraded to $VERSION."
  exit 0
else
  say "Installed $VERSION but not registered. Copy the install command from Douchat to connect this server."
  exit 0
fi

say "Installed $VERSION. Return to Douchat to finish adding this server."
say "Manage it with: $BIN status | doctor | service restart | upgrade | uninstall --purge"
