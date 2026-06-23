from __future__ import annotations

import io
import os
import re
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError
from pypdf import PdfReader

try:
    import fitz  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    fitz = None

try:
    from rapidocr_onnxruntime import RapidOCR
except Exception:  # pragma: no cover - optional dependency
    RapidOCR = None


MAX_ATTACHMENTS = 4
MAX_FILE_SIZE_BYTES = 12 * 1024 * 1024
MAX_TEXT_CHARS = 120000
MAX_ATTACHMENT_SUMMARY_CHARS = 24000
MAX_ATTACHMENT_RAG_CHUNK_CHARS = 3500
MAX_ATTACHMENT_RAG_CHUNKS = 24
MAX_PDF_OCR_PAGES = 120
MAX_VISION_IMAGE_DIMENSION = 768
SCREENSHOT_VISION_IMAGE_DIMENSION = 1536
FAST_VISION_MAX_TOKENS = 180
GENERAL_VISION_MAX_TOKENS = 64
SCREENSHOT_VISION_MAX_TOKENS = 140
OCR_ONLY_MIN_CHARS = 20
TEXT_HEAVY_OCR_MIN_CHARS = 120
SCREENSHOT_OCR_MIN_CHARS = 40
SCREENSHOT_HINT_KEYWORDS = {
    "screenshot",
    "screen shot",
    "screen-shot",
    "capture",
    "snip",
    "snipping",
    "ui",
    "interface",
    "dashboard",
    "app",
    "website",
    "page",
    "لقطة",
    "سكرين",
}
REPORT_HINT_KEYWORDS = {
    "report",
    "lab",
    "labs",
    "blood",
    "test",
    "result",
    "results",
    "scan",
    "mri",
    "xray",
    "x-ray",
    "dexa",
    "inbody",
    "body composition",
    "medical",
    "cbc",
    "glucose",
    "cholesterol",
    "hemoglobin",
    "تقرير",
    "تحليل",
    "نتيجة",
    "نتائج",
    "مختبر",
    "فحص",
}
LABEL_HINT_KEYWORDS = {
    "label",
    "nutrition facts",
    "ingredients",
    "serving",
    "servings",
    "barcode",
    "package",
    "packaging",
    "calories",
    "protein",
    "carb",
    "carbs",
    "fat",
    "sugar",
    "sodium",
    "fiber",
    "product",
    "ملصق",
    "مكونات",
    "سعرات",
    "بروتين",
    "دهون",
    "كارب",
    "سكر",
}
PROGRESS_PHOTO_HINT_KEYWORDS = {
    "progress",
    "before after",
    "before/after",
    "physique",
    "body",
    "pose",
    "posing",
    "front relaxed",
    "back relaxed",
    "shirtless",
    "mirror selfie",
    "check-in",
    "check in",
    "comparison",
    "progress photo",
    "photo update",
    "صورة تقدم",
    "تقدم",
    "مقارنة",
    "جسم",
}
FOOD_HINT_KEYWORDS = {
    "food",
    "meal",
    "plate",
    "dish",
    "snack",
    "drink",
    "smoothie",
    "breakfast",
    "lunch",
    "dinner",
    "fruit",
    "rice",
    "chicken",
    "beef",
    "salad",
    "burger",
    "pizza",
    "وجبة",
    "طعام",
    "طبق",
    "أكل",
    "فطور",
    "غداء",
    "عشاء",
}
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
    document_chunks: Optional[list[str]] = None

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

    def to_rag_documents(self) -> list[dict[str, Any]]:
        base_text = "\n".join(
            [
                f"Attachment filename: {self.filename}",
                f"Attachment kind: {self.kind}",
                f"Attachment summary: {self.summary}",
            ]
        )
        documents = [
            {
                "id": f"attachment_{self.attachment_id}",
                "text": base_text,
                "metadata": {
                    "kind": "attachment",
                    "attachment_kind": self.kind,
                    "filename": self.filename,
                },
            }
        ]

        chunk_source = self.document_chunks or []
        if not chunk_source:
            chunk_parts: list[str] = []
            if self.vision_summary:
                chunk_parts.append(f"Vision analysis: {self.vision_summary}")
            if self.ocr_text:
                chunk_parts.append(f"OCR text: {self.ocr_text}")
            if self.extracted_text:
                chunk_parts.append(f"Extracted text: {self.extracted_text}")
            if chunk_parts:
                chunk_source = ["\n".join(chunk_parts)]

        for index, chunk in enumerate(chunk_source[:MAX_ATTACHMENT_RAG_CHUNKS]):
            clean_chunk = str(chunk or "").strip()
            if not clean_chunk:
                continue
            documents.append(
                {
                    "id": f"attachment_{self.attachment_id}_chunk_{index}",
                    "text": clean_chunk,
                    "metadata": {
                        "kind": "attachment",
                        "attachment_kind": self.kind,
                        "filename": self.filename,
                        "chunk_index": index,
                    },
                }
            )
        return documents


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
            "documents": [doc for item in processed for doc in item.to_rag_documents()],
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
        page_texts: list[str] = []
        missing_text_pages: list[int] = []

        for page_index, page in enumerate(reader.pages):
            try:
                text = str(page.extract_text() or "").strip()
            except Exception:
                text = ""
            if text:
                page_texts.append(f"Page {page_index + 1}: {self._trim_text(text, limit=8000)}")
            else:
                page_texts.append("")
                missing_text_pages.append(page_index)

        ocr_pages_used = 0
        if missing_text_pages:
            if fitz is None:
                warnings.append(
                    "Some PDF pages do not contain selectable text. Install PyMuPDF to OCR scanned PDF pages automatically."
                )
            else:
                for page_index in missing_text_pages[:MAX_PDF_OCR_PAGES]:
                    ocr_text = self._extract_pdf_page_ocr(raw_bytes, page_index)
                    if ocr_text:
                        page_texts[page_index] = f"Page {page_index + 1}: {self._trim_text(ocr_text, limit=8000)}"
                        ocr_pages_used += 1

        extracted_pages = [page_text for page_text in page_texts if page_text.strip()]
        extracted_text = "\n\n".join(extracted_pages)
        if not extracted_text:
            warnings.append(
                "No selectable text was found in this PDF. If it is a scanned document, OCR is needed page by page."
            )
        elif missing_text_pages and ocr_pages_used < len(missing_text_pages):
            unresolved_pages = len(missing_text_pages) - ocr_pages_used
            warnings.append(f"{unresolved_pages} PDF pages still could not be extracted cleanly.")

        summary = self._summarize_pdf(filename, extracted_text, page_count, language)
        return ProcessedAttachment(
            attachment_id=attachment_id,
            filename=filename,
            content_type=content_type,
            kind="pdf",
            size_bytes=len(raw_bytes),
            summary=summary,
            extracted_text=self._trim_text(extracted_text),
            page_count=page_count,
            warnings=warnings,
            document_chunks=self._chunk_attachment_text(extracted_text),
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

        mode_hint = self._infer_image_analysis_mode(filename, user_message, "")
        should_attempt_ocr = self._should_attempt_ocr(filename, user_message, mode_hint)
        ocr_text = ""
        if should_attempt_ocr:
            ocr_text = self._extract_ocr(raw_bytes, filename=filename, user_message=user_message)
        prefer_ocr_only = self._should_prefer_ocr_only(filename, width, height, user_message, ocr_text)
        vision_summary = "" if prefer_ocr_only else self._analyze_image(
            raw_bytes,
            content_type,
            filename,
            language,
            user_message,
            ocr_text,
        )
        if not vision_summary and not prefer_ocr_only:
            warnings.append("Vision model did not return a usable description for this image.")
        if should_attempt_ocr and not ocr_text:
            warnings.append("OCR did not extract readable text from this image.")
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

    def _extract_ocr(
        self,
        raw_bytes: bytes,
        filename: str = "",
        user_message: str = "",
    ) -> str:
        engine = self._get_ocr_engine()
        if engine is None:
            return ""

        best_text = ""
        for candidate_bytes in self._ocr_candidate_images(raw_bytes, filename, user_message):
            try:
                result, _elapsed = engine(candidate_bytes)
            except Exception:
                continue
            lines: list[str] = []
            for item in result or []:
                if isinstance(item, (list, tuple)) and len(item) >= 2:
                    text_info = item[1]
                    if isinstance(text_info, (list, tuple)) and text_info:
                        text = str(text_info[0] or "").strip()
                        if text:
                            lines.append(text)
            joined = self._trim_text("\n".join(lines), limit=4000)
            if len(self._normalize_ocr_text(joined)) > len(self._normalize_ocr_text(best_text)):
                best_text = joined
            if len(self._normalize_ocr_text(best_text)) >= TEXT_HEAVY_OCR_MIN_CHARS:
                break

        if len(self._normalize_ocr_text(best_text)) >= SCREENSHOT_OCR_MIN_CHARS:
            return best_text

        if self._looks_like_screenshot(filename) or self._query_prefers_ocr(user_message):
            for candidate_bytes in self._ocr_candidate_images(raw_bytes, filename, user_message):
                windows_ocr = self._extract_windows_ocr(candidate_bytes)
                if len(self._normalize_ocr_text(windows_ocr)) > len(self._normalize_ocr_text(best_text)):
                    best_text = self._trim_text(windows_ocr, limit=4000)
                if len(self._normalize_ocr_text(best_text)) >= SCREENSHOT_OCR_MIN_CHARS:
                    break

        return best_text

    def _extract_windows_ocr(self, raw_bytes: bytes) -> str:
        if os.name != "nt":
            return ""

        powershell_script = r"""
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod } | Select-Object -First 1)
function Await($op, [type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait()
  return $task.Result
}
$imagePath = $args[0]
$outputPath = $args[1]
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  Set-Content -Path $outputPath -Value ''
  exit 0
}
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
Set-Content -Path $outputPath -Value $result.Text
"""

        try:
            with tempfile.TemporaryDirectory(prefix="fitcoach-winocr-") as temp_dir:
                image_path = Path(temp_dir) / "input.png"
                output_path = Path(temp_dir) / "output.txt"
                script_path = Path(temp_dir) / "ocr.ps1"

                with Image.open(io.BytesIO(raw_bytes)) as image:
                    image.convert("RGB").save(image_path, format="PNG", optimize=True)

                script_path.write_text(powershell_script, encoding="utf-8")
                completed = subprocess.run(
                    [
                        "powershell",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-File",
                        str(script_path),
                        str(image_path),
                        str(output_path),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=45,
                    check=False,
                )
                if completed.returncode != 0 or not output_path.exists():
                    return ""
                return self._normalize_ocr_text(output_path.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            return ""

    def _ocr_candidate_images(self, raw_bytes: bytes, filename: str, user_message: str) -> list[bytes]:
        candidates = [raw_bytes]
        if not self._looks_like_screenshot(filename) and not self._query_prefers_ocr(user_message):
            return candidates
        try:
            with Image.open(io.BytesIO(raw_bytes)) as image:
                grayscale = ImageOps.grayscale(image)
                enhanced = ImageOps.autocontrast(grayscale)
                base_width, base_height = enhanced.size
                upscale = 2 if max(base_width, base_height) < 2200 else 1
                if upscale > 1:
                    enhanced = enhanced.resize(
                        (max(1, base_width * upscale), max(1, base_height * upscale)),
                        Image.Resampling.LANCZOS,
                    )
                sharpened = enhanced.filter(ImageFilter.SHARPEN)
                thresholded = sharpened.point(lambda px: 255 if px > 160 else 0)
                for variant in (enhanced, sharpened, thresholded):
                    buffer = io.BytesIO()
                    variant.save(buffer, format="PNG", optimize=True)
                    candidate = buffer.getvalue()
                    if candidate and candidate not in candidates:
                        candidates.append(candidate)
        except Exception:
            return candidates
        return candidates

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

    def _extract_pdf_page_ocr(self, raw_bytes: bytes, page_index: int) -> str:
        engine = self._get_ocr_engine()
        if engine is None or fitz is None:
            return ""
        try:
            with fitz.open(stream=raw_bytes, filetype="pdf") as document:
                if page_index < 0 or page_index >= len(document):
                    return ""
                page = document.load_page(page_index)
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                image_bytes = pixmap.tobytes("png")
        except Exception:
            return ""
        return self._extract_ocr(image_bytes)

    def _analyze_image(
        self,
        raw_bytes: bytes,
        content_type: str,
        filename: str,
        language: str,
        user_message: str,
        ocr_text: str,
    ) -> str:
        mode = self._infer_image_analysis_mode(filename, user_message, ocr_text)
        prepared_bytes = self._prepare_image_for_vision(raw_bytes, content_type, mode)
        prompt = self._image_analysis_prompt(filename, language, user_message, ocr_text)
        fallback_prompt = self._fallback_image_analysis_prompt(filename, language, user_message, ocr_text)
        has_meaningful_ocr = len(self._normalize_ocr_text(ocr_text)) >= TEXT_HEAVY_OCR_MIN_CHARS

        attempts = [(prepared_bytes, "image/png", prompt)]
        if not has_meaningful_ocr:
            attempts.append((prepared_bytes, "image/png", fallback_prompt))
        if mode == "screenshot" and not has_meaningful_ocr:
            attempts.append(
                (
                    prepared_bytes,
                    "image/png",
                    self._fallback_image_analysis_prompt(filename, language, user_message, ocr_text, mode_override="general"),
                )
            )
        for candidate_bytes, candidate_type, candidate_prompt in attempts:
            try:
                result = self.llm_client.analyze_image(
                    candidate_bytes,
                    candidate_type,
                    candidate_prompt,
                    max_tokens=self._vision_max_tokens(mode, has_meaningful_ocr),
                )
            except Exception:
                result = None
            cleaned = self._trim_text(str(result or "").strip(), limit=3000)
            if cleaned:
                return cleaned
        return ""

    def _vision_max_tokens(self, mode: str, has_meaningful_ocr: bool) -> int:
        if mode == "general":
            return GENERAL_VISION_MAX_TOKENS
        if mode in {"screenshot", "report", "label"} and not has_meaningful_ocr:
            return SCREENSHOT_VISION_MAX_TOKENS
        return FAST_VISION_MAX_TOKENS

    def _prepare_image_for_vision(self, raw_bytes: bytes, content_type: str, mode: str) -> bytes:
        try:
            with Image.open(io.BytesIO(raw_bytes)) as image:
                converted = image.convert("RGB")
                width, height = converted.size
                longest = max(width, height)
                max_dimension = SCREENSHOT_VISION_IMAGE_DIMENSION if mode in {"screenshot", "report"} else MAX_VISION_IMAGE_DIMENSION
                if longest > max_dimension:
                    scale = max_dimension / float(longest)
                    resized = converted.resize(
                        (max(1, int(width * scale)), max(1, int(height * scale))),
                        Image.Resampling.LANCZOS,
                    )
                else:
                    resized = converted
                buffer = io.BytesIO()
                resized.save(buffer, format="PNG", optimize=True)
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

    def _chunk_attachment_text(self, value: str, limit: int = MAX_ATTACHMENT_RAG_CHUNK_CHARS) -> list[str]:
        compact = str(value or "").strip()
        if not compact:
            return []

        chunks: list[str] = []
        current = ""
        segments = re.split(r"(?=Page\s+\d+:)", compact)
        for segment in segments:
            part = str(segment or "").strip()
            if not part:
                continue
            if len(part) > limit:
                if current:
                    chunks.append(current)
                    current = ""
                for start in range(0, len(part), limit):
                    chunks.append(part[start : start + limit].strip())
                continue
            candidate = f"{current}\n\n{part}".strip() if current else part
            if len(candidate) <= limit:
                current = candidate
                continue
            chunks.append(current)
            current = part

        if current:
            chunks.append(current)
        return chunks[:MAX_ATTACHMENT_RAG_CHUNKS]

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
            "question",
            "answer this",
            "answer the question",
            "what does this say",
            "ingredients",
            "nutrition facts",
            "calories",
            "اقرأ",
            "اقرا",
            "السؤال",
            "جاوب",
            "أجب",
            "اجب",
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
    def _normalize_ocr_text(value: str) -> str:
        return re.sub(r"\s+", " ", value or "").strip()

    @staticmethod
    def _normalize_for_matching(*parts: str) -> str:
        return " ".join(str(part or "").strip().lower() for part in parts if str(part or "").strip())

    def _should_prefer_ocr_only(
        self,
        filename: str,
        width: Optional[int],
        height: Optional[int],
        user_message: str,
        ocr_text: str,
    ) -> bool:
        normalized_ocr = self._normalize_ocr_text(ocr_text)
        if len(normalized_ocr) < OCR_ONLY_MIN_CHARS:
            return False
        if self._query_prefers_ocr(user_message):
            return True
        if self._looks_like_screenshot(filename) and len(normalized_ocr) >= SCREENSHOT_OCR_MIN_CHARS:
            return True
        if width and height and max(width, height) >= 900 and len(normalized_ocr) >= TEXT_HEAVY_OCR_MIN_CHARS:
            return True
        return False

    @staticmethod
    def _looks_like_screenshot(filename: str) -> bool:
        normalized = (filename or "").strip().lower()
        keywords = ("screenshot", "screen shot", "screen-shot", "capture", "snip", "snipping", "لقطة", "سكرين")
        return any(keyword in normalized for keyword in keywords)

    def _should_attempt_ocr(self, filename: str, user_message: str, mode_hint: str) -> bool:
        normalized_message = self._normalize_for_matching(user_message)
        if self._query_prefers_ocr(user_message):
            return True
        if mode_hint in {"report", "label", "screenshot"}:
            return True
        if self._looks_like_screenshot(filename) and any(
            keyword in normalized_message
            for keyword in ("read", "text", "question", "answer", "what does this say", "ماذا مكتوب", "اقرا", "اقرأ")
        ):
            return True
        return False

    def _infer_image_analysis_mode(self, filename: str, user_message: str, ocr_text: str) -> str:
        combined = self._normalize_for_matching(filename, user_message, ocr_text)
        if self._should_treat_as_ui_screenshot(filename, user_message, ocr_text):
            return "screenshot"
        if any(keyword in combined for keyword in REPORT_HINT_KEYWORDS):
            return "report"
        if any(keyword in combined for keyword in LABEL_HINT_KEYWORDS):
            return "label"
        if any(keyword in combined for keyword in PROGRESS_PHOTO_HINT_KEYWORDS):
            return "progress_photo"
        if any(keyword in combined for keyword in FOOD_HINT_KEYWORDS):
            return "food"
        return "general"

    def _should_treat_as_ui_screenshot(self, filename: str, user_message: str, ocr_text: str) -> bool:
        combined = self._normalize_for_matching(user_message, ocr_text)
        if any(keyword in combined for keyword in SCREENSHOT_HINT_KEYWORDS):
            return True
        if not self._looks_like_screenshot(filename):
            return False
        normalized_ocr = self._normalize_ocr_text(ocr_text)
        if len(normalized_ocr) >= SCREENSHOT_OCR_MIN_CHARS:
            return True
        if self._query_prefers_ocr(user_message):
            return True
        return False

    def _image_analysis_prompt(self, filename: str, language: str, user_message: str, ocr_text: str) -> str:
        mode = self._infer_image_analysis_mode(filename, user_message, ocr_text)
        instructions_en = {
            "screenshot": (
                "Analyze this screenshot for a fitness coach. Respond in 3 short bullets: "
                "1) what screen or workflow this appears to show, 2) the key visible text, values, warnings, or UI state, "
                "3) the most useful action or answer for the user's question. Do not invent hidden content."
            ),
            "report": (
                "Analyze this report image for a fitness coach. Respond in 4 short bullets: "
                "1) report type, 2) the most important measurable values or findings visible, 3) any flagged risks, restrictions, or abnormal items, "
                "4) the most relevant coaching implication. Quote visible values when possible."
            ),
            "label": (
                "Analyze this food or product label for a fitness coach. Respond in 4 short bullets: "
                "1) product or food type, 2) the clearest nutrition facts or ingredient details visible, 3) any red flags for calories, sugar, sodium, or ultra-processed ingredients, "
                "4) the practical nutrition recommendation. Use only visible text."
            ),
            "progress_photo": (
                "Analyze this progress photo for a fitness coach. Respond in 4 short bullets: "
                "1) pose and photo angle, 2) visible muscularity, body-fat distribution, or symmetry cues, 3) posture or presentation issues that affect interpretation, "
                "4) the most useful training or nutrition implication. Avoid identity, age, or medical diagnosis claims."
            ),
            "food": (
                "Analyze this food image for a fitness coach. Respond in 4 short bullets: "
                "1) likely meal or food items, 2) portion-size estimate with uncertainty noted, 3) likely calorie and protein impact in broad terms, "
                "4) the most practical nutrition coaching advice."
            ),
            "general": (
                "Analyze this uploaded image for a fitness coach. Respond in 3 short bullets: "
                "1) the main visible subject, 2) any readable labels, values, or notable details, 3) the most useful coaching implication. If uncertain, say so briefly."
            ),
        }
        instructions_ar = {
            "screenshot": "حلل لقطة الشاشة هذه لمدرب لياقة. رد في 3 نقاط قصيرة: 1) ما الشاشة أو الواجهة الظاهرة، 2) أهم النصوص أو القيم أو التحذيرات أو حالة الواجهة، 3) أفضل إجراء أو إجابة مفيدة لسؤال المستخدم. لا تخترع محتوى غير ظاهر.",
            "report": "حلل صورة التقرير هذه لمدرب لياقة. رد في 4 نقاط قصيرة: 1) نوع التقرير، 2) أهم القيم أو النتائج الظاهرة، 3) أي مخاطر أو قيود أو عناصر غير طبيعية واضحة، 4) أهم فائدة تدريبية أو صحية عملية. اذكر القيم الظاهرة إن أمكن.",
            "label": "حلل ملصق الطعام أو المنتج هذا لمدرب لياقة. رد في 4 نقاط قصيرة: 1) نوع المنتج أو الطعام، 2) أوضح معلومات التغذية أو المكونات الظاهرة، 3) أي ملاحظات مهمة حول السعرات أو السكر أو الصوديوم أو التصنيع العالي، 4) التوصية الغذائية العملية. استخدم فقط النص الظاهر.",
            "progress_photo": "حلل صورة التقدم هذه لمدرب لياقة. رد في 4 نقاط قصيرة: 1) الوقفة وزاوية التصوير، 2) مؤشرات الكتلة العضلية أو توزيع الدهون أو التناسق الظاهر، 3) أي مشكلة في الوقفة أو العرض تؤثر على التقييم، 4) أهم دلالة تدريبية أو غذائية. تجنب ادعاء الهوية أو العمر أو التشخيص الطبي.",
            "food": "حلل صورة الطعام هذه لمدرب لياقة. رد في 4 نقاط قصيرة: 1) نوع الوجبة أو الأصناف المحتملة، 2) تقدير حجم الحصة مع توضيح عدم اليقين، 3) الأثر التقريبي على السعرات والبروتين بشكل عام، 4) أفضل نصيحة غذائية عملية.",
            "general": "حلل هذه الصورة المرفوعة لمدرب لياقة. رد في 3 نقاط قصيرة: 1) الشيء الأساسي الظاهر، 2) أي نص أو قيم أو تفاصيل مهمة ظاهرة، 3) أهم فائدة تدريبية أو غذائية. إذا كان هناك شيء غير مؤكد فاذكره باختصار.",
        }
        base = instructions_ar[mode] if language.startswith("ar") else instructions_en[mode]
        parts = [base, f"Filename: {filename}"]
        if user_message.strip():
            parts.append(f"User request: {user_message.strip()[:400]}")
        if ocr_text:
            parts.append(f"OCR text already extracted from the image:\n{ocr_text[:900]}")
        return "\n\n".join(parts)

    def _fallback_image_analysis_prompt(
        self,
        filename: str,
        language: str,
        user_message: str,
        ocr_text: str,
        mode_override: Optional[str] = None,
    ) -> str:
        mode = mode_override or self._infer_image_analysis_mode(filename, user_message, ocr_text)
        base = (
            "Describe only what is directly visible in this image. Name the image type first, then list the most important visible elements. "
            "If it is a screenshot, report, label, food image, or progress photo, say that explicitly."
            if not language.startswith("ar")
            else "صف فقط ما يظهر مباشرة في هذه الصورة. ابدأ بنوع الصورة ثم اذكر أهم العناصر الظاهرة. إذا كانت لقطة شاشة أو تقريراً أو ملصقاً أو صورة طعام أو صورة تقدم فاذكر ذلك بوضوح."
        )
        parts = [base, f"Filename: {filename}", f"Detected image type hint: {mode}"]
        if user_message.strip():
            parts.append(f"User request: {user_message.strip()[:400]}")
        if ocr_text:
            parts.append(f"OCR text already extracted from the image:\n{ocr_text[:900]}")
        return "\n\n".join(parts)