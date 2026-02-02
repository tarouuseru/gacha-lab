# Gacha Lab (Pages)

## Entry
- `index.html` is the main entry.
- `app.js` controls UI/state (source of truth).

## Config
- `config.js` contains endpoint/env config.
- `_headers` and `_routes.json` are required for Pages routing/headers.

## Auth
- `auth/callback/` is used for Supabase magic-link callback.
- Do not change auth flow while debugging login boundary issues.

## Notes
- Guest flow uses `guest_token` + localStorage/sessionStorage.
- Login boundary can cause state mismatch; prefer client-side fallback when needed.
