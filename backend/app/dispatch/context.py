from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Awaitable

from app.node_config import NodeConfig


@dataclass
class DispatchContext:
    config: NodeConfig
    is_prod_like: bool
    load_db: Callable[[], dict[str, Any]]
    save_db: Callable[[dict[str, Any] | None], Awaitable[None]]
    rate_limit: Callable[..., bool]
    client_ip: Callable[..., str]
