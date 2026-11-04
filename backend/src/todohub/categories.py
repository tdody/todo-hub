"""Task types, shown as icons in the app.

New candidates get a type from the sweep (Claude picks one). Everything else (captured
notes, existing Linear issues) gets one from these rules: Linear labels first, then words
in the title, then "admin" as the fallback.
"""

from __future__ import annotations

import re

CATEGORIES = ("code", "analysis", "model", "review", "meeting", "email", "writing", "admin")

# Linear's built-in labels, mapped to a type. A team's own labels come from the
# [linear.label_types] setting. Checked before the title.
LABEL_RULES = {"bug": "code", "feature": "code", "improvement": "code"}

# Title patterns, in order: the first match wins.
TITLE_RULES = [
    ("review", r"\b(review|pr\s*#?\d+|pull request|approve the)\b"),
    ("meeting", r"\b(prep for|meeting|call with|the \w+ call|sync|agenda|kickoff|demo)\b"),
    ("email", r"\b(reply|respond|email|follow up|follow-up|send|forward|let \w+ know|waiting on)\b"),
    ("model", r"\b(model|train(ing)?|retrain|outcome|propensity|lookalike|features?|scor(e|ing)|recommender|persona)\b"),
    ("analysis", r"\b(analy[sz]|audit|investigate|query|check|compare|metrics?|drift|calibrat|backtest|lift|decile|cohort|dashboard|numbers?|roi)\b"),
    ("writing", r"\b(write|draft|doc(ument)?s?|deck|slides?|readout|report|summary|notes|spec|proposal|blog)\b"),
    ("code", r"\b(fix|bug|implement|add|build|refactor|test|deploy|ci|endpoint|api|script|migrat|branch|repo|code)\b"),
]
_COMPILED = [(c, re.compile(p, re.I)) for c, p in TITLE_RULES]


def categorize(title: str, labels: list[str] | None = None, signal: str | None = None,
               source: str | None = None, label_types: dict[str, str] | None = None) -> str:
    if source == "github" or signal == "review_request":
        return "review"
    if signal == "meeting_prep" or source == "calendar":
        return "meeting"
    rules = LABEL_RULES | (label_types or {})
    for label in labels or []:
        cat = rules.get(label.lower())
        if cat:
            return cat
    for cat, rx in _COMPILED:
        if rx.search(title or ""):
            return cat
    return "admin"


def clean(category: str | None) -> str | None:
    c = (category or "").strip().lower()
    return c if c in CATEGORIES else None
