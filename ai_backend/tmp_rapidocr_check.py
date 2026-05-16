from PIL import Image, ImageDraw, ImageFont
from rapidocr_onnxruntime import RapidOCR
import io, os

font_path = r'C:\Windows\Fonts\arial.ttf'
font = ImageFont.truetype(font_path, 54) if os.path.exists(font_path) else ImageFont.load_default()
img = Image.new('RGB', (1600, 900), 'white')
draw = ImageDraw.Draw(img)
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
    draw.text((100, y), line, fill='black', font=font)
    y += 110
buf = io.BytesIO()
img.save(buf, format='PNG')
raw = buf.getvalue()
engine = RapidOCR()
result, elapsed = engine(raw)
print('elapsed=', elapsed)
print(result)
