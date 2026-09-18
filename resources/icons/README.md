# Douchat icons

The app uses the Douchat `icon-v2` artwork: a white agent mark on the product's
blue theme-color plate. The source artwork keeps a roughly 7.5% transparent
safety margin on the 1024px canvas so its perceived Dock size matches full-bleed
macOS app icons without clipping the rounded plate. The white mark is enlarged
within that plate so it remains legible at Dock and taskbar sizes.
The development variant adds a red `DEV` badge at the lower right. PNG and
ICNS files are generated from the SVG sources in this directory.

- `douchat.svg` / `douchat.png` / `douchat.icns` / `douchat.ico`: release icon.
- `douchat-dev.svg` / `douchat-dev.png` / `douchat-dev.icns`: development icon.

Electron selects the development PNG when `ELECTRON_RENDERER_URL` is present
and the release PNG otherwise. The Dock, BrowserWindow, and renderer empty
state all use these resources.
