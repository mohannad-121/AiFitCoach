from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter
from attachment_processing import AttachmentProcessor
from llm_client import LLMClient
from rapidocr_onnxruntime import RapidOCR
import io, os

font_path = r'C:\Windows\Fonts\arial.ttf'
font = ImageFont.truetype(font_path, 24) if os.path.exists(font_path) else ImageFont.load_default()
img = Image.new('RGB', (1029, 468), '#f7f7f8')
draw = ImageDraw.Draw(img)
draw.rectangle((0,0,1029,70), fill='#202123')
draw.text((30,20), 'Math Quiz', fill='white', font=font)
draw.rectangle((60,120,980,420), fill='white')
lines = [
    'Question 12',
    'What is 7 x 8?',
    'A. 54',
    'B. 56',
    'C. 64',
    'D. 58',
]
y = 150
for line in lines:
    draw.text((110, y), line, fill='black', font=font)
    y += 42
buf = io.BytesIO(); img.save(buf, format='PNG'); raw = buf.getvalue()
proc = AttachmentProcessor(LLMClient())
print('current=', repr(proc._extract_ocr(raw, filename='Screenshot 2026-04-15 131313.png', user_message='solve this question')))

engine = RapidOCR()
segments = []
with Image.open(io.BytesIO(raw)) as base:
    width, height = base.size
    for idx in range(3):
        top = int(idx * height / 3)
        bottom = int((idx + 1) * height / 3)
        crop = base.crop((0, top, width, bottom))
        gray = ImageOps.grayscale(crop)
        enhanced = ImageOps.autocontrast(gray)
        big = enhanced.resize((enhanced.width * 3, enhanced.height * 3), Image.Resampling.LANCZOS)
        sharp = big.filter(ImageFilter.SHARPEN)
        for variant in (big, sharp):
            out = io.BytesIO(); variant.save(out, format='PNG')
            result, _ = engine(out.getvalue())
            text = []
            for item in result or []:
                if isinstance(item, (list, tuple)) and len(item) >= 2 and isinstance(item[1], (list, tuple)) and item[1]:
                    val = str(item[1][0] or '').strip()
                    if val:
                        text.append(val)
            segments.append((idx, '\n'.join(text)))
print('segments=', segments)
