"""Resolve the database host to an address that really accepts connections.

Some ISP / router resolvers refuse or fail to resolve cloud database hostnames (for example Neon pooler hosts), even
though public DNS resolves them fine. When the system lookup fails we ask public DNS-over-HTTPS. Every candidate
address is probed with a short TCP connect before it is used, so a dead or bogus address is skipped. The caller
connects to the returned address while still sending the hostname for TLS (SNI), which Neon needs to route the
connection and which keeps certificate verification on.
"""

from __future__ import annotations

import json
import socket
import time
import urllib.request

_DOH_ENDPOINTS = (
    "https://dns.google/resolve?name={name}&type={rtype}",
    "https://cloudflare-dns.com/dns-query?name={name}&type={rtype}",
)
_CACHE_SECONDS = 300
_cache: dict[str, tuple[str, float]] = {}


def _system_lookup(hostname: str) -> list[str]:
    infos = socket.getaddrinfo(hostname, 5432, type=socket.SOCK_STREAM)
    ordered: list[str] = []
    for family in (socket.AF_INET, socket.AF_INET6):  # prefer IPv4, accept IPv6
        for info in infos:
            if info[0] == family and info[4][0] not in ordered:
                ordered.append(info[4][0])
    return ordered


def _doh_lookup_all(hostname: str) -> list[str]:
    found: list[str] = []
    for rtype, code in (("A", 1), ("AAAA", 28)):
        for template in _DOH_ENDPOINTS:
            try:
                req = urllib.request.Request(
                    template.format(name=hostname, rtype=rtype),
                    headers={"accept": "application/dns-json"},
                )
                with urllib.request.urlopen(req, timeout=5) as res:  # noqa: S310 - fixed https endpoints
                    data = json.loads(res.read().decode("utf-8"))
                added = False
                for answer in data.get("Answer") or []:
                    if answer.get("type") == code and answer.get("data") and answer["data"] not in found:
                        found.append(str(answer["data"]))
                        added = True
                if added:
                    break  # one provider answered for this record type
            except Exception:
                continue
    return found


def _doh_lookup(hostname: str) -> str | None:
    found = _doh_lookup_all(hostname)
    return found[0] if found else None


def _reachable(address: str, port: int = 5432, timeout: float = 3.0) -> bool:
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    sock = socket.socket(family, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        sock.connect((address, port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def _first_reachable(addresses: list[str]) -> str | None:
    for address in addresses:
        if _reachable(address):
            return address
    # Nothing answered a probe (firewall that drops probes, slow network): still prefer the first candidate.
    return None


def resolve_pg_host(hostname: str) -> tuple[str, str | None]:
    """Return (address, servername). servername is None when no address could be found (use the name as-is)."""
    cached = _cache.get(hostname)
    if cached and time.time() - cached[1] < _CACHE_SECONDS:
        return cached[0], hostname

    candidates: list[str] = []
    try:
        candidates = _system_lookup(hostname)
    except OSError:
        candidates = []
    chosen = _first_reachable(candidates) if candidates else None
    if not chosen:
        public = [a for a in _doh_lookup_all(hostname) if a not in candidates]
        chosen = _first_reachable(public)
        if not chosen:
            fallback = (candidates + public)[:1]
            chosen = fallback[0] if fallback else None
    if chosen:
        _cache[hostname] = (chosen, time.time())
        return chosen, hostname
    return hostname, None
