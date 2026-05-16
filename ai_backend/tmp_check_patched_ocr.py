from attachment_processing import AttachmentProcessor
from llm_client import LLMClient
from pathlib import Path
raw = Path(r'd:\AiFitCoach-main\ai_backend\tmp_question_screenshot.png').read_bytes()
processor = AttachmentProcessor(LLMClient())
ocr = processor._extract_ocr(raw, filename='Screenshot 2026-04-15 131313.png', user_message='solve this question')
print(repr(ocr))
