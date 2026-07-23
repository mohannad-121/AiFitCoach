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

type CameraState = 'idle' | 'starting' | 'live' | 'error';
type CameraIssue = 'permission-denied' | 'no-camera' | 'unsupported' | 'unknown' | null;
type DifficultyLevel = 'normal' | 'advanced';
type CueSeverity = 'good' | 'caution' | 'correction' | 'camera-setup';
type CollectionExercise = 'squat' | 'push-up' | 'plank';
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
const COLLECTION_EXERCISES: CollectionExercise[] = ['squat', 'push-up', 'plank'];
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
    ar: ['Ø§Ù„ØªØªØ¨Ø¹ Ø´ØºØ§Ù„ØŒ Ø®Ù„ÙŠÙƒ ÙˆØ§Ø¶Ø­ Ø¨Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§', 'Ø­Ø±ÙƒØ© Ù…Ù†ÙŠØ­Ø©ØŒ Ø®Ù„ÙŠÙƒ Ù…Ø¨ÙŠÙ† ÙƒØ§Ù…Ù„'],
  },
  low_pose_confidence: {
    en: 'Improve lighting and keep the working joints visible.',
    ar: ['Ø§Ù„Ø¥Ø¶Ø§Ø¡Ø© Ø¶Ø¹ÙŠÙØ© Ø´ÙˆÙŠØŒ Ø¬Ø±Ø¨ Ù…ÙƒØ§Ù† Ø£ÙˆØ¶Ø­', 'Ø®Ù„ÙŠ Ø¬Ø³Ù…Ùƒ Ø£ÙˆØ¶Ø­ØŒ Ø§Ù„Ø¥Ø¶Ø§Ø¡Ø© Ø¨Ø¯Ù‡Ø§ ØªØ²ÙŠØ¯'],
  },
  unsupported_exercise: {
    en: 'I can see your body, but this exercise has visibility tracking only.',
    ar: ['Ø´Ø§ÙŠÙÙƒØŒ Ø¨Ø³ Ù‡Ø§Ù„ØªÙ…Ø±ÙŠÙ† ØªØªØ¨Ø¹Ù‡ Ø¹Ø§Ù… Ø¨Ø³', 'ÙˆØ§Ø¶Ø­ Ø¨Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ØŒ Ø¨Ø³ Ø¨Ø¯ÙˆÙ† ØªØµØ­ÙŠØ­ ØªÙØµÙŠÙ„ÙŠ'],
  },
  pose_model_unavailable: {
    en: 'Pose analysis could not load. Refresh the page and try again.',
    ar: 'ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø­Ø±ÙƒØ© Ù…Ø§ Ø§Ø´ØªØºÙ„ØŒ Ø­Ø¯Ø« Ø§Ù„ØµÙØ­Ø© ÙˆØ¬Ø±Ø¨',
  },
  pose_detection_unavailable: {
    en: 'Pose tracking stopped. Restart the camera session.',
    ar: 'Ø§Ù„ØªØªØ¨Ø¹ ÙˆÙ‚ÙØŒ Ø´ØºÙ„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ù…Ù† Ø¬Ø¯ÙŠØ¯',
  },
  step_into_frame: {
    en: 'Step into the frame.',
    ar: ['ØªØ¹Ø§Ù„ Ø´ÙˆÙŠ Ù‚Ø¯Ø§Ù… Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§', 'Ø®Ù„ÙŠÙƒ Ù‚Ø¯Ø§Ù… Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§'],
  },
  full_body_required: {
    en: 'Step back until your full body is visible.',
    ar: ['Ø§Ø±Ø¬Ø¹ Ø´ÙˆÙŠ Ù„ÙˆØ±Ø§ØŒ Ø®Ù„ÙŠ Ø¬Ø³Ù…Ùƒ ÙŠØ¨ÙŠÙ† ÙƒØ§Ù…Ù„', 'Ø¨Ø¹Ø¯ Ø´ÙˆÙŠ Ø¹Ù† Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ø¹Ø´Ø§Ù† Ø¬Ø³Ù…Ùƒ ÙŠØ·Ù„Ø¹ ÙƒØ§Ù…Ù„'],
  },
  keep_body_in_frame: {
    en: 'Keep your body inside the frame.',
    ar: ['Ø®Ù„ÙŠÙƒ Ø¨Ù†Øµ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§', 'Ø®Ù„ÙŠ Ø¬Ø³Ù…Ùƒ ÙƒÙ„Ù‡ Ø¯Ø§Ø®Ù„ Ø§Ù„ØµÙˆØ±Ø©'],
  },
  improve_lighting: {
    en: 'Improve lighting.',
    ar: ['Ø§Ù„Ø¥Ø¶Ø§Ø¡Ø© Ø¶Ø¹ÙŠÙØ© Ø´ÙˆÙŠØŒ Ø¬Ø±Ø¨ Ù…ÙƒØ§Ù† Ø£ÙˆØ¶Ø­', 'Ø²ÙŠØ¯ Ø§Ù„Ø¥Ø¶Ø§Ø¡Ø© Ø´ÙˆÙŠ'],
  },
  hold_still: {
    en: 'Hold steady for a moment so I can calibrate.',
    ar: ['Ø§Ø«Ø¨Øª Ù„Ø­Ø¸Ø©ØŒ Ø¨Ø¯ÙŠ Ø£Ø¸Ø¨Ø· Ø§Ù„ØªØªØ¨Ø¹', 'Ø¶Ù„ Ø«Ø§Ø¨Øª Ø´ÙˆÙŠ'],
  },
  face_camera: {
    en: 'Face the camera.',
    ar: ['ÙˆØ§Ø¬Ù‡ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§', 'Ù„Ù Ø¬Ø³Ù…Ùƒ Ø´ÙˆÙŠ Ø¹Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§'],
  },
  form_good: {
    en: 'Good form. Keep going.',
    ar: ['Ù…Ù…ØªØ§Ø²ØŒ Ø¶Ù„Ùƒ Ø«Ø§Ø¨Øª', 'Ø­Ø±ÙƒØ© Ù…Ù†ÙŠØ­Ø©ØŒ ÙƒÙ…Ù„', 'ØªÙ…Ø§Ù…ØŒ ÙƒÙ…Ù„ Ù‡ÙŠÙƒ'],
  },
  raise_hips: {
    en: 'Raise your hips slightly.',
    ar: ['Ø¸Ù‡Ø±Ùƒ Ù†Ø§Ø²Ù„ Ø´ÙˆÙŠØŒ Ø§Ø±ÙØ¹Ù‡ Ø´ÙˆÙŠ', 'Ø§Ø±ÙØ¹ Ø§Ù„ÙˆØ±Ùƒ Ø´ÙˆÙŠ'],
  },
  lower_hips: {
    en: 'Lower your hips slightly.',
    ar: ['Ø§Ù„ÙˆØ±Ùƒ Ø¹Ø§Ù„ÙŠ Ø´ÙˆÙŠØŒ Ù†Ø²Ù„Ù‡ Ø´ÙˆÙŠ', 'Ù†Ø²Ù„ Ø§Ù„Ø­ÙˆØ¶ Ø´ÙˆÙŠ'],
  },
  open_elbows: {
    en: 'Open your elbow angle.',
    ar: ['Ù‚Ø±Ø¨ Ø¥ÙŠØ¯ÙŠÙƒ Ø´ÙˆÙŠ Ù…Ù† ÙˆØ¶Ø¹ÙŠØ© Ø§Ù„ØªÙ…Ø±ÙŠÙ†', 'Ø§ÙØªØ­ ÙƒÙˆØ¹Ùƒ Ø´ÙˆÙŠ ÙˆØ®Ù„ÙŠÙƒ Ù…Ø³ÙŠØ·Ø±'],
  },
  chest_up: {
    en: 'Lift your chest.',
    ar: ['Ø§Ø±ÙØ¹ ØµØ¯Ø±Ùƒ Ø´ÙˆÙŠ', 'Ø®Ù„ÙŠ ØµØ¯Ø±Ùƒ Ù„ÙÙˆÙ‚'],
  },
  lower_squat: {
    en: 'Bend your knees and lower.',
    ar: ['Ø§Ù†Ø²Ù„ Ø´ÙˆÙŠ ÙƒÙ…Ø§Ù† Ø¨Ø§Ù„Ø³ÙƒÙˆØ§Øª', 'Ø§Ø«Ù†ÙŠ Ø±ÙƒØ¨ØªÙƒ ÙˆØ§Ù†Ø²Ù„ Ø´ÙˆÙŠ'],
  },
  squat_too_deep: {
    en: 'Rise slightly.',
    ar: ['Ø§Ø·Ù„Ø¹ Ø´ÙˆÙŠ Ù„ÙÙˆÙ‚', 'Ø®ÙÙ Ø§Ù„Ù†Ø²Ù„Ø© Ø´ÙˆÙŠ'],
  },
  lower_lunge: {
    en: 'Lower into the lunge.',
    ar: 'Ø§Ù†Ø²Ù„ Ø´ÙˆÙŠ ÙƒÙ…Ø§Ù† Ø¨Ø§Ù„Ù„Ø§Ù†Ø¬',
  },
  shorten_lunge: {
    en: 'Shorten your stance slightly.',
    ar: 'Ù‚Ø±Ø¨ Ø±Ø¬Ù„ÙŠÙƒ Ø´ÙˆÙŠ',
  },
  bend_back_knee: {
    en: 'Bend your back knee.',
    ar: 'Ø§Ø«Ù†ÙŠ Ø§Ù„Ø±ÙƒØ¨Ø© Ø§Ù„Ù„ÙŠ ÙˆØ±Ø§ Ø´ÙˆÙŠ',
  },
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
      ar: 'Ø´ØºÙ„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ ÙˆÙˆÙ‚Ù Ø¨Ù…ÙƒØ§Ù† ÙŠØ¨ÙŠÙ† Ø¬Ø³Ù…Ùƒ ÙƒØ§Ù…Ù„.',
      speak: false,
    };
  }
  if (!poseQuality.usable && poseQuality.issue) return cueFromKey(poseQuality.issue, 'camera-setup');
  if (trackingSupport === 'basic') return cueFromKey('basic_tracking', 'caution', false);
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
      ?? voices.find((voice) => /arabic|Ø¹Ø±Ø¨ÙŠ/i.test(voice.name))
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
    : text('Exercise', 'Ø§Ù„ØªÙ…Ø±ÙŠÙ†');
  const selectedTracking = selectedExercise?.tracking ?? null;
  const supportedPose = selectedTracking?.support === 'full' ? selectedTracking.pose : null;
  const canStartSession = selectedTracking?.support !== 'unsupported';
  const collectionExercise = selectedTracking?.support === 'full' && selectedTracking.pose && COLLECTION_EXERCISES.includes(selectedTracking.pose as CollectionExercise)
    ? selectedTracking.pose as CollectionExercise
    : null;
  const collectionMistakeOptions = collectionExercise ? COLLECTION_MISTAKES[collectionExercise] : ['none'];
  const canCollectCurrentExercise = collectionModeEnabled && Boolean(collectionExercise);
  const filteredExercises = useMemo(() => {
    const query = exerciseQuery.trim().toLowerCase();
    return liveExercises
      .filter((item) => item.difficulty === difficulty)
      .filter((item) => {
        if (!query) return true;
        return `${item.name} ${item.nameAr} ${item.source.muscle}`.toLowerCase().includes(query);
      })
      .slice(0, 42);
  }, [difficulty, exerciseQuery, liveExercises]);

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
      setErrorMessage(selectedTracking?.reason ?? text('This exercise is not supported for camera tracking yet.', 'Ù‡Ø°Ø§ Ø§Ù„ØªÙ…Ø±ÙŠÙ† ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ… Ù„ØªØªØ¨Ø¹ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ø­Ø§Ù„ÙŠØ§Ù‹.'));
      setCameraState('error');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraIssue('unsupported');
      setErrorMessage(text('This browser does not support camera access.', 'Ù‡Ø°Ø§ Ø§Ù„Ù…ØªØµÙØ­ Ù„Ø§ ÙŠØ¯Ø¹Ù… Ø§Ù„ÙˆØµÙˆÙ„ Ø¥Ù„Ù‰ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§.'));
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
        ? text('Camera permission was denied.', 'ØªÙ… Ø±ÙØ¶ Ø¥Ø°Ù† Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§.')
        : missing
          ? text('No camera was found on this device.', 'Ù„Ù… ÙŠØªÙ… Ø§Ù„Ø¹Ø«ÙˆØ± Ø¹Ù„Ù‰ ÙƒØ§Ù…ÙŠØ±Ø§ Ø¹Ù„Ù‰ Ù‡Ø°Ø§ Ø§Ù„Ø¬Ù‡Ø§Ø².')
        : text('The camera could not be started.', 'ØªØ¹Ø°Ø± ØªØ´ØºÙŠÙ„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§.'));
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
              ? assessPose(supportedPose, smoothedLandmarks)
              : smoothedLandmarks && trackingSupport === 'basic'
                ? createPoseFeedback('basic_tracking', estimatePoseConfidence(smoothedLandmarks), 'basic')
                : createPoseFeedback(smoothedLandmarks ? 'unsupported_exercise' : 'step_into_frame', smoothedLandmarks ? estimatePoseConfidence(smoothedLandmarks) : 0, 'basic');
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
    setDifficulty(requestedExercise.difficulty);
    setExercise(requestedExercise.id);
  }, [requestedExercise]);

  useEffect(() => {
    if (filteredExercises.length > 0 && !filteredExercises.some((item) => item.id === exercise)) {
      setExercise(filteredExercises[0].id);
    }
  }, [exercise, filteredExercises]);

  const liveReady = cameraState === 'live';
  const trackingReady = modelState === 'ready';
  const analysisActive = liveReady && trackingReady && !isPaused;
  const bodyNotDetected = liveReady && trackingReady && !bodyDetected;
  const coachingCue = createCoachingCue(poseFeedback, poseQuality, selectedTracking?.support, modelState, liveReady);
  const needsVisibilityAdjustment = ['full_body_required', 'step_into_frame', 'low_pose_confidence', 'keep_body_in_frame', 'improve_lighting', 'hold_still'].includes(poseFeedback.message);
  const confidenceLabel = poseFeedback.confidence > 0
    ? `${poseFeedback.confidence}%`
    : bodyDetected
      ? text('Pose visible', 'Ø§Ù„ÙˆØ¶Ø¹ÙŠØ© Ø¸Ø§Ù‡Ø±Ø©')
      : text('Waiting for body', 'Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø¸Ù‡ÙˆØ± Ø§Ù„Ø¬Ø³Ù…');
  const supportLabel = supportedPose
    ? poseFeedback.supportLevel === 'full'
      ? text('Full tracking', 'ØªØ­Ù„ÙŠÙ„ ÙƒØ§Ù…Ù„')
      : text('Basic tracking', 'ØªØªØ¨Ø¹ Ø£Ø³Ø§Ø³ÙŠ')
    : text('Preview only', 'Ø¹Ø±Ø¶ ÙÙ‚Ø·');
  const trackingSupportLabel = selectedTracking?.support === 'full'
    ? text('Full tracking', 'ØªØ­Ù„ÙŠÙ„ ÙƒØ§Ù…Ù„')
    : selectedTracking?.support === 'basic'
      ? text('Basic tracking', 'ØªØªØ¨Ø¹ Ø£Ø³Ø§Ø³ÙŠ')
      : text('Not supported', 'ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ…');
  const trackedRatio = progressRef.current.analyzedSamples
    ? `${Math.round((progressRef.current.goodSamples / progressRef.current.analyzedSamples) * 100)}%`
    : text('Collecting', 'Ù‚ÙŠØ¯ Ø§Ù„Ø¬Ù…Ø¹');
  const sessionProgress = progressRef.current;
  const formScoreValue = clampPercent(poseFeedback.score ?? 0);
  const confidenceValue = clampPercent(liveReady ? (poseFeedback.confidence || poseQuality.averageVisibility) : 0);
  const rangeOfMotionValue = clampPercent(!liveReady ? 0 : poseFeedback.score !== null ? Math.max(45, Math.min(96, poseFeedback.score + 6)) : poseQuality.usable ? 68 : 28);
  const stabilityValue = clampPercent(!liveReady ? 0 : poseQuality.stable ? Math.max(82, poseQuality.averageVisibility) : Math.min(74, poseQuality.averageVisibility));
  const tempoValue = clampPercent(!liveReady ? 0 : isPaused ? 38 : poseQuality.stable ? 76 : 52);
  const averageFormScoreValue = clampPercent(sessionProgress.analyzedSamples
    ? (sessionProgress.goodSamples / sessionProgress.analyzedSamples) * 100
    : formScoreValue);
  const bestFormScoreValue = clampPercent(Math.max(formScoreValue, averageFormScoreValue));
  const consistencyValue = clampPercent(sessionProgress.analyzedSamples
    ? (sessionProgress.goodSamples / sessionProgress.analyzedSamples) * 100
    : stabilityValue);
  const completedReps = 0;
  const completionValue = clampPercent(Math.min(100, Math.max(completedReps * 8, sessionProgress.analyzedSamples ? averageFormScoreValue : 0)));
  const currentStreakValue = sessionProgress.goodSamples;
  const analyticsCards = [
    {
      label: text('Form Score', 'Ù†ØªÙŠØ¬Ø© Ø§Ù„Ø£Ø¯Ø§Ø¡'),
      value: formScoreValue > 0 ? `${formScoreValue}` : text('Ready', 'Ø¬Ø§Ù‡Ø²'),
      suffix: formScoreValue > 0 ? '/100' : '',
      trend: formScoreValue >= 88 ? text('â†‘ New best', 'â†‘ Ø£ÙØ¶Ù„ Ù†ØªÙŠØ¬Ø©') : formScoreValue >= 74 ? text('â†‘ +6%', 'â†‘ +6%') : liveReady ? text('â†’ Calibrating', 'â†’ Ù…Ø¹Ø§ÙŠØ±Ø©') : text('Ready', 'Ø¬Ø§Ù‡Ø²'),
      status: formScoreValue >= 88 ? text('Excellent form', 'Ø£Ø¯Ø§Ø¡ Ù…Ù…ØªØ§Ø²') : formScoreValue >= 74 ? text('Great form', 'Ø£Ø¯Ø§Ø¡ Ø±Ø§Ø¦Ø¹') : liveReady ? text('Building signal', 'Ø¬Ø§Ø±ÙŠ Ø§Ù„Ù‚ÙŠØ§Ø³') : text('Waiting for camera', 'Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§'),
      progress: formScoreValue,
      tone: metricToneFor(formScoreValue, liveReady),
      icon: <ShieldCheck className="h-4 w-4" />,
    },
    {
      label: text('Confidence', 'Ø§Ù„Ø«Ù‚Ø©'),
      value: confidenceValue > 0 ? `${confidenceValue}%` : text('Idle', 'Ø§Ù†ØªØ¸Ø§Ø±'),
      trend: confidenceValue >= 88 ? text('â†‘ Stable', 'â†‘ Ø«Ø§Ø¨Øª') : liveReady ? text('â†’ Tracking', 'â†’ ØªØªØ¨Ø¹') : text('Ready', 'Ø¬Ø§Ù‡Ø²'),
      status: bodyDetected ? text('Body visible', 'Ø§Ù„Ø¬Ø³Ù… Ø¸Ø§Ù‡Ø±') : liveReady ? text('Searching', 'Ø¬Ø§Ø±ÙŠ Ø§Ù„Ø¨Ø­Ø«') : text('Pose model ready', 'Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„Ø­Ø±ÙƒØ© Ø¬Ø§Ù‡Ø²'),
      progress: confidenceValue,
      tone: metricToneFor(confidenceValue, liveReady),
      icon: <Radar className="h-4 w-4" />,
    },
    {
      label: text('Reps', 'Ø§Ù„ØªÙƒØ±Ø§Ø±Ø§Øª'),
      value: `${completedReps}`,
      suffix: text(' reps', ' ØªÙƒØ±Ø§Ø±'),
      trend: completedReps > 0 ? text('â­ Consistency +1', 'â­ Ø«Ø¨Ø§Øª +1') : text('Ready', 'Ø¬Ø§Ù‡Ø²'),
      status: text('Rep counter pending', 'Ø¹Ø¯ Ø§Ù„ØªÙƒØ±Ø§Ø±Ø§Øª Ù„Ø§Ø­Ù‚Ø§Ù‹'),
      progress: completedReps > 0 ? Math.min(100, completedReps * 10) : 0,
      tone: 'purple',
      icon: <Dumbbell className="h-4 w-4" />,
    },
    {
      label: text('Range of Motion', 'Ù…Ø¯Ù‰ Ø§Ù„Ø­Ø±ÙƒØ©'),
      value: rangeOfMotionValue > 0 ? `${rangeOfMotionValue}%` : text('Ready', 'Ø¬Ø§Ù‡Ø²'),
      trend: rangeOfMotionValue >= 82 ? text('ðŸŽ¯ Full range', 'ðŸŽ¯ Ù…Ø¯Ù‰ ÙƒØ§Ù…Ù„') : liveReady ? text('â†’ Needs depth', 'â†’ ÙŠØ­ØªØ§Ø¬ Ø¹Ù…Ù‚') : text('Ready', 'Ø¬Ø§Ù‡Ø²'),
      status: rangeOfMotionValue >= 82 ? text('Excellent range', 'Ù…Ø¯Ù‰ Ù…Ù…ØªØ§Ø²') : rangeOfMotionValue >= 68 ? text('Good depth', 'Ù…Ø¯Ù‰ Ø¬ÙŠØ¯') : liveReady ? text('Needs depth', 'ÙŠØ­ØªØ§Ø¬ Ø¹Ù…Ù‚') : text('Waiting for camera', 'Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§'),
      progress: rangeOfMotionValue,
      tone: metricToneFor(rangeOfMotionValue, liveReady),
      icon: <Target className="h-4 w-4" />,
    },
    {
      label: text('Stability', 'Ø§Ù„Ø«Ø¨Ø§Øª'),
      value: stabilityValue > 0 ? `${stabilityValue}%` : text('Ready', 'Ø¬Ø§Ù‡Ø²'),
      trend: stabilityValue >= 90 ? text('âœ… Very stable', 'âœ… Ø«Ø§Ø¨Øª Ø¬Ø¯Ø§Ù‹') : liveReady ? text('â†’ Center body', 'â†’ Ø«Ø¨Øª Ø¬Ø³Ù…Ùƒ') : text('Ready', 'Ø¬Ø§Ù‡Ø²'),
      status: poseQuality.stable ? text('Very stable', 'Ø«Ø§Ø¨Øª Ø¬Ø¯Ø§Ù‹') : liveReady ? text('Hold steady', 'Ø§Ø«Ø¨Øª Ø´ÙˆÙŠ') : text('Waiting for camera', 'Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§'),
      progress: stabilityValue,
      tone: metricToneFor(stabilityValue, liveReady),
      icon: <Gauge className="h-4 w-4" />,
    },
    {
      label: text('Tempo', 'Ø§Ù„Ø¥ÙŠÙ‚Ø§Ø¹'),
      value: liveReady ? (isPaused ? text('Paused', 'Ù…ØªÙˆÙ‚Ù') : '2.3s') : text('Ready', 'Ø¬Ø§Ù‡Ø²'),
      trend: tempoValue >= 70 ? text('â†‘ Improving', 'â†‘ ÙŠØªØ­Ø³Ù†') : liveReady ? text('â†’ Controlled', 'â†’ Ù…ØªØ­ÙƒÙ…') : text('Ready', 'Ø¬Ø§Ù‡Ø²'),
      status: liveReady ? text('Control each rep', 'ØªØ­ÙƒÙ… Ø¨ÙƒÙ„ ØªÙƒØ±Ø§Ø±') : text('Waiting for camera', 'Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§'),
      progress: tempoValue,
      tone: metricToneFor(tempoValue, liveReady),
      icon: <Timer className="h-4 w-4" />,
    },
  ] as const;
  const collectionReady = canCollectCurrentExercise && cameraState === 'live' && modelState === 'ready';
  const collectionStatus = !collectionModeEnabled
    ? text('Hidden', 'Ù…Ø®ÙÙŠ')
    : !canCollectCurrentExercise
      ? text('Select squat, push-up, or plank', 'Ø§Ø®ØªØ± Ø§Ù„Ø³ÙƒÙˆØ§Øª Ø£Ùˆ Ø§Ù„Ø¶ØºØ· Ø£Ùˆ Ø§Ù„Ø¨Ù„Ø§Ù†Ùƒ')
      : isCollecting
        ? text('Collecting locally', 'ÙŠØªÙ… Ø§Ù„Ø¬Ù…Ø¹ Ù…Ø­Ù„ÙŠØ§Ù‹')
        : text('Ready to collect', 'Ø¬Ø§Ù‡Ø² Ù„Ù„Ø¬Ù…Ø¹');

  const guidanceItems = [
    { label: text('Full body visible', 'Ø¸Ù‡ÙˆØ± Ø§Ù„Ø¬Ø³Ù… ÙƒØ§Ù…Ù„Ù‹Ø§'), active: !needsVisibilityAdjustment },
    { label: text('Good lighting', 'Ø¥Ø¶Ø§Ø¡Ø© Ø¬ÙŠØ¯Ø©'), active: liveReady },
    { label: text('Camera stable', 'Ø«Ø¨Ø§Øª Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§'), active: liveReady },
    { label: text('Exercise selected', 'ØªÙ… Ø§Ø®ØªÙŠØ§Ø± Ø§Ù„ØªÙ…Ø±ÙŠÙ†'), active: Boolean(exercise) },
  ];

  const setupGuidanceItems = [
    { label: text('Full body visible', 'Ø¸Ù‡ÙˆØ± Ø§Ù„Ø¬Ø³Ù… ÙƒØ§Ù…Ù„'), active: bodyDetected && poseQuality.visibleLandmarks >= MIN_VISIBLE_LANDMARKS },
    { label: text('Good lighting', 'Ø¥Ø¶Ø§Ø¡Ø© ÙˆØ§Ø¶Ø­Ø©'), active: poseQuality.averageVisibility >= Math.round(MIN_AVERAGE_VISIBILITY * 100) },
    { label: text('Body centered', 'Ø¬Ø³Ù…Ùƒ Ø¨ÙˆØ³Ø· Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§'), active: poseQuality.centered },
    { label: text('Stable detection', 'Ø§Ù„ØªØªØ¨Ø¹ Ø«Ø§Ø¨Øª'), active: poseQuality.stable },
    { label: text('Exercise selected', 'ØªÙ… Ø§Ø®ØªÙŠØ§Ø± Ø§Ù„ØªÙ…Ø±ÙŠÙ†'), active: Boolean(exercise) },
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
    <div className="relative min-h-screen overflow-hidden bg-[#060816] pb-24 text-foreground md:pb-10">
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
              {text('LIVE COACH', 'ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø£Ø¯Ø§Ø¡ Ø§Ù„Ù…Ø¨Ø§Ø´Ø± Ø¨Ø§Ù„Ø°ÙƒØ§Ø¡ Ø§Ù„Ø§ØµØ·Ù†Ø§Ø¹ÙŠ')}
            </span>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold text-emerald-200">
              {liveReady ? text('Live', 'Ù…Ø¨Ø§Ø´Ø±') : text('Ready', 'Ø¬Ø§Ù‡Ø²')}
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-medium text-muted-foreground">
              {text('Private live view', 'Ø¹Ø±Ø¶ Ù…Ø¨Ø§Ø´Ø± Ø®Ø§Øµ')}
            </span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-white md:text-5xl">
            {text('Live Form Coach', 'Ù…Ø¯Ø±Ø¨ Ø§Ù„Ø£Ø¯Ø§Ø¡ Ø§Ù„Ù…Ø¨Ø§Ø´Ø±')}
          </h1>
          <div className="relative mt-3 h-1.5 w-44 overflow-hidden rounded-full bg-white/8">
            <div className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-fuchsia-400 via-violet-400 to-cyan-300 blur-[1px]" />
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground md:text-base">
            {text('Live exercise form feedback.', 'ØªØªØ¨Ø¹ ÙÙˆØ±ÙŠ Ù„Ù„ÙˆØ¶Ø¹ÙŠØ©ØŒ ÙˆÙ…Ù„Ø§Ø­Ø¸Ø§Øª Ù„Ù„Ø­Ø±ÙƒØ©ØŒ ÙˆØªØµØ­ÙŠØ­ Ø°ÙƒÙŠ Ù„Ù„ØªÙ…Ø±ÙŠÙ† ÙÙŠ Ø§Ù„ÙˆÙ‚Øª Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠ.')}
          </p>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(21rem,34%)] 2xl:grid-cols-[minmax(0,1fr)_minmax(22rem,32%)] xl:items-start">
          <aside className="hidden">
            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl" dir="ltr">
              <div className="flex flex-row items-center gap-4 text-left">
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
                  <h2 className="text-lg font-semibold text-foreground">{profile?.name || text('Your live session', 'Ø¬Ù„Ø³ØªÙƒ Ø§Ù„Ù…Ø¨Ø§Ø´Ø±Ø©')}</h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {profile?.goal && (
                      <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-3 py-1 text-[11px] font-medium text-fuchsia-100">
                        {profile.goal}
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-muted-foreground">
                      {text('Active Session', 'Ø¬Ù„Ø³Ø© Ù†Ø´Ø·Ø©')}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-2 text-sm">
                <StatusRow label={text('Camera connected', 'Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ù…ØªØµÙ„Ø©')} value={liveReady ? text('Yes', 'Ù†Ø¹Ù…') : text('Waiting', 'Ø§Ù†ØªØ¸Ø§Ø±')} active={liveReady} />
                <StatusRow label={text('Pose tracking ready', 'ØªØªØ¨Ø¹ Ø§Ù„Ø­Ø±ÙƒØ© Ø¬Ø§Ù‡Ø²')} value={trackingReady ? text('Ready', 'Ø¬Ø§Ù‡Ø²') : text('Loading', 'Ø¬Ø§Ø±Ù Ø§Ù„ØªØ­Ù…ÙŠÙ„')} active={trackingReady} />
              </div>
            </div>

            <div className="order-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-cyan-300" />
                <h3 className="text-sm font-semibold text-white">{text('Tracking Guidance', 'Ø¥Ø±Ø´Ø§Ø¯Ø§Øª Ø§Ù„ØªØªØ¨Ø¹')}</h3>
              </div>
              <p className="mb-4 text-sm leading-6 text-muted-foreground">
                {text('Keep your full body visible inside the frame for better movement analysis.', 'Ø­Ø§ÙØ¸ Ø¹Ù„Ù‰ Ø¸Ù‡ÙˆØ± Ø¬Ø³Ù…Ùƒ ÙƒØ§Ù…Ù„Ù‹Ø§ Ø¯Ø§Ø®Ù„ Ø§Ù„Ø¥Ø·Ø§Ø± Ù„Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ ØªØ­Ù„ÙŠÙ„ Ø£Ø¯Ù‚ Ù„Ù„Ø­Ø±ÙƒØ©.')}
              </p>
              <div className="space-y-2">
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2.5 text-sm">
                    <span className="text-foreground/90">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'Ø¬Ø§Ù‡Ø²') : text('Guide', 'ØªÙ†Ø¨ÙŠÙ‡')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'Ø§Ù„Ù…Ø³ØªÙˆÙ‰')} value={difficulty === 'advanced' ? text('Advanced', 'Ù…ØªÙ‚Ø¯Ù…') : text('Normal', 'Ø¹Ø§Ø¯ÙŠ')} />
                <InfoChip label={text('Analysis', 'Ø§Ù„ØªØ­Ù„ÙŠÙ„')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'Ø§Ù„Ø«Ù‚Ø©')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'Ø§Ù„ØªÙƒØ±Ø§Ø±Ø§Øª')} value={text('Pending', 'Ù„Ø§Ø­Ù‚Ø§Ù‹')} />
              </div>
            </div>
            <div className="order-4 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.78),rgba(10,12,24,0.86))] p-5 shadow-[0_16px_48px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-violet-200" />
                  <h3 className="text-sm font-semibold text-white">{text('Recent Sessions', 'Ø¢Ø®Ø± Ø§Ù„Ø¬Ù„Ø³Ø§Øª')}</h3>
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
                  {text('Clear', 'Ù…Ø³Ø­')}
                </Button>
              </div>

              {recentSessions.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs leading-6 text-muted-foreground">
                  {text('Stop a session longer than 5 seconds to save a local summary here.', 'Ø£Ù†Ù‡Ù Ø¬Ù„Ø³Ø© Ø£Ø·ÙˆÙ„ Ù…Ù† 5 Ø«ÙˆØ§Ù†ÙŠ Ù„Ø­ÙØ¸ Ù…Ù„Ø®Øµ Ù…Ø­Ù„ÙŠ Ù‡Ù†Ø§.')}
                </div>
              ) : (
                <div className="space-y-3">
                  {recentSessions.map((session) => {
                    const support = session.supportLevel === 'full'
                      ? text('Full tracking', 'ØªØ­Ù„ÙŠÙ„ ÙƒØ§Ù…Ù„')
                      : session.supportLevel === 'basic'
                        ? text('Basic tracking', 'ØªØªØ¨Ø¹ Ø£Ø³Ø§Ø³ÙŠ')
                        : text('Not supported', 'ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ…');
                    return (
                      <div key={session.sessionId} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{session.exerciseName}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {new Date(session.timestamp).toLocaleString()} Â· {support}
                            </div>
                          </div>
                          <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] font-mono text-cyan-100">
                            {formatElapsed(session.duration)}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                          <InfoChip label={text('Best', 'Ø£ÙØ¶Ù„')} value={session.bestFormScore !== null ? `${session.bestFormScore}` : '--'} />
                          <InfoChip label={text('Avg', 'Ø§Ù„Ù…ØªÙˆØ³Ø·')} value={session.averageFormScore !== null ? `${session.averageFormScore}` : '--'} />
                          <InfoChip label={text('Conf.', 'Ø§Ù„Ø«Ù‚Ø©')} value={session.confidence !== null ? `${session.confidence}%` : '--'} />
                        </div>
                        <div className="mt-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                          <span className="text-white/80">{text('Final cue', 'Ø¢Ø®Ø± ØªÙ†Ø¨ÙŠÙ‡')}:</span> {session.finalStatus}
                        </div>
                        {session.corrections.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {session.corrections.map((correction) => (
                              <span key={correction.message} className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-100">
                                {correction.message} Ã—{correction.count}
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
                  <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-200" />{text('Advanced details', 'ØªÙØ§ØµÙŠÙ„ Ù…ØªÙ‚Ø¯Ù…Ø©')}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{text('Optional', 'Ø§Ø®ØªÙŠØ§Ø±ÙŠ')}</span>
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
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-semibold text-white">{profile?.name || text('Your live session', 'Ø¬Ù„Ø³ØªÙƒ Ø§Ù„Ù…Ø¨Ø§Ø´Ø±Ø©')}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {profile?.goal && (
                      <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-medium text-fuchsia-100">
                        {profile.goal}
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">
                      {text('Setup details', 'ØªÙØ§ØµÙŠÙ„ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="text-foreground/85">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'Ø¬Ø§Ù‡Ø²') : text('Guide', 'ØªÙ†Ø¨ÙŠÙ‡')}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'Ø§Ù„Ù…Ø³ØªÙˆÙ‰')} value={difficulty === 'advanced' ? text('Advanced', 'Ù…ØªÙ‚Ø¯Ù…') : text('Normal', 'Ø¹Ø§Ø¯ÙŠ')} />
                <InfoChip label={text('Analysis', 'Ø§Ù„ØªØ­Ù„ÙŠÙ„')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'Ø§Ù„Ø«Ù‚Ø©')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'Ø§Ù„ØªÙƒØ±Ø§Ø±Ø§Øª')} value={text('Pending', 'Ù„Ø§Ø­Ù‚Ø§')} />
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
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-semibold text-white">{profile?.name || text('Your live session', 'Ø¬Ù„Ø³ØªÙƒ Ø§Ù„Ù…Ø¨Ø§Ø´Ø±Ø©')}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {profile?.goal && (
                      <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-medium text-fuchsia-100">
                        {profile.goal}
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">
                      {text('Setup details', 'ØªÙØ§ØµÙŠÙ„ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="text-foreground/85">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'Ø¬Ø§Ù‡Ø²') : text('Guide', 'ØªÙ†Ø¨ÙŠÙ‡')}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'Ø§Ù„Ù…Ø³ØªÙˆÙ‰')} value={difficulty === 'advanced' ? text('Advanced', 'Ù…ØªÙ‚Ø¯Ù…') : text('Normal', 'Ø¹Ø§Ø¯ÙŠ')} />
                <InfoChip label={text('Analysis', 'Ø§Ù„ØªØ­Ù„ÙŠÙ„')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'Ø§Ù„Ø«Ù‚Ø©')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'Ø§Ù„ØªÙƒØ±Ø§Ø±Ø§Øª')} value={text('Pending', 'Ù„Ø§Ø­Ù‚Ø§')} />
              </div>
            </div>
          </aside>

          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground">
                {text('Exercise', 'Exercise')}: <span className="text-white">{selectedExerciseLabel}</span>
              </div>
              <div className={cn('rounded-full border px-3 py-1.5 text-xs', analysisActive ? 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                {analysisActive ? text('AI Tracking', 'Ø§Ù„ØªØªØ¨Ø¹ Ø§Ù„Ø°ÙƒÙŠ') : text('Scanner idle', 'Ø§Ù„Ù…Ø§Ø³Ø­ ÙÙŠ ÙˆØ¶Ø¹ Ø§Ù„Ø§Ù†ØªØ¸Ø§Ø±')}
              </div>
            </div>

            <CurrentCuePanel cue={coachingCue} isArabic={isArabic} poseQuality={poseQuality} text={text} />

            <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(12,14,28,0.95),rgba(5,7,16,0.98))] shadow-[0_28px_90px_rgba(0,0,0,0.4)]">
              <div className="border-b border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-red-200">
                      <span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                      {text('LIVE', 'Ù…Ø¨Ø§Ø´Ø±')}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-muted-foreground">
                      {text('Private live view', 'Ø¹Ø±Ø¶ Ù…Ø¨Ø§Ø´Ø± Ø®Ø§Øµ')}
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
                          ? text('Pose detected', 'ØªÙ… Ø§ÙƒØªØ´Ø§Ù Ø§Ù„Ø¬Ø³Ù…')
                          : liveReady
                            ? text('Searching', 'Ø¬Ø§Ø±ÙŠ Ø§Ù„Ø¨Ø­Ø«')
                            : text('Pose model ready', 'Ù†Ù…ÙˆØ°Ø¬ Ø§Ù„Ø­Ø±ÙƒØ© Ø¬Ø§Ù‡Ø²')
                        : text('Tracking ready', 'Ø§Ù„ØªØªØ¨Ø¹ Ø¬Ø§Ù‡Ø²')}
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
                        ? text('Camera setup issue', 'Ù…Ø´ÙƒÙ„Ø© ÙÙŠ Ø¥Ø¹Ø¯Ø§Ø¯ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§')
                        : text('Ready to start?', 'Ø§Ø¨Ø¯Ø£ Ø¬Ù„Ø³Ø© Ø§Ù„Ø£Ø¯Ø§Ø¡ Ø§Ù„Ù…Ø¨Ø§Ø´Ø±')}
                    </h3>
                    <p className="max-w-xl text-sm leading-7 text-zinc-400">
                      {cameraState === 'error' ? errorMessage : cameraState === 'starting'
                        ? text('Starting camera...', 'Ø¬Ø§Ø±Ù ØªØ´ØºÙŠÙ„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§...')
                        : text('Make sure your full body is visible.', 'Ø³ÙŠÙ‚ÙˆÙ… Ù…Ø¯Ø±Ø¨Ùƒ Ø§Ù„Ø°ÙƒÙŠ Ø¨ØªØªØ¨Ø¹ Ø§Ù„Ø­Ø±ÙƒØ© ÙˆÙ…Ø³Ø§Ø¹Ø¯ØªÙƒ Ø¹Ù„Ù‰ ØªØµØ­ÙŠØ­ Ø§Ù„ØªÙ…Ø±ÙŠÙ† ÙÙŠ Ø§Ù„ÙˆÙ‚Øª Ø§Ù„Ø­Ù‚ÙŠÙ‚ÙŠ.')}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {text('', 'ÙŠÙØ³ØªØ®Ø¯Ù… Ø§Ù„Ø¹Ø±Ø¶ Ø§Ù„Ù…Ø¨Ø§Ø´Ø± Ù„ØªÙ‚Ø¯ÙŠÙ… Ù…Ù„Ø§Ø­Ø¸Ø§Øª ÙÙˆØ±ÙŠØ© Ø¹Ù„Ù‰ Ø§Ù„Ø£Ø¯Ø§Ø¡.')}
                    </p>
                  </div>
                )}

                {cameraState === 'live' && (
                  <>
                    <div className="pointer-events-none absolute inset-x-[12%] top-[24%] z-[3] h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent shadow-[0_0_14px_rgba(34,211,238,0.45)]" />
                    <div className="pointer-events-none absolute bottom-5 right-5 z-[3] rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[11px] text-cyan-100 backdrop-blur-md">
                      <Cpu className="mr-1 inline h-3.5 w-3.5" />
                      {analysisActive ? text('Analyzing joints', 'ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù…ÙØ§ØµÙ„') : text('AI tracking ready', 'Ø§Ù„ØªØªØ¨Ø¹ Ø§Ù„Ø°ÙƒÙŠ Ø¬Ø§Ù‡Ø²')}
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-white/10 bg-[linear-gradient(180deg,rgba(7,9,18,0.88),rgba(7,9,18,0.96))] px-4 py-4">
                <div className="mb-3 flex flex-wrap gap-2">
                  <div className={cn('rounded-full border px-3 py-1.5 text-xs', liveReady ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                    <Camera className="mr-1 inline h-3.5 w-3.5" />
                    {text('Camera', 'Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§')}: {liveReady ? text('Connected', 'Ù…ØªØµÙ„Ø©') : text('Off', 'Ù…ØªÙˆÙ‚ÙØ©')}
                  </div>
                  <div className={cn('rounded-full border px-3 py-1.5 text-xs', trackingReady ? 'border-cyan-300/20 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                    <Radar className="mr-1 inline h-3.5 w-3.5" />
                    {text('Pose tracking', 'ØªØªØ¨Ø¹ Ø§Ù„Ø­Ø±ÙƒØ©')}: {trackingReady ? text('Ready', 'Ø¬Ø§Ù‡Ø²') : text('Loading', 'ØªØ­Ù…ÙŠÙ„')}
                  </div>
                  <div className={cn('rounded-full border px-3 py-1.5 text-xs', analysisActive ? 'border-fuchsia-300/20 bg-fuchsia-500/10 text-fuchsia-100' : 'border-white/10 bg-white/[0.04] text-muted-foreground')}>
                    <Activity className="mr-1 inline h-3.5 w-3.5" />
                    {text('Form analysis', 'ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø£Ø¯Ø§Ø¡')}: {analysisActive ? text('Analyzing', 'Ø¬Ø§Ø±Ù Ø§Ù„ØªØ­Ù„ÙŠÙ„') : text('Stand by', 'Ø§Ù†ØªØ¸Ø§Ø±')}
                  </div>
                  <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground">
                    <Eye className="mr-1 inline h-3.5 w-3.5" />
                    {text('Exercise', 'Ø§Ù„ØªÙ…Ø±ÙŠÙ†')}: <span className="text-foreground">{selectedExerciseLabel}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {cameraState === 'live' ? (
                    <>
                      <Button variant="secondary" onClick={() => setIsPaused((value) => !value)} className="rounded-full border border-white/10 bg-white/[0.06] px-5">
                        {isPaused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
                        {isPaused ? text('Resume', 'Ø§Ø³ØªØ¦Ù†Ø§Ù') : text('Pause', 'Ø¥ÙŠÙ‚Ø§Ù Ù…Ø¤Ù‚Øª')}
                      </Button>
                      <Button variant="secondary" onClick={resetSession} className="rounded-full border border-white/10 bg-white/[0.06] px-5"><RotateCcw className="mr-2 h-4 w-4" />{text('Reset', 'Ø¥Ø¹Ø§Ø¯Ø© Ø¶Ø¨Ø·')}</Button>
                      <Button variant="destructive" onClick={stopCamera} className="rounded-full px-5 shadow-[0_16px_36px_rgba(239,68,68,0.22)]"><CameraOff className="mr-2 h-4 w-4" />{text('Stop Session', 'Ø¥ÙŠÙ‚Ø§Ù Ø§Ù„Ø¬Ù„Ø³Ø©')}</Button>
                      <Button variant="secondary" onClick={switchCamera} className="rounded-full border border-white/10 bg-white/[0.06] px-5"><RefreshCw className="mr-2 h-4 w-4" />{text('Switch camera', 'ØªØ¨Ø¯ÙŠÙ„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§')}</Button>
                      <Button variant="secondary" onClick={() => setVoiceEnabled((value) => !value)} className="rounded-full border border-white/10 bg-white/[0.06] px-5">
                        {voiceEnabled ? <Volume2 className="mr-2 h-4 w-4" /> : <VolumeX className="mr-2 h-4 w-4" />}
                        {voiceEnabled ? text('Voice on', 'Ø§Ù„ØµÙˆØª Ø´ØºØ§Ù„') : text('Muted', 'Ø§Ù„ØµÙˆØª Ù…Ø·ÙÙŠ')}
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => startCamera()} disabled={cameraState === 'starting' || !canStartSession} className="rounded-full px-6"><Camera className="mr-2 h-4 w-4" />{text('Start camera', 'ØªØ´ØºÙŠÙ„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§')}</Button>
                  )}
                </div>
              </div>
            </section>

            <section className="mt-5 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,17,34,0.88),rgba(7,9,18,0.94))] p-4 shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur-2xl sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/70">{text('Real-time Analytics', 'ØªØ­Ù„ÙŠÙ„Ø§Øª Ù…Ø¨Ø§Ø´Ø±Ø©')}</div>
                  <h2 className="mt-1 text-xl font-semibold text-white">{text('Training metrics', 'Ù…Ø¤Ø´Ø±Ø§Øª Ø§Ù„ØªÙ…Ø±ÙŠÙ†')}</h2>
                </div>
                <span className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium',
                  liveReady ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-200' : 'border-violet-300/25 bg-violet-400/10 text-violet-100'
                )}>
                  {liveReady ? text('Live metrics', 'Ù…Ø¤Ø´Ø±Ø§Øª Ù…Ø¨Ø§Ø´Ø±Ø©') : text('Ready to watch', 'Ø¬Ø§Ù‡Ø² Ù„Ù„ØªØªØ¨Ø¹')}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {analyticsCards.slice(0, 4).map((card) => (
                  <AnalyticsCard key={card.label} {...card} />
                ))}
              </div>
            </section>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
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
                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-yellow-100/70">{text('Form Tips', 'Ù†ØµØ§Ø¦Ø­ Ø§Ù„Ø°ÙƒØ§Ø¡ Ù„Ù„ØªØ­Ø³Ù†')}</div>
                    <h3 className="text-lg font-semibold text-white">{text('Better reps', 'ØªÙˆØ¬ÙŠÙ‡Ø§Øª Ø¨Ø³ÙŠØ·Ø© Ù„ØªÙƒØ±Ø§Ø±Ø§Øª Ø£ÙØ¶Ù„')}</h3>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <CoachTip icon={<Target className="h-5 w-5" />} tone="green" title={text('Keep your body aligned', 'Ø®Ù„ÙŠ Ø¬Ø³Ù…Ùƒ Ø¨Ù…Ø­Ø§Ø°Ø§Ø©')} description={text('Stack joints and stay centered in frame.', 'Ø±ØªØ¨ Ù…ÙØ§ØµÙ„Ùƒ ÙˆØ®Ù„ÙŠÙƒ Ø¨Ù†Øµ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§.')} />
                  <CoachTip icon={<Timer className="h-5 w-5" />} tone="amber" title={text('Control your tempo', 'ØªØ­ÙƒÙ… Ø¨Ø§Ù„Ø¥ÙŠÙ‚Ø§Ø¹')} description={text('Move with control instead of rushing reps.', 'ØªØ­Ø±Ùƒ Ø¨Ù‡Ø¯ÙˆØ¡ Ø¨Ø¯ÙˆÙ† Ø§Ø³ØªØ¹Ø¬Ø§Ù„.')} />
                  <CoachTip icon={<TrendingUp className="h-5 w-5" />} tone="green" title={text('Complete full range of motion', 'ÙƒÙ…Ù„ Ù…Ø¯Ù‰ Ø§Ù„Ø­Ø±ÙƒØ©')} description={text('Use smooth depth while keeping form clean.', 'Ø§Ù†Ø²Ù„ ÙˆØ§Ø·Ù„Ø¹ Ø¨Ù…Ø¯Ù‰ ÙˆØ§Ø¶Ø­ ÙˆÙ†Ø¸ÙŠÙ.')} />
                </div>
              </section>
            </div>
          </div>

          <aside className="flex flex-col gap-5 xl:sticky xl:top-24">
            <div className="order-3"><FeedbackPanel feedback={poseFeedback} modelState={modelState} isCameraLive={liveReady} text={text} /></div>
            {collectionModeEnabled && (
              <div className="order-6 rounded-[28px] border border-cyan-300/20 bg-[linear-gradient(180deg,rgba(8,24,34,0.92),rgba(8,10,22,0.94))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-cyan-300" />
                      <h3 className="text-sm font-semibold text-white">{text('Data Collection', 'Ø¬Ù…Ø¹ Ø§Ù„Ø¨ÙŠØ§Ù†Ø§Øª')}</h3>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-cyan-50/70">
                      {text('This mode exports pose landmarks and joint angles only. It does not save camera video.', 'Ù‡Ø°Ø§ Ø§Ù„ÙˆØ¶Ø¹ ÙŠØµØ¯Ù‘Ø± Ù†Ù‚Ø§Ø· Ø§Ù„Ø¬Ø³Ù… ÙˆØ²ÙˆØ§ÙŠØ§ Ø§Ù„Ù…ÙØ§ØµÙ„ ÙÙ‚Ø·. Ù„Ø§ ÙŠØ­ÙØ¸ ÙÙŠØ¯ÙŠÙˆ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§.')}
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
                    <span>{text('Status', 'Ø§Ù„Ø­Ø§Ù„Ø©')}</span>
                    <span className={cn('text-right font-medium', collectionReady ? 'text-emerald-300' : 'text-amber-300')}>{collectionStatus}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span>{text('Exercise', 'Ø§Ù„ØªÙ…Ø±ÙŠÙ†')}</span>
                    <span className="font-medium text-white">{collectionExercise ?? text('Unsupported for collection', 'ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ… Ù„Ù„Ø¬Ù…Ø¹')}</span>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">{text('Label', 'Ø§Ù„ØªØµÙ†ÙŠÙ')}</Label>
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
                    <Label className="text-xs text-muted-foreground">{text('Mistake Type', 'Ù†ÙˆØ¹ Ø§Ù„Ø®Ø·Ø£')}</Label>
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
                      <Label className="text-xs text-muted-foreground">{text('Camera Angle', 'Ø²Ø§ÙˆÙŠØ© Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§')}</Label>
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
                      <Label className="text-xs text-muted-foreground">{text('Difficulty', 'Ø§Ù„ØµØ¹ÙˆØ¨Ø©')}</Label>
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
                      <Pause className="mr-2 h-4 w-4" />{text('Stop', 'Ø¥ÙŠÙ‚Ø§Ù')}
                    </Button>
                  ) : (
                    <Button type="button" className="rounded-2xl" onClick={startDataCollection} disabled={!collectionReady}>
                      <Play className="mr-2 h-4 w-4" />{text('Start', 'Ø¨Ø¯Ø¡')}
                    </Button>
                  )}
                  <Button type="button" variant="outline" className="rounded-2xl border-white/10 bg-white/[0.04]" onClick={exportCollectionBatch} disabled={collectionSamples.length === 0}>
                    <Download className="mr-2 h-4 w-4" />{text('Export', 'ØªØµØ¯ÙŠØ±')}
                  </Button>
                  <Button type="button" variant="outline" className="col-span-2 rounded-2xl border-white/10 bg-white/[0.04] text-muted-foreground hover:text-white" onClick={clearCollectionBatch} disabled={collectionSamples.length === 0 && !isCollecting}>
                    <Trash2 className="mr-2 h-4 w-4" />{text('Clear batch', 'Ù…Ø³Ø­ Ø§Ù„Ø¯ÙØ¹Ø©')}
                  </Button>
                </div>
              </div>
            )}

            <div className="order-1 rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.26em] text-cyan-100/70">{text('Exercise', 'Exercise')}</div>
              <Label htmlFor="exercise" className="text-sm font-semibold text-white">{text('Exercise', 'Ø§Ù„ØªÙ…Ø±ÙŠÙ†')}</Label>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                {text('Choose an exercise to begin.', 'Ø§Ø®ØªØ± Ø§Ù„ØªÙ…Ø±ÙŠÙ† Ø­ØªÙ‰ ÙŠØªÙ…ÙƒÙ† Ø§Ù„Ù…Ø¯Ø±Ø¨ Ø§Ù„Ø°ÙƒÙŠ Ù…Ù† ØªÙ‚ÙŠÙŠÙ… Ø§Ù„Ø£Ø¯Ø§Ø¡ Ø§Ù„ØµØ­ÙŠØ­.')}
              </p>
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{text('Tracking', 'Ø§Ù„ØªØªØ¨Ø¹')}</span>
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
                  {selectedTracking?.reason ?? text('Select an exercise to see tracking support.', 'Ø§Ø®ØªØ± ØªÙ…Ø±ÙŠÙ†Ø§Ù‹ Ù„Ø¹Ø±Ø¶ Ø¯Ø¹Ù… Ø§Ù„ØªØªØ¨Ø¹.')}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 rounded-2xl border border-white/10 bg-black/20 p-1">
                {(['normal', 'advanced'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDifficulty(level)}
                    className={cn(
                      'rounded-xl px-3 py-2 text-sm font-semibold transition',
                      difficulty === level ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {level === 'advanced' ? text('Advanced', 'Ù…ØªÙ‚Ø¯Ù…') : text('Normal', 'Ø¹Ø§Ø¯ÙŠ')}
                  </button>
                ))}
              </div>

              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={exerciseQuery}
                  onChange={(event) => setExerciseQuery(event.target.value)}
                  placeholder={text('Search exercises', 'Ø§Ø¨Ø­Ø« Ø¹Ù† ØªÙ…Ø±ÙŠÙ†')}
                  className="h-11 w-full rounded-2xl border border-white/10 bg-black/20 pl-10 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-cyan-300/40"
                />
              </div>

              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                {filteredExercises.map((item) => {
                  const active = item.id === exercise;
                  const label = localizedLabel(item.name, item.nameAr, language);
                  const itemSupportLabel = item.tracking.support === 'full'
                    ? text('Full tracking', 'ØªØ­Ù„ÙŠÙ„ ÙƒØ§Ù…Ù„')
                    : item.tracking.support === 'basic'
                      ? text('Basic tracking', 'ØªØªØ¨Ø¹ Ø£Ø³Ø§Ø³ÙŠ')
                      : text('Not supported', 'ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ…');
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setExercise(item.id)}
                      className={cn(
                        'w-full rounded-2xl border px-3 py-3 text-left transition',
                        active ? 'border-cyan-300/35 bg-cyan-400/10' : 'border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.06]'
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white">{label}</div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                            <span>{item.source.muscle}</span>
                            <span>â€¢</span>
                            <span>{item.source.location}</span>
                            <span>â€¢</span>
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
                    {text('No exercises match this filter.', 'Ù„Ø§ ØªÙˆØ¬Ø¯ ØªÙ…Ø§Ø±ÙŠÙ† Ù…Ø·Ø§Ø¨Ù‚Ø© Ù„Ù‡Ø°Ø§ Ø§Ù„ÙÙ„ØªØ±.')}
                  </div>
                )}
              </div>
            </div>

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
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm font-semibold text-white">{profile?.name || text('Your live session', 'Ø¬Ù„Ø³ØªÙƒ Ø§Ù„Ù…Ø¨Ø§Ø´Ø±Ø©')}</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {profile?.goal && (
                      <span className="rounded-full border border-fuchsia-300/20 bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-medium text-fuchsia-100">
                        {profile.goal}
                      </span>
                    )}
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">
                      {text('Setup details', 'ØªÙØ§ØµÙŠÙ„ Ø§Ù„Ø¥Ø¹Ø¯Ø§Ø¯')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-2">
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="text-foreground/85">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'Ø¬Ø§Ù‡Ø²') : text('Guide', 'ØªÙ†Ø¨ÙŠÙ‡')}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'Ø§Ù„Ù…Ø³ØªÙˆÙ‰')} value={difficulty === 'advanced' ? text('Advanced', 'Ù…ØªÙ‚Ø¯Ù…') : text('Normal', 'Ø¹Ø§Ø¯ÙŠ')} />
                <InfoChip label={text('Analysis', 'Ø§Ù„ØªØ­Ù„ÙŠÙ„')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'Ø§Ù„Ø«Ù‚Ø©')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'Ø§Ù„ØªÙƒØ±Ø§Ø±Ø§Øª')} value={text('Pending', 'Ù„Ø§Ø­Ù‚Ø§')} />
              </div>
            </div>

            {devices.length > 1 && (
              <div className="order-5 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
                <Label htmlFor="camera-device" className="text-sm font-semibold text-white">{text('Camera', 'Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§')}</Label>
                <Select value={deviceId} onValueChange={async (value) => {
                  setDeviceId(value);
                  if (cameraState === 'live') await startCamera(facingMode, value);
                }}>
                  <SelectTrigger id="camera-device" className="mt-3 rounded-2xl border-white/10 bg-black/20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">{text('Automatic', 'ØªÙ„Ù‚Ø§Ø¦ÙŠ')}</SelectItem>
                    {devices.map((device, index) => (
                      <SelectItem key={device.deviceId} value={device.deviceId}>{device.label || `${text('Camera', 'ÙƒØ§Ù…ÙŠØ±Ø§')} ${index + 1}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="order-3 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-2xl">
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-cyan-300" />
                <h3 className="text-sm font-semibold text-white">{text('Session Status', 'Ø­Ø§Ù„Ø© Ø§Ù„Ø¬Ù„Ø³Ø©')}</h3>
              </div>
              <div className="space-y-3">
                <StatusRow label={text('Camera', 'Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§')} value={cameraState === 'live' ? text('Connected', 'Ù…ØªØµÙ„Ø©') : text('Off', 'Ù…ØªÙˆÙ‚ÙØ©')} active={cameraState === 'live'} />
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Session', 'Ø§Ù„Ø¬Ù„Ø³Ø©')}</span><span className="font-mono font-medium">{formatElapsed(elapsed)}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Form analysis', 'ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø£Ø¯Ø§Ø¡')}</span><span className={cn('flex items-center gap-1.5', modelState === 'ready' ? 'text-emerald-500' : 'text-muted-foreground')}><ScanLine className="h-4 w-4" />{modelState === 'ready' ? text('Ready', 'Ø¬Ø§Ù‡Ø²') : modelState === 'loading' ? text('Loading', 'Ø¬Ø§Ø±Ù Ø§Ù„ØªØ­Ù…ÙŠÙ„') : text('Unavailable', 'ØºÙŠØ± Ù…ØªØ§Ø­')}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Exercise', 'Ø§Ù„ØªÙ…Ø±ÙŠÙ†')}</span><span className="font-medium text-foreground">{selectedExerciseLabel}</span></div>
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{text('Visibility', 'Ø§Ù„Ø¸Ù‡ÙˆØ±')}</span><span className={cn('font-medium', needsVisibilityAdjustment ? 'text-amber-400' : 'text-emerald-400')}>{needsVisibilityAdjustment ? text('Needs adjustment', 'ÙŠØ­ØªØ§Ø¬ ØªØ¹Ø¯ÙŠÙ„') : text('Full body visible', 'Ø§Ù„Ø¬Ø³Ù… Ø¸Ø§Ù‡Ø±')}</span></div>
              </div>
            </div>

            <details className="order-5 rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.74),rgba(10,12,24,0.82))] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.22)] backdrop-blur-2xl">
              <summary className="cursor-pointer list-none text-sm font-semibold text-white outline-none marker:hidden">
                <span className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-200" />{text('Advanced details', 'ØªÙØ§ØµÙŠÙ„ Ù…ØªÙ‚Ø¯Ù…Ø©')}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{text('Optional', 'Ø§Ø®ØªÙŠØ§Ø±ÙŠ')}</span>
                </span>
              </summary>
              <div className="mt-4 grid gap-2">
                {setupGuidanceItems.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 text-xs">
                    <span className="text-foreground/85">{item.label}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]', item.active ? 'bg-emerald-400/12 text-emerald-200' : 'bg-white/6 text-muted-foreground')}>
                      {item.active ? text('OK', 'Ø¬Ø§Ù‡Ø²') : text('Guide', 'ØªÙ†Ø¨ÙŠÙ‡')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <InfoChip label={text('Difficulty', 'Ø§Ù„Ù…Ø³ØªÙˆÙ‰')} value={difficulty === 'advanced' ? text('Advanced', 'Ù…ØªÙ‚Ø¯Ù…') : text('Normal', 'Ø¹Ø§Ø¯ÙŠ')} />
                <InfoChip label={text('Analysis', 'Ø§Ù„ØªØ­Ù„ÙŠÙ„')} value={trackingSupportLabel} />
                <InfoChip label={text('Confidence', 'Ø§Ù„Ø«Ù‚Ø©')} value={confidenceLabel} />
                <InfoChip label={text('Reps', 'Ø§Ù„ØªÙƒØ±Ø§Ø±Ø§Øª')} value={text('Pending', 'Ù„Ø§Ø­Ù‚Ø§')} />
              </div>
            </details>
          </aside>
        </div>
      </main>
    </div>
  );
}

const feedbackCopy: Record<string, [string, string]> = {
  basic_tracking: ['Pose tracking is active. Keep your body visible and move with control.', 'ØªØªØ¨Ø¹ Ø§Ù„ÙˆØ¶Ø¹ÙŠØ© ÙØ¹Ù‘Ø§Ù„. Ø£Ø¨Ù‚Ù Ø¬Ø³Ù…Ùƒ Ø¸Ø§Ù‡Ø±Ø§Ù‹ ÙˆØªØ­Ø±Ùƒ Ø¨ØªØ­ÙƒÙ….'],
  low_pose_confidence: ['Improve lighting and keep the working joints visible', 'Ø­Ø³Ù‘Ù† Ø§Ù„Ø¥Ø¶Ø§Ø¡Ø© ÙˆØ£Ø¸Ù‡Ø± Ø§Ù„Ù…ÙØ§ØµÙ„ Ø§Ù„Ù…Ø·Ù„ÙˆØ¨Ø©'],
  unsupported_exercise: ['Pose visibility is active. Detailed scoring is not available for this exercise yet.', 'Ø±Ø¤ÙŠØ© Ø§Ù„ÙˆØ¶Ø¹ÙŠØ© ÙØ¹Ø§Ù„Ø©. Ø§Ù„ØªÙ‚ÙŠÙŠÙ… Ø§Ù„ØªÙØµÙŠÙ„ÙŠ ØºÙŠØ± Ù…ØªØ§Ø­ Ù„Ù‡Ø°Ø§ Ø§Ù„ØªÙ…Ø±ÙŠÙ† Ø­Ø§Ù„ÙŠØ§Ù‹.'],
  pose_model_unavailable: ['Pose analysis could not load. Check the model assets and refresh.', 'ØªØ¹Ø°Ø± ØªØ­Ù…ÙŠÙ„ ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø­Ø±ÙƒØ©. ØªØ­Ù‚Ù‚ Ù…Ù† Ù…Ù„ÙØ§Øª Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ Ø«Ù… Ø­Ø¯Ù‘Ø« Ø§Ù„ØµÙØ­Ø©.'],
  pose_detection_unavailable: ['Pose tracking stopped. Refresh the camera session and try again.', 'ØªÙˆÙ‚Ù ØªØªØ¨Ø¹ Ø§Ù„Ø­Ø±ÙƒØ©. Ø£Ø¹Ø¯ ØªØ´ØºÙŠÙ„ Ø¬Ù„Ø³Ø© Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ ÙˆØ­Ø§ÙˆÙ„ Ù…Ø±Ø© Ø£Ø®Ø±Ù‰.'],
  step_into_frame: ['Step into the frame', 'Ù‚Ù Ø£Ù…Ø§Ù… Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§'],
  full_body_required: ['Keep your full body visible', 'Ø£Ø¸Ù‡Ø± Ø¬Ø³Ù…Ùƒ ÙƒØ§Ù…Ù„Ù‹Ø§'],
  both_legs_required: ['Keep both legs visible', 'Ø£Ø¸Ù‡Ø± Ø§Ù„Ø³Ø§Ù‚ÙŠÙ† ÙƒØ§Ù…Ù„ØªÙŠÙ†'],
  form_good: ['Good form. Keep going!', 'Ø£Ø¯Ø§Ø¤Ùƒ Ø¬ÙŠØ¯. Ø§Ø³ØªÙ…Ø±!'],
  raise_hips: ['Raise your hips slightly', 'Ø§Ø±ÙØ¹ Ø§Ù„ÙˆØ±ÙƒÙŠÙ† Ù‚Ù„ÙŠÙ„Ù‹Ø§'],
  lower_hips: ['Lower your hips slightly', 'Ø§Ø®ÙØ¶ Ø§Ù„ÙˆØ±ÙƒÙŠÙ† Ù‚Ù„ÙŠÙ„Ù‹Ø§'],
  open_elbows: ['Open your elbow angle', 'ÙˆØ³Ù‘Ø¹ Ø²Ø§ÙˆÙŠØ© Ø§Ù„Ù…Ø±ÙÙ‚'],
  chest_up: ['Lift your chest', 'Ø§Ø±ÙØ¹ ØµØ¯Ø±Ùƒ'],
  lower_squat: ['Bend your knees and lower', 'Ø§Ø«Ù†Ù Ø±ÙƒØ¨ØªÙŠÙƒ ÙˆØ§Ù†Ø®ÙØ¶'],
  squat_too_deep: ['Rise slightly', 'Ø§Ø±ØªÙØ¹ Ù‚Ù„ÙŠÙ„Ù‹Ø§'],
  lower_lunge: ['Lower into the lunge', 'Ø§Ù†Ø®ÙØ¶ Ø£ÙƒØ«Ø± ÙÙŠ Ø§Ù„Ø§Ù†Ø¯ÙØ§Ø¹'],
  shorten_lunge: ['Shorten your stance slightly', 'Ù‚Ù„Ù‘Ù„ Ø§Ù„Ù…Ø³Ø§ÙØ© Ø¨ÙŠÙ† Ø§Ù„Ù‚Ø¯Ù…ÙŠÙ†'],
  bend_back_knee: ['Bend your back knee', 'Ø§Ø«Ù†Ù Ø§Ù„Ø±ÙƒØ¨Ø© Ø§Ù„Ø®Ù„ÙÙŠØ©'],
};

function CurrentCuePanel({ cue, isArabic, poseQuality, text }: {
  cue: CoachingCue;
  isArabic: boolean;
  poseQuality: PoseQuality;
  text: (en: string, ar: string) => string;
}) {
  const message = isArabic ? cue.ar : cue.en;
  const label = cue.severity === 'good'
    ? text('Current cue', 'Ø§Ù„ØªÙˆØ¬ÙŠÙ‡ Ø§Ù„Ø­Ø§Ù„ÙŠ')
    : cue.severity === 'correction'
      ? text('Fix now', 'Ø¹Ø¯Ù‘Ù„ Ø§Ù„Ø¢Ù†')
      : cue.severity === 'caution'
        ? text('Needs attention', 'Ø§Ù†ØªØ¨Ù‡ Ø´ÙˆÙŠ')
        : text('Camera setup', 'Ø¶Ø¨Ø· Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§');
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
            <span>{text('Visibility', 'Ø§Ù„ÙˆØ¶ÙˆØ­')}: {poseQuality.averageVisibility}%</span>
            <span>{text('Landmarks', 'Ø§Ù„Ù†Ù‚Ø§Ø·')}: {poseQuality.visibleLandmarks}</span>
            <span>{text('Stability', 'Ø§Ù„Ø«Ø¨Ø§Øª')}: {poseQuality.stableFrames}/{CALIBRATION_STABLE_FRAMES}</span>
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
    ? text('Good', 'ØªÙ…Ø§Ù…')
    : cue.severity === 'correction'
      ? text('Correct now', 'Ø¹Ø¯Ù‘Ù„ Ø§Ù„Ø¢Ù†')
      : cue.severity === 'caution'
        ? text('Watch it', 'Ø§Ù†ØªØ¨Ù‡')
        : text('Camera setup', 'Ø¶Ø¨Ø· Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§');
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
            <span>{text('Visibility', 'Ø§Ù„ÙˆØ¶ÙˆØ­')}: {poseQuality.averageVisibility}%</span>
            <span>{text('Landmarks', 'Ø§Ù„Ù†Ù‚Ø§Ø·')}: {poseQuality.visibleLandmarks}</span>
            <span>{text('Stable', 'Ø§Ù„Ø«Ø¨Ø§Øª')}: {poseQuality.stableFrames}/{CALIBRATION_STABLE_FRAMES}</span>
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

function createSparklinePoints(progress: number) {
  const safe = clampPercent(progress);
  const seed = safe || 42;
  return Array.from({ length: 10 }, (_, index) => {
    const x = (index / 9) * 120;
    const drift = (index / 9) * (safe * 0.22);
    const wave = Math.sin((index + seed / 17) * 1.35) * 5;
    const value = Math.max(10, Math.min(92, seed * 0.58 + drift + wave));
    const y = 30 - (value / 100) * 24;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function AnalyticsCard({ icon, label, value, suffix, status, trend, progress, tone }: {
  icon: ReactNode;
  label: string;
  value: string;
  suffix?: string;
  status: string;
  trend: string;
  progress: number;
  tone: MetricTone;
}) {
  const styles = metricToneClasses[tone];
  const safeProgress = clampPercent(progress);
  const ringDash = `${safeProgress}, 100`;
  const sparkPoints = createSparklinePoints(safeProgress);

  return (
    <div className={cn(
      'group rounded-3xl border bg-white/[0.035] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.055] hover:shadow-[0_24px_70px_rgba(0,0,0,0.34)]',
      styles.border,
      styles.glow
    )}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className={cn('mb-2 flex h-9 w-9 items-center justify-center rounded-2xl border transition-transform duration-300 group-hover:scale-105', styles.border, styles.bg, styles.text)}>
            {icon}
          </div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
        </div>
        <div className="relative h-16 w-16 shrink-0">
          <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
            <path d="M18 2.6a15.4 15.4 0 1 1 0 30.8a15.4 15.4 0 0 1 0-30.8" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="3.2" />
            <path
              d="M18 2.6a15.4 15.4 0 1 1 0 30.8a15.4 15.4 0 0 1 0-30.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.2"
              strokeDasharray={ringDash}
              strokeLinecap="round"
              className={cn('transition-all duration-700 ease-out', styles.text)}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-white/80">
            {safeProgress > 0 ? safeProgress : '--'}
          </div>
        </div>
      </div>
      <div className="flex items-end gap-1">
        <span className="text-3xl font-semibold tracking-tight text-white transition-all duration-300">{value}</span>
        {suffix && <span className="pb-1 text-xs text-muted-foreground">{suffix}</span>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="text-xs leading-5 text-muted-foreground">{status}</div>
        <span className={cn('shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold', styles.bg, styles.text)}>{trend}</span>
      </div>
      <svg viewBox="0 0 120 34" preserveAspectRatio="none" className="mt-4 h-9 w-full overflow-visible">
        <defs>
          <linearGradient id={`spark-${label.replace(/\W/g, '')}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <polyline
          points={sparkPoints}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('opacity-90 transition-all duration-700', styles.text)}
        />
      </svg>
    </div>
  );
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
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-100/70">{text('Session Progress', 'ØªÙ‚Ø¯Ù… Ø§Ù„Ø¬Ù„Ø³Ø©')}</div>
            <h3 className="text-lg font-semibold text-white">{liveReady ? text('Live set summary', 'Ù…Ù„Ø®Øµ Ø§Ù„Ø¬ÙˆÙ„Ø© Ø§Ù„Ù…Ø¨Ø§Ø´Ø±') : text('Ready for your set', 'Ø¬Ø§Ù‡Ø² Ù„Ù„Ø¬ÙˆÙ„Ø©')}</h3>
          </div>
        </div>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-xs text-white">{formatElapsed(elapsed)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ProgressMetric label={text('Completion', 'Ø§Ù„Ø¥Ù†Ø¬Ø§Ø²')} value={completion > 0 ? `${completion}%` : text('Ready', 'Ø¬Ø§Ù‡Ø²')} progress={completion} tone={metricToneFor(completion, liveReady)} />
        <ProgressMetric label={text('Completed reps', 'Ø§Ù„ØªÙƒØ±Ø§Ø±Ø§Øª Ø§Ù„Ù…ÙƒØªÙ…Ù„Ø©')} value={`${completedReps}`} progress={Math.min(100, completedReps * 10)} tone="purple" />
        <ProgressMetric label={text('Average form score', 'Ù…ØªÙˆØ³Ø· Ø§Ù„Ø£Ø¯Ø§Ø¡')} value={averageFormScore > 0 ? `${averageFormScore}%` : text('Pending', 'Ù„Ø§Ø­Ù‚Ø§Ù‹')} progress={averageFormScore} tone={averageFormScore >= 75 ? 'green' : averageFormScore >= 45 ? 'amber' : 'purple'} />
        <ProgressMetric label={text('Best form score', 'Ø£ÙØ¶Ù„ Ù†ØªÙŠØ¬Ø©')} value={bestFormScore > 0 ? `${bestFormScore}%` : text('Pending', 'Ù„Ø§Ø­Ù‚Ø§Ù‹')} progress={bestFormScore} tone={bestFormScore >= 75 ? 'green' : bestFormScore >= 45 ? 'amber' : 'purple'} />
        <ProgressMetric label={text('Consistency', 'Ø§Ù„Ø«Ø¨Ø§Øª')} value={consistency > 0 ? `${consistency}%` : text('Pending', 'Ù„Ø§Ø­Ù‚Ø§Ù‹')} progress={consistency} tone={consistency >= 75 ? 'green' : consistency >= 45 ? 'amber' : 'purple'} />
        <ProgressMetric label={text('Current streak', 'Ø§Ù„Ø³Ù„Ø³Ù„Ø© Ø§Ù„Ø­Ø§Ù„ÙŠØ©')} value={currentStreak > 0 ? `${currentStreak}` : text('Ready', 'Ø¬Ø§Ù‡Ø²')} progress={Math.min(100, currentStreak * 12)} tone={currentStreak > 3 ? 'green' : 'cyan'} />
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
  feedback: PoseFeedback;
  modelState: 'loading' | 'ready' | 'error';
  isCameraLive: boolean;
  text: (en: string, ar: string) => string;
}) {
  const copy = feedbackCopy[feedback.message] ?? feedbackCopy.step_into_frame;
  const level = modelState === 'error' ? 'adjust' : feedback.level;
  const idleBeforeCamera = !isCameraLive && modelState !== 'error';
  const message = modelState === 'loading'
    ? text('Preparing pose analysis...', 'Ø¬Ø§Ø±Ù ØªØ¬Ù‡ÙŠØ² ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø­Ø±ÙƒØ©...')
    : modelState === 'error'
      ? text('Pose analysis could not start', 'ØªØ¹Ø°Ø± ØªØ´ØºÙŠÙ„ ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø­Ø±ÙƒØ©')
      : idleBeforeCamera
        ? text('Start the camera when you are ready. The coach will watch movement once your body is visible.', 'Ø´ØºÙ„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ù„Ù…Ø§ ØªÙƒÙˆÙ† Ø¬Ø§Ù‡Ø². Ø§Ù„Ù…Ø¯Ø±Ø¨ Ø±Ø­ ÙŠØ¨Ø¯Ø£ ÙŠØªØ§Ø¨Ø¹ Ø§Ù„Ø­Ø±ÙƒØ© Ù„Ù…Ø§ Ø¬Ø³Ù…Ùƒ ÙŠØ¨ÙŠÙ†.')
        : text(copy[0], copy[1]);
  const phaseLabel = feedback.repPhase
    ? feedback.repPhase === 'hold'
      ? text('Hold', 'Ø«Ø¨Ø§Øª')
      : feedback.repPhase === 'top'
        ? text('Top', 'Ø§Ù„Ø£Ø¹Ù„Ù‰')
        : feedback.repPhase === 'bottom'
          ? text('Bottom', 'Ø§Ù„Ø£Ø³ÙÙ„')
          : text('Transition', 'Ø§Ù†ØªÙ‚Ø§Ù„')
    : text('Pending', 'Ù„Ø§Ø­Ù‚Ø§Ù‹');
  const supportLabel = feedback.supportLevel === 'full'
    ? text('Full tracking', 'ØªØ­Ù„ÙŠÙ„ ÙƒØ§Ù…Ù„')
    : text('Basic tracking', 'ØªØªØ¨Ø¹ Ø£Ø³Ø§Ø³ÙŠ');
  const scoreValue = clampPercent(feedback.score ?? (isCameraLive ? feedback.confidence : 0));
  const heroTone = level === 'good' ? 'green' : level === 'adjust' ? 'amber' : isCameraLive ? 'cyan' : 'purple';
  const heroStyles = metricToneClasses[heroTone];
  const phaseTone = feedback.repPhase ? 'cyan' : 'purple';
  const recommendation = level === 'good'
    ? text('Keep this rhythm and stay controlled.', 'ÙƒÙ…Ù„ Ø¨Ù†ÙØ³ Ø§Ù„Ø¥ÙŠÙ‚Ø§Ø¹ ÙˆØ®Ù„ÙŠÙƒ Ù…ØªØ­ÙƒÙ….')
    : level === 'adjust'
      ? message
      : idleBeforeCamera
        ? text('Start camera to unlock live recommendations.', 'Ø´ØºÙ„ Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§ Ø¹Ø´Ø§Ù† ØªØ¸Ù‡Ø± Ø§Ù„ØªÙˆØµÙŠØ§Øª Ø§Ù„Ù…Ø¨Ø§Ø´Ø±Ø©.')
        : text('Keep your full body visible for cleaner feedback.', 'Ø®Ù„ÙŠ Ø¬Ø³Ù…Ùƒ ÙƒØ§Ù…Ù„ ÙˆØ§Ø¶Ø­ Ø¹Ø´Ø§Ù† ØªÙƒÙˆÙ† Ø§Ù„Ù…Ù„Ø§Ø­Ø¸Ø§Øª Ø£Ø¯Ù‚.');
  const alignmentLabel = level === 'good'
    ? text('Aligned', 'Ù…ØªÙˆØ§Ø²Ù†')
    : level === 'adjust'
      ? text('Needs correction', 'ÙŠØ­ØªØ§Ø¬ ØªØ¹Ø¯ÙŠÙ„')
      : isCameraLive
        ? text('Calibrating', 'Ù…Ø¹Ø§ÙŠØ±Ø©')
        : text('Ready', 'Ø¬Ø§Ù‡Ø²');
  return (
    <div className={cn(
      'rounded-[30px] border p-5 shadow-[0_24px_80px_rgba(0,0,0,0.32)] backdrop-blur-2xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[0_30px_90px_rgba(0,0,0,0.4)]',
      level === 'good' && 'border-emerald-500/30 bg-emerald-500/10',
      level === 'adjust' && 'border-amber-500/30 bg-amber-500/10',
      level === 'waiting' && 'border-white/10 bg-[linear-gradient(180deg,rgba(17,20,37,0.9),rgba(10,12,24,0.92))]'
    )}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className={cn('h-4 w-4', heroStyles.text)} />
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">{text('AI Coach', 'Ø§Ù„Ù…Ø¯Ø±Ø¨ Ø§Ù„Ø°ÙƒÙŠ')}</span>
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', heroStyles.bg, heroStyles.text)}>
          {isCameraLive ? text('Live', 'Ù…Ø¨Ø§Ø´Ø±') : text('Ready', 'Ø¬Ø§Ù‡Ø²')}
        </span>
      </div>

      <div className="grid gap-5 sm:grid-cols-[7rem_minmax(0,1fr)] xl:grid-cols-1 2xl:grid-cols-[7rem_minmax(0,1fr)]">
        <div className="relative mx-auto h-28 w-28">
          <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
            <path d="M18 2.6a15.4 15.4 0 1 1 0 30.8a15.4 15.4 0 0 1 0-30.8" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="3" />
            <path d="M18 2.6a15.4 15.4 0 1 1 0 30.8a15.4 15.4 0 0 1 0-30.8" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${scoreValue}, 100`} strokeLinecap="round" className={cn('transition-all duration-700', heroStyles.text)} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-semibold text-white">{scoreValue || '--'}</span>
            <span className="text-[10px] text-muted-foreground">/100</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xl font-semibold text-white">
            {level === 'good'
              ? text('Great Form', 'Ø£Ø¯Ø§Ø¡ Ø±Ø§Ø¦Ø¹')
              : level === 'adjust'
                ? text('Correction Needed', 'ÙŠØ­ØªØ§Ø¬ ØªØ¹Ø¯ÙŠÙ„')
                : idleBeforeCamera
                  ? text('Ready to Watch', 'Ø¬Ø§Ù‡Ø² Ù„Ù„ØªØªØ¨Ø¹')
                  : text('Tracking Movement', 'ÙŠØªØ§Ø¨Ø¹ Ø§Ù„Ø­Ø±ÙƒØ©')}
          </div>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">{recommendation}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {level === 'good' && <span className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">âœ… {text('Great Form', 'Ø£Ø¯Ø§Ø¡ Ø±Ø§Ø¦Ø¹')}</span>}
            {scoreValue >= 90 && <span className="rounded-full bg-yellow-400/10 px-2.5 py-1 text-[11px] font-semibold text-yellow-200">ðŸ† {text('Personal Best', 'Ø£ÙØ¶Ù„ Ø£Ø¯Ø§Ø¡')}</span>}
            {scoreValue >= 84 && <span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-[11px] font-semibold text-violet-100">ðŸ”¥ {text('New Best', 'Ø£ÙØ¶Ù„ Ø¬Ø¯ÙŠØ¯')}</span>}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
        <PremiumStatusTile icon={<TriangleAlert className="h-4 w-4" />} label={text('Current correction', 'Ø§Ù„ØªØµØ­ÙŠØ­ Ø§Ù„Ø­Ø§Ù„ÙŠ')} value={level === 'adjust' ? message : text('No major correction', 'Ù„Ø§ ÙŠÙˆØ¬Ø¯ ØªØ¹Ø¯ÙŠÙ„ ÙƒØ¨ÙŠØ±')} tone={level === 'adjust' ? 'amber' : 'green'} />
        <PremiumStatusTile icon={<Zap className="h-4 w-4" />} label={text('Recommendation', 'Ø§Ù„ØªÙˆØµÙŠØ©')} value={recommendation} tone={heroTone} />
        <PremiumStatusTile icon={<Radar className="h-4 w-4" />} label={text('Confidence', 'Ø§Ù„Ø«Ù‚Ø©')} value={idleBeforeCamera ? text('Waiting for camera', 'Ø¨Ø§Ù†ØªØ¸Ø§Ø± Ø§Ù„ÙƒØ§Ù…ÙŠØ±Ø§') : `${feedback.confidence}%`} tone={heroTone} />
        <PremiumStatusTile icon={<Activity className="h-4 w-4" />} label={text('Movement phase', 'Ù…Ø±Ø­Ù„Ø© Ø§Ù„Ø­Ø±ÙƒØ©')} value={phaseLabel} tone={phaseTone} />
        <PremiumStatusTile icon={<ShieldCheck className="h-4 w-4" />} label={text('Body alignment', 'Ù…Ø­Ø§Ø°Ø§Ø© Ø§Ù„Ø¬Ø³Ù…')} value={alignmentLabel} tone={level === 'adjust' ? 'amber' : level === 'good' ? 'green' : 'purple'} />
        <PremiumStatusTile icon={<Cpu className="h-4 w-4" />} label={text('Support', 'Ø§Ù„Ø¯Ø¹Ù…')} value={supportLabel} tone="purple" />
      </div>
    </div>
  );
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

