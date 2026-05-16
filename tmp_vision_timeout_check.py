import base64, json, requests
from pathlib import Path
img = Path(r'd:\AiFitCoach-main\fitcoach-presentation-thumbnail.png').read_bytes()
payload = {
    'model': 'gemma3:4b',
    'messages': [{'role': 'user', 'content': 'Describe the main visible content in this image in 3 short bullets.', 'images': [base64.b64encode(img).decode('utf-8')]}],
    'stream': False,
    'options': {'temperature': 0.2, 'num_predict': 120},
}
resp = requests.post('http://127.0.0.1:11434/api/chat', json=payload, timeout=240)
print('status=', resp.status_code)
print(resp.text[:2000])
