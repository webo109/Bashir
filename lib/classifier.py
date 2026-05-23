"""Calls Claude with Bashir's prompt and returns parsed JSON.

Uses prompt caching on the system prompt (~2k tokens) — the system block is
identical across batches, so cache hits drop cost dramatically once warm.
"""
from __future__ import annotations

import json
import re
from typing import Any

import anthropic

from . import config


_client: anthropic.Anthropic | None = None
_prompt_cache: str | None = None


def _client_singleton() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(
            api_key=config.require("ANTHROPIC_API_KEY", config.ANTHROPIC_API_KEY or "")
        )
    return _client


def _system_prompt() -> str:
    global _prompt_cache
    if _prompt_cache is None:
        raw = config.PROMPT_PATH.read_text(encoding="utf-8")
        # Strip the leading `version: X.Y` line — it's metadata for humans,
        # not part of the instructions sent to Claude.
        lines = raw.splitlines()
        if lines and lines[0].strip().lower().startswith("version:"):
            raw = "\n".join(lines[1:]).lstrip()
        _prompt_cache = raw
    return _prompt_cache


def classify_batch(emails: list[dict[str, Any]], max_tokens: int = 4096) -> list[dict[str, Any]]:
    """Classify a batch of emails. Returns a flat list of classification dicts.

    Each input email dict needs: gmail_msg_id, from_name, from_email, subject,
    snippet, body, received_at, account_email (which inbox received it).

    Each output dict has: gmail_msg_id, category, summary (or None), why_priority (or None).
    """
    if not emails:
        return []

    # Compact user-message payload — only what Bashir needs to judge.
    payload = [
        {
            "id": e["gmail_msg_id"],
            "account": e.get("account_email", ""),
            "from": (e.get("from_name") or "") + (f" <{e['from_email']}>" if e.get("from_email") else ""),
            "subject": e.get("subject", "") or "",
            "received_at": e.get("received_at", ""),
            "snippet": e.get("snippet", "") or "",
            "body": (e.get("body") or "")[:2000],
        }
        for e in emails
    ]

    user_message = (
        "Classify the following emails. Output JSON matching the schema in your instructions.\n\n"
        f"```json\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n```"
    )

    resp = _client_singleton().messages.create(
        model=config.CLASSIFIER_MODEL,
        max_tokens=max_tokens,
        system=[
            {
                "type": "text",
                "text": _system_prompt(),
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_message}],
    )

    text = "".join(block.text for block in resp.content if block.type == "text").strip()
    parsed = _parse_json(text)

    out: list[dict[str, Any]] = []
    for category, items in parsed.get("categories", {}).items():
        for item in items or []:
            out.append(
                {
                    "gmail_msg_id": item.get("id"),
                    "category": category,
                    "summary": item.get("summary"),
                    "why_priority": item.get("why_priority"),
                }
            )
    return out


def _parse_json(text: str) -> dict[str, Any]:
    """Extract JSON object even if Claude wraps it in fences."""
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.S)
    if fence:
        text = fence.group(1)
    else:
        # Find first { ... last }
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1:
            text = text[start : end + 1]
    return json.loads(text)
