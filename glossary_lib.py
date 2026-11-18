"""CTO Review glossary: load glossary.json and find/mark terms in brief text.

Used by build.py (margin notes, /glossary/ page, per-item "glossary" keys) and glossary_suggest.py.

Matching rules (deterministic, no network):
- Every alias is matched as a whole word. Longer aliases win ("Claude Code" before "Claude").
- Latin aliases are case-sensitive, except all-lowercase aliases of category "concept" (e.g. "agents",
  "fine-tune"), which are case-insensitive.
- A Hebrew prefix written with a hyphen (ב-, ל-, ה-, ו-, מ-, ש-, כ-, וה- ...) is allowed before a Latin
  alias: in «ב-Keycloak» only «Keycloak» is wrapped.
- A Latin alias must not be glued to other Latin letters/digits, and is not matched when followed by
  "-x" or ".x" (so "Claude-BugHunter", "GPT-6", "Next.js" do not match "Claude", "GPT", "Next").
- Hebrew aliases (e.g. «קיוביטים») may carry up to two one-letter prefixes (בהולמשכ) glued to them.
- Only the first occurrence of each entry per item is marked (headline -> summary -> why_it_matters -> action).
"""
import json, re
from pathlib import Path

CATEGORIES = ("company", "product", "concept", "standard", "org")
CAT_HE = {"concept": "מושגים", "product": "מוצרים וכלים", "company": "חברות", "standard": "תקנים ופורמטים",
          "org": "ארגונים, גופים וכנסים"}
CAT_ORDER = ["concept", "product", "company", "standard", "org"]
ITEM_FIELDS = ("headline", "summary", "why_it_matters", "action")
_LAT = re.compile(r"[A-Za-z0-9_]")
_HEB = re.compile(r"[\u05D0-\u05EA]")
_PREFIX = set("בהולמשכ")


def load(path):
    d = json.load(open(path, encoding="utf-8"))
    entries = d["entries"] if isinstance(d, dict) else d
    seen = set()
    for e in entries:
        for f in ("key", "term", "category", "definition_he"):
            if not e.get(f):
                raise SystemExit(f"glossary: entry {e.get('key')!r} has no {f}")
        if e["category"] not in CATEGORIES:
            raise SystemExit(f"glossary: entry {e['key']!r} has unknown category {e['category']!r}")
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", e["key"]):
            raise SystemExit(f"glossary: bad key {e['key']!r} (use a lowercase slug)")
        if e["key"] in seen:
            raise SystemExit(f"glossary: duplicate key {e['key']!r}")
        seen.add(e["key"])
        e.setdefault("aliases", [e["term"]])
        if e["term"] not in e["aliases"]:
            e["aliases"] = [e["term"]] + list(e["aliases"])
    return d if isinstance(d, dict) else {"entries": entries}


class Matcher:
    def __init__(self, entries):
        self.by_key = {e["key"]: e for e in entries}
        self.cs, self.ci = {}, {}
        alts = []
        for e in entries:
            for a in e.get("aliases") or [e["term"]]:
                a = a.strip()
                if not a:
                    continue
                if e["category"] == "concept" and a == a.lower() and re.search(r"[a-z]", a):
                    if a in self.ci:
                        raise SystemExit(f"glossary: alias {a!r} used twice")
                    self.ci[a] = e
                    alts.append((a, True))
                else:
                    if a in self.cs:
                        raise SystemExit(f"glossary: alias {a!r} used twice")
                    self.cs[a] = e
                    alts.append((a, False))
        alts.sort(key=lambda x: -len(x[0]))
        self.rx = re.compile("|".join(("(?i:%s)" if ci else "%s") % re.escape(a) for a, ci in alts)) if alts else None

    def _entry(self, tok):
        return self.cs.get(tok) or self.ci.get(tok.lower())

    @staticmethod
    def _ok(text, s, e, hebrew):
        prev = text[s - 1] if s > 0 else ""
        nxt = text[e] if e < len(text) else ""
        nxt2 = text[e + 1] if e + 1 < len(text) else ""
        if hebrew:
            if nxt and (_HEB.match(nxt) or _LAT.match(nxt)):
                return False
            i = s
            while i > 0 and s - i < 2 and text[i - 1] in _PREFIX:
                i -= 1
            before = text[i - 1] if i > 0 else ""
            if s - i == 0:
                return not (before and (_HEB.match(before) or _LAT.match(before)))
            return not (before and (_HEB.match(before) or _LAT.match(before)))
        if prev:
            if _LAT.match(prev) or prev in "./@#\\":
                return False
            if prev == "-" and not (s >= 2 and _HEB.match(text[s - 2])):
                return False
        if nxt:
            if _LAT.match(nxt):
                return False
            if nxt in "-./@" and nxt2 and _LAT.match(nxt2):
                return False
        return True

    def find(self, text):
        """All acceptable matches in text: [(start, end, entry)], non-overlapping, left to right."""
        out = []
        if not self.rx or not text:
            return out
        pos = 0
        while True:
            m = self.rx.search(text, pos)
            if not m:
                break
            s, e = m.span()
            ent = self._entry(m.group())
            if ent and self._ok(text, s, e, bool(_HEB.match(m.group()[0]))):
                out.append((s, e, ent))
                pos = e
            else:
                pos = s + 1
        return out

    def item_keys(self, it):
        """Keys of the entries marked in one item, in order of first appearance."""
        used = []
        for f in ITEM_FIELDS:
            for _, _, ent in self.find(str(it.get(f) or "")):
                if ent["key"] not in used:
                    used.append(ent["key"])
        return used
