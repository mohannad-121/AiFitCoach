import { FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { exercises } from '@/data/exercises';
import { getExerciseVideoUrl } from '@/data/exerciseVideoResolver';

type ReferenceExerciseId = 'squats' | 'push-ups' | 'plank';

interface ExtractionTarget {
  id: ReferenceExerciseId;
  poseExercise: 'squat' | 'push-up' | 'plank';
  name: string;
  videoPath: string;
}

interface UrlCheck {
  ok: boolean;
  status: number | null;
  statusText: string;
  url: string;
  contentType: string;
  error?: string;
}

interface ExtractionSummary {
  target: ExtractionTarget;
  urlCheck: UrlCheck;
  metadataLoaded: boolean;
  duration: number | null;
  framesProcessed: number;
  samplesExported: number;
  warning?: string;
  error?: string;
}

const POSE_WASM_PATH = '/mediapipe/wasm';
const POSE_MODEL_PATH = '/models/pose_landmarker_lite.task';
const APP_VERSION = 'reference-video-landmarks-v1';
const DEFAULT_EXTRACTION_FPS = 2;
const TARGET_IDS: ReferenceExerciseId[] = ['squats', 'push-ups', 'plank'];
const POSE_NAME_BY_ID: Record<ReferenceExerciseId, ExtractionTarget['poseExercise']> = {
  squats: 'squat',
  'push-ups': 'push-up',
  plank: 'plank',
};

declare global {
  interface Window {
    __aifitcoachReferenceRows?: unknown[];
  }
}

const LANDMARK_NAMES = [
  'nose',
  'left_eye_inner',
  'left_eye',
  'left_eye_outer',
  'right_eye_inner',
  'right_eye',
  'right_eye_outer',
  'left_ear',
  'right_ear',
  'mouth_left',
  'mouth_right',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_pinky',
  'right_pinky',
  'left_index',
  'right_index',
  'left_thumb',
  'right_thumb',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
] as const;

const INDEX = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

function byId(id: ReferenceExerciseId) {
  const exercise = exercises.find((item) => item.id === id);
  if (!exercise) throw new Error(`Missing exercise in catalog: ${id}`);
  return exercise;
}

function resolveTargets(): ExtractionTarget[] {
  return TARGET_IDS.map((id) => {
    const exercise = byId(id);
    return {
      id,
      poseExercise: POSE_NAME_BY_ID[id],
      name: exercise.name,
      videoPath: getExerciseVideoUrl(exercise, 'male') || getExerciseVideoUrl(exercise, 'female') || getExerciseVideoUrl(exercise),
    };
  }).filter((target) => Boolean(target.videoPath));
}

function encodeVideoPath(path: string) {
  const absoluteUrl = new URL(path, window.location.origin);
  absoluteUrl.pathname = absoluteUrl.pathname
    .split('/')
    .map((part) => encodeURIComponent(decodeURIComponent(part)))
    .join('/');
  return absoluteUrl.toString();
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function roundMetric(value: number | undefined | null, digits = 4) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function angle(a: NormalizedLandmark | undefined, b: NormalizedLandmark | undefined, c: NormalizedLandmark | undefined) {
  if (!a || !b || !c) return null;
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!denominator) return null;
  const cosine = Math.max(-1, Math.min(1, (ab.x * cb.x + ab.y * cb.y) / denominator));
  return roundMetric(Math.acos(cosine) * 180 / Math.PI, 2);
}

function torsoTilt(shoulder: NormalizedLandmark | undefined, hip: NormalizedLandmark | undefined) {
  if (!shoulder || !hip) return null;
  const dx = Math.abs(shoulder.x - hip.x);
  const dy = Math.abs(shoulder.y - hip.y);
  if (!dy) return null;
  return roundMetric(Math.atan2(dx, dy) * 180 / Math.PI, 2);
}

function jointAngles(landmarks: NormalizedLandmark[]) {
  const point = (index: number) => landmarks[index];
  return {
    leftKnee: angle(point(INDEX.leftHip), point(INDEX.leftKnee), point(INDEX.leftAnkle)),
    rightKnee: angle(point(INDEX.rightHip), point(INDEX.rightKnee), point(INDEX.rightAnkle)),
    leftHip: angle(point(INDEX.leftShoulder), point(INDEX.leftHip), point(INDEX.leftKnee)),
    rightHip: angle(point(INDEX.rightShoulder), point(INDEX.rightHip), point(INDEX.rightKnee)),
    leftElbow: angle(point(INDEX.leftShoulder), point(INDEX.leftElbow), point(INDEX.leftWrist)),
    rightElbow: angle(point(INDEX.rightShoulder), point(INDEX.rightElbow), point(INDEX.rightWrist)),
    leftBodyLine: angle(point(INDEX.leftShoulder), point(INDEX.leftHip), point(INDEX.leftAnkle)),
    rightBodyLine: angle(point(INDEX.rightShoulder), point(INDEX.rightHip), point(INDEX.rightAnkle)),
    leftTorsoTilt: torsoTilt(point(INDEX.leftShoulder), point(INDEX.leftHip)),
    rightTorsoTilt: torsoTilt(point(INDEX.rightShoulder), point(INDEX.rightHip)),
  };
}

function serializeLandmarks(landmarks: NormalizedLandmark[]) {
  return landmarks.map((point, index) => ({
    index,
    name: LANDMARK_NAMES[index] ?? `landmark_${index}`,
    x: roundMetric(point.x) ?? 0,
    y: roundMetric(point.y) ?? 0,
    z: roundMetric(point.z) ?? 0,
    visibility: roundMetric(point.visibility ?? null),
  }));
}

function confidence(landmarks: NormalizedLandmark[]) {
  const visibleLandmarks = landmarks.filter((point) => (point.visibility ?? 0) >= 0.45).length;
  const averageVisibility = landmarks.length
    ? landmarks.reduce((sum, point) => sum + (point.visibility ?? 0), 0) / landmarks.length
    : 0;
  return {
    averageVisibility: roundMetric(averageVisibility, 4),
    visibleLandmarks,
    usable: visibleLandmarks >= 18 && averageVisibility >= 0.48,
  };
}

function waitForEvent(target: EventTarget, eventName: string) {
  return new Promise<void>((resolve, reject) => {
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Video failed during ${eventName}`));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onSuccess);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(eventName, onSuccess, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

async function checkVideoUrl(path: string): Promise<UrlCheck> {
  const url = encodeVideoPath(path);
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const contentType = response.headers.get('content-type') ?? '';
    const isVideo = contentType.toLowerCase().startsWith('video/');
    return {
      ok: response.ok && isVideo,
      status: response.status,
      statusText: isVideo ? response.statusText : `${response.statusText || 'OK'}; expected video, got ${contentType || 'unknown content type'}`,
      url,
      contentType,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      statusText: 'request failed',
      url,
      contentType: '',
      error: error instanceof Error ? error.message : 'Unknown fetch error',
    };
  }
}

function downloadJsonl(rows: unknown[], filename: string) {
  const blob = new Blob([`${rows.map((row) => JSON.stringify(row)).join('\n')}\n`], { type: 'application/x-ndjson;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function createLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(POSE_WASM_PATH);
  const options = {
    baseOptions: {
      modelAssetPath: POSE_MODEL_PATH,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  } as const;

  try {
    return await PoseLandmarker.createFromOptions(vision, options);
  } catch (error) {
    console.warn('GPU pose extraction failed, retrying with CPU.', error);
    return PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: {
        modelAssetPath: POSE_MODEL_PATH,
        delegate: 'CPU',
      },
    });
  }
}

function updateDebug(debug: HTMLElement, summaries: ExtractionSummary[], active?: Partial<ExtractionSummary>) {
  const rows = [...summaries, ...(active?.target ? [active as ExtractionSummary] : [])];
  debug.innerHTML = rows.length
    ? rows.map((summary) => `
      <article class="debug-card">
        <strong>${summary.target.name}</strong>
        <code>${summary.target.videoPath}</code>
        <dl>
          <div><dt>Current video URL</dt><dd>${summary.urlCheck?.url ?? 'Pending'}</dd></div>
          <div><dt>HTTP/video load status</dt><dd>${summary.urlCheck ? `${summary.urlCheck.status ?? 'n/a'} ${summary.urlCheck.statusText}` : 'Pending'}</dd></div>
          <div><dt>Content-Type</dt><dd>${summary.urlCheck?.contentType || 'n/a'}</dd></div>
          <div><dt>loadedmetadata</dt><dd>${summary.metadataLoaded ? 'success' : 'not loaded'}</dd></div>
          <div><dt>Duration</dt><dd>${summary.duration !== null && summary.duration !== undefined ? `${summary.duration.toFixed(2)}s` : 'n/a'}</dd></div>
          <div><dt>Frames processed</dt><dd>${summary.framesProcessed ?? 0}</dd></div>
          <div><dt>Samples exported</dt><dd>${summary.samplesExported ?? 0}</dd></div>
          <div><dt>Last error</dt><dd>${summary.error ?? summary.warning ?? 'none'}</dd></div>
        </dl>
      </article>
    `).join('')
    : '<p>No extraction has run yet.</p>';
}

async function extractTarget(target: ExtractionTarget, landmarker: PoseLandmarker, extractionFps: number, status: HTMLElement, debug: HTMLElement, summaries: ExtractionSummary[], timestampOffsetMs: number) {
  const urlCheck = await checkVideoUrl(target.videoPath);
  const summary: ExtractionSummary = {
    target,
    urlCheck,
    metadataLoaded: false,
    duration: null,
    framesProcessed: 0,
    samplesExported: 0,
  };
  updateDebug(debug, summaries, summary);

  if (!urlCheck.ok) {
    summary.warning = `Skipped: video URL did not return a playable video response.`;
    updateDebug(debug, summaries, summary);
    return { rows: [], summary };
  }

  const video = document.createElement('video');
  video.src = urlCheck.url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    video.load();
    await waitForEvent(video, 'loadedmetadata');
    summary.metadataLoaded = true;
  } catch (error) {
    summary.error = error instanceof Error ? error.message : 'loadedmetadata failed';
    updateDebug(debug, summaries, summary);
    return { rows: [], summary };
  }

  const rows = [];
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  summary.duration = duration;
  const step = 1 / extractionFps;
  const sampleCount = Math.max(1, Math.floor(duration / step));

  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    const timestampInVideo = Math.min(duration, sampleIndex * step);
    video.currentTime = timestampInVideo;
    try {
      await waitForEvent(video, 'seeked');
    } catch (error) {
      summary.error = error instanceof Error ? error.message : 'seek failed';
      updateDebug(debug, summaries, summary);
      break;
    }
    let result: ReturnType<PoseLandmarker['detectForVideo']>;
    try {
      result = landmarker.detectForVideo(video, timestampOffsetMs + Math.round((sampleIndex + 1) * step * 1000));
    } catch (error) {
      summary.error = error instanceof Error ? error.message : 'pose extraction failed';
      updateDebug(debug, summaries, summary);
      break;
    }
    const landmarks = result.landmarks[0] ?? null;
    summary.framesProcessed = sampleIndex + 1;
    status.textContent = `Extracting ${target.name}: ${sampleIndex + 1}/${sampleCount + 1}`;

    if (!landmarks) continue;

    rows.push({
      sampleId: createId('reference_sample'),
      sessionId: `${target.id}_reference_video`,
      participantId: 'third_party_reference_unknown',
      exercise: target.poseExercise,
      label: 'reference',
      mistakeType: 'unknown',
      sourceType: 'third_party_video_reference',
      commercialAllowed: false,
      sourceVideoPath: target.videoPath,
      sourceVideoUrl: urlCheck.url,
      sourceExerciseId: target.id,
      extractionFps,
      timestampInVideo: roundMetric(timestampInVideo, 3),
      landmarks: serializeLandmarks(landmarks),
      jointAngles: jointAngles(landmarks),
      confidence: confidence(landmarks),
      camera: {
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      },
      timestamp: new Date().toISOString(),
      appVersion: APP_VERSION,
    });
    summary.samplesExported = rows.length;
    updateDebug(debug, summaries, summary);
  }

  video.removeAttribute('src');
  video.load();
  return { rows, summary };
}

function render() {
  const targets = resolveTargets();
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;

  app.innerHTML = `
    <main class="shell">
      <section class="hero">
        <p class="eyebrow">AiFitCoach internal prototype</p>
        <h1>Reference Video Landmark Extractor</h1>
        <p class="warning">Outputs are marked <strong>reference</strong> and <strong>commercialAllowed: false</strong>. Do not use as commercial-safe training data.</p>
      </section>
      <section class="panel">
        <label>Extraction FPS
          <input id="fps" type="number" min="0.5" max="10" step="0.5" value="${DEFAULT_EXTRACTION_FPS}" />
        </label>
        <button id="extract">Extract and download JSONL</button>
        <p id="status">Ready.</p>
      </section>
      <section class="panel">
        <h2>Debug output</h2>
        <div id="debug"><p>No extraction has run yet.</p></div>
      </section>
      <section class="panel">
        <h2>Resolved website videos</h2>
        <ul>
          ${targets.map((target) => `<li><strong>${target.name}</strong><code>${target.videoPath || 'No video resolved'}</code></li>`).join('')}
        </ul>
      </section>
    </main>
  `;

  const style = document.createElement('style');
  style.textContent = `
    body { margin: 0; background: #060816; color: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    .shell { width: min(980px, calc(100vw - 32px)); margin: 0 auto; padding: 48px 0; }
    .hero, .panel { border: 1px solid rgba(255,255,255,.1); border-radius: 22px; background: rgba(17,20,37,.88); padding: 24px; margin-bottom: 18px; box-shadow: 0 24px 80px rgba(0,0,0,.28); }
    .eyebrow { color: #67e8f9; text-transform: uppercase; letter-spacing: .24em; font-size: 12px; font-weight: 700; }
    h1 { margin: 8px 0 12px; font-size: clamp(30px, 5vw, 52px); }
    h2 { margin-top: 0; font-size: 18px; }
    .warning { color: #fde68a; line-height: 1.7; }
    label { display: grid; gap: 8px; max-width: 220px; color: #cbd5e1; font-size: 14px; }
    input { height: 42px; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.28); color: white; padding: 0 12px; }
    button { margin-top: 16px; min-height: 44px; border: 0; border-radius: 14px; background: #06b6d4; color: #06202a; padding: 0 18px; font-weight: 800; cursor: pointer; }
    button:disabled { opacity: .55; cursor: wait; }
    code { display: block; margin-top: 6px; color: #93c5fd; overflow-wrap: anywhere; }
    li { margin: 14px 0; color: #e2e8f0; }
    #status { color: #bae6fd; }
    .debug-card { border: 1px solid rgba(255,255,255,.1); border-radius: 16px; background: rgba(0,0,0,.2); padding: 14px; margin-top: 12px; }
    dl { display: grid; gap: 8px; margin: 12px 0 0; }
    dt { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    dd { margin: 3px 0 0; color: #f8fafc; overflow-wrap: anywhere; }
  `;
  document.head.appendChild(style);

  const button = document.querySelector<HTMLButtonElement>('#extract');
  const fpsInput = document.querySelector<HTMLInputElement>('#fps');
  const status = document.querySelector<HTMLElement>('#status');
  const debug = document.querySelector<HTMLElement>('#debug');
  button?.addEventListener('click', async () => {
    if (!button || !status || !fpsInput || !debug) return;
    button.disabled = true;
    const summaries: ExtractionSummary[] = [];
    try {
      const extractionFps = Math.max(0.5, Math.min(10, Number(fpsInput.value) || DEFAULT_EXTRACTION_FPS));
      status.textContent = 'Loading MediaPipe model...';
      const landmarker = await createLandmarker();
      const allRows = [];
      let timestampOffsetMs = 0;
      for (const target of targets) {
        status.textContent = `Checking ${target.name} video URL...`;
        const { rows, summary } = await extractTarget(target, landmarker, extractionFps, status, debug, summaries, timestampOffsetMs);
        timestampOffsetMs += Math.max(1000, Math.ceil(((summary.duration ?? 0) + 1) * 1000));
        summaries.push(summary);
        updateDebug(debug, summaries);
        allRows.push(...rows);
      }
      landmarker.close();
      if (allRows.length === 0) {
        status.textContent = 'No samples exported. All videos failed to load or produced no landmarks.';
        return;
      }
      window.__aifitcoachReferenceRows = allRows;
      window.localStorage.setItem('aifitcoach_reference_last_export', JSON.stringify(allRows));
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadJsonl(allRows, `aifitcoach-reference-landmarks-${stamp}.jsonl`);
      status.textContent = `Done. Exported ${allRows.length} reference rows.`;
    } catch (error) {
      console.error(error);
      status.textContent = error instanceof Error ? error.message : 'Extraction failed.';
    } finally {
      button.disabled = false;
    }
  });
}

render();
