"""Per-request SSE transport; preserves the existing chat routing and billing path."""
from __future__ import annotations
import asyncio
import json
import logging
import threading
import time
from contextvars import ContextVar
from typing import Any, Callable
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

emit_text: ContextVar[Callable[[str], None] | None] = ContextVar('emit_text', default=None)
logger = logging.getLogger(__name__)

def stream_chat(run: Callable, request_id: str) -> StreamingResponse:
    async def events():
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        stopped = threading.Event()
        started = time.perf_counter()
        first_text = None
        def enqueue(event: str, data: Any):
            if not stopped.is_set():
                loop.call_soon_threadsafe(queue.put_nowait, (event, data))
        def emit(text: str):
            nonlocal first_text
            if stopped.is_set():
                raise asyncio.CancelledError()
            if text:
                if first_text is None:
                    first_text = time.perf_counter() - started
                enqueue('delta', {'text': text})
        def worker():
            token = emit_text.set(emit)
            try:
                result = asyncio.run(run())
                enqueue('done', result.model_dump(mode='json'))
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                logger.exception('Chat stream failed: %s', request_id)
                enqueue('error', {'message': exc.detail if isinstance(exc, HTTPException) else str(exc) if hasattr(exc, 'code') else 'Unable to complete the reply. Please try again.', 'code': getattr(exc, 'code', None)})
            finally:
                emit_text.reset(token)
                logger.info('chat_timing request=%s first_text_ms=%s total_ms=%.1f', request_id, round(first_text * 1000, 1) if first_text is not None else None, (time.perf_counter() - started) * 1000)
        task = asyncio.create_task(asyncio.to_thread(worker))
        try:
            yield 'event: ready\ndata: {}\n\n'
            while True:
                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=10)
                except asyncio.TimeoutError:
                    yield ': keepalive\n\n'
                    continue
                yield f'event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n'
                if event in ('done', 'error'):
                    break
        finally:
            stopped.set()
            # Provider iteration checks stopped at each emitted sentence. A blocking
            # provider connection remains bounded by its existing request timeout.
            if not task.done():
                task.cancel()
    return StreamingResponse(events(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no'})
