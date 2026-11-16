#!/usr/bin/env python3
"""Build the installable userscript release for one hosting location.

    python release/build_release.py --base https://hutauf.org/userscripts --out dist

For every *.user.js in tax/userscripts this writes into --out:

- <name>.user.js  with @updateURL/@downloadURL pointing at --base
- <name>.meta.js  header only (what script managers poll for updates)
- index.html      list of scripts with install links

The source files keep whatever update URLs they have; the hosting location is
decided here, at build time, so dev and production builds update from their
own host.

    --check-published URL

compares the build against what is live at URL and fails if a script changed
without a new @version. Script managers only update on a higher @version, so
such a change would never reach users.
"""
from __future__ import annotations

import argparse
import html
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent
HEADER_RE = re.compile(r"(// ==UserScript==\n)(.*?)(// ==/UserScript==\n?)", re.DOTALL)
URL_KEYS = ("updateURL", "downloadURL")


def parse_meta(header_body: str) -> dict[str, str]:
    meta: dict[str, str] = {}
    for line in header_body.splitlines():
        m = re.match(r"//\s*@(\S+)\s+(.*\S)\s*$", line)
        if m and m.group(1) not in meta:
            meta[m.group(1)] = m.group(2)
    return meta


BACKEND_URL_RE = re.compile(r"^const VTT_HOSTED_BACKEND_URL = '([^']+)';$", re.MULTILINE)


def set_backend_url(text: str, filename: str, backend_url: str) -> str:
    """Point the hosted backend at another deployment (dev) and allow the request."""
    if len(BACKEND_URL_RE.findall(text)) != 1:
        raise ValueError(
            f"{filename}: expected exactly one line \"const VTT_HOSTED_BACKEND_URL = '...';\". "
            "The release build replaces it for the dev deployment; keep that form."
        )
    text = BACKEND_URL_RE.sub(lambda _m: f"const VTT_HOSTED_BACKEND_URL = '{backend_url}';", text)
    host = urllib.parse.urlsplit(backend_url).hostname
    if not re.search(rf"^// @connect\s+{re.escape(host)}$", text, re.MULTILINE):
        text = text.replace("// ==/UserScript==", f"// @connect     {host}\n// ==/UserScript==", 1)
    return text


def build_script(text: str, filename: str, base: str, backend_url: str | None = None) -> tuple[str, str, dict[str, str]]:
    """Return (user.js text, meta.js text, metadata)."""
    text = text.replace("\r\n", "\n")
    if backend_url and BACKEND_URL_RE.search(text):
        text = set_backend_url(text, filename, backend_url)
    m = HEADER_RE.search(text)
    if not m:
        raise ValueError(
            f"{filename}: no '// ==UserScript==' header block found. "
            "Every *.user.js needs one; copy it from a sibling script."
        )
    meta = parse_meta(m.group(2))
    for key in ("name", "version"):
        if key not in meta:
            raise ValueError(f"{filename}: header has no @{key}. Add '// @{key} ...' to the header.")
    lines = [
        ln for ln in m.group(2).splitlines()
        if not re.match(r"//\s*@(%s)\b" % "|".join(URL_KEYS), ln)
    ]
    stem = filename[: -len(".user.js")]
    lines.append(f"// @updateURL   {base}/{stem}.meta.js")
    lines.append(f"// @downloadURL {base}/{filename}")
    header = m.group(1) + "\n".join(lines) + "\n" + "// ==/UserScript==\n"
    return text[: m.start()] + header + text[m.end():], header, meta


def render_index(entries: list[tuple[str, dict[str, str]]]) -> str:
    items = "\n".join(
        f'      <li><a class="entry" href="{html.escape(fn)}"><strong>{html.escape(meta["name"])}</strong>'
        f'<span>Version {html.escape(meta["version"])}'
        f'{" · " + html.escape(meta["description"]) if meta.get("description") else ""}</span></a></li>'
        for fn, meta in entries
    )
    return f"""<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Userscripts</title>
  <style>
    :root {{ --bg:#f6f5f1; --fg:#1d1d1b; --muted:#6b6a66; --line:#dcdad3; --accent:#2f6b3a; }}
    @media (prefers-color-scheme: dark) {{
      :root {{ --bg:#161716; --fg:#ecebe6; --muted:#9a9993; --line:#2e302e; --accent:#8fcf9b; }}
    }}
    body {{ margin:0; background:var(--bg); color:var(--fg);
           font:17px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }}
    main {{ max-width:34rem; margin:0 auto; padding:18vh 1.25rem 4rem; }}
    h1 {{ margin:0 0 .4rem; font-size:1.6rem; font-weight:650; }}
    p {{ margin:0 0 2.2rem; color:var(--muted); }}
    ul {{ list-style:none; margin:0; padding:0; border-top:1px solid var(--line); }}
    li {{ border-bottom:1px solid var(--line); }}
    a.entry {{ display:block; padding:1rem 0; color:inherit; text-decoration:none; overflow-wrap:anywhere; }}
    a.entry strong {{ color:var(--accent); font-weight:600; }}
    a.entry span {{ display:block; color:var(--muted); font-size:.93rem; }}
    a.entry:hover strong {{ text-decoration:underline; }}
  </style>
</head>
<body>
  <main>
    <h1>Userscripts</h1>
    <p>Installieren: Violentmonkey oder Tampermonkey einrichten, dann ein Skript anklicken. Updates kommen automatisch.</p>
    <ul>
{items}
    </ul>
  </main>
</body>
</html>
"""


def build(base: str, src: Path = SRC, backend_url: str | None = None) -> dict[str, str]:
    """Return {filename: content} for the whole release."""
    base = base.rstrip("/")
    out: dict[str, str] = {}
    entries: list[tuple[str, dict[str, str]]] = []
    for path in sorted(src.glob("*.user.js")):
        user_js, meta_js, meta = build_script(path.read_text(encoding="utf-8"), path.name, base, backend_url)
        out[path.name] = user_js
        out[path.name[: -len(".user.js")] + ".meta.js"] = meta_js
        entries.append((path.name, meta))
    if not entries:
        raise ValueError(f"No *.user.js found in {src}.")
    out["index.html"] = render_index(entries)
    return out


def fetch(url: str) -> str | None:
    """Published content, or None if nothing is published there yet."""
    # Cloudflare in front of hutauf.org rejects the default Python user agent.
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0", "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.read().decode("utf-8").replace("\r\n", "\n")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def check_published(files: dict[str, str], published_base: str, fetcher=fetch) -> list[str]:
    errors: list[str] = []
    for name, content in files.items():
        if not name.endswith(".user.js"):
            continue
        live = fetcher(f"{published_base.rstrip('/')}/{name}")
        if live is None or live == content:
            continue
        new_v = parse_meta(HEADER_RE.search(content).group(2))["version"]
        m = HEADER_RE.search(live)
        live_v = parse_meta(m.group(2)).get("version") if m else None
        if live_v == new_v:
            errors.append(
                f"{name} differs from the published script but still has @version {new_v}. "
                "Script managers only update on a higher version: raise '// @version' in "
                f"tax/userscripts/{name}."
            )
    return errors


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True, help="public URL the release is served from")
    ap.add_argument("--out", help="directory to write the release to")
    ap.add_argument("--backend-url", help="sync API of this deployment, if not production (dev)")
    ap.add_argument("--check-published", metavar="URL", help="fail if a changed script kept its @version")
    args = ap.parse_args()
    try:
        files = build(args.base, backend_url=args.backend_url)
    except ValueError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    if args.check_published:
        errors = check_published(files, args.check_published)
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        if errors:
            return 1
        print("version check passed")
    if args.out:
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        for name, content in files.items():
            (out / name).write_text(content, encoding="utf-8", newline="\n")
        print(f"wrote {len(files)} files to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
