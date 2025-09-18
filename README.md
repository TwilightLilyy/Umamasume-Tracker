# Umamasume Tracker

Uma Resource Tracker is a Vite + React + TypeScript single-page app for keeping stream-friendly tabs on **Uma Musume Pretty Derby** resources.
It tracks Training Points (TP), Race Points (RP), the daily reset, and any custom timers you need while persisting everything in the browser so the data is still there the next time you open the page.

## Requirements

- Node.js 18 or newer (Vite 5.x requirement)
- npm 9+ (ships with the recommended Node.js releases)

## Installation

```bash
git clone https://github.com/<your-account>/Umamasume-Tracker.git
cd Umamasume-Tracker
npm install
```

## Available scripts

- `npm run dev` – start Vite in development mode with hot module replacement. The dev server prints its URL (usually http://localhost:5173).
- `npm run build` – type-check the project and generate an optimized production bundle in `dist/`.
- `npm run preview` – run the production build locally for smoke testing.
- `npm run lint` – run TypeScript in no-emit mode to ensure the project type-checks.

## Usage

### Launch the tracker locally

```bash
npm run dev
```

Open the printed URL in your browser. All state is stored in `localStorage`, so opening the site again in the same browser will restore previous resource counts, timers, and settings.

### Track TP and RP

The TP (gold) and RP (blue) cards automatically count up based on the Uma Musume regeneration rates (1 TP every 10 minutes, 1 RP every 2 hours) up to their respective caps (100 TP / 5 RP).

Each card lets you:

- Click **-1 / +1** to adjust values when you spend or earn points.
- Use **Spend 30** (TP) or **Use 1** (RP) for common actions.
- Enter a custom **time until next point** (supports inputs like `5:00`, `15m`, `2h`, `45` seconds) to correct timers after stamina drinks or manual syncs.
- Manually set the **current amount**.
- See the countdown until the next point and until the resource is full.
- Review milestone timings (TP 30/60/90) to plan resets.
- Copy an overlay URL for adding the resource display to OBS/streaming software.

### Daily reset & overview

The **Daily Reset & Timer Overview** card shows the next 10:00 AM reset according to your selected time zone along with summaries of every timer you have running. Use this card’s **Copy Overlay URL** for a standalone daily reset browser source.

### Custom timers

Two timer types are supported:

- **Flexible timers** accept the same duration inputs as the resource override (e.g. `12m`, `1:30`, `720`). They support pause/resume, +1/+5 minute adjustments, resets, per-timer colors, and overlay links.
- **Exact date/time timers** count down to a specific timestamp (use your browser’s locale or ISO strings such as `2024-08-31T10:00`).

### Notifications

Enable **browser notifications** from the Notifications card to receive alerts when:

- TP reaches 30/60/90 or becomes full.
- RP refills to 5.
- Custom timers or exact timers complete.
- The daily reset is one hour away or just happened.

Grant notification permission when prompted and keep the tab open; the browser handles the rest. Notification choices are persisted per browser.

### Time zone

Set the tracker’s time zone from **Settings** → **Time zone**. Time zone affects the daily reset timer and how absolute times are displayed. Enter any valid IANA identifier such as `America/Chicago` or `Asia/Tokyo`.

### HUD mode & overlays

Add `?hud=1` to the URL for a compact layout that fits nicely in streaming scenes. Every resource or timer card has a **Copy Overlay URL** button that places a ready-to-use URL in your clipboard. Paste it into OBS (Browser Source) to show a single tracker element.

Overlay URLs use the following patterns if you want to build them manually:

- `?hud=1&overlay=tp` – TP counter
- `?hud=1&overlay=rp` – RP counter
- `?hud=1&overlay=reset` – daily reset countdown
- `?hud=1&overlay=timer:<timerId>` – specific flexible timer
- `?hud=1&overlay=abs:<timerId>` – specific exact date/time timer

### Keyboard shortcuts

The app is mouse-driven; no dedicated keyboard shortcuts are defined.

## Project structure

```
├── index.html             # Root HTML file loaded by Vite
├── package.json           # Project metadata and scripts
├── src/
│   ├── App.tsx            # Main Uma tracker application
│   ├── index.css          # Global styles
│   └── main.tsx           # React entry point
├── tsconfig*.json         # TypeScript configuration
└── vite.config.ts         # Vite configuration with React plugin
```

## Building for deployment

Run `npm run build` to produce the static assets inside `dist/`. Upload the `dist/` directory to any static host (GitHub Pages, Netlify, Vercel, Cloudflare Pages, etc.).

## Troubleshooting

- **Timers look wrong after long downtime** – use the **Set current amount** or **Set time until next** inputs on TP/RP cards to resync after playing on another device.
- **Notifications never appear** – ensure notifications are enabled in the Notifications card and that your browser allowed them; some browsers block notifications on unfocused tabs.
- **Overlay not updating** – overlays read the same localStorage as the main app, so make sure the overlay URL is opened from the same browser profile.

Enjoy your races!
