from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageFilter
from rapidocr_onnxruntime import RapidOCR
import io, os

font_path = r'C:\Windows\Fonts\arial.ttf'
font = ImageFont.truetype(font_path, 24) if os.path.exists(font_path) else ImageFont.load_default()
img = Image.new('RGB', (1029, 468), '#f7f7f8')
draw = ImageDraw.Draw(img)
draw.rectangle((0,0,1029,70), fill='#202123')
draw.text((30,20), 'Math Quiz', fill='white', font=font)
draw.rectangle((60,120,980,420), fill='white')
lines = ['Question 12','What is 7 x 8?','A. 54','B. 56','C. 64','D. 58']
y = 150
for line in lines:
    draw.text((110, y), line, fill='black', font=font)
    y += 42
engine = RapidOCR()
variants = []
variants.append(('base', img))
gray = ImageOps.grayscale(img)
variants.append(('gray', gray))
auto = ImageOps.autocontrast(gray)
variants.append(('auto', auto))
for scale in (2,3,4,5):
    big = auto.resize((auto.width*scale, auto.height*scale), Image.Resampling.LANCZOS)
    variants.append((f'auto_x{scale}', big))
    sharp = big.filter(ImageFilter.SHARPEN)
    variants.append((f'sharp_x{scale}', sharp))
    for thresh in (140,160,180,200):
        bw = sharp.point(lambda px, t=thresh: 255 if px > t else 0)
        variants.append((f'bw{thresh}_x{scale}', bw))
content = img.crop((60,120,980,420))
content_auto = ImageOps.autocontrast(ImageOps.grayscale(content))
for scale in (3,4,5,6):
    big = content_auto.resize((content_auto.width*scale, content_auto.height*scale), Image.Resampling.LANCZOS)
    variants.append((f'content_x{scale}', big))
    for thresh in (140,160,180,200):
        bw = big.point(lambda px, t=thresh: 255 if px > t else 0)
        variants.append((f'content_bw{thresh}_x{scale}', bw))

best = []
for name, variant in variants:
    out = io.BytesIO(); variant.save(out, format='PNG')
    result, elapsed = engine(out.getvalue())
    text = []
    for item in result or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            ti = item[1]
            if isinstance(ti, (list, tuple)) and ti:
                val = str(ti[0] or '').strip()
                if val:
                    text.append(val)
    joined = ' | '.join(text)
    if joined:
        best.append((name, joined))
print(best[:20])
