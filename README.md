# Umamasume Tracker

A Vite + React + TypeScript single-page application for tracking TP/RP timers and custom countdowns for **Uma Musume Pretty Derby**. The tracker supports streamer HUD and overlay views, configurable notifications, flexible timers, and persistent local storage.

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

   The app will be served at the URL printed in the console (typically http://localhost:5173).

3. Create a production build:

   ```bash
   npm run build
   ```

4. Preview the production build locally:

   ```bash
   npm run preview
   ```

## Scripts

- `npm run dev` – start Vite in development mode with hot module replacement.
- `npm run build` – type-check the project and generate an optimized production build.
- `npm run preview` – preview the production build locally.
- `npm run lint` – run TypeScript to ensure the project type-checks.

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

## Deployment

The repository is ready for static hosting platforms that support Vite builds (e.g., GitHub Pages, Netlify, Vercel). Run `npm run build` and deploy the output in the `dist/` directory.
