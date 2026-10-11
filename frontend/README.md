# SmartAirAware — Frontend

React + Vite dashboard for the SmartAirAware HVAC optimization system.

## Setup

```bash
npm install
npm run dev      # dev server on http://localhost:5173
npm run build    # production build → dist/
```

The dev server proxies all `/api/*` requests to the backend at `http://localhost:8000`.

## Pages

- **Schedule** — KPI cards, mode timeline, energy/PM2.5 chart, 48-hour forecast strip, full 24-hour schedule table with CSV download and manual run trigger
- **History** — Last 50 pipeline run records with status and error details
- **Settings** — Edit optimizer parameters and the 24-hour occupancy profile (requires admin key)
