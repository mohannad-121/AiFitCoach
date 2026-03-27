from __future__ import annotations

import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

import numpy as np

try:
    import faiss  # type: ignore
except Exception:  # pragma: no cover - optional dependency at runtime
    faiss = None

try:
    from sentence_transformers import SentenceTransformer
except Exception:  # pragma: no cover - optional dependency at runtime
    SentenceTransformer = None

from nlp_utils import normalize_text, tokenize


logger = logging.getLogger(__name__)


class PersistentRagStore:
    def __init__(
        self,
        base_dir: Path | str,
        model_name: str = "paraphrase-multilingual-MiniLM-L12-v2",
    ) -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.model_name = model_name
        self._model: Any = None
        self._model_load_attempted = False

    def _safe_namespace(self, namespace: str) -> str:
        cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(namespace or "default")).strip("_")
        if cleaned:
            return cleaned[:80]
        return hashlib.sha1(str(namespace or "default").encode("utf-8")).hexdigest()[:20]

    def _namespace_dir(self, namespace: str) -> Path:
        path = self.base_dir / self._safe_namespace(namespace)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _documents_path(self, namespace: str) -> Path:
        return self._namespace_dir(namespace) / "documents.json"

    def _embeddings_path(self, namespace: str) -> Path:
        return self._namespace_dir(namespace) / "embeddings.npy"

    def _index_path(self, namespace: str) -> Path:
        return self._namespace_dir(namespace) / "faiss.index"

    def _load_documents(self, namespace: str) -> list[dict[str, Any]]:
        path = self._documents_path(namespace)
        if not path.exists():
            return []
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []
        except Exception as exc:
            logger.warning("Failed loading persistent RAG documents for %s: %s", namespace, exc)
            return []

    def list_documents(self, namespace: str, limit: Optional[int] = None) -> list[dict[str, Any]]:
        documents = self._load_documents(namespace)
        if limit is None or limit <= 0:
            return documents
        return documents[:limit]

    def namespace_stats(self, namespace: str) -> dict[str, Any]:
        documents = self._load_documents(namespace)
        embeddings = self._load_embeddings(namespace)
        return {
            "namespace": namespace,
            "documents": len(documents),
            "embeddings_ready": embeddings is not None and len(documents) == int(embeddings.shape[0]),
            "faiss_ready": self._index_path(namespace).exists(),
        }

    def _save_documents(self, namespace: str, documents: list[dict[str, Any]]) -> None:
        self._documents_path(namespace).write_text(
            json.dumps(documents, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _load_embeddings(self, namespace: str) -> Optional[np.ndarray]:
        path = self._embeddings_path(namespace)
        if not path.exists():
            return None
        try:
            return np.load(path)
        except Exception as exc:
            logger.warning("Failed loading persistent RAG embeddings for %s: %s", namespace, exc)
            return None

    def _save_embeddings(self, namespace: str, embeddings: np.ndarray) -> None:
        np.save(self._embeddings_path(namespace), embeddings)

    def _get_model(self) -> Any:
        if self._model_load_attempted:
            return self._model
        self._model_load_attempted = True
        if SentenceTransformer is None:
            logger.info("SentenceTransformer not available, persistent RAG will use lexical fallback")
            self._model = None
            return None
        try:
            self._model = SentenceTransformer(self.model_name)
        except Exception as exc:
            logger.warning("Failed loading RAG embedding model %s: %s", self.model_name, exc)
            self._model = None
        return self._model

    def _embed_texts(self, texts: list[str]) -> Optional[np.ndarray]:
        if not texts:
            return None
        model = self._get_model()
        if model is None:
            return None
        try:
            embeddings = model.encode(
                texts,
                convert_to_numpy=True,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            return np.asarray(embeddings, dtype=np.float32)
        except Exception as exc:
            logger.warning("Failed embedding persistent RAG texts: %s", exc)
            return None

    def _save_faiss_index(self, namespace: str, embeddings: np.ndarray) -> None:
        if faiss is None:
            return
        try:
            index = faiss.IndexFlatIP(int(embeddings.shape[1]))
            index.add(embeddings)
            faiss.write_index(index, str(self._index_path(namespace)))
        except Exception as exc:
            logger.warning("Failed saving FAISS index for %s: %s", namespace, exc)

    def _load_faiss_index(self, namespace: str):
        if faiss is None:
            return None
        path = self._index_path(namespace)
        if not path.exists():
            return None
        try:
            return faiss.read_index(str(path))
        except Exception as exc:
            logger.warning("Failed loading FAISS index for %s: %s", namespace, exc)
            return None

    def upsert_documents(
        self,
        namespace: str,
        documents: list[dict[str, Any]],
        replace: bool = False,
    ) -> dict[str, Any]:
        existing_docs = [] if replace else self._load_documents(namespace)
        merged: dict[str, dict[str, Any]] = {
            str(item.get("id") or f"doc_{index}"): item
            for index, item in enumerate(existing_docs)
            if isinstance(item, dict) and item.get("text")
        }

        for index, doc in enumerate(documents):
            if not isinstance(doc, dict):
                continue
            text = str(doc.get("text") or "").strip()
            if not text:
                continue
            doc_id = str(doc.get("id") or f"doc_{index}")
            merged[doc_id] = {
                "id": doc_id,
                "text": text,
                "metadata": doc.get("metadata") if isinstance(doc.get("metadata"), dict) else {},
            }

        ordered_docs = list(merged.values())
        self._save_documents(namespace, ordered_docs)

        embeddings = self._embed_texts([str(doc.get("text") or "") for doc in ordered_docs])
        if embeddings is not None and len(ordered_docs) == embeddings.shape[0]:
            self._save_embeddings(namespace, embeddings)
            self._save_faiss_index(namespace, embeddings)

        return {
            "namespace": namespace,
            "documents": len(ordered_docs),
            "embeddings_ready": embeddings is not None,
        }

    def _lexical_search(self, documents: list[dict[str, Any]], query: str, top_k: int) -> list[dict[str, Any]]:
        query_norm = normalize_text(query or "")
        query_tokens = set(tokenize(query_norm))
        if not query_tokens:
            return []

        scored: list[tuple[float, dict[str, Any]]] = []
        for doc in documents:
            text = str(doc.get("text") or "")
            text_norm = normalize_text(text)
            tokens = set(tokenize(text_norm))
            overlap = len(query_tokens.intersection(tokens))
            phrase_bonus = 2 if query_norm and query_norm in text_norm else 0
            if overlap <= 0 and phrase_bonus <= 0:
                continue
            score = float(overlap + phrase_bonus)
            scored.append((score, doc))

        scored.sort(key=lambda item: item[0], reverse=True)
        results = []
        for score, doc in scored[: max(1, top_k)]:
            results.append(
                {
                    "id": doc.get("id"),
                    "score": score,
                    "text": doc.get("text"),
                    "metadata": doc.get("metadata") or {},
                }
            )
        return results

    def search(self, namespace: str, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        documents = self._load_documents(namespace)
        if not documents:
            return []

        embeddings = self._load_embeddings(namespace)
        query_embedding = self._embed_texts([query])
        if embeddings is None or query_embedding is None or embeddings.shape[0] != len(documents):
            return self._lexical_search(documents, query, top_k)

        try:
            index = self._load_faiss_index(namespace)
            if index is not None:
                scores, indices = index.search(query_embedding, min(top_k, len(documents)))
                selected: list[dict[str, Any]] = []
                for score, idx in zip(scores[0], indices[0]):
                    if idx < 0 or idx >= len(documents):
                        continue
                    doc = documents[int(idx)]
                    selected.append(
                        {
                            "id": doc.get("id"),
                            "score": float(score),
                            "text": doc.get("text"),
                            "metadata": doc.get("metadata") or {},
                        }
                    )
                if selected:
                    return selected
        except Exception as exc:
            logger.warning("Failed FAISS search for %s: %s", namespace, exc)

        scores = np.dot(embeddings, query_embedding[0])
        order = np.argsort(scores)[::-1][: max(1, min(top_k, len(documents)))]
        results: list[dict[str, Any]] = []
        for idx in order:
            doc = documents[int(idx)]
            results.append(
                {
                    "id": doc.get("id"),
                    "score": float(scores[int(idx)]),
                    "text": doc.get("text"),
                    "metadata": doc.get("metadata") or {},
                }
            )
        return results


__all__ = ["PersistentRagStore"]