# Douchat development shortcuts.

.PHONY: dev dev-desktop

# Local service + web app with live reload, also reachable from phones on
# the same Wi-Fi (see scripts/dev.mjs for the addresses it prints).
dev:
	@node scripts/dev.mjs

# The desktop app (Electron) against the local service.
dev-desktop:
	@npm run dev
