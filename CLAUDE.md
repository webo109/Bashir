# Instructions for Claude Code running Bashir routines

This repo is invoked from two Claude Code Remote Routines:

## Daily (7am Muscat / 03:00 UTC)
Prompt for the routine:
> Run `python scripts/daily.py`. Report the email counts and any errors. Do not edit any files.

## Monthly (1st of month, 8am Muscat / 04:00 UTC)
Prompt for the routine:
> Run `python scripts/monthly.py`. Report the row written to `monthly_reports` and any errors. Do not edit any files.

## Network allowlist
The routine environment must be able to reach:
- `googleapis.com` (Gmail API)
- `gmail.googleapis.com`
- `oauth2.googleapis.com`
- `*.supabase.co`
- `api.anthropic.com`

If a request is blocked, add the host in the environment config for the routine.

## Secrets
All secrets live in routine environment variables (see `.env.example` for the list). Never commit `.env`.

## Do not
- Do not modify code from inside the routine.
- Do not call any tools other than running these scripts.
- Do not retry on Anthropic rate limits — surface the error and exit; the next run will catch up.
