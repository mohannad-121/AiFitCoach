from PIL import Image, ImageDraw, ImageFont
import os
font_path = r'C:\Windows\Fonts\arial.ttf'
font = ImageFont.truetype(font_path, 24) if os.path.exists(font_path) else ImageFont.load_default()
img = Image.new('RGB', (1029, 468), 'white')
draw = ImageDraw.Draw(img)
lines = ['Question 12','What is 7 x 8?','A. 54','B. 56','C. 64','D. 58']
y = 80
for line in lines:
    draw.text((80, y), line, fill='black', font=font)
    y += 42
img.save(r'd:\AiFitCoach-main\ai_backend\tmp_question_screenshot.png')
