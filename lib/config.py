"""Central env + path config. Loads .env once on import."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

# Supabase
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")

# Google OAuth
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.environ.get(
    "GOOGLE_REDIRECT_URI", "http://localhost:8765/oauth/callback"
)

# Notifications
NOTIFY_TO_EMAIL = os.environ.get("NOTIFY_TO_EMAIL", "")
NOTIFY_FROM_EMAIL = os.environ.get("NOTIFY_FROM_EMAIL", "")

# Prompt
PROMPT_VERSION = os.environ.get("PROMPT_VERSION", "1.0")
PROMPT_PATH = ROOT / "prompts" / "triage.md"

# Shared scratch dir for the fetch → classify → persist handoff.
TMP_DIR = ROOT / "tmp"
PENDING_PATH = TMP_DIR / "pending.jsonl"
CLASSIFICATIONS_PATH = TMP_DIR / "classifications.jsonl"


def require(name: str, value: str) -> str:
    if not value:
        raise RuntimeError(
            f"Missing env var: {name}. Set it in .env (see .env.example)."
        )
    return value
