"""Run Bashir on a labeled set of emails and print a confusion matrix.

Run before/after any prompts/triage.md change.

    python evals/run.py

`evals/cases.jsonl` is the labeled corpus. Each line:
    {gmail_msg_id, from_name, from_email, subject, snippet, body,
     received_at, account_email, expected_category}

Target: ≥85% accuracy on `reply_today` and `opportunities`,
        ≤5% leak from `archive` into any other category.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from lib import classifier  # noqa: E402

CATEGORIES = [
    "reply_today",
    "important_fyi",
    "opportunities",
    "diploma_learning",
    "archive",
]


def load_cases(path: Path) -> list[dict]:
    cases = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        cases.append(json.loads(line))
    return cases


def main() -> None:
    cases = load_cases(ROOT / "evals" / "cases.jsonl")
    if not cases:
        print("evals/cases.jsonl is empty. Add labeled examples first.")
        sys.exit(1)

    print(f"Running Bashir on {len(cases)} cases…")
    results = classifier.classify_batch(cases)
    by_id = {r["gmail_msg_id"]: r for r in results}

    # Confusion: matrix[expected][predicted] = count
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

    # Print matrix
    cols = CATEGORIES + (["MISSING"] if any("MISSING" in r for r in matrix.values()) else [])
    header = "expected ↓ / predicted →".ljust(22) + " ".join(c[:10].ljust(10) for c in cols)
    print(header)
    print("-" * len(header))
    for exp in CATEGORIES:
        row = matrix.get(exp, {})
        line = exp.ljust(22) + " ".join(str(row.get(c, 0)).ljust(10) for c in cols)
        print(line)

    # Per-category recall, with attention to reply_today + opportunities
    print()
    for exp in ("reply_today", "opportunities"):
        total = sum(matrix.get(exp, {}).values())
        right = matrix.get(exp, {}).get(exp, 0)
        if total:
            print(f"  recall({exp}) = {right}/{total} ({100*right/total:.0f}%)")

    # Archive leak (archive misclassified as anything else)
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
