# Tab Volume Adjuster

Minimal browser extension for per-site tab volume control.

## Features

- Minimal popup focused on one job: lower volume, increase volume, and toggle mono output.
- Lists tabs currently playing audio so you can jump directly to them.
- Stores volume and mono preferences by hostname in `chrome.storage.local`.
- Reapplies saved settings when the same site is opened again.
- Separate settings page for slider step size, max volume, persistence, and popup behavior.

## Project Structure

```text
.
|-- manifest.json
|-- README.md
|-- assets/
|   `-- icons/
|       |-- icon-16.png
|       |-- icon-32.png
|       |-- icon-48.png
|       `-- icon-128.png
|-- pages/
|   |-- offscreen.html
|   |-- options.html
|   `-- popup.html
|-- scripts/
|   |-- audio/
|   |   `-- offscreen.js
|   |-- background/
|   |   `-- service-worker.js
|   |-- content/
|   |   `-- content.js
|   |-- shared/
|   |   |-- constants.js
|   |   `-- storage.js
|   `-- ui/
|       |-- options.js
|       `-- popup.js
`-- styles/
    |-- options.css
    `-- popup.css
```

## File Roles

- `manifest.json`: MV3 entry points and permissions.
- `assets/icons/`: Placeholder extension icons referenced by the manifest and toolbar.
- `pages/`: HTML entry points for popup, options, and offscreen audio processing.
- `scripts/background/service-worker.js`: Coordinates tab state, persistence, and offscreen messaging.
- `scripts/audio/offscreen.js`: Owns the Web Audio graph for gain control and mono mixing.
- `scripts/content/content.js`: Notifies the background script when SPA navigation changes the current URL.
- `scripts/shared/`: Shared constants and storage helpers.
- `scripts/ui/`: Popup and options page behavior.
- `styles/`: Page-specific styles.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select this repository folder.

## Notes

- Site-specific profiles are keyed by hostname, for example `instagram.com`.
- The offscreen document is used so the tab audio graph can stay alive outside the popup lifecycle.
- Replace the placeholder PNG files in `assets/icons/` with your final brand artwork using the same filenames.
