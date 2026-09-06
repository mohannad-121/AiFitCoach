import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Camera, CameraOff, CheckCircle2, Clock3, RefreshCw, ScanLine, ShieldCheck, TriangleAlert, User, Sparkles, Activity, Radar, Cpu, Eye, Search, Play, Pause, RotateCcw, Dumbbell, Volume2, VolumeX, Database, Download, Trash2, Target, Timer, Gauge, Zap, TrendingUp, Award } from 'lucide-react';
import { DrawingUtils, FilesetResolver, PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';
import { cn } from '@/lib/utils';
import { assessPose, estimatePoseConfidence, type PoseFeedback, type SupportedExercise } from '@/lib/poseFeedback';
import { useUser } from '@/contexts/UserContext';
import { exercises as exerciseCatalog, type Exercise } from '@/data/exercises';
import { localizedLabel, repairMojibake } from '@/lib/text';
import { getExerciseTrackingConfig, normalizeExerciseName, type ExerciseTrackingConfig } from '@/lib/exerciseTracking';
import { muscleGroups, muscleLabel } from '@/lib/trainingCatalog';
import { ReferenceVideos } from '@/components/workout/ReferenceVideos';
import { advanceRep, emptyRepCounter } from '@/lib/repCounter';
import './TrainingFlow.css';

type CameraState = 'idle' | 'starting' | 'live' | 'error';
type CameraIssue = 'permission-denied' | 'no-camera' | 'unsupported' | 'unknown' | null;
type DifficultyLevel = 'normal' | 'advanced';
type CueSeverity = 'good' | 'caution' | 'correction' | 'camera-setup';
type CollectionExercise = SupportedExercise;
type CollectionLabel = 'correct' | 'incorrect' | 'uncertain' | 'setup_bad';
type CollectionCameraAngle = 'front' | 'side' | 'front_45' | 'unknown';
type CollectionDifficulty = 'beginner' | 'normal' | 'advanced';

interface LiveCoachRouteState {
  exerciseId?: string;
  exerciseName?: string;
}

interface LiveExercise {
  source: Exercise;
  id: string;
  name: string;
  nameAr: string;
  difficulty: DifficultyLevel;
  tracking: ExerciseTrackingConfig;
}

interface PoseQuality {
  visibleLandmarks: number;
  averageVisibility: number;
  centered: boolean;
  stableFrames: number;
  stable: boolean;
  usable: boolean;
  issue: string | null;
}

interface CoachingCue {
  key: string;
  severity: CueSeverity;
  en: string;
  ar: string;
  speak: boolean;
}

interface LiveCoachProgress {
  analyzedSamples: number;
  goodSamples: number;
  scoredSamples: number;
  scoreSum: number;
  bestScore: number | null;
  corrections: Record<string, number>;
}

interface RecentLiveSession {
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  duration: number;
  timestamp: string;
  bestFormScore: number | null;
  averageFormScore: number | null;
  confidence: number | null;
  supportLevel: ExerciseTrackingConfig['support'];
  corrections: Array<{ message: string; count: number }>;
  finalStatus: string;
}

interface DataCollectionSample {
  sampleId: string;
  sessionId: string;
  participantId: string;
  exercise: CollectionExercise;
  label: CollectionLabel;
  mistakeType: string;
  cameraAngle: CollectionCameraAngle;
  difficulty: CollectionDifficulty;
  repPhase: PoseFeedback['repPhase'];
  supportLevel: PoseFeedback['supportLevel'];
  landmarks: Array<{
    index: number;
    name: string;
    x: number;
    y: number;
    z: number;
    visibility: number | null;
  }>;
  jointAngles: Record<string, number | null>;
  confidence: {
    pose: number;
    averageVisibility: number;
    visibleLandmarks: number;
    centered: boolean;
    stableFrames: number;
    usable: boolean;
    issue: string | null;
  };
  camera: {
    width: number | null;
    height: number | null;
    fps: number | null;
    facingMode: string | null;
    deviceId: string | null;
  };
  timestamp: string;
  appVersion: string;
}

const advancedExerciseTerms = [
  'barbell',
  'bench',
  'bulgarian',
  'cable',
  'chin-up',
  'deadlift',
  'decline',
  'hip thrust',
  'machine',
  'nordic',
  'pull-up',
  'romanian',
  'single-leg',
];

const POSE_WASM_PATH = '/mediapipe/wasm';
const POSE_MODEL_PATH = '/models/pose_landmarker_lite.task';
const SMOOTHING_ALPHA = 0.62;
const MIN_VISIBLE_LANDMARKS = 18;
const MIN_AVERAGE_VISIBILITY = 0.48;
const CALIBRATION_STABLE_FRAMES = 8;
const VOICE_COOLDOWN_MS = 8000;
const COLLECTION_SAMPLE_INTERVAL_MS = 350;
const DATA_COLLECTION_APP_VERSION = 'live-coach-collection-v1';
const RECENT_SESSIONS_STORAGE_KEY = 'aifitcoach_livecoach_recent_sessions';
const RECENT_SESSIONS_LIMIT = 3;
const COLLECTION_EXERCISES: CollectionExercise[] = ['squat', 'push-up', 'plank', 'lunge', 'curl', 'lateral-raise', 'shoulder-press', 'hip-hinge', 'bridge'];
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
const COLLECTION_MISTAKES: Record<CollectionExercise, string[]> = {
  lunge: ['none', 'torso_lean', 'partial_range', 'setup_bad'],
  curl: ['none', 'torso_swing', 'elbow_drift', 'partial_range', 'setup_bad'],
  'lateral-raise': ['none', 'torso_swing', 'arms_too_high', 'setup_bad'],
  'shoulder-press': ['none', 'torso_lean', 'partial_range', 'setup_bad'],
  'hip-hinge': ['none', 'excess_knee_bend', 'partial_range', 'setup_bad'],
  bridge: ['none', 'feet_too_far', 'partial_range', 'setup_bad'],
  squat: ['none', 'not_deep_enough', 'too_deep_unstable', 'chest_falling_forward', 'knees_caving_in', 'heels_lifting', 'uneven_weight_shift', 'setup_bad'],
  'push-up': ['none', 'hips_sagging', 'hips_too_high', 'partial_range', 'elbows_flared', 'head_dropping', 'uneven_arm_load', 'setup_bad'],
  plank: ['none', 'hips_sagging', 'hips_too_high', 'shoulders_not_stacked', 'knees_bent', 'head_dropping', 'unstable_hold', 'setup_bad'],
};

const COLLECTION_INDEX = {
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

function classifyExerciseDifficulty(exercise: Exercise): DifficultyLevel {
  const searchable = `${exercise.id} ${exercise.name}`.toLowerCase();

  // The exercise catalog does not expose a stable difficulty field yet.
  // Be conservative: only clearly loaded, unilateral, machine, or advanced
  // movement names are classified as advanced; everything else stays normal.
  if (advancedExerciseTerms.some((term) => searchable.includes(term))) return 'advanced';
  if (exercise.goal === 'bulking' && exercise.location === 'gym') return 'advanced';
  return 'normal';
}

function toLiveExercise(exercise: Exercise): LiveExercise {
  return {
    source: exercise,
    id: exercise.id,
    name: repairMojibake(exercise.name),
    nameAr: repairMojibake(exercise.nameAr || exercise.name),
    difficulty: classifyExerciseDifficulty(exercise),
    tracking: getExerciseTrackingConfig(exercise),
  };
}

function createPoseFeedback(message = 'step_into_frame', confidence = 0, supportLevel: PoseFeedback['supportLevel'] = 'basic'): PoseFeedback {
  return {
    level: 'waiting',
    message,
    score: null,
    status: message === 'basic_tracking' ? 'tracking_basic' : 'waiting_for_body',
    confidence,
    correction: message,
    repPhase: null,
    supportLevel,
  };
}

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function createEmptyProgress(): LiveCoachProgress {
  return {
    analyzedSamples: 0,
    goodSamples: 0,
    scoredSamples: 0,
    scoreSum: 0,
    bestScore: null,
    corrections: {},
  };
}

function metricToneFor(value: number, liveReady: boolean): MetricTone {
  if (!liveReady) return 'purple';
  if (value >= 88) return 'green';
  if (value >= 74) return 'cyan';
  if (value >= 56) return 'purple';
  if (value >= 36) return 'amber';
  return 'red';
}

function createLocalId(prefix: string) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

function loadRecentLiveSessions(): RecentLiveSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_SESSIONS_LIMIT) : [];
  } catch (error) {
    console.warn('Live Coach recent sessions could not be read.', error);
    return [];
  }
}

function persistRecentLiveSessions(sessions: RecentLiveSession[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_SESSIONS_STORAGE_KEY, JSON.stringify(sessions.slice(0, RECENT_SESSIONS_LIMIT)));
  } catch (error) {
    console.warn('Live Coach recent sessions could not be saved.', error);
  }
}

function getLocalParticipantId() {
  const key = 'aifitcoach_live_collection_participant';
  if (typeof window === 'undefined') return createLocalId('anon');
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const next = createLocalId('anon');
  window.localStorage.setItem(key, next);
  return next;
}

function roundMetric(value: number | undefined | null, digits = 4) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function poseAngle(a: NormalizedLandmark | undefined, b: NormalizedLandmark | undefined, c: NormalizedLandmark | undefined) {
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

function extractCollectionJointAngles(landmarks: NormalizedLandmark[]) {
  const point = (index: number) => landmarks[index];
  return {
    leftKnee: poseAngle(point(COLLECTION_INDEX.leftHip), point(COLLECTION_INDEX.leftKnee), point(COLLECTION_INDEX.leftAnkle)),
    rightKnee: poseAngle(point(COLLECTION_INDEX.rightHip), point(COLLECTION_INDEX.rightKnee), point(COLLECTION_INDEX.rightAnkle)),
    leftHip: poseAngle(point(COLLECTION_INDEX.leftShoulder), point(COLLECTION_INDEX.leftHip), point(COLLECTION_INDEX.leftKnee)),
    rightHip: poseAngle(point(COLLECTION_INDEX.rightShoulder), point(COLLECTION_INDEX.rightHip), point(COLLECTION_INDEX.rightKnee)),
    leftElbow: poseAngle(point(COLLECTION_INDEX.leftShoulder), point(COLLECTION_INDEX.leftElbow), point(COLLECTION_INDEX.leftWrist)),
    rightElbow: poseAngle(point(COLLECTION_INDEX.rightShoulder), point(COLLECTION_INDEX.rightElbow), point(COLLECTION_INDEX.rightWrist)),
    leftBodyLine: poseAngle(point(COLLECTION_INDEX.leftShoulder), point(COLLECTION_INDEX.leftHip), point(COLLECTION_INDEX.leftAnkle)),
    rightBodyLine: poseAngle(point(COLLECTION_INDEX.rightShoulder), point(COLLECTION_INDEX.rightHip), point(COLLECTION_INDEX.rightAnkle)),
    leftTorsoTilt: torsoTilt(point(COLLECTION_INDEX.leftShoulder), point(COLLECTION_INDEX.leftHip)),
    rightTorsoTilt: torsoTilt(point(COLLECTION_INDEX.rightShoulder), point(COLLECTION_INDEX.rightHip)),
  };
}

function serializeCollectionLandmarks(landmarks: NormalizedLandmark[]) {
  return landmarks.map((point, index) => ({
    index,
    name: LANDMARK_NAMES[index] ?? `landmark_${index}`,
    x: roundMetric(point.x) ?? 0,
    y: roundMetric(point.y) ?? 0,
    z: roundMetric(point.z) ?? 0,
    visibility: roundMetric(point.visibility ?? null),
  }));
}

function exportJsonl(samples: DataCollectionSample[], filename: string) {
  if (typeof window === 'undefined' || samples.length === 0) return;
  const content = samples.map((sample) => JSON.stringify(sample)).join('\n');
  const blob = new Blob([`${content}\n`], { type: 'application/x-ndjson;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function emptyPoseQuality(): PoseQuality {
  return {
    visibleLandmarks: 0,
    averageVisibility: 0,
    centered: false,
    stableFrames: 0,
    stable: false,
    usable: false,
    issue: 'step_into_frame',
  };
}

function smoothLandmarks(previous: NormalizedLandmark[] | null, current: NormalizedLandmark[]) {
  if (!previous || previous.length !== current.length) return current.map((point) => ({ ...point }));
  return current.map((point, index) => ({
    ...point,
    x: previous[index].x + (point.x - previous[index].x) * SMOOTHING_ALPHA,
    y: previous[index].y + (point.y - previous[index].y) * SMOOTHING_ALPHA,
    z: previous[index].z + (point.z - previous[index].z) * SMOOTHING_ALPHA,
    visibility: point.visibility ?? previous[index].visibility,
  }));
}

function getPoseBounds(landmarks: NormalizedLandmark[]) {
  const visible = landmarks.filter((point) => (point.visibility ?? 0) >= 0.35);
  const points = visible.length >= 8 ? visible : landmarks;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function assessLandmarkQuality(landmarks: NormalizedLandmark[] | null, previousStableFrames: number): PoseQuality {
  if (!landmarks?.length) return emptyPoseQuality();

  const visibleLandmarks = landmarks.filter((point) => (point.visibility ?? 0) >= 0.45).length;
  const averageVisibility = landmarks.reduce((sum, point) => sum + (point.visibility ?? 0), 0) / landmarks.length;
  const bounds = getPoseBounds(landmarks);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centered = centerX > 0.2 && centerX < 0.8 && centerY > 0.16 && centerY < 0.86;
  const fullBodyLikelyVisible = bounds.minY > -0.08 && bounds.maxY < 1.08 && bounds.minX > -0.08 && bounds.maxX < 1.08;
  const enoughLandmarks = visibleLandmarks >= MIN_VISIBLE_LANDMARKS;
  const enoughVisibility = averageVisibility >= MIN_AVERAGE_VISIBILITY;
  const frameQualityOk = enoughLandmarks && enoughVisibility && centered && fullBodyLikelyVisible;
  const stableFrames = frameQualityOk ? Math.min(previousStableFrames + 1, CALIBRATION_STABLE_FRAMES) : 0;
  const stable = stableFrames >= CALIBRATION_STABLE_FRAMES;
  let issue: string | null = null;

  if (!enoughLandmarks || !fullBodyLikelyVisible) issue = 'full_body_required';
  else if (!centered) issue = 'keep_body_in_frame';
  else if (!enoughVisibility) issue = 'improve_lighting';
  else if (!stable) issue = 'hold_still';

  return {
    visibleLandmarks,
    averageVisibility: Math.round(averageVisibility * 100),
    centered,
    stableFrames,
    stable,
    usable: frameQualityOk && stable,
    issue,
  };
}

function makeVideoConstraints(nextFacingMode: 'user' | 'environment', nextDeviceId: string, includeFrameRate = true): MediaTrackConstraints {
  const base: MediaTrackConstraints = nextDeviceId !== 'default'
    ? { deviceId: { exact: nextDeviceId } }
    : { facingMode: { ideal: nextFacingMode } };
  return {
    ...base,
    width: { ideal: 1280 },
    height: { ideal: 720 },
    ...(includeFrameRate ? { frameRate: { ideal: 30, max: 30 } } : {}),
  };
}

const cueCopy: Record<string, { en: string; ar: string | string[] }> = {
  basic_tracking: {
    en: 'Pose tracking is active. Keep your full body visible and move with control.',
    ar: ['التتبع شغال، خليك واضح بالكاميرا', 'حركة منيحة، خليك مبين كامل'],
  },
  low_pose_confidence: {
    en: 'Improve lighting and keep the working joints visible.',
    ar: ['الإضاءة ضعيفة شوي، جرب مكان أوضح', 'خلي جسمك أوضح، الإضاءة بدها تزيد'],
  },
  unsupported_exercise: {
    en: 'I can see your body, but this exercise has visibility tracking only.',
    ar: ['شايفك، بس هالتمرين تتبعه عام بس', 'واضح بالكاميرا، بس بدون تصحيح تفصيلي'],
  },
  pose_model_unavailable: {
    en: 'Pose analysis could not load. Refresh the page and try again.',
    ar: 'تحليل الحركة ما اشتغل، حدث الصفحة وجرب',
  },
  pose_detection_unavailable: {
    en: 'Pose tracking stopped. Restart the camera session.',
    ar: 'التتبع وقف، شغل الكاميرا من جديد',
  },
  step_into_frame: {
    en: 'Step into the frame.',
    ar: ['تعال شوي قدام الكاميرا', 'خليك قدام الكاميرا'],
  },
  full_body_required: {
    en: 'Step back until your full body is visible.',
    ar: ['ارجع شوي لورا، خلي جسمك يبين كامل', 'بعد شوي عن الكاميرا عشان جسمك يطلع كامل'],
  },
  keep_body_in_frame: {
    en: 'Keep your body inside the frame.',
    ar: ['خليك بنص الكاميرا', 'خلي جسمك كله داخل الصورة'],
  },
  improve_lighting: {
    en: 'Improve lighting.',
    ar: ['الإضاءة ضعيفة شوي، جرب مكان أوضح', 'زيد الإضاءة شوي'],
  },
  hold_still: {
    en: 'Hold steady for a moment so I can calibrate.',
    ar: ['اثبت لحظة، بدي أظبط التتبع', 'ضل ثابت شوي'],
  },
  face_camera: {
    en: 'Face the camera.',
    ar: ['واجه الكاميرا', 'لف جسمك شوي عالكاميرا'],
  },
  form_good: {
    en: 'Good form. Keep going.',
    ar: ['ممتاز، ضلك ثابت', 'حركة منيحة، كمل', 'تمام، كمل هيك'],
  },
  raise_hips: {
    en: 'Raise your hips slightly.',
    ar: ['ظهرك نازل شوي، ارفعه شوي', 'ارفع الورك شوي'],
  },
  lower_hips: {
    en: 'Lower your hips slightly.',
    ar: ['الورك عالي شوي، نزله شوي', 'نزل الحوض شوي'],
  },
  open_elbows: {
    en: 'Open your elbow angle.',
    ar: ['قرب إيديك شوي من وضعية التمرين', 'افتح كوعك شوي وخليك مسيطر'],
  },
  chest_up: {
    en: 'Lift your chest.',
    ar: ['ارفع صدرك شوي', 'خلي صدرك لفوق'],
  },
  lower_squat: {
    en: 'Bend your knees and lower.',
    ar: ['انزل شوي كمان بالسكوات', 'اثني ركبتك وانزل شوي'],
  },
  squat_too_deep: {
    en: 'Rise slightly.',
    ar: ['اطلع شوي لفوق', 'خفف النزلة شوي'],
  },
  lower_lunge: {
    en: 'Lower into the lunge.',
    ar: 'انزل شوي كمان باللانج',
  },
  shorten_lunge: {
    en: 'Shorten your stance slightly.',
    ar: 'قرب رجليك شوي',
  },
  bend_back_knee: {
    en: 'Bend your back knee.',
    ar: 'اثني الركبة اللي ورا شوي',
  },
  steady_torso: { en: 'Keep your torso steady.', ar: 'ثبّت جذعك وتجنب التأرجح.' },
  elbows_close: { en: 'Keep the upper arms closer to your sides.', ar: 'أبقِ العضد قريبًا من جانبي الجسم.' },
  shoulder_height: { en: 'Keep the raise near shoulder height.', ar: 'خفّض الذراعين إلى مستوى الكتف.' },
  press_setup: { en: 'Bring the weights to shoulder level to start.', ar: 'ابدأ واليدان عند مستوى الكتف.' },
  hinge_not_squat: { en: 'Move the hips back with a soft knee bend.', ar: 'ارجع بالورك مع ثني بسيط للركبة.' },
  bridge_setup: { en: 'Lie down and show the side of your body.', ar: 'استلقِ وأظهر جسمك من الجانب.' },
  bridge_feet: { en: 'Bring your feet closer and bend the knees.', ar: 'قرّب القدمين واثنِ الركبتين.' },
  both_legs_required: { en: 'Keep both legs visible.', ar: 'أظهر الساقين كاملتين.' },
};

function cueFromKey(key: string, severity: CueSeverity, speak = true): CoachingCue {
  const copy = cueCopy[key] ?? cueCopy.step_into_frame;
  const ar = Array.isArray(copy.ar)
    ? copy.ar[Math.floor(Date.now() / VOICE_COOLDOWN_MS) % copy.ar.length]
    : copy.ar;
  return { key, severity, en: copy.en, ar, speak };
}

function severityFromFeedback(feedback: PoseFeedback): CueSeverity {
  if (feedback.status === 'waiting_for_body') return 'camera-setup';
  if (feedback.level === 'good') return 'good';
  if (feedback.level === 'adjust') return 'correction';
  return 'caution';
}

function createCoachingCue(
  feedback: PoseFeedback,
  poseQuality: PoseQuality,
  trackingSupport: ExerciseTrackingConfig['support'] | undefined,
  modelState: 'loading' | 'ready' | 'error',
  liveReady: boolean
): CoachingCue {
  if (modelState === 'error') return cueFromKey(feedback.message, 'camera-setup');
  if (!liveReady || modelState === 'loading') {
    return {
      key: 'camera_idle',
      severity: 'camera-setup',
      en: 'Start the camera and stand where your full body is visible.',
      ar: 'شغل الكاميرا ووقف بمكان يبين جسمك كامل.',
      speak: false,
    };
  }
  if (!poseQuality.usable && poseQuality.issue) return cueFromKey(poseQuality.issue, 'camera-setup');
  if (trackingSupport === 'basic' && feedback.message === 'basic_tracking') return cueFromKey('basic_tracking', 'caution', false);
  if (trackingSupport === 'unsupported') return cueFromKey('unsupported_exercise', 'camera-setup', false);
  return cueFromKey(feedback.message, severityFromFeedback(feedback));
}

function pickSpeechVoice(voices: SpeechSynthesisVoice[], language: string) {
  if (language === 'ar') {
    const preferredArabic = ['ar-JO', 'ar_JO', 'ar-SA', 'ar_SA', 'ar-XA', 'ar_XA', 'ar'];
    return preferredArabic
      .map((lang) => voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase()))
      .find(Boolean)
      ?? voices.find((voice) => /^ar(-|_|$)/i.test(voice.lang))
      ?? voices.find((voice) => /arabic|عربي/i.test(voice.name))
      ?? null;
  }
  return voices.find((voice) => /^en(-|_|$)/i.test(voice.lang)) ?? null;
}

export function LiveCoachPage() {
  const { language } = useLanguage();
  const { profile } = useUser();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const animationRef = useRef<number | null>(null);
  const stopCameraRef = useRef<() => void>(() => {});
  const lastInferenceRef = useRef(0);
  const feedbackCandidateRef = useRef({ key: '', frames: 0 });
  const smoothedLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const poseQualityRef = useRef<PoseQuality>(emptyPoseQuality());
  const lastSpokenCueRef = useRef({ key: '', time: 0 });
  const progressRef = useRef<LiveCoachProgress>(createEmptyProgress());
  const liveSessionIdRef = useRef(createLocalId('live_session'));
  const collectionSessionIdRef = useRef(createLocalId('session'));
  const collectionParticipantIdRef = useRef('');
  const collectionActiveRef = useRef(false);
  const lastCollectionSampleRef = useRef(0);
  const liveExercises = useMemo(() => exerciseCatalog.map(toLiveExercise), []);
  const defaultExercise = liveExercises.find((item) => item.tracking.support === 'full') ?? liveExercises[0];
  const routeState = location.state as LiveCoachRouteState | null;
  const requestedExerciseId = searchParams.get('exerciseId') || searchParams.get('exercise') || routeState?.exerciseId || '';
  const requestedExerciseName = searchParams.get('exerciseName') || routeState?.exerciseName || '';
  const collectionModeEnabled = searchParams.get('collect') === '1';
  const requestedExercise = useMemo(() => {
    const requestedId = requestedExerciseId.trim();
    if (requestedId) {
      const byId = liveExercises.find((item) => item.id === requestedId);
      if (byId) return byId;
    }

    const requestedName = normalizeExerciseName(requestedExerciseName);
    if (!requestedName) return null;
    return liveExercises.find((item) =>
      normalizeExerciseName(item.name) === requestedName ||
      normalizeExerciseName(item.nameAr) === requestedName
    ) ?? null;
  }, [liveExercises, requestedExerciseId, requestedExerciseName]);
  const initialExercise = requestedExercise ?? defaultExercise;
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [cameraIssue, setCameraIssue] = useState<CameraIssue>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('default');
  const [exercise, setExercise] = useState(initialExercise?.id ?? 'plank');
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(initialExercise?.difficulty ?? 'normal');
  const [exerciseQuery, setExerciseQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState('all');
  const [genderChoice, setGenderChoice] = useState<string | null>(null);
  const [placeChoice, setPlaceChoice] = useState<string | null>(null);
  const genderFilter = genderChoice ?? profile?.gender ?? 'all';
  const placeFilter = placeChoice ?? profile?.location ?? 'all';
  const [levelFilter, setLevelFilter] = useState('all');
  const repCounterRef = useRef(emptyRepCounter());
  const [completedReps, setCompletedReps] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [bodyDetected, setBodyDetected] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [modelState, setModelState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [poseQuality, setPoseQuality] = useState<PoseQuality>(() => emptyPoseQuality());
  const [poseFeedback, setPoseFeedback] = useState<PoseFeedback>(() => createPoseFeedback());
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [collectionLabel, setCollectionLabel] = useState<CollectionLabel>('correct');
  const [collectionMistakeType, setCollectionMistakeType] = useState('none');
  const [collectionCameraAngle, setCollectionCameraAngle] = useState<CollectionCameraAngle>('unknown');
  const [collectionDifficulty, setCollectionDifficulty] = useState<CollectionDifficulty>('normal');
  const [collectionSamples, setCollectionSamples] = useState<DataCollectionSample[]>([]);
  const [isCollecting, setIsCollecting] = useState(false);
  const [recentSessions, setRecentSessions] = useState<RecentLiveSession[]>(() => loadRecentLiveSessions());

  const text = useCallback((en: string, ar: string) => (language === 'ar' ? ar : en), [language]);
  const isArabic = language === 'ar';
  const selectedExercise = useMemo(
    () => liveExercises.find((item) => item.id === exercise) ?? defaultExercise,
    [defaultExercise, exercise, liveExercises]
  );
  const selectedExerciseLabel = selectedExercise
    ? localizedLabel(selectedExercise.name, selectedExercise.nameAr, language)
    : text('Exercise', 'التمرين');
  const selectedTracking = selectedExercise?.tracking ?? null;
  const supportedPose = selectedTracking?.pose ?? null;
  const canStartSession = selectedTracking?.support !== 'unsupported';
  const collectionExercise = selectedTracking?.pose && COLLECTION_EXERCISES.includes(selectedTracking.pose as CollectionExercise)
    ? selectedTracking.pose as CollectionExercise
    : null;
  const collectionMistakeOptions = collectionExercise ? COLLECTION_MISTAKES[collectionExercise] : ['none'];
  const canCollectCurrentExercise = collectionModeEnabled && Boolean(collectionExercise);
  const filteredExercises = useMemo(() => {
    const query = exerciseQuery.trim().toLowerCase();
    return liveExercises
      .filter((item) => levelFilter === 'all' || item.difficulty === levelFilter)
      .filter((item) => muscleFilter === 'all' || item.source.muscle === muscleFilter)
      .filter((item) => genderFilter === 'all' || item.source.gender === 'all' || item.source.gender === genderFilter)
      .filter((item) => placeFilter === 'all' || item.source.location === 'both' || item.source.location === placeFilter)
      .filter((item) => {
        if (!query) return true;
        return `${item.name} ${item.nameAr} ${item.source.muscle}`.toLowerCase().includes(query);
      });
  }, [levelFilter, muscleFilter, genderFilter, placeFilter, exerciseQuery, liveExercises]);

  const saveSessionSummary = useCallback(() => {
    if (cameraState !== 'live') return;
    const progress = progressRef.current;
    const meaningfulAnalysis = progress.analyzedSamples > 0 || poseFeedback.score !== null || bodyDetected;
    if (!meaningfulAnalysis && elapsed <= 5) return;

    const corrections = Object.entries(progress.corrections)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([message, count]) => ({ message: feedbackCopy[message]?.[0] || message, count }));
    const averageFormScore = progress.scoredSamples > 0
      ? clampPercent(progress.scoreSum / progress.scoredSamples)
      : progress.analyzedSamples > 0
        ? clampPercent((progress.goodSamples / progress.analyzedSamples) * 100)
        : null;
    const summary: RecentLiveSession = {
      sessionId: liveSessionIdRef.current,
      exerciseId: selectedExercise?.id ?? exercise,
      exerciseName: selectedExercise?.name ?? exercise,
      duration: elapsed,
      timestamp: new Date().toISOString(),
      bestFormScore: progress.bestScore !== null ? clampPercent(progress.bestScore) : poseFeedback.score,
      averageFormScore,
      confidence: poseFeedback.confidence > 0 ? poseFeedback.confidence : null,
      supportLevel: selectedTracking?.support ?? 'unsupported',
      corrections,
      finalStatus: feedbackCopy[poseFeedback.message]?.[0] || poseFeedback.status || poseFeedback.message,
    };

    setRecentSessions((current) => {
      const next = [summary, ...current.filter((item) => item.sessionId !== summary.sessionId)].slice(0, RECENT_SESSIONS_LIMIT);
      persistRecentLiveSessions(next);
      return next;
    });
  }, [bodyDetected, cameraState, elapsed, exercise, poseFeedback, selectedExercise?.id, selectedExercise?.name, selectedTracking?.support]);

  const clearRecentSessions = useCallback(() => {
    setRecentSessions([]);
    persistRecentLiveSessions([]);
  }, []);

  const stopCamera = useCallback(() => {
    saveSessionSummary();
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    collectionActiveRef.current = false;
    setIsCollecting(false);
    setCameraState('idle');
    setCameraIssue(null);
    setElapsed(0);
    setIsPaused(false);
    setBodyDetected(false);
    poseQualityRef.current = emptyPoseQuality();
    setPoseQuality(poseQualityRef.current);
    smoothedLandmarksRef.current = null;
    setPoseFeedback(createPoseFeedback());
  }, [saveSessionSummary]);

  const resetSession = useCallback(() => {
    repCounterRef.current = emptyRepCounter();
    setCompletedReps(0);
    progressRef.current = createEmptyProgress();
    liveSessionIdRef.current = createLocalId('live_session');
    feedbackCandidateRef.current = { key: '', frames: 0 };
    smoothedLandmarksRef.current = null;
    setElapsed(0);
    setBodyDetected(false);
    poseQualityRef.current = emptyPoseQuality();
    setPoseQuality(poseQualityRef.current);
    setPoseFeedback(createPoseFeedback());
  }, []);

  const refreshDevices = useCallback(async () => {
    const available = await navigator.mediaDevices.enumerateDevices();
    setDevices(available.filter((device) => device.kind === 'videoinput'));
  }, []);

  const buildCollectionSample = useCallback((landmarks: NormalizedLandmark[], quality: PoseQuality, feedback: PoseFeedback): DataCollectionSample | null => {
    if (!collectionModeEnabled || !collectionExercise) return null;
    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks()[0] ?? null;
    const settings = track?.getSettings();
    const effectiveLabel: CollectionLabel = quality.usable ? collectionLabel : 'setup_bad';

    return {
      sampleId: createLocalId('sample'),
      sessionId: collectionSessionIdRef.current,
      participantId: collectionParticipantIdRef.current || getLocalParticipantId(),
      exercise: collectionExercise,
      label: effectiveLabel,
      mistakeType: effectiveLabel === 'setup_bad' ? 'setup_bad' : collectionMistakeType,
      cameraAngle: collectionCameraAngle,
      difficulty: collectionDifficulty,
      repPhase: feedback.repPhase,
      supportLevel: feedback.supportLevel,
      landmarks: serializeCollectionLandmarks(landmarks),
      jointAngles: extractCollectionJointAngles(landmarks),
      confidence: {
        pose: feedback.confidence,
        averageVisibility: quality.averageVisibility,
        visibleLandmarks: quality.visibleLandmarks,
        centered: quality.centered,
        stableFrames: quality.stableFrames,
        usable: quality.usable,
        issue: quality.issue,
      },
      camera: {
        width: settings?.width ?? video?.videoWidth ?? null,
        height: settings?.height ?? video?.videoHeight ?? null,
        fps: settings?.frameRate ?? null,
        facingMode: settings?.facingMode ?? facingMode,
        deviceId: settings?.deviceId ?? (deviceId === 'default' ? null : deviceId),
      },
      timestamp: new Date().toISOString(),
      appVersion: DATA_COLLECTION_APP_VERSION,
    };
  }, [collectionCameraAngle, collectionDifficulty, collectionExercise, collectionLabel, collectionMistakeType, collectionModeEnabled, deviceId, facingMode]);

  const startDataCollection = useCallback(() => {
    if (!canCollectCurrentExercise || cameraState !== 'live' || modelState !== 'ready') return;
    collectionParticipantIdRef.current = getLocalParticipantId();
    collectionSessionIdRef.current = createLocalId('session');
    lastCollectionSampleRef.current = 0;
    collectionActiveRef.current = true;
    setIsCollecting(true);
  }, [cameraState, canCollectCurrentExercise, modelState]);

  const stopDataCollection = useCallback(() => {
    collectionActiveRef.current = false;
    setIsCollecting(false);
  }, []);

  const clearCollectionBatch = useCallback(() => {
    stopDataCollection();
    setCollectionSamples([]);
    collectionSessionIdRef.current = createLocalId('session');
    lastCollectionSampleRef.current = 0;
  }, [stopDataCollection]);

  const exportCollectionBatch = useCallback(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    exportJsonl(collectionSamples, `aifitcoach-livecoach-${collectionExercise ?? 'exercise'}-${stamp}.jsonl`);
  }, [collectionExercise, collectionSamples]);

  const startCamera = useCallback(async (nextFacingMode = facingMode, nextDeviceId = deviceId) => {
    if (!canStartSession) {
      setCameraIssue('unsupported');
      setErrorMessage(selectedTracking?.reason ?? text('This exercise is not supported for camera tracking yet.', 'هذا التمرين غير مدعوم لتتبع الكاميرا حالياً.'));
      setCameraState('error');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraIssue('unsupported');
      setErrorMessage(text('This browser does not support camera access.', 'هذا المتصفح لا يدعم الوصول إلى الكاميرا.'));
      setCameraState('error');
      return;
    }

    const isNewSession = !streamRef.current;
    if (isNewSession) {
      progressRef.current = createEmptyProgress();
      liveSessionIdRef.current = createLocalId('live_session');
    }
    setCameraState('starting');
    setCameraIssue(null);
    setIsPaused(false);
    setBodyDetected(false);
    poseQualityRef.current = emptyPoseQuality();
    setPoseQuality(poseQualityRef.current);
    setErrorMessage('');
    streamRef.current?.getTracks().forEach((track) => track.stop());

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: makeVideoConstraints(nextFacingMode, nextDeviceId, true),
          audio: false,
        });
      } catch (constraintError) {
        console.warn('Live Coach camera rejected 30fps preference; retrying without frame-rate constraint.', constraintError);
        stream = await navigator.mediaDevices.getUserMedia({
          video: makeVideoConstraints(nextFacingMode, nextDeviceId, false),
          audio: false,
        });
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraState('live');
      setElapsed(0);
      await refreshDevices();
    } catch (error) {
      const denied = error instanceof DOMException && error.name === 'NotAllowedError';
      const missing = error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError');
      setCameraIssue(denied ? 'permission-denied' : missing ? 'no-camera' : 'unknown');
      setErrorMessage(denied
        ? text('Camera permission was denied.', 'تم رفض إذن الكاميرا.')
        : missing
          ? text('No camera was found on this device.', 'لم يتم العثور على كاميرا على هذا الجهاز.')
        : text('The camera could not be started.', 'تعذر تشغيل الكاميرا.'));
      setCameraState('error');
    }
  }, [canStartSession, deviceId, facingMode, refreshDevices, selectedTracking?.reason, text]);

  const switchCamera = async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    setDeviceId('default');
    await startCamera(next, 'default');
  };

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      setModelState('loading');
      try {
        const vision = await FilesetResolver.forVisionTasks(POSE_WASM_PATH);
        let landmarker: PoseLandmarker;
        try {
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate: 'GPU' },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.55,
            minPosePresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
          });
        } catch (gpuError) {
          console.warn('Live Coach pose model GPU initialization failed; retrying on CPU.', gpuError);
          landmarker = await PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate: 'CPU' },
            runningMode: 'VIDEO',
            numPoses: 1,
            minPoseDetectionConfidence: 0.55,
            minPosePresenceConfidence: 0.55,
            minTrackingConfidence: 0.55,
          });
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setModelState('ready');
      } catch (error) {
        console.error('Live Coach pose model failed to load.', error);
        if (!cancelled) {
          setModelState('error');
          setPoseFeedback(createPoseFeedback('pose_model_unavailable'));
        }
      }
    };
    initialize();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (cameraState !== 'live' || modelState !== 'ready' || isPaused) return;

    const analyze = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !canvas || !landmarker || video.readyState < 2) {
        animationRef.current = requestAnimationFrame(analyze);
        return;
      }

      const now = performance.now();
      if (now - lastInferenceRef.current >= 100) {
        lastInferenceRef.current = now;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const context = canvas.getContext('2d');
        if (context) {
          context.clearRect(0, 0, canvas.width, canvas.height);
          let result: ReturnType<PoseLandmarker['detectForVideo']>;
          try {
            result = landmarker.detectForVideo(video, now);
          } catch (error) {
            console.error('Live Coach pose detection loop failed.', error);
            setModelState('error');
            setBodyDetected(false);
            setPoseFeedback(createPoseFeedback('pose_detection_unavailable'));
            if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
            return;
          }
          const landmarks = result.landmarks[0] ?? null;
          const smoothedLandmarks = landmarks ? smoothLandmarks(smoothedLandmarksRef.current, landmarks) : null;
          smoothedLandmarksRef.current = smoothedLandmarks;
          const quality = assessLandmarkQuality(smoothedLandmarks, poseQualityRef.current.stableFrames);
          poseQualityRef.current = quality;
          setPoseQuality(quality);
          setBodyDetected(Boolean(smoothedLandmarks));
          if (smoothedLandmarks) {
            const drawing = new DrawingUtils(context);
            drawing.drawConnectors(smoothedLandmarks, PoseLandmarker.POSE_CONNECTIONS, { color: quality.usable ? '#67e8f9' : '#93c5fd', lineWidth: 3 });
            drawing.drawLandmarks(smoothedLandmarks, { color: '#ffffff', fillColor: quality.usable ? '#22c55e' : '#60a5fa', lineWidth: 1.4, radius: 3.4 });
          }

          const trackingSupport = selectedTracking?.support ?? 'unsupported';
          const nextFeedback = smoothedLandmarks && !quality.usable
            ? createPoseFeedback(quality.issue ?? 'step_into_frame', estimatePoseConfidence(smoothedLandmarks), 'basic')
            : smoothedLandmarks && supportedPose
              ? assessPose(supportedPose, smoothedLandmarks, video.videoWidth / video.videoHeight)
              : smoothedLandmarks && trackingSupport === 'basic'
                ? createPoseFeedback('basic_tracking', estimatePoseConfidence(smoothedLandmarks), 'basic')
                : createPoseFeedback(smoothedLandmarks ? 'unsupported_exercise' : 'step_into_frame', smoothedLandmarks ? estimatePoseConfidence(smoothedLandmarks) : 0, 'basic');
          if (selectedTracking?.support === 'basic') nextFeedback.supportLevel = 'basic';
          const nextRep = advanceRep(repCounterRef.current, nextFeedback.repPhase, now, quality.usable && nextFeedback.level !== 'waiting');
          if (nextRep.count !== repCounterRef.current.count) setCompletedReps(nextRep.count);
          repCounterRef.current = nextRep;
          if (nextFeedback.score !== null) {
            const progress = progressRef.current;
            progress.analyzedSamples += 1;
            progress.scoredSamples += 1;
            progress.scoreSum += nextFeedback.score;
            progress.bestScore = progress.bestScore === null ? nextFeedback.score : Math.max(progress.bestScore, nextFeedback.score);
            if (nextFeedback.level === 'good') progress.goodSamples += 1;
            if (nextFeedback.level === 'adjust') {
              progress.corrections[nextFeedback.message] = (progress.corrections[nextFeedback.message] || 0) + 1;
            }
          }
          if (collectionActiveRef.current && smoothedLandmarks && now - lastCollectionSampleRef.current >= COLLECTION_SAMPLE_INTERVAL_MS) {
            lastCollectionSampleRef.current = now;
            const sample = buildCollectionSample(smoothedLandmarks, quality, nextFeedback);
            if (sample) setCollectionSamples((current) => [...current, sample]);
          }
          const key = `${nextFeedback.level}:${nextFeedback.message}`;
          const candidate = feedbackCandidateRef.current;
          candidate.frames = candidate.key === key ? candidate.frames + 1 : 1;
          candidate.key = key;
          if (candidate.frames >= 3) setPoseFeedback(nextFeedback);
        }
      }
      animationRef.current = requestAnimationFrame(analyze);
    };

    animationRef.current = requestAnimationFrame(analyze);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
      canvasRef.current?.getContext('2d')?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    };
  }, [buildCollectionSample, cameraState, isPaused, modelState, selectedTracking?.support, supportedPose]);

  useEffect(() => {
    resetSession();
    stopDataCollection();
  }, [exercise, resetSession, stopDataCollection]);

  useEffect(() => {
    if (!collectionModeEnabled) return;
    collectionParticipantIdRef.current = getLocalParticipantId();
  }, [collectionModeEnabled]);

  useEffect(() => {
    if (!collectionMistakeOptions.includes(collectionMistakeType)) {
      setCollectionMistakeType(collectionMistakeOptions[0] ?? 'none');
    }
  }, [collectionMistakeOptions, collectionMistakeType]);

  useEffect(() => {
    if (!canCollectCurrentExercise && isCollecting) stopDataCollection();
  }, [canCollectCurrentExercise, isCollecting, stopDataCollection]);


  useEffect(() => {
    if (cameraState !== 'live' || isPaused) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [cameraState, isPaused]);

  useEffect(() => {
    stopCameraRef.current = stopCamera;
  }, [stopCamera]);

  useEffect(() => () => stopCameraRef.current(), []);

  useEffect(() => {
    if (!requestedExercise) return;
    stopCameraRef.current();
    resetSession();
    setDifficulty(requestedExercise.difficulty);
    setExercise(requestedExercise.id);
  }, [requestedExercise, resetSession]);

  const liveReady = cameraState === 'live';
  const trackingReady = modelState === 'ready';
  const analysisActive = liveReady && trackingReady && !isPaused;
  const bodyNotDetected = liveReady && trackingReady && !bodyDetected;
  const coachingCue = createCoachingCue(poseFeedback, poseQuality, selectedTracking?.support, modelState, liveReady);
  const needsVisibilityAdjustment = ['full_body_required', 'step_into_frame', 'low_pose_confidence', 'keep_body_in_frame', 'improve_lighting', 'hold_still'].includes(poseFeedback.message);
  const confidenceLabel = poseFeedback.confidence > 0
    ? `${poseFeedback.confidence}%`
    : bodyDetected
      ? text('Pose visible', 'الوضعية ظاهرة')
      : text('Waiting for body', 'بانتظار ظهور الجسم');
  const supportLabel = supportedPose
    ? poseFeedback.supportLevel === 'full'
      ? text('Full tracking', 'تحليل كامل')
      : text('Basic tracking', 'تتبع أساسي')
    : text('Preview only', 'عرض فقط');
  const trackingSupportLabel = selectedTracking?.support === 'full'
    ? text('Angle checks', 'فحص الزوايا')
    : selectedTracking?.support === 'basic'
      ? selectedTracking.pose ? text('Movement cues (beta)', 'توجيه الحركة (تجريبي)') : text('Visibility only', 'تتبع الظهور فقط')
      : text('Not supported', 'غير مدعوم');
  const trackedRatio = progressRef.current.analyzedSamples
    ? `${Math.round((progressRef.current.goodSamples / progressRef.current.analyzedSamples) * 100)}%`
    : text('Collecting', 'قيد الجمع');
  const sessionProgress = progressRef.current;
  const formScoreValue = clampPercent(poseFeedback.score ?? 0);
  const confidenceValue = clampPercent(liveReady ? (poseFeedback.confidence || poseQuality.averageVisibility) : 0);
  const stabilityValue = clampPercent(!liveReady ? 0 : poseQuality.stable ? Math.max(82, poseQuality.averageVisibility) : Math.min(74, poseQuality.averageVisibility));
  const averageFormScoreValue = clampPercent(sessionProgress.analyzedSamples
    ? (sessionProgress.goodSamples / sessionProgress.analyzedSamples) * 100
    : formScoreValue);
  const bestFormScoreValue = clampPercent(Math.max(formScoreValue, averageFormScoreValue));
  const consistencyValue = clampPercent(sessionProgress.analyzedSamples
    ? (sessionProgress.goodSamples / sessionProgress.analyzedSamples) * 100
    : stabilityValue);
  const completionValue = clampPercent(Math.min(100, Math.max(completedReps * 8, sessionProgress.analyzedSamples ? averageFormScoreValue : 0)));
  const currentStreakValue = sessionProgress.goodSamples;
  const analyticsCards = [
    {
      label: text('Angle score', 'نتيجة الزوايا'),
      value: liveReady && poseFeedback.score !== null ? String(formScoreValue) : '—',
      suffix: liveReady && poseFeedback.score !== null ? '/100' : '',
      trend: text('Rule-based estimate', 'تقدير مبني على قواعد'),
      status: text('Not a complete form assessment', 'ليس تقييمًا شاملًا للأداء'),
      progress: formScoreValue, tone: metricToneFor(formScoreValue, liveReady),
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    {
      label: text('Pose confidence', 'ثقة رصد المفاصل'),
      value: confidenceValue > 0 ? `${confidenceValue}%` : '—',
      trend: text('Visible landmarks', 'المفاصل الظاهرة'),
      status: bodyDetected ? text('Body visible', 'الجسم ظاهر') : text('Waiting for body', 'بانتظار الجسم'),
      progress: confidenceValue, tone: metricToneFor(confidenceValue, liveReady),
      icon: <Radar className="h-4 w-4" />,
    },
    {
      label: text('Reps', 'التكرارات'),
      value: supportedPose && supportedPose !== 'plank' ? String(completedReps) : '—',
      trend: text('Complete movement cycles', 'دورات حركة كاملة'),
      status: supportedPose === 'plank' ? text('Hold exercise', 'تمرين ثبات') : supportedPose ? text('Experimental counter', 'عدّاد تجريبي') : text('Not available for this movement', 'غير متاح لهذه الحركة'),
      progress: 0, tone: 'purple', icon: <Dumbbell className="h-4 w-4" />,
    },
  ] as const;
  const collectionReady = canCollectCurrentExercise && cameraState === 'live' && modelState === 'ready';
  const collectionStatus = !collectionModeEnabled
    ? text('Hidden', 'مخفي')
    : !canCollectCurrentExercise
      ? text('Select squat, push-up, or plank', 'اختر السكوات أو الضغط أو البلانك')
      : isCollecting
        ? text('Collecting locally', 'يتم الجمع محلياً')
        : text('Ready to collect', 'جاهز للجمع');

  const guidanceItems = [
    { label: text('Full body visible', 'ظهور الجسم كاملًا'), active: !needsVisibilityAdjustment },
    { label: text('Good lighting', 'إضاءة جيدة'), active: liveReady },
    { label: text('Camera stable', 'ثبات الكاميرا'), active: liveReady },
    { label: text('Exercise selected', 'تم اختيار التمرين'), active: Boolean(exercise) },
  ];

  const setupGuidanceItems = [
    { label: text('Full body visible', 'ظهور الجسم كامل'), active: bodyDetected && poseQuality.visibleLandmarks >= MIN_VISIBLE_LANDMARKS },
    { label: text('Good lighting', 'إضاءة واضحة'), active: poseQuality.averageVisibility >= Math.round(MIN_AVERAGE_VISIBILITY * 100) },
    { label: text('Body centered', 'جسمك بوسط الكاميرا'), active: poseQuality.centered },
    { label: text('Stable detection', 'التتبع ثابت'), active: poseQuality.stable },
    { label: text('Exercise selected', 'تم اختيار التمرين'), active: Boolean(exercise) },
  ];

  useEffect(() => {
    if (!voiceEnabled || !coachingCue.speak || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const now = Date.now();
    if (lastSpokenCueRef.current.key === coachingCue.key && now - lastSpokenCueRef.current.time < VOICE_COOLDOWN_MS) return;

    const speak = () => {
      const voices = window.speechSynthesis.getVoices();
      const utterance = new SpeechSynthesisUtterance(isArabic ? coachingCue.ar : coachingCue.en);
      const voice = pickSpeechVoice(voices, language);
      if (isArabic && !voice) {
        lastSpokenCueRef.current = { key: coachingCue.key, time: now };
        return;
      }
      if (voice) utterance.voice = voice;
      utterance.lang = isArabic ? (voice?.lang || 'ar-JO') : (voice?.lang || 'en-US');
      utterance.rate = isArabic ? 0.9 : 0.94;
      utterance.volume = 0.9;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
      lastSpokenCueRef.current = { key: coachingCue.key, time: now };
    };

    if (window.speechSynthesis.getVoices().length > 0) {
      speak();
      return;
    }

    const handleVoicesChanged = () => speak();
    window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged, { once: true });
    return () => window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
  }, [coachingCue, isArabic, language, voiceEnabled]);

  return (
    <div dir={isArabic ? 'rtl' : 'ltr'} className="live-coach-shell training-simple relative min-h-screen overflow-hidden bg-[#060816] pb-24 text-foreground md:pb-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(129,92,255,0.18),_transparent_28%),radial-gradient(circle_at_82%_18%,_rgba(34,211,238,0.12),_transparent_24%),radial-gradient(circle_at_50%_100%,_rgba(236,72,153,0.1),_transparent_34%)]" />
        <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:54px_54px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_48%,_rgba(1,3,10,0.76)_100%)]" />
      </div>
      <Navbar />
      <main className="relative z-10 mx-auto w-full max-w-[1680px] px-4 pt-20 sm:px-6 lg:px-8">
        <section className="mb-6 rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,18,32,0.86),rgba(9,11,22,0.72))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-2xl">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.32em] text-cyan-100/80">
              {text('LIVE COACH', 'تحليل الأداء المباشر بالذكاء الاصطناعي')}
            </span>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-200">
              {liveReady ? text('Live', 'مباشر') : text('Ready', 'جاهز')}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-muted-foreground">
              {text('Private live view', 'عرض مباشر خاص')}
            </span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
            {text('Live Form Coach', 'مدرب الأداء المباشر')}
          </h1>
          <div className="relative mt-3 h-1.5 w-44 overflow-hidden rounded-full bg-white/8">
            <div className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-300 blur-[1px]" />
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
            {text('Live exercise form feedback.', 'تتبع فوري للوضعية، وملاحظات للحركة، وتصحيح ذكي للتمرين في الوقت الحقيقي.')}
          </p>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,34%)] 2xl:grid-cols-[minmax(0,1fr)_minmax(22rem,32%)] xl:items-start">
          <aside className="hidden">
            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl" dir="ltr">
            <div className="flex flex-row items-center gap-4 text-start">
                <div className="relative h-20 w-20 shrink-0 rounded-full bg-gradient-primary p-[3px] shadow-[0_0_40px_rgba(168,85,247,0.24)]">
                  <div className="h-full w-full overflow-hidden rounded-full bg-secondary">
                    {profile?.avatarUrl ? (
                      <img src={profile.avatarUrl} alt={profile.name || 'Profile'} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-card">
                        <User className="h-14 w-14 text-primary" />
                      </div>
                    )}
                  </div>
                  <span className="absolute bottom-2 right-2 h-4 w-4 rounded-full border-2 border-background bg-emerald-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-foreground">{profile?.name || text('Your live session', 'جلستك المباشرة')}</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {profile?.goal && (
                      <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-medium text-fuchsia-100">
                        {profile.goal}
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-muted-foreground">
                      {text('Active Session', 'جلسة نشطة')}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <StatusRow label={text('Camera connected', 'الكاميرا متصلة')} value={liveReady ? text('Yes', 'نعم') : text('Waiting', 'انتظار')} active={liveReady} />
                <StatusRow label={text('Pose tracking ready', 'تتبع الحركة جاهز')} value={trackingReady ? text('Ready', 'جاهز') : text('Loading', 'جارٍ التحميل')} active={trackingReady} />
              </div>
            </div>

            <div className="order-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-300" />
                <h3 className="text-sm font-semibold text-white">{text('Tracking Guidance', 'إرشادات التتبع')}</h3>
              </div>
              <p className="mb-4 text-sm leading-6 text-muted-foreground">
                {text('Keep your full body visible inside the frame for better movement analysis.', 'حافظ على ظهور جسمك كاملًا داخل الإطار للحصول على تحليل أدق للحركة.')}
              </p>
              <div className="space-y-2">
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm">
                    <span className="text-foreground/90">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'جاهز') : text('Guide', 'تنبيه')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'المستوى')} value={difficulty === 'advanced' ? text('Advanced', 'متقدم') : text('Normal', 'عادي')} />
                <InfoChip label={text('Analysis', 'التحليل')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'الثقة')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'التكرارات')} value={text('Pending', 'لاحقاً')} />
              </div>
            </div>
            <div className="order-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.78),rgba(10,12,24,0.86))] p-5 shadow-[0_16px_48px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-violet-200" />
                  <h3 className="text-sm font-semibold text-white">{text('Recent Sessions', 'آخر الجلسات')}</h3>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearRecentSessions}
                  disabled={recentSessions.length === 0}
                  className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:text-white"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  {text('Clear', 'مسح')}
                </Button>
              </div>

              {recentSessions.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-6 text-muted-foreground">
                  {text('Stop a session longer than 5 seconds to save a local summary here.', 'أنهِ جلسة أطول من 5 ثواني لحفظ ملخص محلي هنا.')}
                </div>
              ) : (
                <div className="space-y-3">
                  {recentSessions.map((session) => {
                    const support = session.supportLevel === 'full'
                      ? text('Full tracking', 'تحليل كامل')
                      : session.supportLevel === 'basic'
                        ? text('Basic tracking', 'تتبع أساسي')
                        : text('Not supported', 'غير مدعوم');
                    return (
                      <div key={session.sessionId} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{session.exerciseName}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {new Date(session.timestamp).toLocaleString()} · {support}
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-mono text-cyan-100">
                            {formatElapsed(session.duration)}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                          <InfoChip label={text('Best', 'أفضل')} value={session.bestFormScore !== null ? `${session.bestFormScore}` : '--'} />
                          <InfoChip label={text('Avg', 'المتوسط')} value={session.averageFormScore !== null ? `${session.averageFormScore}` : '--'} />
                          <InfoChip label={text('Conf.', 'الثقة')} value={session.confidence !== null ? `${session.confidence}%` : '--'} />
                        </div>
                        <div className="mt-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                          <span className="text-white/80">{text('Final cue', 'آخر تنبيه')}:</span> {session.finalStatus}
                        </div>
                        {session.corrections.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {session.corrections.map((correction) => (
                              <span key={correction.message} className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-100">
                                {correction.message} ×{correction.count}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <details className="order-5 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.74),rgba(10,12,24,0.82))] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
              <summary className="cursor-pointer list-none text-sm font-semibold text-white outline-none marker:hidden">
                <span className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-200" />{text('Advanced details', 'تفاصيل متقدمة')}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{text('Optional', 'اختياري')}</span>
                </span>
              </summary>
              <div className="mt-4">
              <div className="flex items-center gap-3" dir="ltr">
                <div className="relative h-12 w-12 shrink-0 rounded-full bg-gradient-primary p-[2px]">
                  <div className="h-full w-full overflow-hidden rounded-full bg-secondary">
                    {profile?.avatarUrl ? (
                      <img src={profile.avatarUrl} alt={profile.name || 'Profile'} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-card">
                        <User className="h-6 w-6 text-primary" />
                      </div>
                    )}
                  </div>
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
                </div>
                    <div className="min-w-0 flex-1 text-start">
                  <div className="truncate text-sm font-semibold text-white">{profile?.name || text('Your live session', 'جلستك المباشرة')}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {profile?.goal && (
                      <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-medium text-fuchsia-100">
                        {profile.goal}
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">
                      {text('Setup details', 'تفاصيل الإعداد')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="text-foreground/85">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'جاهز') : text('Guide', 'تنبيه')}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'المستوى')} value={difficulty === 'advanced' ? text('Advanced', 'متقدم') : text('Normal', 'عادي')} />
                <InfoChip label={text('Analysis', 'التحليل')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'الثقة')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'التكرارات')} value={text('Pending', 'لاحقا')} />
              </div>
              </div>
            </details>

            <div className="hidden">
              <div className="flex items-center gap-3" dir="ltr">
                <div className="relative h-12 w-12 shrink-0 rounded-full bg-gradient-primary p-[2px]">
                  <div className="h-full w-full overflow-hidden rounded-full bg-secondary">
                    {profile?.avatarUrl ? (
                      <img src={profile.avatarUrl} alt={profile.name || 'Profile'} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-card">
                        <User className="h-6 w-6 text-primary" />
                      </div>
                    )}
                  </div>
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
                </div>
                    <div className="min-w-0 flex-1 text-start">
                  <div className="truncate text-sm font-semibold text-white">{profile?.name || text('Your live session', 'جلستك المباشرة')}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {profile?.goal && (
                      <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-medium text-fuchsia-100">
                        {profile.goal}
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">
                      {text('Setup details', 'تفاصيل الإعداد')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="text-foreground/85">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'جاهز') : text('Guide', 'تنبيه')}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'المستوى')} value={difficulty === 'advanced' ? text('Advanced', 'متقدم') : text('Normal', 'عادي')} />
                <InfoChip label={text('Analysis', 'التحليل')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'الثقة')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'التكرارات')} value={text('Pending', 'لاحقا')} />
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground">
                {text('Exercise', 'Exercise')}: <span className="text-white">{selectedExerciseLabel}</span>
              </div>
              <div className={cn('rounded-full border px-3 py-1.5 text-xs', analysisActive ? 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                {analysisActive ? text('AI Tracking', 'التتبع الذكي') : text('Scanner idle', 'الماسح في وضع الانتظار')}
              </div>
            </div>

            {liveReady && <CurrentCuePanel cue={coachingCue} isArabic={isArabic} poseQuality={poseQuality} text={text} />}

            <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,14,28,0.95),rgba(5,7,16,0.98))] shadow-[0_28px_90px_rgba(0,0,0,0.4)]">
              <div className="border-b border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-red-200">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                      {liveReady ? text('LIVE', 'مباشر') : text('CAMERA OFF', 'الكاميرا متوقفة')}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-muted-foreground">
                      {text('Private live view', 'عرض مباشر خاص')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-foreground">
                      <Clock3 className="mr-1 inline h-3.5 w-3.5" />{formatElapsed(elapsed)}
                    </span>
                    <span className={cn('rounded-full border px-3 py-1', trackingReady ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                      <Radar className="mr-1 inline h-3.5 w-3.5" />
                      {trackingReady
                        ? bodyDetected
                          ? text('Pose detected', 'تم اكتشاف الجسم')
                          : liveReady
                            ? text('Searching', 'جاري البحث')
                            : text('Pose model ready', 'نموذج الحركة جاهز')
                        : text('Tracking ready', 'التتبع جاهز')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative h-[58svh] min-h-[360px] max-h-[660px] w-full overflow-hidden bg-black sm:h-[64vh] sm:min-h-[480px] sm:max-h-[720px] lg:h-[68vh] lg:min-h-[540px] lg:max-h-[760px] xl:h-[calc(100vh-18rem)] xl:min-h-[560px] xl:max-h-[720px]">
                <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_center,_rgba(56,189,248,0.08),_transparent_55%)]" />
                <div className="pointer-events-none absolute inset-0 z-[1] opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:32px_32px]" />
                <video ref={videoRef} muted playsInline className={cn(
                  'h-full w-full object-contain',
                  facingMode === 'user' && 'scale-x-[-1]',
                  cameraState !== 'live' && 'invisible'
                )} />
                <canvas ref={canvasRef} className={cn(
                  'pointer-events-none absolute inset-0 z-[2] h-full w-full object-contain',
                  facingMode === 'user' && 'scale-x-[-1]',
                  cameraState !== 'live' && 'hidden'
                )} />
                <div className="pointer-events-none absolute inset-[7%] z-[3] rounded-[28px] border border-white/15 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]">
                  <span className="absolute -left-px -top-px h-10 w-10 border-l-2 border-t-2 border-cyan-300/80" />
                  <span className="absolute -right-px -top-px h-10 w-10 border-r-2 border-t-2 border-fuchsia-300/80" />
                  <span className="absolute -bottom-px -left-px h-10 w-10 border-b-2 border-l-2 border-fuchsia-300/80" />
                  <span className="absolute -bottom-px -right-px h-10 w-10 border-b-2 border-r-2 border-cyan-300/80" />
                </div>
                {cameraState === 'live' && (
                  <CoachingCueOverlay
                    cue={coachingCue}
                    isArabic={isArabic}
                    poseQuality={poseQuality}
                    text={text}
                  />
                )}

                {cameraState !== 'live' && (
                  <div className="absolute inset-0 z-[4] flex flex-col items-center justify-center gap-4 bg-zinc-950/95 px-6 text-center backdrop-blur-sm">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full border border-fuchsia-300/15 bg-white/[0.03] shadow-[0_0_60px_rgba(168,85,247,0.14)]">
                      {cameraState === 'error'
                        ? <TriangleAlert className="h-8 w-8 text-amber-400" />
                        : <Camera className="h-8 w-8 text-zinc-300" />}
                    </div>
                    <h3 className="text-2xl font-semibold text-white">
                      {cameraState === 'error'
                        ? text('Camera setup issue', 'مشكلة في إعداد الكاميرا')
                        : text('Ready to start?', 'ابدأ جلسة الأداء المباشر')}
                    </h3>
                    <p className="max-w-xl text-sm leading-7 text-zinc-400">
                      {cameraState === 'error' ? errorMessage : cameraState === 'starting'
                        ? text('Starting camera...', 'جارٍ تشغيل الكاميرا...')
                        : text('Make sure your full body is visible.', 'سيقوم مدربك الذكي بتتبع الحركة ومساعدتك على تصحيح التمرين في الوقت الحقيقي.')}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {text('', 'يُستخدم العرض المباشر لتقديم ملاحظات فورية على الأداء.')}
                    </p>
                  </div>
                )}

                {cameraState === 'live' && (
                  <>
                    <div className="pointer-events-none absolute inset-x-[12%] top-[24%] z-[3] h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent shadow-[0_0_14px_rgba(34,211,238,0.45)]" />
                    <div className="pointer-events-none absolute bottom-5 right-5 z-[3] rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[11px] text-cyan-100 backdrop-blur-md">
                      <Cpu className="mr-1 inline h-3.5 w-3.5" />
                      {analysisActive ? text('Analyzing joints', 'تحليل المفاصل') : text('AI tracking ready', 'التتبع الذكي جاهز')}
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-white/10 bg-[linear-gradient(180deg,rgba(7,9,18,0.88),rgba(7,9,18,0.96))] px-4 py-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  <div className={cn('rounded-full border px-3 py-1.5 text-xs', liveReady ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                    <Camera className="mr-1 inline h-3.5 w-3.5" />
                    {text('Camera', 'الكاميرا')}: {liveReady ? text('Connected', 'متصلة') : text('Off', 'متوقفة')}
                  </div>
                  <div className={cn('rounded-full border px-3 py-1.5 text-xs', trackingReady ? 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                    <Radar className="mr-1 inline h-3.5 w-3.5" />
                    {text('Pose tracking', 'تتبع الحركة')}: {trackingReady ? text('Ready', 'جاهز') : text('Loading', 'تحميل')}
                  </div>
                  <div className={cn('rounded-full border px-3 py-1.5 text-xs', analysisActive ? 'border-fuchsia-300/20 bg-fuchsia-500/10 text-fuchsia-100' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                    <Activity className="mr-1 inline h-3.5 w-3.5" />
                    {text('Form analysis', 'تحليل الأداء')}: {analysisActive ? text('Analyzing', 'جارٍ التحليل') : text('Stand by', 'انتظار')}
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground">
                    <Eye className="mr-1 inline h-3.5 w-3.5" />
                    {text('Exercise', 'التمرين')}: <span className="text-foreground">{selectedExerciseLabel}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {cameraState === 'live' ? (
                    <>
                      <Button variant="secondary" onClick={() => setIsPaused((value) => !value)} className="rounded-full border border-white/10 bg-white/[0.06] px-5">
                        {isPaused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                        {isPaused ? text('Resume', 'استئناف') : text('Pause', 'إيقاف مؤقت')}
                      </Button>
                      <Button variant="secondary" onClick={resetSession} className="rounded-full border border-white/10 bg-white/[0.06] px-5"><RotateCcw className="mr-2 h-4 w-4" />{text('Reset', 'إعادة ضبط')}</Button>
                      <Button variant="destructive" onClick={stopCamera} className="rounded-full px-5 shadow-[0_16px_36px_rgba(239,68,68,0.22)]"><CameraOff className="mr-2 h-4 w-4" />{text('Stop Session', 'إيقاف الجلسة')}</Button>
                      <Button variant="secondary" onClick={switchCamera} className="rounded-full border border-white/10 bg-white/[0.06] px-5"><RefreshCw className="mr-2 h-4 w-4" />{text('Switch camera', 'تبديل الكاميرا')}</Button>
                      <Button variant="secondary" onClick={() => setVoiceEnabled((value) => !value)} className="rounded-full border border-white/10 bg-white/[0.06] px-5">
                        {voiceEnabled ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}
                        {voiceEnabled ? text('Voice on', 'الصوت شغال') : text('Muted', 'الصوت مطفي')}
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => startCamera()} disabled={cameraState === 'starting' || !canStartSession} className="rounded-full px-6"><Camera className="mr-2 h-4 w-4" />{text('Start camera', 'تشغيل الكاميرا')}</Button>
                  )}
                </div>
              </div>
            </section>

            <details className="live-session-details mt-5 rounded-[28px] border border-white/10 p-4">
              <summary>{text('Session measurements', 'قياسات الجلسة')}</summary>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/70">{text('Real-time Analytics', 'تحليلات مباشرة')}</div>
                  <h2 className="mt-1 text-xl font-semibold text-white">{text('Training metrics', 'مؤشرات التمرين')}</h2>
                </div>
                <span className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium',
                  liveReady ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200' : 'border-violet-300/25 bg-violet-400/10 text-violet-100'
                )}>
                  {liveReady ? text('Live metrics', 'مؤشرات مباشرة') : text('Ready to watch', 'جاهز للتتبع')}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {analyticsCards.slice(0, 4).map((card) => (
                  <AnalyticsCard key={card.label} {...card} />
                ))}
              </div>
            </details>

            <div className="live-extra-panels mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <SessionProgressCard
                text={text}
                elapsed={elapsed}
                completedReps={completedReps}
                averageFormScore={averageFormScoreValue}
                bestFormScore={bestFormScoreValue}
                consistency={consistencyValue}
                completion={completionValue}
                currentStreak={currentStreakValue}
                liveReady={liveReady}
              />
              <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,17,34,0.84),rgba(7,9,18,0.92))] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-yellow-300/20 bg-yellow-400/10 text-yellow-200">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-yellow-100/70">{text('Form Tips', 'نصائح الذكاء للتحسن')}</div>
                    <h3 className="text-lg font-semibold text-white">{text('Better reps', 'توجيهات بسيطة لتكرارات أفضل')}</h3>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CoachTip icon={<Target className="h-5 w-5" />} tone="green" title={text('Keep your body aligned', 'خلي جسمك بمحاذاة')} description={text('Stack joints and stay centered in frame.', 'رتب مفاصلك وخليك بنص الكاميرا.')} />
                  <CoachTip icon={<Timer className="h-5 w-5" />} tone="amber" title={text('Control your tempo', 'تحكم بالإيقاع')} description={text('Move with control instead of rushing reps.', 'تحرك بهدوء بدون استعجال.')} />
                  <CoachTip icon={<TrendingUp className="h-5 w-5" />} tone="green" title={text('Complete full range of motion', 'كمل مدى الحركة')} description={text('Use smooth depth while keeping form clean.', 'انزل واطلع بمدى واضح ونظيف.')} />
                </div>
              </section>
            </div>
          </div>

          <aside className="flex flex-col gap-5 xl:sticky xl:top-24">
            <div className="live-feedback-wrap order-3"><FeedbackPanel feedback={poseFeedback} modelState={modelState} isCameraLive={liveReady} text={text} /></div>
            {collectionModeEnabled && (
              <div className="order-6 rounded-[28px] border border-cyan-300/20 bg-[linear-gradient(180deg,rgba(8,24,34,0.92),rgba(8,10,22,0.94))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-cyan-300" />
                      <h3 className="text-sm font-semibold text-white">{text('Data Collection', 'جمع البيانات')}</h3>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-cyan-50/70">
                      {text('This mode exports pose landmarks and joint angles only. It does not save camera video.', 'هذا الوضع يصدّر نقاط الجسم وزوايا المفاصل فقط. لا يحفظ فيديو الكاميرا.')}
                    </p>
                  </div>
                  <span className={cn(
                    'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    isCollecting ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/10 text-cyan-100'
                  )}>
                    {collectionSamples.length}
                  </span>
                </div>

                <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span>{text('Status', 'الحالة')}</span>
                    <span className={cn('text-end font-medium', collectionReady ? 'text-emerald-300' : 'text-amber-300')}>{collectionStatus}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span>{text('Exercise', 'التمرين')}</span>
                    <span className="font-medium text-white">{collectionExercise ?? text('Unsupported for collection', 'غير مدعوم للجمع')}</span>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">{text('Label', 'التصنيف')}</Label>
                    <Select value={collectionLabel} onValueChange={(value) => setCollectionLabel(value as CollectionLabel)} disabled={isCollecting}>
                      <SelectTrigger className="mt-1 rounded-2xl border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(['correct', 'incorrect', 'uncertain', 'setup_bad'] as CollectionLabel[]).map((value) => (
                          <SelectItem key={value} value={value}>{value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{text('Mistake Type', 'نوع الخطأ')}</Label>
                    <Select value={collectionMistakeType} onValueChange={setCollectionMistakeType} disabled={isCollecting}>
                      <SelectTrigger className="mt-1 rounded-2xl border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {collectionMistakeOptions.map((value) => (
                          <SelectItem key={value} value={value}>{value}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">{text('Camera Angle', 'زاوية الكاميرا')}</Label>
                      <Select value={collectionCameraAngle} onValueChange={(value) => setCollectionCameraAngle(value as CollectionCameraAngle)} disabled={isCollecting}>
                        <SelectTrigger className="mt-1 rounded-2xl border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['front', 'side', 'front_45', 'unknown'] as CollectionCameraAngle[]).map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">{text('Difficulty', 'الصعوبة')}</Label>
                      <Select value={collectionDifficulty} onValueChange={(value) => setCollectionDifficulty(value as CollectionDifficulty)} disabled={isCollecting}>
                        <SelectTrigger className="mt-1 rounded-2xl border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['beginner', 'normal', 'advanced'] as CollectionDifficulty[]).map((value) => (
                            <SelectItem key={value} value={value}>{value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  {isCollecting ? (
                    <Button type="button" variant="outline" className="rounded-2xl border-amber-300/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/20" onClick={stopDataCollection}>
                      <Pause className="mr-2 h-4 w-4" />{text('Stop', 'إيقاف')}
                    </Button>
                  ) : (
                    <Button type="button" className="rounded-2xl" onClick={startDataCollection} disabled={!collectionReady}>
                      <Play className="mr-2 h-4 w-4" />{text('Start', 'بدء')}
                    </Button>
                  )}
                  <Button type="button" variant="outline" className="rounded-2xl border-white/10 bg-white/[0.04]" onClick={exportCollectionBatch} disabled={collectionSamples.length === 0}>
                    <Download className="mr-2 h-4 w-4" />{text('Export', 'تصدير')}
                  </Button>
                  <Button type="button" variant="outline" className="col-span-2 rounded-2xl border-white/10 bg-white/[0.04] text-muted-foreground hover:text-white" onClick={clearCollectionBatch} disabled={collectionSamples.length === 0 && !isCollecting}>
                    <Trash2 className="mr-2 h-4 w-4" />{text('Clear batch', 'مسح الدفعة')}
                  </Button>
                </div>
              </div>
            )}

            <details className="live-exercise-picker order-1 rounded-[24px] border border-white/10 p-5">
              <summary><span>{selectedExerciseLabel}</span><small>{trackingSupportLabel} · {text('Change exercise', 'تغيير التمرين')}</small></summary>
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.26em] text-cyan-100/70">{text('Exercise', 'Exercise')}</div>
              <Label htmlFor="exercise" className="text-sm font-semibold text-white">{text('Exercise', 'التمرين')}</Label>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                {text('Choose an exercise to begin.', 'اختر التمرين حتى يتمكن المدرب الذكي من تقييم الأداء الصحيح.')}
              </p>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{text('Tracking', 'التتبع')}</span>
                  <span className={cn(
                    'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    selectedTracking?.support === 'full' && 'bg-emerald-400/12 text-emerald-200',
                    selectedTracking?.support === 'basic' && 'bg-cyan-400/12 text-cyan-100',
                    selectedTracking?.support === 'unsupported' && 'bg-amber-400/12 text-amber-200'
                  )}>
                    {trackingSupportLabel}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-6 text-muted-foreground">
                  {isArabic ? (selectedTracking?.reasonAr ?? (selectedTracking?.pose ? 'توجيه مفاصل تجريبي، وليس حكمًا شاملًا على الأداء.' : 'تتبع الظهور فقط؛ لا يتوفر تصحيح الأداء لهذا التمرين بعد.')) : selectedTracking?.reason}
                </p>
                {selectedTracking?.cameraAngle && <p className="mt-2 text-xs text-primary">{selectedTracking.cameraAngle === 'side' ? text('Camera: side view', 'الكاميرا: من الجانب') : text('Camera: front view', 'الكاميرا: من الأمام')}</p>}
              </div>
              <div className="live-catalog-filters">
                <label>{text('Muscle', 'العضلة')}<select value={muscleFilter} onChange={event => setMuscleFilter(event.target.value)}><option value="all">{text('All muscles', 'كل العضلات')}</option>{Object.keys(muscleGroups).map(muscle => <option key={muscle} value={muscle}>{muscleLabel(muscle, language)}</option>)}</select></label>
                <label>{text('Profile', 'الجنس')}<select value={genderFilter} onChange={event => setGenderChoice(event.target.value)}><option value="all">{text('All', 'الكل')}</option><option value="male">{text('Male', 'ذكر')}</option><option value="female">{text('Female', 'أنثى')}</option></select></label>
                <label>{text('Location', 'المكان')}<select value={placeFilter} onChange={event => setPlaceChoice(event.target.value)}><option value="all">{text('All', 'الكل')}</option><option value="home">{text('Home', 'البيت')}</option><option value="gym">{text('Gym', 'الجيم')}</option></select></label>
              </div>
              <div className="mt-3 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/20 p-1">
                {(['all', 'normal', 'advanced'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setLevelFilter(level)}
                    className={cn(
                      'rounded-xl px-3 py-2 text-sm font-semibold transition',
                      levelFilter === level ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {level === 'all' ? text('All levels', 'كل المستويات') : level === 'advanced' ? text('Advanced', 'متقدم') : text('Normal', 'عادي')}
                  </button>
                ))}
              </div>

              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="exercise"
                  aria-label={text('Search exercises', 'ابحث عن تمرين')}
                  value={exerciseQuery}
                  onChange={(event) => setExerciseQuery(event.target.value)}
                  placeholder={text('Search exercises', 'ابحث عن تمرين')}
                  className="h-11 w-full rounded-2xl border border-white/10 bg-black/20 pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-cyan-300/40"
                />
              </div>

              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {filteredExercises.map((item) => {
                  const active = item.id === exercise;
                  const label = localizedLabel(item.name, item.nameAr, language);
                  const itemSupportLabel = item.tracking.support === 'full'
                    ? text('Angle checks', 'فحص الزوايا')
                    : item.tracking.support === 'basic'
                      ? item.tracking.pose ? text('Movement cues (beta)', 'توجيه الحركة (تجريبي)') : text('Visibility only', 'تتبع الظهور فقط')
                      : text('Not supported', 'غير مدعوم');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => { stopCamera(); resetSession(); setExercise(item.id); setDifficulty(item.difficulty); }}
                      className={cn(
                                'w-full rounded-2xl border px-3 py-3 text-start transition',
                        active ? 'border-cyan-300/35 bg-cyan-400/10' : 'border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.06]'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{label}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                            <span>{muscleLabel(item.source.muscle, language)}</span>
                            <span>•</span>
                            <span>{item.source.location}</span>
                            <span>•</span>
                            <span className={cn(
                              'rounded-full px-2 py-0.5',
                              item.tracking.support === 'full' && 'bg-emerald-400/10 text-emerald-200',
                              item.tracking.support === 'basic' && 'bg-cyan-400/10 text-cyan-100',
                              item.tracking.support === 'unsupported' && 'bg-amber-400/10 text-amber-200'
                            )}>{itemSupportLabel}</span>
                          </div>
                        </div>
                        {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-200" />}
                      </div>
                    </button>
                  );
                })}
                {filteredExercises.length === 0 && (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-muted-foreground">
                    {text('No exercises match this filter.', 'لا توجد تمارين مطابقة لهذا الفلتر.')}
                  </div>
                )}
              </div>
              {selectedExercise && <ReferenceVideos key={`${selectedExercise.id}-${genderFilter}-${placeFilter}`} muscle={selectedExercise.source.muscle} gender={genderFilter} location={placeFilter} />}
            </details>

            <div className="hidden">
              <div className="flex items-center gap-3" dir="ltr">
                <div className="relative h-12 w-12 shrink-0 rounded-full bg-gradient-primary p-[2px]">
                  <div className="h-full w-full overflow-hidden rounded-full bg-secondary">
                    {profile?.avatarUrl ? (
                      <img src={profile.avatarUrl} alt={profile.name || 'Profile'} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-card">
                        <User className="h-6 w-6 text-primary" />
                      </div>
                    )}
                  </div>
                  <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
                </div>
                    <div className="min-w-0 flex-1 text-start">
                  <div className="truncate text-sm font-semibold text-white">{profile?.name || text('Your live session', 'جلستك المباشرة')}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {profile?.goal && (
                      <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-medium text-fuchsia-100">
                        {profile.goal}
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">
                      {text('Setup details', 'تفاصيل الإعداد')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="text-foreground/85">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'جاهز') : text('Guide', 'تنبيه')}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'المستوى')} value={difficulty === 'advanced' ? text('Advanced', 'متقدم') : text('Normal', 'عادي')} />
                <InfoChip label={text('Analysis', 'التحليل')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'الثقة')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'التكرارات')} value={text('Pending', 'لاحقا')} />
              </div>
            </div>

            {devices.length > 1 && (
              <div className="order-5 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
                <Label htmlFor="camera-device" className="text-sm font-semibold text-white">{text('Camera', 'الكاميرا')}</Label>
                <Select value={deviceId} onValueChange={async (value) => {
                  setDeviceId(value);
                  if (cameraState === 'live') await startCamera(facingMode, value);
                }}>
                  <SelectTrigger id="camera-device" className="mt-3 rounded-2xl border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{text('Automatic', 'تلقائي')}</SelectItem>
                    {devices.map((device, index) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>{device.label || `${text('Camera', 'كاميرا')} ${index + 1}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="order-3 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-300" />
                <h3 className="text-sm font-semibold text-white">{text('Session Status', 'حالة الجلسة')}</h3>
              </div>
              <div className="space-y-3">
                <StatusRow label={text('Camera', 'الكاميرا')} value={cameraState === 'live' ? text('Connected', 'متصلة') : text('Off', 'متوقفة')} active={cameraState === 'live'} />
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Session', 'الجلسة')}</span><span className="font-mono font-medium">{formatElapsed(elapsed)}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Form analysis', 'تحليل الأداء')}</span><span className={cn('flex items-center gap-1.5', modelState === 'ready' ? 'text-emerald-500' : 'text-muted-foreground')}><ScanLine className="h-4 w-4" />{modelState === 'ready' ? text('Ready', 'جاهز') : modelState === 'loading' ? text('Loading', 'جارٍ التحميل') : text('Unavailable', 'غير متاح')}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Exercise', 'التمرين')}</span><span className="font-medium text-foreground">{selectedExerciseLabel}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Visibility', 'الظهور')}</span><span className={cn('font-medium', needsVisibilityAdjustment ? 'text-amber-400' : 'text-emerald-400')}>{needsVisibilityAdjustment ? text('Needs adjustment', 'يحتاج تعديل') : text('Full body visible', 'الجسم ظاهر')}</span></div>
              </div>
            </div>

            <details className="order-5 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.74),rgba(10,12,24,0.82))] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
              <summary className="cursor-pointer list-none text-sm font-semibold text-white outline-none marker:hidden">
                <span className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-200" />{text('Advanced details', 'تفاصيل متقدمة')}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{text('Optional', 'اختياري')}</span>
                </span>
              </summary>
              <div className="mt-4 grid gap-2">
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="text-foreground/85">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'جاهز') : text('Guide', 'تنبيه')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'المستوى')} value={difficulty === 'advanced' ? text('Advanced', 'متقدم') : text('Normal', 'عادي')} />
                <InfoChip label={text('Analysis', 'التحليل')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'الثقة')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'التكرارات')} value={text('Pending', 'لاحقا')} />
              </div>
            </details>
          </aside>
        </div>
      </main>
    </div>
  );
}

const feedbackCopy: Record<string, [string, string]> = {
  ...Object.fromEntries(Object.entries(cueCopy).map(([key, value]) => [key, [value.en, Array.isArray(value.ar) ? value.ar[0] : value.ar] as [string, string]])),
  basic_tracking: ['Pose tracking is active. Keep your body visible and move with control.', 'تتبع الوضعية فعّال. أبقِ جسمك ظاهراً وتحرك بتحكم.'],
  low_pose_confidence: ['Improve lighting and keep the working joints visible', 'حسّن الإضاءة وأظهر المفاصل المطلوبة'],
  unsupported_exercise: ['Pose visibility is active. Detailed scoring is not available for this exercise yet.', 'رؤية الوضعية فعالة. التقييم التفصيلي غير متاح لهذا التمرين حالياً.'],
  pose_model_unavailable: ['Pose analysis could not load. Check the model assets and refresh.', 'تعذر تحميل تحليل الحركة. تحقق من ملفات النموذج ثم حدّث الصفحة.'],
  pose_detection_unavailable: ['Pose tracking stopped. Refresh the camera session and try again.', 'توقف تتبع الحركة. أعد تشغيل جلسة الكاميرا وحاول مرة أخرى.'],
  step_into_frame: ['Step into the frame', 'قف أمام الكاميرا'],
  full_body_required: ['Keep your full body visible', 'أظهر جسمك كاملًا'],
  both_legs_required: ['Keep both legs visible', 'أظهر الساقين كاملتين'],
  form_good: ['Good form. Keep going!', 'أداؤك جيد. استمر!'],
  raise_hips: ['Raise your hips slightly', 'ارفع الوركين قليلًا'],
  lower_hips: ['Lower your hips slightly', 'اخفض الوركين قليلًا'],
  open_elbows: ['Open your elbow angle', 'وسّع زاوية المرفق'],
  chest_up: ['Lift your chest', 'ارفع صدرك'],
  lower_squat: ['Bend your knees and lower', 'اثنِ ركبتيك وانخفض'],
  squat_too_deep: ['Rise slightly', 'ارتفع قليلًا'],
  lower_lunge: ['Lower into the lunge', 'انخفض أكثر في الاندفاع'],
  shorten_lunge: ['Shorten your stance slightly', 'قلّل المسافة بين القدمين'],
  bend_back_knee: ['Bend your back knee', 'اثنِ الركبة الخلفية'],
};

function CurrentCuePanel({ cue, isArabic, poseQuality, text }: {
  cue: CoachingCue;
  isArabic: boolean;
  poseQuality: PoseQuality;
  text: (en: string, ar: string) => string;
}) {
  const message = isArabic ? cue.ar : cue.en;
  const label = cue.severity === 'good'
    ? text('Current cue', 'التوجيه الحالي')
    : cue.severity === 'correction'
      ? text('Fix now', 'عدّل الآن')
      : cue.severity === 'caution'
        ? text('Needs attention', 'انتبه شوي')
        : text('Camera setup', 'ضبط الكاميرا');
  const Icon = cue.severity === 'good'
    ? CheckCircle2
    : cue.severity === 'correction'
      ? TriangleAlert
      : cue.severity === 'caution'
        ? ShieldCheck
        : Radar;

  return (
    <div className={cn(
      'mb-4 rounded-[28px] border p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-5',
      cue.severity === 'good' && 'border-emerald-300/30 bg-emerald-500/12',
      cue.severity === 'caution' && 'border-yellow-300/30 bg-yellow-500/12',
      cue.severity === 'correction' && 'border-red-300/35 bg-red-500/14',
      cue.severity === 'camera-setup' && 'border-cyan-300/30 bg-cyan-500/12'
    )}>
      <div className="flex items-start gap-3">
        <div className={cn(
          'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border bg-black/20',
          cue.severity === 'good' && 'border-emerald-300/20 text-emerald-100',
          cue.severity === 'caution' && 'border-yellow-300/20 text-yellow-100',
          cue.severity === 'correction' && 'border-red-300/25 text-red-100',
          cue.severity === 'camera-setup' && 'border-cyan-300/20 text-cyan-100'
        )}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">{label}</div>
          <div className="mt-1 text-xl font-semibold leading-snug text-white sm:text-2xl">{message}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/60">
            <span>{text('Visibility', 'الوضوح')}: {poseQuality.averageVisibility}%</span>
            <span>{text('Landmarks', 'النقاط')}: {poseQuality.visibleLandmarks}</span>
            <span>{text('Stability', 'الثبات')}: {poseQuality.stableFrames}/{CALIBRATION_STABLE_FRAMES}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoachingCueOverlay({ cue, isArabic, poseQuality, text }: {
  cue: CoachingCue;
  isArabic: boolean;
  poseQuality: PoseQuality;
  text: (en: string, ar: string) => string;
}) {
  const message = isArabic ? cue.ar : cue.en;
  const label = cue.severity === 'good'
    ? text('Good', 'تمام')
    : cue.severity === 'correction'
      ? text('Correct now', 'عدّل الآن')
      : cue.severity === 'caution'
        ? text('Watch it', 'انتبه')
        : text('Camera setup', 'ضبط الكاميرا');
  const Icon = cue.severity === 'good'
    ? CheckCircle2
    : cue.severity === 'correction'
      ? TriangleAlert
      : cue.severity === 'caution'
        ? ShieldCheck
        : Radar;

  return (
    <div className={cn(
      'pointer-events-none absolute inset-x-4 top-4 z-[5] rounded-3xl border px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:inset-x-8 sm:top-6',
      cue.severity === 'good' && 'border-emerald-300/35 bg-emerald-500/18 text-emerald-50',
      cue.severity === 'caution' && 'border-yellow-300/35 bg-yellow-500/18 text-yellow-50',
      cue.severity === 'correction' && 'border-red-300/40 bg-red-500/20 text-red-50',
      cue.severity === 'camera-setup' && 'border-cyan-300/35 bg-cyan-500/18 text-cyan-50'
    )}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-black/25">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] opacity-80">{label}</div>
          <div className="mt-1 text-lg font-semibold leading-snug sm:text-2xl">{message}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/75">
            <span>{text('Visibility', 'الوضوح')}: {poseQuality.averageVisibility}%</span>
            <span>{text('Landmarks', 'النقاط')}: {poseQuality.visibleLandmarks}</span>
            <span>{text('Stable', 'الثبات')}: {poseQuality.stableFrames}/{CALIBRATION_STABLE_FRAMES}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

type MetricTone = 'green' | 'cyan' | 'amber' | 'red' | 'purple';

const metricToneClasses: Record<MetricTone, {
  border: string;
  bg: string;
  text: string;
  bar: string;
  glow: string;
}> = {
  green: {
    border: 'border-emerald-300/25',
    bg: 'bg-emerald-400/10',
    text: 'text-emerald-200',
    bar: 'from-emerald-400 to-green-300',
    glow: 'shadow-[0_0_30px_rgba(52,211,153,0.16)]',
  },
  cyan: {
    border: 'border-cyan-300/25',
    bg: 'bg-cyan-400/10',
    text: 'text-cyan-100',
    bar: 'from-cyan-300 to-sky-400',
    glow: 'shadow-[0_0_30px_rgba(34,211,238,0.15)]',
  },
  amber: {
    border: 'border-amber-300/25',
    bg: 'bg-amber-400/10',
    text: 'text-amber-200',
    bar: 'from-amber-400 to-orange-300',
    glow: 'shadow-[0_0_30px_rgba(251,191,36,0.14)]',
  },
  red: {
    border: 'border-red-300/25',
    bg: 'bg-red-400/10',
    text: 'text-red-200',
    bar: 'from-red-400 to-rose-300',
    glow: 'shadow-[0_0_30px_rgba(248,113,113,0.14)]',
  },
  purple: {
    border: 'border-violet-300/25',
    bg: 'bg-violet-400/10',
    text: 'text-violet-100',
    bar: 'from-violet-400 to-fuchsia-300',
    glow: 'shadow-[0_0_30px_rgba(168,85,247,0.16)]',
  },
};

function AnalyticsCard({ icon, label, value, suffix, status, trend }: {
  icon: ReactNode; label: string; value: string; suffix?: string; status: string; trend: string; progress: number; tone: MetricTone;
}) {
  return <div className="live-measurement"><header>{icon}<span>{label}</span></header><strong>{value}<small>{suffix}</small></strong><p>{status}</p><small>{trend}</small></div>;
}

function SessionProgressCard({ text, elapsed, completedReps, averageFormScore, bestFormScore, consistency, completion, currentStreak, liveReady }: {
  text: (en: string, ar: string) => string;
  elapsed: number;
  completedReps: number;
  averageFormScore: number;
  bestFormScore: number;
  consistency: number;
  completion: number;
  currentStreak: number;
  liveReady: boolean;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,17,34,0.84),rgba(7,9,18,0.92))] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-violet-300/20 bg-violet-400/10 text-violet-100">
            <Award className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-100/70">{text('Session Progress', 'تقدم الجلسة')}</div>
            <h3 className="text-lg font-semibold text-white">{liveReady ? text('Live set summary', 'ملخص الجولة المباشر') : text('Ready for your set', 'جاهز للجولة')}</h3>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-xs text-white">{formatElapsed(elapsed)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ProgressMetric label={text('Completion', 'الإنجاز')} value={completion > 0 ? `${completion}%` : text('Ready', 'جاهز')} progress={completion} tone={metricToneFor(completion, liveReady)} />
        <ProgressMetric label={text('Completed reps', 'التكرارات المكتملة')} value={`${completedReps}`} progress={Math.min(100, completedReps * 10)} tone="purple" />
        <ProgressMetric label={text('Average form score', 'متوسط الأداء')} value={averageFormScore > 0 ? `${averageFormScore}%` : text('Pending', 'لاحقاً')} progress={averageFormScore} tone={averageFormScore >= 75 ? 'green' : averageFormScore >= 45 ? 'amber' : 'purple'} />
        <ProgressMetric label={text('Best form score', 'أفضل نتيجة')} value={bestFormScore > 0 ? `${bestFormScore}%` : text('Pending', 'لاحقاً')} progress={bestFormScore} tone={bestFormScore >= 75 ? 'green' : bestFormScore >= 45 ? 'amber' : 'purple'} />
        <ProgressMetric label={text('Consistency', 'الثبات')} value={consistency > 0 ? `${consistency}%` : text('Pending', 'لاحقاً')} progress={consistency} tone={consistency >= 75 ? 'green' : consistency >= 45 ? 'amber' : 'purple'} />
        <ProgressMetric label={text('Current streak', 'السلسلة الحالية')} value={currentStreak > 0 ? `${currentStreak}` : text('Ready', 'جاهز')} progress={Math.min(100, currentStreak * 12)} tone={currentStreak > 3 ? 'green' : 'cyan'} />
      </div>
    </section>
  );
}

function ProgressMetric({ label, value, progress, tone }: {
  label: string;
  value: string;
  progress: number;
  tone: MetricTone;
}) {
  const styles = metricToneClasses[tone];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold text-white">{value}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className={cn('h-full rounded-full bg-gradient-to-r', styles.bar)} style={{ width: `${clampPercent(progress)}%` }} />
      </div>
    </div>
  );
}

function CoachTip({ icon, tone, title, description }: {
  icon: ReactNode;
  tone: MetricTone;
  title: string;
  description: string;
}) {
  const styles = metricToneClasses[tone];
  return (
    <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border', styles.border, styles.bg, styles.text)}>
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

function PremiumStatusTile({ icon, label, value, tone }: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: MetricTone;
}) {
  const styles = metricToneClasses[tone];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.055]">
      <div className="mb-2 flex items-center gap-2">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-xl', styles.bg, styles.text)}>{icon}</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      </div>
      <div className="line-clamp-2 text-xs font-semibold leading-5 text-white">{value}</div>
    </div>
  );
}

function FeedbackPanel({ feedback, modelState, isCameraLive, text }: {
  feedback: PoseFeedback; modelState: 'loading' | 'ready' | 'error'; isCameraLive: boolean; text: (en:string,ar:string)=>string;
}) {
  const copy = feedbackCopy[feedback.message] ?? feedbackCopy.step_into_frame;
  const message = modelState === 'error' ? text('Analysis could not load. Refresh to retry.', 'تعذر تحميل التحليل. حدّث الصفحة للمحاولة.')
    : !isCameraLive ? text('Start the camera when you are ready.', 'شغّل الكاميرا لما تكون جاهز.')
    : modelState === 'loading' ? text('Preparing pose analysis…', 'تجهيز تحليل الحركة…') : text(copy[0],copy[1]);
  return <section className="live-feedback-compact" aria-live="polite">
    <header><ScanLine size={17}/><strong>{text('Movement feedback','ملاحظات الحركة')}</strong><span>{isCameraLive?text('Live','مباشر'):text('Ready','جاهز')}</span></header>
    <p>{message}</p>
    {isCameraLive && <div><span>{text('Pose confidence','ثقة الرصد')}: {feedback.confidence}%</span>{feedback.score!==null&&<span>{text('Angle estimate','تقدير الزوايا')}: {feedback.score}/100</span>}</div>}
    <small>{text('Guidance is limited to visible joints. Stop if movement causes pain.', 'التوجيه محدود بالمفاصل الظاهرة. توقّف إذا سببت الحركة ألمًا.')}</small>
  </section>;
}

function StatusRow({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('flex items-center gap-1.5 font-medium', active ? 'text-emerald-500' : 'text-muted-foreground')}>
        {active && <CheckCircle2 className="h-4 w-4" />}{value}
      </span>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-semibold text-white">{value}</div>
    </div>
  );
}

