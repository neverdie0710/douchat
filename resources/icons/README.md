# Douchat icons

The app uses the Douchat `icon-v2` artwork. The source artwork is inset by 12%
on the 1024px canvas so its perceived Dock size matches other macOS app icons.
The development variant adds a red `DEV` badge at the lower right. PNG and
ICNS files are generated from the SVG sources in this directory.

- `douchat.svg` / `douchat.png` / `douchat.icns`: release icon.
- `douchat-dev.svg` / `douchat-dev.png` / `douchat-dev.icns`: development icon.

Electron selects the development PNG when `ELECTRON_RENDERER_URL` is present
and the release PNG otherwise. The Dock, BrowserWindow, and renderer empty
state all use these resources.
