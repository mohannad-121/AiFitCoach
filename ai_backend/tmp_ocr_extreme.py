from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter
from rapidocr_onnxruntime import RapidOCR
import io, os
font_path = r'C:\Windows\Fonts\arial.ttf'
font = ImageFont.truetype(font_path, 24) if os.path.exists(font_path) else ImageFont.load_default()
img = Image.new('RGB', (1029, 468), 'white')
draw = ImageDraw.Draw(img)
lines = ['Question 12','What is 7 x 8?','A. 54','B. 56','C. 64','D. 58']
y = 80
for line in lines:
    draw.text((80, y), line, fill='black', font=font)
    y += 42
engine = RapidOCR()
for scale in (6,8,10,12):
    gray = ImageOps.autocontrast(ImageOps.grayscale(img))
    big = gray.resize((gray.width*scale, gray.height*scale), Image.Resampling.LANCZOS)
    sharp = big.filter(ImageFilter.SHARPEN)
    bw = sharp.point(lambda px: 255 if px > 170 else 0)
    out = io.BytesIO(); bw.save(out, format='PNG')
    result, _ = engine(out.getvalue())
    text=[]
    for item in result or []:
        if isinstance(item, (list, tuple)) and len(item)>=2 and isinstance(item[1], (list, tuple)) and item[1]:
            val=str(item[1][0] or '').strip()
            if val:
                text.append(val)
    print(scale, text)
