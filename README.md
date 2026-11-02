# ReturnReady

Track return windows. Get your money back on time.

ReturnReady is a local-first purchase return tracker. Add a purchase, enter the return policy the store actually gave you (a window in days or an exact last day), and see a live countdown for every open return - sorted so the most urgent one is always on top.

## Run it

Fully static site. Open `index.html` or serve the folder:

```
python3 -m http.server 8000
```

Deployed version: (GitHub Pages link added at submission)

## Features

- Purchases with store, date, price, and user-entered return policy - ReturnReady never assumes a store's policy.
- Countdowns computed on local calendar days (no timezone or DST drift); statuses: on track, due soon (<=7d), urgent (<=2d), closed.
- Receipt photos stored locally in IndexedDB (downscaled to save space), with thumbnail and full view.
- Filters (all / urgent / active / returned), mark-returned, edit, delete with confirm.
- Everything persists in your browser (localStorage + IndexedDB). No account, no server, no data leaves the device.

## Built with

Vanilla HTML/CSS/JavaScript, localStorage, IndexedDB. No dependencies.

Built during LaunchPad Hacks (Oct 16 - Nov 20, 2026). AI assistance used for ideation.
