#!/usr/bin/env python3
"""List entities and technical terms in a brief that the CTO Review glossary does not cover yet.

Usage:
  python3 glossary_suggest.py /workspace/briefs/tech-brief-YYYY-MM-DD.json [--json] [--glossary PATH] [--min 1]

Output: two lists, newest-brief order.
  1. entities – values from items[].entities that no glossary alias matches.
  2. terms    – Latin words / acronyms / hyphenated terms in headline, summary, why_it_matters and action
                that no glossary alias matches (count >= --min), with the first item id where they appear.
Nothing is written. The daily run reviews the list, skips ultra-common names (Google, Microsoft, Apple,
Amazon...) and people, and adds short Hebrew definitions to glossary.json for the rest (see README "Glossary").
"""
import argparse, json, re, sys
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import glossary_lib  # noqa: E402

COMMON = {"AI", "Google", "Microsoft", "Apple", "Amazon", "AWS", "Azure", "Meta", "IBM", "Oracle", "Nvidia", "NVIDIA",
          "Intel", "AMD", "OpenAI", "ChatGPT", "GitHub", "Linux", "Windows", "Chrome", "Firefox", "Edge", "X", "IT",
          "Google Cloud", "Microsoft 365", "Teams", "Outlook", "Python", "Java", "JavaScript", "TypeScript", "SQL",
          "JSON", "CSV", "HTML", "CSS", "HTTP", "URL", "PDF", "CEO", "CTO", "CIO", "CISO", "USA", "US", "EU"}
TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9+#&]*(?:[-.][A-Za-z0-9+#&]+)*")


def covered(M, s):
    """True if the glossary matches the whole string s (or s is a common name)."""
    if s in COMMON:
        return True
    hits = M.find(s)
    return any(a == 0 and b == len(s) for a, b, _ in hits)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("--glossary", default=str(ROOT / "glossary.json"))
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--min", type=int, default=1, help="minimum occurrences for a text term")
    a = ap.parse_args()
    M = glossary_lib.Matcher(glossary_lib.load(a.glossary)["entries"])
    b = json.load(open(a.brief, encoding="utf-8"))
    ents, terms = OrderedDict(), OrderedDict()
    for it in b.get("items", []):
        iid = it.get("id") or ""
        for e in it.get("entities") or []:
            e = str(e).strip()
            if e and not re.match(r"CVE-\d", e) and not covered(M, e):
                ents.setdefault(e, iid)
        for f in glossary_lib.ITEM_FIELDS:
            text = str(it.get(f) or "")
            marked = [(s, t) for s, t, _ in M.find(text)]
            for m in TOKEN.finditer(text):
                w = m.group().rstrip(".")
                if len(w) < 2 or w in COMMON or re.match(r"CVE-\d", w) or re.fullmatch(r"[A-Za-z]?\d[\w.]*", w):
                    continue
                if any(s <= m.start() < t for s, t in marked):
                    continue
                if not (w.isupper() or "-" in w or w[0].isupper() or w.islower()):
                    continue
                d = terms.setdefault(w, {"count": 0, "item": iid})
                d["count"] += 1
    terms = OrderedDict((k, v) for k, v in terms.items() if v["count"] >= a.min)
    if a.json:
        print(json.dumps({"brief": b.get("date"), "entities": [{"name": k, "item": v} for k, v in ents.items()],
                          "terms": [{"term": k, **v} for k, v in terms.items()]}, ensure_ascii=False, indent=2))
        return
    print(f"brief {b.get('date')}: {len(ents)} entities and {len(terms)} text terms not in the glossary")
    print("\n# entities")
    for k, v in ents.items():
        print(f"  {k}\t({v})")
    print("\n# terms (count, first item)")
    for k, v in sorted(terms.items(), key=lambda kv: -kv[1]["count"]):
        print(f"  {k}\t{v['count']}\t({v['item']})")


if __name__ == "__main__":
    main()
