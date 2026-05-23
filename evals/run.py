"""Evaluate Bashir's classification accuracy.

Two scripts, one workflow — same fetch → classify → persist split as the
real pipeline, but the "fetch" is `cases.jsonl` and the "persist" is a
confusion matrix print:

    python evals/prepare.py    # writes evals/_pending.jsonl from cases.jsonl
    # (Claude classifies it into evals/_classifications.jsonl)
    python evals/run.py        # reads both, prints confusion matrix

`evals/cases.jsonl` lines:
    {gmail_msg_id, from_name, from_email, subject, snippet, body,
     received_at, account_email, expected_category}

Target: ≥85% accuracy on `reply_today` and `opportunities`;
        ≤5% leak from `archive` into any other category.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


CATEGORIES = [
    "reply_today",
    "important_fyi",
    "opportunities",
    "diploma_learning",
    "archive",
]

CASES_PATH = ROOT / "evals" / "cases.jsonl"
PRED_PATH = ROOT / "evals" / "_classifications.jsonl"


def load_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.append(json.loads(line))
    return out


def main() -> None:
    cases = load_jsonl(CASES_PATH)
    if not cases:
        print(f"{CASES_PATH} is empty. Add labeled examples first.")
        sys.exit(1)

    preds = load_jsonl(PRED_PATH)
    if not preds:
        print(f"{PRED_PATH} not found.")
        print("Ask Claude (locally via Claude Code, or in a routine) to read")
        print(f"  {CASES_PATH}")
        print(f"and write classifications to")
        print(f"  {PRED_PATH}")
        print("per the rules in prompts/triage.md. Then rerun this script.")
        sys.exit(1)

    by_id = {p.get("gmail_msg_id") or p.get("id"): p for p in preds}

    matrix: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    misses: list[dict] = []
    correct = 0

    for case in cases:
        expected = case["expected_category"]
        pred = (by_id.get(case["gmail_msg_id"]) or {}).get("category", "MISSING")
        matrix[expected][pred] += 1
        if pred == expected:
            correct += 1
        else:
            misses.append({
                "id": case["gmail_msg_id"],
                "subject": case.get("subject"),
                "expected": expected,
                "predicted": pred,
            })

    print()
    print(f"Accuracy: {correct}/{len(cases)} ({100*correct/len(cases):.1f}%)")
    print()

    cols = CATEGORIES + (["MISSING"] if any("MISSING" in r for r in matrix.values()) else [])
    header = "expected ↓ / predicted →".ljust(22) + " ".join(c[:10].ljust(10) for c in cols)
    print(header)
    print("-" * len(header))
    for exp in CATEGORIES:
        row = matrix.get(exp, {})
        line = exp.ljust(22) + " ".join(str(row.get(c, 0)).ljust(10) for c in cols)
        print(line)

    print()
    for exp in ("reply_today", "opportunities"):
        total = sum(matrix.get(exp, {}).values())
        right = matrix.get(exp, {}).get(exp, 0)
        if total:
            print(f"  recall({exp}) = {right}/{total} ({100*right/total:.0f}%)  (target ≥85%)")

    arch_total = sum(matrix.get("archive", {}).values())
    arch_leak = arch_total - matrix.get("archive", {}).get("archive", 0)
    if arch_total:
        print(f"  archive leak = {arch_leak}/{arch_total} ({100*arch_leak/arch_total:.0f}%)  (target ≤5%)")

    if misses:
        print()
        print("Misses:")
        for m in misses:
            print(f"  [{m['expected']} → {m['predicted']}] {m['subject']}")


if __name__ == "__main__":
    main()
