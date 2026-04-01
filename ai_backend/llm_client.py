from __future__ import annotations

import base64
import json
from typing import Any, Iterator

import requests
try:
    from openai import OpenAI
except Exception:  # pragma: no cover - optional dependency in Ollama-only setups
    OpenAI = None

from config import (
    LLM_MODEL,
    LLM_PROVIDER,
    LLM_TEMPERATURE,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT_SECONDS,
    OLLAMA_VISION_MODEL,
    OPENAI_API_KEY,
    OPENAI_VISION_MODEL,
)
from utils_logger import log_error


class LLMClient:
    """LLM wrapper supporting OpenAI and local Ollama."""

    def __init__(self, model: str = LLM_MODEL, temperature: float = LLM_TEMPERATURE):
        self.model = model
        self.temperature = temperature
        self.provider = (LLM_PROVIDER or "auto").lower()
        self.has_openai_key = bool(OPENAI_API_KEY) and (OpenAI is not None)
        self._openai_client = OpenAI(api_key=OPENAI_API_KEY) if self.has_openai_key else None

    @property
    def active_provider(self) -> str:
        if self.provider in {"openai", "ollama"}:
            return self.provider
        # auto mode: prefer OpenAI when key exists, otherwise Ollama.
        return "openai" if self.has_openai_key else "ollama"

    @property
    def active_model(self) -> str:
        if self.active_provider == "ollama":
            return OLLAMA_MODEL
        return self.model

    @property
    def active_vision_model(self) -> str | None:
        if self.active_provider == "openai":
            return OPENAI_VISION_MODEL
        candidate = str(OLLAMA_VISION_MODEL or "").strip() or OLLAMA_MODEL
        return candidate or None

    def chat_completion(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None = None,
        max_tokens: int | None = None,
        tools: list[dict[str, Any]] | None = None,
    ) -> str:
        provider = self.active_provider
        if provider == "openai":
            return self._chat_openai(messages, temperature, max_tokens, tools)
        return self._chat_ollama(messages, temperature, max_tokens)

    def chat_completion_stream(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> Iterator[str]:
        provider = self.active_provider
        if provider == "openai":
            yield from self._chat_openai_stream(messages, temperature, max_tokens)
            return
        yield from self._chat_ollama_stream(messages, temperature, max_tokens)

    def analyze_image(
        self,
        image_bytes: bytes,
        mime_type: str,
        prompt: str,
        max_tokens: int | None = None,
    ) -> str | None:
        provider = self.active_provider
        if provider == "openai":
            return self._analyze_image_openai(image_bytes, mime_type, prompt, max_tokens)
        return self._analyze_image_ollama(image_bytes, prompt, max_tokens)

    def _chat_openai(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None,
        max_tokens: int | None,
        tools: list[dict[str, Any]] | None,
    ) -> str:
        if not self.has_openai_key or self._openai_client is None:
            return (
                "OpenAI key is not configured. "
                "Use OPENAI_API_KEY or switch to Ollama (LLM_PROVIDER=ollama)."
            )

        try:
            accumulated_text = ""
            base_messages = [dict(message) for message in messages]

            for _attempt in range(3):
                request_messages = base_messages if not accumulated_text else [
                    *base_messages,
                    {"role": "assistant", "content": accumulated_text},
                    {
                        "role": "user",
                        "content": "Continue exactly from where you stopped. Do not repeat anything. Finish the answer.",
                    },
                ]
                params: dict[str, Any] = {
                    "model": self.model,
                    "messages": request_messages,
                    "temperature": self.temperature if temperature is None else temperature,
                }
                if max_tokens is not None:
                    params["max_tokens"] = max_tokens
                if tools and not accumulated_text:
                    params["tools"] = tools
                    params["tool_choice"] = "auto"

                response = self._openai_client.chat.completions.create(**params)
                choice = response.choices[0]
                new_text = choice.message.content or ""
                accumulated_text = self._append_ollama_text(accumulated_text, new_text)
                if not self._openai_needs_continuation(choice):
                    break

            return accumulated_text.strip()
        except Exception as exc:
            log_error("LLM_OPENAI_COMPLETION_ERROR", None, exc, {"messages": len(messages)})
            return "I hit a temporary AI error. Please try again."

    def _chat_openai_stream(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None,
        max_tokens: int | None,
    ) -> Iterator[str]:
        if not self.has_openai_key or self._openai_client is None:
            yield (
                "OpenAI key is not configured. "
                "Use OPENAI_API_KEY or switch to Ollama (LLM_PROVIDER=ollama)."
            )
            return

        try:
            params: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "temperature": self.temperature if temperature is None else temperature,
                "stream": True,
            }
            if max_tokens is not None:
                params["max_tokens"] = max_tokens

            stream = self._openai_client.chat.completions.create(**params)
            for chunk in stream:
                delta = chunk.choices[0].delta.content
                if delta:
                    yield delta
        except Exception as exc:
            log_error("LLM_OPENAI_STREAM_ERROR", None, exc, {"messages": len(messages)})
            yield "I hit a temporary AI streaming error. Please try again."

    def _analyze_image_openai(
        self,
        image_bytes: bytes,
        mime_type: str,
        prompt: str,
        max_tokens: int | None,
    ) -> str | None:
        if not self.has_openai_key or self._openai_client is None:
            return None

        params: dict[str, Any] = {
            "model": OPENAI_VISION_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": (
                                    f"data:{mime_type};base64,"
                                    f"{base64.b64encode(image_bytes).decode('utf-8')}"
                                )
                            },
                        },
                    ],
                }
            ],
            "temperature": 0.2,
        }
        if max_tokens is not None:
            params["max_tokens"] = max_tokens
        try:
            response = self._openai_client.chat.completions.create(**params)
            text = str(response.choices[0].message.content or "").strip()
            return text or None
        except Exception as exc:
            log_error("LLM_OPENAI_VISION_ERROR", None, exc, {"model": OPENAI_VISION_MODEL})
            return None

    def _chat_ollama(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None,
        max_tokens: int | None,
    ) -> str:
        try:
            accumulated_text = ""
            base_messages = [dict(message) for message in messages]

            for _attempt in range(3):
                request_messages = base_messages if not accumulated_text else [
                    *base_messages,
                    {"role": "assistant", "content": accumulated_text},
                    {
                        "role": "user",
                        "content": "Continue exactly from where you stopped. Do not repeat anything. Finish the answer.",
                    },
                ]
                payload = {
                    "model": OLLAMA_MODEL,
                    "messages": request_messages,
                    "stream": False,
                    "options": {
                        "temperature": self.temperature if temperature is None else temperature,
                        "num_ctx": self._ollama_num_ctx(max_tokens),
                    },
                }
                if max_tokens is not None:
                    payload["options"]["num_predict"] = max_tokens

                response = requests.post(
                    f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat",
                    json=payload,
                    timeout=OLLAMA_TIMEOUT_SECONDS,
                )
                if response.status_code == 404:
                    # Older Ollama builds expose /api/generate only.
                    return self._chat_ollama_generate(messages, temperature, max_tokens)
                if response.status_code >= 400:
                    return self._format_ollama_http_error(response)
                response.raise_for_status()
                data = response.json()
                new_text = str(data.get("message", {}).get("content", "")).strip()
                accumulated_text = self._append_ollama_text(accumulated_text, new_text)
                if not self._ollama_needs_continuation(data):
                    break

            return accumulated_text.strip()
        except Exception as exc:
            log_error(
                "LLM_OLLAMA_COMPLETION_ERROR",
                None,
                exc,
                {"base_url": OLLAMA_BASE_URL, "model": OLLAMA_MODEL},
            )
            return (
                "Ollama is not reachable. Start Ollama and pull a model, for example:\n"
                "ollama pull llama3.1:8b\n"
                "Then keep Ollama running on http://127.0.0.1:11434."
            )

    def _chat_ollama_stream(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None,
        max_tokens: int | None,
    ) -> Iterator[str]:
        payload = {
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": self.temperature if temperature is None else temperature,
                "num_ctx": self._ollama_num_ctx(max_tokens),
            },
        }
        if max_tokens is not None:
            payload["options"]["num_predict"] = max_tokens

        try:
            with requests.post(
                f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat",
                json=payload,
                timeout=OLLAMA_TIMEOUT_SECONDS,
                stream=True,
            ) as response:
                if response.status_code == 404:
                    yield from self._chat_ollama_generate_stream(messages, temperature, max_tokens)
                    return
                if response.status_code >= 400:
                    yield self._format_ollama_http_error(response)
                    return
                response.raise_for_status()
                for raw_line in response.iter_lines(decode_unicode=True):
                    if not raw_line:
                        continue
                    try:
                        line = json.loads(raw_line)
                    except Exception:
                        continue
                    text = str(line.get("message", {}).get("content", ""))
                    if text:
                        yield text
        except Exception as exc:
            log_error(
                "LLM_OLLAMA_STREAM_ERROR",
                None,
                exc,
                {"base_url": OLLAMA_BASE_URL, "model": OLLAMA_MODEL},
            )
            yield "Ollama streaming is unavailable right now. Please retry."

    def _analyze_image_ollama(
        self,
        image_bytes: bytes,
        prompt: str,
        max_tokens: int | None,
    ) -> str | None:
        vision_model = str(OLLAMA_VISION_MODEL or "").strip() or OLLAMA_MODEL
        if not self._ollama_model_supports_vision(vision_model):
            return None

        payload = {
            "model": vision_model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "images": [base64.b64encode(image_bytes).decode("utf-8")],
                }
            ],
            "stream": False,
            "options": {
                "temperature": 0.2,
                "num_ctx": self._ollama_num_ctx(max_tokens),
            },
        }
        if max_tokens is not None:
            payload["options"]["num_predict"] = max_tokens
        try:
            response = requests.post(
                f"{OLLAMA_BASE_URL.rstrip('/')}/api/chat",
                json=payload,
                timeout=OLLAMA_TIMEOUT_SECONDS,
            )
            if response.status_code >= 400:
                return None
            response.raise_for_status()
            data = response.json()
            text = str(data.get("message", {}).get("content", "")).strip()
            return text or None
        except Exception as exc:
            log_error("LLM_OLLAMA_VISION_ERROR", None, exc, {"model": vision_model})
            return None

    @staticmethod
    def _messages_to_prompt(messages: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for msg in messages:
            role = str(msg.get("role", "user")).strip().lower()
            content = str(msg.get("content", "")).strip()
            if not content:
                continue
            if role == "system":
                lines.append(f"System: {content}")
            elif role == "assistant":
                lines.append(f"Assistant: {content}")
            else:
                lines.append(f"User: {content}")
        lines.append("Assistant:")
        return "\n\n".join(lines)

    def _chat_ollama_generate(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None,
        max_tokens: int | None,
    ) -> str:
        accumulated_text = ""
        base_messages = [dict(message) for message in messages]

        for _attempt in range(3):
            request_messages = base_messages if not accumulated_text else [
                *base_messages,
                {"role": "assistant", "content": accumulated_text},
                {
                    "role": "user",
                    "content": "Continue exactly from where you stopped. Do not repeat anything. Finish the answer.",
                },
            ]
            payload = {
                "model": OLLAMA_MODEL,
                "prompt": self._messages_to_prompt(request_messages),
                "stream": False,
                "options": {
                    "temperature": self.temperature if temperature is None else temperature,
                    "num_ctx": self._ollama_num_ctx(max_tokens),
                },
            }
            if max_tokens is not None:
                payload["options"]["num_predict"] = max_tokens

            response = requests.post(
                f"{OLLAMA_BASE_URL.rstrip('/')}/api/generate",
                json=payload,
                timeout=OLLAMA_TIMEOUT_SECONDS,
            )
            if response.status_code >= 400:
                return self._format_ollama_http_error(response)
            response.raise_for_status()
            data = response.json()
            new_text = str(data.get("response", "")).strip()
            accumulated_text = self._append_ollama_text(accumulated_text, new_text)
            if not self._ollama_needs_continuation(data):
                break

        return accumulated_text.strip()

    def _chat_ollama_generate_stream(
        self,
        messages: list[dict[str, Any]],
        temperature: float | None,
        max_tokens: int | None,
    ) -> Iterator[str]:
        payload = {
            "model": OLLAMA_MODEL,
            "prompt": self._messages_to_prompt(messages),
            "stream": True,
            "options": {
                "temperature": self.temperature if temperature is None else temperature,
                "num_ctx": self._ollama_num_ctx(max_tokens),
            },
        }
        if max_tokens is not None:
            payload["options"]["num_predict"] = max_tokens

        with requests.post(
            f"{OLLAMA_BASE_URL.rstrip('/')}/api/generate",
            json=payload,
            timeout=OLLAMA_TIMEOUT_SECONDS,
            stream=True,
        ) as response:
            if response.status_code >= 400:
                yield self._format_ollama_http_error(response)
                return
            response.raise_for_status()
            for raw_line in response.iter_lines(decode_unicode=True):
                if not raw_line:
                    continue
                try:
                    line = json.loads(raw_line)
                except Exception:
                    continue
                text = str(line.get("response", ""))
                if text:
                    yield text

    @staticmethod
    def _ollama_num_ctx(max_tokens: int | None) -> int:
        if (max_tokens or 0) > 480:
            return 3072
        if (max_tokens or 0) > 240:
            return 2048
        if (max_tokens or 0) > 160:
            return 1536
        return 1024

    @staticmethod
    def _ollama_needs_continuation(payload: dict[str, Any]) -> bool:
        done_reason = str(payload.get("done_reason", "")).strip().lower()
        return done_reason in {"length", "max_tokens"}

    @staticmethod
    def _ollama_model_supports_vision(model_name: str) -> bool:
        normalized = str(model_name or "").strip().lower()
        return any(tag in normalized for tag in ("llava", "vision", "gemma3", "minicpm-v", "qwen2.5vl", "qwen2-vl", "bakllava"))

    @staticmethod
    def _openai_needs_continuation(choice: Any) -> bool:
        finish_reason = str(getattr(choice, "finish_reason", "") or "").strip().lower()
        return finish_reason == "length"

    @staticmethod
    def _append_ollama_text(existing: str, new_text: str) -> str:
        if not existing:
            return new_text.strip()
        if not new_text:
            return existing.strip()
        if existing.endswith((" ", "\n")) or new_text.startswith((" ", "\n", ".", ",", ":", ";", "!", "?")):
            return f"{existing}{new_text}".strip()
        return f"{existing} {new_text}".strip()

    @staticmethod
    def _format_ollama_http_error(response: requests.Response) -> str:
        detail = ""
        try:
            payload = response.json()
            if isinstance(payload, dict):
                detail = str(payload.get("error", "")).strip()
        except Exception:
            detail = (response.text or "").strip()

        if detail:
            return (
                f"Ollama error: {detail}\n"
                f"Check your local model runtime with: ollama run {OLLAMA_MODEL}\n"
                "Then retry your message."
            )
        return (
            f"Ollama request failed with status {response.status_code}.\n"
            f"Check your local model runtime with: ollama run {OLLAMA_MODEL}"
        )

    @staticmethod
    def create_tool_definition(
        name: str,
        description: str,
        parameters: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": {
                    "type": "object",
                    "properties": parameters.get("properties", {}),
                    "required": parameters.get("required", []),
                },
            },
        }
