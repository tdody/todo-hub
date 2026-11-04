"""Client logos for the app: the client's site icon, downloaded once and kept on this Mac.

The client label -> website mapping is client_domains.json in the settings folder; it stays
on this Mac, out of the repo. Icons are cached in <settings>/logos/. A site with no usable
icon is remembered for a week, so it isn't asked again on every launch.
The app shows initials whenever there's no logo.
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from .config import Settings

MISS_TTL = 7 * 86400
MAX_BYTES = 200_000
SOURCES = (
    "https://www.google.com/s2/favicons?domain={domain}&sz=64",
    "https://icons.duckduckgo.com/ip3/{domain}.ico",
)


def domains(settings: Settings) -> dict[str, str | None]:
    """The user's client_domains.json; empty when there is none."""
    path = settings.home / "client_domains.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except ValueError:
        return {}


def _paths(settings: Settings, domain: str) -> tuple[Path, Path]:
    key = hashlib.sha1(domain.lower().encode()).hexdigest()[:16]
    folder = settings.home / "logos"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{key}.img", folder / f"{key}.missing"


def _sniff(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG"):
        return "image/png"
    if data[:4] == b"\x00\x00\x01\x00":
        return "image/x-icon"
    if data[:3] == b"GIF":
        return "image/gif"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None   # SVG and anything else: not used (an SVG could carry script)


def _download(domain: str, client: httpx.Client) -> bytes | None:
    for url in SOURCES:
        try:
            r = client.get(url.format(domain=domain), follow_redirects=True)
        except httpx.HTTPError:
            continue
        # Google answers unknown sites with a 404 and a generic globe; skip that.
        if r.status_code == 200 and 100 < len(r.content) <= MAX_BYTES and _sniff(r.content):
            return r.content
    return None


def logo_data_uri(settings: Settings, domain: str, client: httpx.Client | None = None) -> str | None:
    img, missing = _paths(settings, domain)
    if not img.exists():
        if missing.exists() and time.time() - missing.stat().st_mtime < MISS_TTL:
            return None
        own = client is None
        client = client or httpx.Client(timeout=6, headers={"User-Agent": "TodoHub/0.1"})
        try:
            data = _download(domain, client)
        finally:
            if own:
                client.close()
        if not data:
            missing.touch()
            return None
        img.write_bytes(data)
        missing.unlink(missing_ok=True)
    data = img.read_bytes()
    mime = _sniff(data)
    return f"data:{mime};base64,{base64.b64encode(data).decode()}" if mime else None


def logos_for(settings: Settings, clients: list[str]) -> dict[str, str | None]:
    mapping = domains(settings)
    wanted = {c: mapping.get(c) for c in dict.fromkeys(clients)}
    out: dict[str, str | None] = {c: None for c in wanted}
    todo = {c: d for c, d in wanted.items() if d}
    if not todo:
        return out
    with httpx.Client(timeout=6, headers={"User-Agent": "TodoHub/0.1"}) as client, \
            ThreadPoolExecutor(max_workers=8) as pool:
        results = pool.map(lambda item: (item[0], logo_data_uri(settings, item[1], client)), todo.items())
        out.update(dict(results))
    return out
