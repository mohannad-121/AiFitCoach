from __future__ import annotations

import io
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader

try:
    from rapidocr_onnxruntime import RapidOCR
except Exception:  # pragma: no cover - optional dependency
    RapidOCR = None


MAX_ATTACHMENTS = 4
MAX_FILE_SIZE_BYTES = 12 * 1024 * 1024
MAX_TEXT_CHARS = 12000
MAX_PDF_PAGES = 20
MAX_VISION_IMAGE_DIMENSION = 896
FAST_VISION_MAX_TOKENS = 180
SUPPORTED_IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
}


class AttachmentProcessingError(Exception):
    pass


@dataclass
class ProcessedAttachment:
    attachment_id: str
    filename: str
    content_type: str
    kind: str
    size_bytes: int
    summary: str
    extracted_text: str = ""
    ocr_text: str = ""
    vision_summary: str = ""
    page_count: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    warnings: Optional[list[str]] = None

    def to_payload(self) -> dict[str, Any]:
        return {
            "id": self.attachment_id,
            "filename": self.filename,
            "content_type": self.content_type,
            "kind": self.kind,
            "size_bytes": self.size_bytes,
            "summary": self.summary,
            "page_count": self.page_count,
            "width": self.width,
            "height": self.height,
            "warnings": self.warnings or [],
        }

    def to_rag_document(self) -> dict[str, Any]:
        parts = [
            f"Attachment filename: {self.filename}",
            f"Attachment kind: {self.kind}",
            f"Attachment summary: {self.summary}",
        ]
        if self.vision_summary:
            parts.append(f"Vision analysis: {self.vision_summary}")
        if self.ocr_text:
            parts.append(f"OCR text: {self.ocr_text}")
        if self.extracted_text:
            parts.append(f"Extracted text: {self.extracted_text}")
        return {
            "id": f"attachment_{self.attachment_id}",
            "text": "\n".join(parts),
            "metadata": {
                "kind": "attachment",
                "attachment_kind": self.kind,
                "filename": self.filename,
            },
        }


class AttachmentProcessor:
    def __init__(self, llm_client: Any):
        self.llm_client = llm_client
        self._ocr_engine: Any = None
        self._ocr_attempted = False

    def process_files(
        self,
        files: Iterable[dict[str, Any]],
        language: str,
        user_message: str,
    ) -> dict[str, Any]:
        items = list(files)
        if not items:
            raise AttachmentProcessingError("No files were uploaded.")
        if len(items) > MAX_ATTACHMENTS:
            raise AttachmentProcessingError(f"You can upload up to {MAX_ATTACHMENTS} files at a time.")

        processed = [self._process_single_file(file_info, language, user_message) for file_info in items]
        return {
            "summary": self._build_combined_summary(processed, language, user_message),
            "attachments": [item.to_payload() for item in processed],
            "documents": [item.to_rag_document() for item in processed],
            "used_ocr": any(bool(item.ocr_text) for item in processed),
            "used_vision": any(bool(item.vision_summary) for item in processed),
        }

    def _process_single_file(self, file_info: dict[str, Any], language: str, user_message: str) -> ProcessedAttachment:
        filename = str(file_info.get("filename") or "attachment")
        content_type = str(file_info.get("content_type") or "application/octet-stream").lower()
        data = file_info.get("bytes")
        if not isinstance(data, (bytes, bytearray)):
            raise AttachmentProcessingError(f"Uploaded file {filename} could not be read.")
        raw_bytes = bytes(data)
        if len(raw_bytes) > MAX_FILE_SIZE_BYTES:
            raise AttachmentProcessingError(
                f"{filename} is too large. Keep each file under {MAX_FILE_SIZE_BYTES // (1024 * 1024)} MB."
            )

        attachment_id = uuid.uuid4().hex[:12]
        if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
            return self._process_pdf(attachment_id, filename, content_type or "application/pdf", raw_bytes, language)
        if content_type in SUPPORTED_IMAGE_MIME_TYPES or self._looks_like_image_filename(filename):
            normalized_type = content_type if content_type in SUPPORTED_IMAGE_MIME_TYPES else "image/png"
            return self._process_image(attachment_id, filename, normalized_type, raw_bytes, language, user_message)
        raise AttachmentProcessingError(f"Unsupported file type for {filename}. Use PDF or common image formats.")

    def _process_pdf(
        self,
        attachment_id: str,
        filename: str,
        content_type: str,
        raw_bytes: bytes,
        language: str,
    ) -> ProcessedAttachment:
        warnings: list[str] = []
        try:
            reader = PdfReader(io.BytesIO(raw_bytes))
        except Exception as exc:
            raise AttachmentProcessingError(f"Could not open PDF {filename}: {exc}") from exc

        page_count = len(reader.pages)
        chunks: list[str] = []
        for page in reader.pages[:MAX_PDF_PAGES]:
            try:
                text = str(page.extract_text() or "").strip()
            except Exception:
                text = ""
            if text:
                chunks.append(text)

        extracted_text = self._trim_text("\n\n".join(chunks))
        if not extracted_text:
            warnings.append(
                "No selectable text was found in this PDF. If it is a scanned document, OCR is needed page by page."
            )

        summary = self._summarize_pdf(filename, extracted_text, page_count, language)
        return ProcessedAttachment(
            attachment_id=attachment_id,
            filename=filename,
            content_type=content_type,
            kind="pdf",
            size_bytes=len(raw_bytes),
            summary=summary,
            extracted_text=extracted_text,
            page_count=page_count,
            warnings=warnings,
        )

    def _process_image(
        self,
        attachment_id: str,
        filename: str,
        content_type: str,
        raw_bytes: bytes,
        language: str,
        user_message: str,
    ) -> ProcessedAttachment:
        warnings: list[str] = []
        width: Optional[int] = None
        height: Optional[int] = None
        try:
            with Image.open(io.BytesIO(raw_bytes)) as image:
                width, height = image.size
        except UnidentifiedImageError as exc:
            raise AttachmentProcessingError(f"Could not decode image {filename}.") from exc

        ocr_text = self._extract_ocr(raw_bytes)
        prefer_ocr_only = self._query_prefers_ocr(user_message) and len(ocr_text.strip()) >= 20
        vision_summary = "" if prefer_ocr_only else self._analyze_image(raw_bytes, content_type, filename, language, ocr_text)
        if not vision_summary and not ocr_text:
            warnings.append(
                "Vision analysis is unavailable for the active model, and no readable text was found in the image."
            )

        summary = self._summarize_image(filename, width, height, ocr_text, vision_summary, language)
        return ProcessedAttachment(
            attachment_id=attachment_id,
            filename=filename,
            content_type=content_type,
            kind="image",
            size_bytes=len(raw_bytes),
            summary=summary,
            ocr_text=self._trim_text(ocr_text, limit=4000),
            vision_summary=vision_summary,
            width=width,
            height=height,
            warnings=warnings,
        )

    def _extract_ocr(self, raw_bytes: bytes) -> str:
        engine = self._get_ocr_engine()
        if engine is None:
            return ""
        try:
            result, _elapsed = engine(raw_bytes)
        except Exception:
            return ""
        lines: list[str] = []
        for item in result or []:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                text_info = item[1]
                if isinstance(text_info, (list, tuple)) and text_info:
                    text = str(text_info[0] or "").strip()
                    if text:
                        lines.append(text)
        return self._trim_text("\n".join(lines), limit=4000)

    def _get_ocr_engine(self) -> Any:
        if self._ocr_attempted:
            return self._ocr_engine
        self._ocr_attempted = True
        if RapidOCR is None:
            self._ocr_engine = None
            return None
        try:
            self._ocr_engine = RapidOCR()
        except Exception:
            self._ocr_engine = None
        return self._ocr_engine

    def _analyze_image(
        self,
        raw_bytes: bytes,
        content_type: str,
        filename: str,
        language: str,
        ocr_text: str,
    ) -> str:
        prepared_bytes = self._prepare_image_for_vision(raw_bytes, content_type)
        prompt = self._image_analysis_prompt(filename, language, ocr_text)
        try:
            result = self.llm_client.analyze_image(prepared_bytes, content_type, prompt, max_tokens=FAST_VISION_MAX_TOKENS)
        except Exception:
            result = None
        if not result:
            return ""
        return self._trim_text(str(result).strip(), limit=3000)

    def _prepare_image_for_vision(self, raw_bytes: bytes, content_type: str) -> bytes:
        try:
            with Image.open(io.BytesIO(raw_bytes)) as image:
                converted = image.convert("RGB")
                width, height = converted.size
                longest = max(width, height)
                if longest > MAX_VISION_IMAGE_DIMENSION:
                    scale = MAX_VISION_IMAGE_DIMENSION / float(longest)
                    resized = converted.resize(
                        (max(1, int(width * scale)), max(1, int(height * scale))),
                        Image.Resampling.LANCZOS,
                    )
                else:
                    resized = converted
                buffer = io.BytesIO()
                resized.save(buffer, format="JPEG", quality=88, optimize=True)
                return buffer.getvalue()
        except Exception:
            return raw_bytes

    def _summarize_pdf(self, filename: str, extracted_text: str, page_count: int, language: str) -> str:
        if extracted_text:
            prompt = (
                "Summarize this uploaded PDF for a fitness coach. "
                "Highlight the key findings, metrics, restrictions, and actionable implications in 5 concise bullets.\n\n"
                f"Filename: {filename}\n"
                f"Pages: {page_count}\n"
                f"Document text:\n{extracted_text[:8000]}"
            )
            summary = self._llm_text_summary(prompt, language)
            if summary:
                return summary
        if language.startswith("ar"):
            return f"ملف PDF بعنوان {filename} يحتوي على {page_count} صفحات، لكن لم أستطع استخراج نص كافٍ لملخص غني."
        return f"PDF file {filename} has {page_count} pages, but there was not enough extractable text for a richer summary."

    def _summarize_image(
        self,
        filename: str,
        width: Optional[int],
        height: Optional[int],
        ocr_text: str,
        vision_summary: str,
        language: str,
    ) -> str:
        parts: list[str] = []
        if vision_summary:
            parts.append(vision_summary)
        if ocr_text:
            snippet = ocr_text[:500]
            label = "Detected text" if not language.startswith("ar") else "النص المستخرج"
            parts.append(f"{label}: {snippet}")
        if not parts:
            dims = f"{width}x{height}" if width and height else "unknown size"
            if language.startswith("ar"):
                return f"تم استلام الصورة {filename} بحجم {dims} لكن لم تتوفر نتيجة رؤية أو OCR كافية."
            return f"Received image {filename} at {dims}, but no strong OCR or vision result was available."
        return self._trim_text("\n".join(parts), limit=1200)

    def _llm_text_summary(self, prompt: str, language: str) -> str:
        messages = [
            {
                "role": "system",
                "content": (
                    "You summarize uploaded files for a professional AI fitness coach. "
                    "Be concise, specific, and action-oriented. "
                    + ("Respond in Arabic." if language.startswith("ar") else "Respond in English.")
                ),
            },
            {"role": "user", "content": prompt},
        ]
        try:
            result = str(self.llm_client.chat_completion(messages, max_tokens=320) or "").strip()
        except Exception:
            return ""
        if not result or result.startswith("Ollama error:") or result.startswith("Ollama is not reachable"):
            return ""
        return self._trim_text(result, limit=1500)

    def _build_combined_summary(
        self,
        processed: list[ProcessedAttachment],
        language: str,
        user_message: str,
    ) -> str:
        attachment_lines = [f"- {item.filename} ({item.kind}): {item.summary}" for item in processed]
        header = (
            "Current uploaded attachment intelligence for this chat:"
            if not language.startswith("ar")
            else "ملخص الملفات المرفوعة الحالية لهذه المحادثة:"
        )
        footer = (
            "Use this as primary evidence when answering the user about the uploaded material."
            if not language.startswith("ar")
            else "استخدم هذه النتائج كمرجع أساسي عند الرد على المستخدم بخصوص الملفات المرفوعة."
        )
        blocks = [header, *attachment_lines, footer]
        if user_message.strip():
            blocks.append(f"User request about attachments: {user_message.strip()}")
        return "\n".join(blocks)

    @staticmethod
    def _trim_text(value: str, limit: int = MAX_TEXT_CHARS) -> str:
        compact = re.sub(r"\s+", " ", value or "").strip()
        if len(compact) <= limit:
            return compact
        return compact[:limit].rstrip() + "..."

    @staticmethod
    def _looks_like_image_filename(filename: str) -> bool:
        return Path(filename).suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}

    @staticmethod
    def _query_prefers_ocr(user_message: str) -> bool:
        normalized = (user_message or "").strip().lower()
        keywords = {
            "read",
            "text",
            "label",
            "report",
            "scan",
            "screenshot",
            "what does this say",
            "ingredients",
            "nutrition facts",
            "calories",
            "اقرأ",
            "اقرا",
            "النص",
            "ماذا مكتوب",
            "مكتوب",
            "تقرير",
            "تحليل",
            "لقطة شاشة",
            "صورة شاشة",
            "ملصق",
        }
        return any(keyword in normalized for keyword in keywords)

    @staticmethod
    def _image_analysis_prompt(filename: str, language: str, ocr_text: str) -> str:
        base = (
            "Analyze this uploaded image for a fitness coach. "
            "Respond quickly and precisely. Identify the main visible subject, any readable labels or report details, and the most useful coaching implication. "
            "If something is uncertain, say so briefly."
            if not language.startswith("ar")
            else "حلل هذه الصورة المرفوعة لمدرب لياقة. رد بسرعة وبدقة. حدّد الشيء الأساسي الظاهر، وأي نص أو تقرير أو ملصق واضح، ثم اذكر أهم فائدة تدريبية أو غذائية. إذا كان هناك شيء غير مؤكد فاذكره باختصار."
        )
        if ocr_text:
            return f"{base}\n\nFilename: {filename}\n\nOCR text already extracted from the image:\n{ocr_text[:700]}"
        return f"{base}\n\nFilename: {filename}"