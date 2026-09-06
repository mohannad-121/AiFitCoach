# Exercise video review — 2026-09-06

## What was imported

The user supplied `videos 23.zip` and `videos.ex.zip`. Their 3,156 MP4 entries produce **1,752 unique videos** after SHA-256 deduplication, about 1.2 GB. Originals are unchanged. Local copies are in `public/exercise-references/`; the catalog preserves archive and member-path provenance for every copy. All muscle folders map to the shared 10-group workout catalog. Home/gym and male/female folder metadata are preserved.

These files have no reliable exact movement IDs, performance labels, subject IDs, or camera-angle labels. The user confirmed that no additional annotations are available. Folder names describe muscles, not whether a movement is correct. Do not treat the clips as labeled positive samples or infer correctness from filenames.

## Current functionality vs. model training

- Camera and Workouts share `src/data/exercises.ts`, including 18 additional movements. Every muscle group has home/gym choices available to both genders.
- Nine movement families have 2D angle rules: plank, squat, push-up, lunge, curl, lateral raise, overhead press, hip hinge, and bridge. Additional mappings are explicitly **experimental movement cues**, not validated form classifiers.
- Other exercises are selectable with **visibility-only** tracking. Membership in the catalog does not imply detailed correction support.
- MediaPipe remains the pretrained pose detector; **no new correct/incorrect model was trained**, and no accuracy claim is made. Rules cannot assess load, pain, spinal alignment, every joint, or all errors from a single camera view.
- Video references are shown by muscle, gender, and location. The UI explicitly warns that the clip may demonstrate a different movement from the selected exercise. Clips load only when the visitor opens references.
- Repetition counting uses stable endpoints and a full return cycle. Jitter, missing joints and occlusion reset the in-flight cycle. It is experimental, and plank holds are not repetitions.

## Annotation and later training

`labels.csv` contains one row per unique clip, with review columns intentionally blank. For each usable clip, a qualified reviewer should enter the canonical `exercise_id`, `form_label` (`correct`, `incorrect`, or `uncertain`), `mistake`, subject identifier, and camera angle. Exclude uncertain/unsupported views from correctness training. Do not label an entire clip as incorrect when only isolated frames are wrong; record the relevant time interval in a separate segment manifest.

Collect diverse, consented correct and incorrect examples and evaluate on held-out subjects, source clips and recording sessions. Never randomly split neighboring frames across training and test sets. Report per-movement precision/recall, coverage, and low-confidence abstention before enabling any learned classifier. Do not manufacture error examples by relabeling correct demonstrations.

The existing `/live-coach?collect=1` mode can export reviewed landmark sessions locally for the supported families. Select labels deliberately; no upload occurs automatically. Raw normalized landmarks and camera width/height are retained; aspect-correct x/y before computing angles for training, as the live analyzer does.

## Re-import

From the repository root:

```powershell
python scripts/import-exercise-videos.py "D:\Ai Fit Coach\tasks\video\videos 23.zip" "D:\Ai Fit Coach\tasks\video\videos.ex.zip"
```

The importer hashes video bytes, uses safe generated file names, and does not extract ZIP paths verbatim. It does not overwrite an existing reviewed `labels.csv`. The public video directory makes production builds about 1.2 GB larger; before public deployment confirm distribution rights and consider dedicated video storage. No external publication was performed.

Reference: [MediaPipe Pose Landmarker for web](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js).
