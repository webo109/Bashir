"""Authorize one Gmail account and store its refresh token in Supabase.

Run once per Gmail account Bashir will read from:

    python scripts/oauth_setup.py

A browser window will open, you'll pick a Google account and grant the
requested scopes (read + send for the nudge email), and the refresh token
will be saved to the `accounts` table keyed by that account's email.

Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in .env.
The redirect URI must be added to your OAuth client's "Authorized redirect
URIs" list in Google Cloud Console (default: http://localhost:8765/oauth/callback).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import config, gmail, supabase_client  # noqa: E402


def main() -> None:
    config.require("GOOGLE_CLIENT_ID", config.GOOGLE_CLIENT_ID)
    config.require("GOOGLE_CLIENT_SECRET", config.GOOGLE_CLIENT_SECRET)

    client_config = {
        "installed": {
            "client_id": config.GOOGLE_CLIENT_ID,
            "client_secret": config.GOOGLE_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [config.GOOGLE_REDIRECT_URI],
        }
    }

    flow = InstalledAppFlow.from_client_config(client_config, scopes=gmail.GMAIL_SCOPES)

    # Print the auth URL up front so the user always has a clickable link,
    # even if the browser doesn't auto-launch (e.g. running from a non-
    # interactive shell).
    auth_url, _ = flow.authorization_url(access_type="offline", prompt="consent")
    print()
    print("=" * 70)
    print("OPEN THIS URL IN A BROWSER (signed in as the inbox you want to authorize):")
    print()
    print(auth_url)
    print()
    print("After clicking 'Allow', you'll land on a localhost page — that's the")
    print("script catching the callback. This terminal will then print 'Authorized'.")
    print("=" * 70)
    print(flush=True)

    # access_type=offline + prompt=consent forces a refresh token.
    creds = flow.run_local_server(
        host="localhost",
        port=8765,
        access_type="offline",
        prompt="consent",
        open_browser=True,
    )

    if not creds.refresh_token:
        print("ERROR: no refresh token returned. Revoke the app in your Google account "
              "(https://myaccount.google.com/permissions) and rerun.")
        sys.exit(1)

    # Get the authorized email address.
    service = build("gmail", "v1", credentials=creds, cache_discovery=False)
    profile = service.users().getProfile(userId="me").execute()
    email = profile["emailAddress"]

    row = supabase_client.upsert_account(email, creds.refresh_token)
    print(f"Authorized {email}. accounts.id = {row['id']}")
    print(f"Tokens persisted to Supabase. You can run backfill next.")


if __name__ == "__main__":
    main()
