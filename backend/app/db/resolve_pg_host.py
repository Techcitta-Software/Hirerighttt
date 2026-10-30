from __future__ import annotations

import socket


def resolve_pg_host(hostname: str) -> tuple[str, str | None]:
    try:
        infos = socket.getaddrinfo(hostname, 5432, type=socket.SOCK_STREAM)
        for info in infos:
            if info[0] == socket.AF_INET:
                return info[4][0], hostname
    except OSError:
        pass
    return hostname, None
