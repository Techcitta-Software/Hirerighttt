"""Fire-and-forget work that must not delay the HTTP response.

`asyncio.create_task` only keeps a weak reference to a task, so an un-referenced task can be garbage-collected before
it finishes. `spawn` keeps a strong reference until the task is done and logs failures (they used to vanish).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

logger = logging.getLogger("hireright.background")

_tasks: set[asyncio.Task] = set()


def _done(task: asyncio.Task) -> None:
    _tasks.discard(task)
    if task.cancelled():
        return
    err = task.exception()
    if err is not None:
        logger.error("Background task %s failed: %s", task.get_name(), err, exc_info=err)


def spawn(coro: Coroutine[Any, Any, Any], name: str = "background") -> asyncio.Task:
    task = asyncio.get_running_loop().create_task(coro, name=name)
    _tasks.add(task)
    task.add_done_callback(_done)
    return task


def pending_count() -> int:
    return len(_tasks)


async def drain(timeout: float = 10.0) -> None:
    """Wait for in-flight background work (tests, graceful shutdown)."""
    pending = [t for t in list(_tasks) if not t.done()]
    if pending:
        await asyncio.wait(pending, timeout=timeout)
