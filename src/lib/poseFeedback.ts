import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export type SupportedExercise = 'plank' | 'squat' | 'push-up' | 'lunge';
export type ReliableExercise = 'plank' | 'squat' | 'push-up';
export type FeedbackLevel = 'waiting' | 'good' | 'adjust';
export type FeedbackStatus = 'waiting_for_body' | 'tracking_basic' | 'analyzing' | 'needs_adjustment' | 'good_form';
export type ExerciseSupportLevel = 'full' | 'basic';
export type RepPhase = 'top' | 'bottom' | 'hold' | 'transition' | null;

export interface PoseFeedback {
  level: FeedbackLevel;
  message: string;
  score: number | null;
  status: FeedbackStatus;
  confidence: number;
  correction: string;
  repPhase: RepPhase;
  supportLevel: ExerciseSupportLevel;
}

interface ExerciseAnalysis {
  supportLevel: ExerciseSupportLevel;
  requiredJoints: Joint[];
  analyze: (landmarks: NormalizedLandmark[], context: AnalysisContext) => PoseFeedback;
}

interface AnalysisContext {
  side: Side;
  confidence: number;
  supportLevel: ExerciseSupportLevel;
}

const INDEX = {
  shoulder: { left: 11, right: 12 },
  elbow: { left: 13, right: 14 },
  wrist: { left: 15, right: 16 },
  hip: { left: 23, right: 24 },
  knee: { left: 25, right: 26 },
  ankle: { left: 27, right: 28 },
} as const;

type Side = 'left' | 'right';
type Joint = keyof typeof INDEX;

const MIN_REQUIRED_LANDMARKS = 29;
const MIN_FULL_CONFIDENCE = 0.62;
const MIN_BASIC_CONFIDENCE = 0.52;

const visibility = (point: NormalizedLandmark | undefined) => point?.visibility ?? 0;

function angle(a: NormalizedLandmark, b: NormalizedLandmark, c: NormalizedLandmark) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (!denominator) return 0;
  const cosine = Math.max(-1, Math.min(1, (ab.x * cb.x + ab.y * cb.y) / denominator));
  return Math.acos(cosine) * 180 / Math.PI;
}

function sideVisibility(landmarks: NormalizedLandmark[], side: Side, joints: Joint[]) {
  return joints.reduce((sum, joint) => sum + visibility(landmarks[INDEX[joint][side]]), 0) / joints.length;
}

function bestSide(landmarks: NormalizedLandmark[], joints: Joint[]): Side {
  return sideVisibility(landmarks, 'left', joints) >= sideVisibility(landmarks, 'right', joints) ? 'left' : 'right';
}

function point(landmarks: NormalizedLandmark[], joint: Joint, side: Side) {
  return landmarks[INDEX[joint][side]];
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(99, Math.round(value)));
}

function waiting(message = 'full_body_required', confidence = 0, supportLevel: ExerciseSupportLevel = 'basic'): PoseFeedback {
  return {
    level: 'waiting',
    message,
    score: null,
    status: 'waiting_for_body',
    confidence: clampPercent(confidence * 100),
    correction: message,
    repPhase: null,
    supportLevel,
  };
}

function adjust(message: string, score: number, context: AnalysisContext, repPhase: RepPhase = null): PoseFeedback {
  return {
    level: 'adjust',
    message,
    score: clampPercent(score),
    status: 'needs_adjustment',
    confidence: clampPercent(context.confidence * 100),
    correction: message,
    repPhase,
    supportLevel: context.supportLevel,
  };
}

function good(score: number, context: AnalysisContext, repPhase: RepPhase = null): PoseFeedback {
  return {
    level: 'good',
    message: 'form_good',
    score: clampPercent(score),
    status: 'good_form',
    confidence: clampPercent(context.confidence * 100),
    correction: 'form_good',
    repPhase,
    supportLevel: context.supportLevel,
  };
}

function torsoTiltFromVertical(shoulder: NormalizedLandmark, hip: NormalizedLandmark) {
  const dx = Math.abs(shoulder.x - hip.x);
  const dy = Math.abs(shoulder.y - hip.y);
  return Math.atan2(dx, dy) * 180 / Math.PI;
}

function estimateRepPhase(exercise: SupportedExercise, angles: { elbow?: number; knee?: number; body?: number }): RepPhase {
  if (exercise === 'plank') return 'hold';
  if (exercise === 'squat') {
    if ((angles.knee ?? 180) > 145) return 'top';
    if ((angles.knee ?? 180) < 95) return 'bottom';
    return 'transition';
  }
  if (exercise === 'push-up') {
    if ((angles.elbow ?? 180) > 150) return 'top';
    if ((angles.elbow ?? 180) < 90) return 'bottom';
    return 'transition';
  }
  return null;
}

function assessPlank(landmarks: NormalizedLandmark[], context: AnalysisContext): PoseFeedback {
  const shoulder = point(landmarks, 'shoulder', context.side);
  const hip = point(landmarks, 'hip', context.side);
  const ankle = point(landmarks, 'ankle', context.side);
  const bodyAngle = angle(shoulder, hip, ankle);
  const expectedHipY = (shoulder.y + ankle.y) / 2;
  const repPhase = estimateRepPhase('plank', { body: bodyAngle });

  if (bodyAngle < 158) {
    return hip.y > expectedHipY
      ? adjust('raise_hips', 45 + bodyAngle / 4, context, repPhase)
      : adjust('lower_hips', 45 + bodyAngle / 4, context, repPhase);
  }
  return good(Math.min(98, 75 + (bodyAngle - 150)), context, repPhase);
}

function assessPushUp(landmarks: NormalizedLandmark[], context: AnalysisContext): PoseFeedback {
  const shoulder = point(landmarks, 'shoulder', context.side);
  const elbow = point(landmarks, 'elbow', context.side);
  const wrist = point(landmarks, 'wrist', context.side);
  const hip = point(landmarks, 'hip', context.side);
  const ankle = point(landmarks, 'ankle', context.side);
  const bodyAngle = angle(shoulder, hip, ankle);
  const elbowAngle = angle(shoulder, elbow, wrist);
  const expectedHipY = (shoulder.y + ankle.y) / 2;
  const repPhase = estimateRepPhase('push-up', { body: bodyAngle, elbow: elbowAngle });

  if (bodyAngle < 158) {
    return hip.y > expectedHipY
      ? adjust('raise_hips', 55, context, repPhase)
      : adjust('lower_hips', 55, context, repPhase);
  }
  if (elbowAngle < 45) return adjust('open_elbows', 65, context, repPhase);
  return good(Math.min(98, 82 + (bodyAngle - 158) / 2), context, repPhase);
}

function assessSquat(landmarks: NormalizedLandmark[], context: AnalysisContext): PoseFeedback {
  const shoulder = point(landmarks, 'shoulder', context.side);
  const hip = point(landmarks, 'hip', context.side);
  const knee = point(landmarks, 'knee', context.side);
  const ankle = point(landmarks, 'ankle', context.side);
  const kneeAngle = angle(hip, knee, ankle);
  const torsoTilt = torsoTiltFromVertical(shoulder, hip);
  const repPhase = estimateRepPhase('squat', { knee: kneeAngle });

  if (torsoTilt > 48) return adjust('chest_up', 58, context, repPhase);
  if (kneeAngle > 145) return adjust('lower_squat', 62, context, repPhase);
  if (kneeAngle < 62) return adjust('squat_too_deep', 72, context, repPhase);
  if (kneeAngle > 125) return adjust('lower_squat', 76, context, repPhase);
  return good(Math.min(98, 91 + (125 - kneeAngle) / 12), context, repPhase);
}

function assessLunge(landmarks: NormalizedLandmark[], context: AnalysisContext): PoseFeedback {
  const joints: Joint[] = ['shoulder', 'hip', 'knee', 'ankle'];
  if (sideVisibility(landmarks, 'left', joints) < MIN_BASIC_CONFIDENCE || sideVisibility(landmarks, 'right', joints) < MIN_BASIC_CONFIDENCE) {
    return waiting('both_legs_required', context.confidence, context.supportLevel);
  }
  const leftKnee = angle(point(landmarks, 'hip', 'left'), point(landmarks, 'knee', 'left'), point(landmarks, 'ankle', 'left'));
  const rightKnee = angle(point(landmarks, 'hip', 'right'), point(landmarks, 'knee', 'right'), point(landmarks, 'ankle', 'right'));
  const front: Side = leftKnee <= rightKnee ? 'left' : 'right';
  const frontAngle = Math.min(leftKnee, rightKnee);
  const backAngle = Math.max(leftKnee, rightKnee);
  const torsoTilt = torsoTiltFromVertical(point(landmarks, 'shoulder', front), point(landmarks, 'hip', front));

  if (torsoTilt > 38) return adjust('chest_up', 60, context);
  if (frontAngle > 135) return adjust('lower_lunge', 64, context);
  if (frontAngle < 62) return adjust('shorten_lunge', 70, context);
  if (backAngle > 165) return adjust('bend_back_knee', 74, context);
  return good(92, context);
}

const poseFeedbackRegistry: Record<SupportedExercise, ExerciseAnalysis> = {
  plank: {
    supportLevel: 'full',
    requiredJoints: ['shoulder', 'hip', 'ankle'],
    analyze: assessPlank,
  },
  squat: {
    supportLevel: 'full',
    requiredJoints: ['shoulder', 'hip', 'knee', 'ankle'],
    analyze: assessSquat,
  },
  'push-up': {
    supportLevel: 'full',
    requiredJoints: ['shoulder', 'elbow', 'wrist', 'hip', 'ankle'],
    analyze: assessPushUp,
  },
  lunge: {
    supportLevel: 'basic',
    requiredJoints: ['shoulder', 'hip', 'knee', 'ankle'],
    analyze: assessLunge,
  },
};

export function assessPose(exercise: SupportedExercise, landmarks: NormalizedLandmark[]): PoseFeedback {
  const analysis = poseFeedbackRegistry[exercise];
  if (landmarks.length < MIN_REQUIRED_LANDMARKS) return waiting('step_into_frame', 0, analysis.supportLevel);

  const side = bestSide(landmarks, analysis.requiredJoints);
  const confidence = sideVisibility(landmarks, side, analysis.requiredJoints);
  const minimumConfidence = analysis.supportLevel === 'full' ? MIN_FULL_CONFIDENCE : MIN_BASIC_CONFIDENCE;

  if (confidence < minimumConfidence) {
    return waiting(confidence < 0.35 ? 'step_into_frame' : 'low_pose_confidence', confidence, analysis.supportLevel);
  }

  return analysis.analyze(landmarks, { side, confidence, supportLevel: analysis.supportLevel });
}

export function getPoseFeedbackSupport(exercise: SupportedExercise): ExerciseSupportLevel {
  return poseFeedbackRegistry[exercise].supportLevel;
}

export function estimatePoseConfidence(landmarks: NormalizedLandmark[]): number {
  if (landmarks.length < MIN_REQUIRED_LANDMARKS) return 0;
  const joints: Joint[] = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'];
  const leftConfidence = sideVisibility(landmarks, 'left', joints);
  const rightConfidence = sideVisibility(landmarks, 'right', joints);
  return clampPercent(Math.max(leftConfidence, rightConfidence) * 100);
}
