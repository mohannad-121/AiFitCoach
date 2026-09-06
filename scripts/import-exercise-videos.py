"""Import supplied MP4 archives as references, preserving provenance, not inferred form labels.

Usage: python scripts/import-exercise-videos.py archive.zip [archive.zip ...]
Only generated content-addressed MP4 names are written; archive paths are never extracted.
"""
import csv
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public' / 'exercise-references'

def muscle_group(name):
    name = re.sub(r'[^a-z]+', ' ', name.lower()).strip()
    for tokens, group in [
        (['pect', 'chest'], 'chest'), (['tricep'], 'triceps'),
        (['bicep', 'wrist', 'foream', 'forearm', 'hands'], 'biceps'),
        (['deltoid', 'deiloid', 'shoulder', 'delt', 'neck', 'neak'], 'shoulders'),
        (['abdom', 'abs', 'oblique'], 'abs'), (['hamstring'], 'hamstrings'),
        (['glut'], 'glutes'), (['quad', 'femoris', 'thigh', 'groin'], 'quads'),
        (['calv', 'gastro', 'gastron', 'soleus', 'tibialis', 'feet'], 'calves'),
        (['trap', 'lats', 'back'], 'back'),
    ]:
        if any(token in name for token in tokens):
            return group
    return None

def main():
    DEST.mkdir(parents=True, exist_ok=True)
    records = {}
    count = 0
    for archive_path in map(Path, sys.argv[1:]):
        with zipfile.ZipFile(archive_path) as archive:
            for entry in archive.infolist():
                if not entry.filename.lower().endswith('.mp4'):
                    continue
                count += 1
                data = archive.read(entry)
                digest = hashlib.sha256(data).hexdigest()
                target = DEST / f'{digest}.mp4'
                if not target.exists():
                    target.write_bytes(data)
                parts = entry.filename.replace('\\', '/').split('/')
                lowered = entry.filename.lower()
                source = {
                    'archive': archive_path.name, 'path': entry.filename,
                    'muscle': muscle_group(parts[-2]), 'target': parts[-2],
                    'gender': 'female' if 'female' in lowered else 'male' if 'male' in lowered else 'all',
                    'location': 'home' if re.search(r'/home/', lowered) else 'gym' if '/gym/' in lowered else 'both',
                    'level': 'advanced' if re.search(r'advanc', parts[-1], re.I) else 'normal',
                }
                if digest not in records:
                    records[digest] = {'id': digest, 'url': f'/exercise-references/{digest}.mp4', 'bytes': len(data), 'sources': []}
                records[digest]['sources'].append(source)
    catalog = {'version': 1, 'sourceVideos': count, 'uniqueVideos': len(records), 'labelsAvailable': False, 'videos': list(records.values())}
    (DEST / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    dataset_dir = ROOT / 'ai_backend' / 'datasets' / 'exercise_video_review'
    dataset_dir.mkdir(parents=True, exist_ok=True)
    # Never overwrite manual review work on subsequent imports.
    labels = dataset_dir / 'labels.csv'
    if not labels.exists():
        with labels.open('w', encoding='utf-8', newline='') as handle:
            writer = csv.writer(handle)
            writer.writerow(['video_id', 'exercise_id', 'form_label', 'mistake', 'subject_id', 'camera_angle', 'source'])
            for item in records.values():
                writer.writerow([item['id'], '', '', '', '', '', item['sources'][0]['path']])
    print(json.dumps({'sourceVideos': count, 'uniqueVideos': len(records), 'bytes': sum(r['bytes'] for r in records.values()), 'unmapped': sorted({s['target'] for r in records.values() for s in r['sources'] if s['muscle'] is None}), 'labels': str(labels)}))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('Pass at least one ZIP archive.')
    main()
