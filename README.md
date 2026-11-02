# Kindcipe Backend

Canonical production database: **Railway Postgres**.
Supabase is **legacy — do not use** for development, validation, or deployments.

## Database rules

- `DATABASE_URL` is injected by the Railway service. Never commit a real URL, host, password, or connection string.
- Use exactly one production target: Railway service `kindcipe-backend` / production environment.
- Do not run validation or migrations against Supabase. It is retained only as legacy data.

## Migration / deploy order

1. Apply the additive migration to Railway production.
2. Run the preflight check against Railway production.
3. Paste the preflight result and get owner approval.
4. Deploy the backend.
5. Within 5 minutes verify `/health`, the changed endpoint, and Sentry.

The canonical commands, known-good IDs, safe mode, and rollback steps live in
the app repo’s `ROLLBACK_RUNBOOK.md` and `WEBAPP_DEPLOY.md`.

## Local development

Copy `.env.example` to `.env`, fill placeholders locally, and never commit `.env`.
