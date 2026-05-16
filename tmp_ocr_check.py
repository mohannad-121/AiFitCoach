from PIL import Image, ImageDraw, ImageFont
from ai_backend.attachment_processing import AttachmentProcessor
from ai_backend.llm_client import LLMClient
import io

img = Image.new('RGB', (1400, 800), 'white')
draw = ImageDraw.Draw(img)
font = ImageFont.load_default()
lines = [
    'Question 12',
    'What is 7 x 8?',
    'A. 54',
    'B. 56',
    'C. 64',
    'D. 58',
]
y = 80
for line in lines:
    draw.text((80, y), line, fill='black', font=font)
    y += 80
buf = io.BytesIO()
img.save(buf, format='PNG')
raw = buf.getvalue()
processor = AttachmentProcessor(LLMClient())
ocr = processor._extract_ocr(raw, filename='Screenshot 2026-04-15 131313.png', user_message='solve this question')
print(repr(ocr))
