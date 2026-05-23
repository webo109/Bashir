# Bashir dashboard

The web UI for Bashir. See the parent [`../README.md`](../README.md) for the
overall project, OAuth setup, daily/monthly routines, and the Python pipeline
that populates Supabase.

## Local development

```powershell
cd dashboard
npm install            # first time
npm run dev            # http://localhost:3000
npm run build          # production build
npm test               # vitest unit tests (auth, time, query sanitizer)
```

Required env in `dashboard/.env.local` (see `dashboard/.env.local.example`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `DASHBOARD_PASSWORD`
- `DASHBOARD_SESSION_SECRET` (32+ random bytes hex)

The dashboard reads Supabase server-side only. The secret key never reaches
the browser.
