# Douchat icons

The app uses the Douchat `icon-v2` artwork: a white agent mark on the product's
blue theme-color plate. The source artwork keeps a roughly 9.8% transparent
margin on each side of the 1024px canvas, with an approximately 824px plate.
This matches the visible plate proportions measured from the installed Chrome
icon (206px on a 256px canvas). The white mark is enlarged
within that plate so it remains legible at Dock and taskbar sizes.
The development variant uses the same plate and agent-mark size as the release
icon, with a red `DEV` badge at the lower right. Keep the shared artwork at the
same scale so both variants have the same perceived Dock size. PNG and ICNS files are generated from
the SVG sources in this directory.

- `douchat.svg` / `douchat.png` / `douchat.icns` / `douchat.ico`: release icon.
- `douchat-dev.svg` / `douchat-dev.png` / `douchat-dev.icns`: development icon.

Electron selects the development PNG when `ELECTRON_RENDERER_URL` is present
and the release PNG otherwise. The Dock, BrowserWindow, and renderer empty
state all use these resources.

Regenerate the PNG, ICNS, and ICO assets after changing the SVG artwork; changing
only ICNS is insufficient because Electron sets the running Dock icon from PNG.
On macOS, run `bash scripts/generate-icons.sh` with `rsvg-convert` and ImageMagick
installed. Rebuild and install the app to see the change in the release version.
