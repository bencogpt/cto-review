#!/usr/bin/env python3
"""CTO Review replica – publish a JSON file to the shared server folder data/updates/ (SPEC 9.10).

Every visitor's browser reads data/updates/manifest.json on each page load and merges the files it lists.
IIS does not list folders, so this script keeps the manifest in sync with the *.json files in the folder.

  python add_update.py --file cto-review-update-2026-11-19.json --site-root /path/to/site
  python add_update.py --remove cto-review-update-2026-11-19.json --site-root /path/to/site
  python add_update.py --rebuild --site-root /path/to/site
  (--site-root defaults to the folder above this script, i.e. the site when the script sits in <site>/tools/)

Accepted files (same detection as the import page): daily update (format "cto-review-update"), full export
(format "cto-review-export"), daily brief (format_version "2-layered" + date + items), glossary (entries), sources.
Only the standard library is used. Exit code 0 = ok, 1 = refused.
"""
import argparse, datetime as dt, hashlib, json, os, re, shutil, sys, tempfile
from pathlib import Path

MANIFEST = "manifest.json"
FORMAT = "cto-review-updates-manifest"
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.json$")
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_BYTES = 25 * 1024 * 1024


def is_http(u):
    return isinstance(u, str) and re.match(r"^https?://", u.strip(), re.I) is not None


def brief_ok(b):
    if not isinstance(b, dict) or b.get("format_version") != "2-layered":
        return "brief: format_version is not 2-layered"
    if not ISO_DATE.match(str(b.get("date", ""))):
        return "brief: no ISO date (YYYY-MM-DD)"
    if not isinstance(b.get("items"), list) or not b["items"]:
        return "brief: items is missing or empty"
    for it in b["items"]:
        for s in (it.get("sources") or []) if isinstance(it, dict) else []:
            if isinstance(s, dict) and s.get("url") and not is_http(s["url"]):
                return "brief: a source link is not http(s)"
    return None


def detect(o):
    """-> (kind, date, generated_at) or raises ValueError with the reason."""
    if isinstance(o, dict) and o.get("format") == "cto-review-update":
        if o.get("format_version") != 1:
            raise ValueError("update: unsupported format_version")
        err = brief_ok(o.get("brief"))
        if err:
            raise ValueError("update " + err)
        return "update", o["brief"]["date"], o.get("generated_at") or ""
    if isinstance(o, dict) and o.get("format") == "cto-review-export":
        if o.get("format_version") != 1 or not isinstance(o.get("briefs"), list):
            raise ValueError("export: unsupported format_version or no briefs")
        for b in o["briefs"]:
            err = brief_ok(b)
            if err:
                raise ValueError("export " + err)
        dates = sorted(b["date"] for b in o["briefs"])
        return "export", (dates[-1] if dates else ""), o.get("generated_at") or ""
    if isinstance(o, dict) and o.get("format_version") == "2-layered" and "date" in o:
        err = brief_ok(o)
        if err:
            raise ValueError(err)
        return "brief", o["date"], o.get("generated_at") or ""
    if isinstance(o, dict) and isinstance(o.get("entries"), list) and "sources" not in o:
        for e in o["entries"]:
            if not isinstance(e, dict) or not all(isinstance(e.get(k), str) and e.get(k) for k in ("key", "term", "category", "definition_he")):
                raise ValueError("glossary: an entry misses key/term/category/definition_he")
            if e.get("url") and not is_http(e["url"]):
                raise ValueError("glossary: a link is not http(s)")
        return "glossary", "", o.get("generated_at") or o.get("updated") or ""
    if isinstance(o, dict) and isinstance(o.get("sources"), list) and "entries" not in o and "briefs" not in o:
        for s in o["sources"]:
            if not isinstance(s, dict) or not s.get("id") or not is_http(s.get("url")):
                raise ValueError("sources: a source has no id or no http(s) url")
        return "sources", "", o.get("updated") or ""
    raise ValueError("not a CTO Review file (update, export, brief, glossary or sources)")


def read_json(p):
    if p.stat().st_size > MAX_BYTES:
        raise ValueError("file is larger than 25 MB")
    return json.loads(p.read_bytes().decode("utf-8-sig"))


def write_manifest(folder):
    entries, skipped = [], []
    for p in sorted(folder.glob("*.json")):
        if p.name.lower() == MANIFEST or not SAFE_NAME.match(p.name):
            continue
        try:
            kind, date, gen = detect(read_json(p))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as e:
            skipped.append(f"{p.name}: {e}")
            continue
        data = p.read_bytes()
        entries.append({"name": p.name, "kind": kind, "date": date, "generated_at": gen, "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest()})
    # oldest first: by brief date (glossary/sources files without a date first), then generated_at, then name
    entries.sort(key=lambda e: (e["date"] or "0000", e["generated_at"] or "", e["name"]))
    man = {"format": FORMAT, "format_version": 1, "files": [e["name"] for e in entries], "entries": entries,
           "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds")}
    tmp = folder / (MANIFEST + ".tmp")
    tmp.write_text(json.dumps(man, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, folder / MANIFEST)
    return man, skipped


def main():
    ap = argparse.ArgumentParser(description="Publish a CTO Review JSON file to <site>/data/updates and rewrite manifest.json")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--file", help="JSON file to publish (copied with its own name)")
    g.add_argument("--remove", help="file name to remove from data/updates")
    g.add_argument("--rebuild", action="store_true", help="only rewrite manifest.json from the folder")
    ap.add_argument("--site-root", default=str(Path(__file__).resolve().parent.parent), help="site folder (contains index.html)")
    a = ap.parse_args()
    root = Path(a.site_root).resolve()
    if not (root / "index.html").exists():
        sys.exit(f"refusing: {root} has no index.html (is it the site folder?)")
    folder = root / "data" / "updates"
    folder.mkdir(parents=True, exist_ok=True)
    if a.file:
        src = Path(a.file).resolve()
        if not src.is_file():
            sys.exit(f"refusing: {src} not found")
        if not SAFE_NAME.match(src.name) or src.name.lower() == MANIFEST:
            sys.exit(f"refusing: file name {src.name!r} must be letters, digits, . _ - and end with .json")
        try:
            kind, date, gen = detect(read_json(src))
        except (ValueError, json.JSONDecodeError, UnicodeDecodeError) as e:
            sys.exit(f"refusing: {src.name} is not a valid CTO Review file: {e}")
        dst = folder / src.name
        if src != dst:
            fd, tmp = tempfile.mkstemp(dir=folder, suffix=".part")
            os.close(fd)
            shutil.copyfile(src, tmp)
            os.replace(tmp, dst)
        print(f"published {src.name} ({kind}{', ' + date if date else ''}) -> {dst}")
    elif a.remove:
        name = Path(a.remove).name
        if not SAFE_NAME.match(name) or name.lower() == MANIFEST:
            sys.exit(f"refusing: bad file name {name!r}")
        p = folder / name
        if p.exists():
            p.unlink()
            print(f"removed {name}")
        else:
            print(f"{name} was not in {folder}")
    man, skipped = write_manifest(folder)
    for s in skipped:
        print(f"warning: not listed (invalid): {s}")
    print(f"manifest.json: {len(man['files'])} file(s): " + ", ".join(man["files"]))


if __name__ == "__main__":
    main()
