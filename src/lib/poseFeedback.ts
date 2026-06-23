import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

export type SupportedExercise = 'plank' | 'squat' | 'push-up' | 'lunge';
export type FeedbackLevel = 'waiting' | 'good' | 'adjust';

export interface PoseFeedback {
  level: FeedbackLevel;
  message: string;
  score: number | null;
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

function waiting(message = 'full_body_required'): PoseFeedback {
  return { level: 'waiting', message, score: null };
}

function adjust(message: string, score: number): PoseFeedback {
  return { level: 'adjust', message, score: Math.max(0, Math.min(99, Math.round(score))) };
}

function good(score = 94): PoseFeedback {
  return { level: 'good', message: 'form_good', score };
}

function torsoTiltFromVertical(shoulder: NormalizedLandmark, hip: NormalizedLandmark) {
  const dx = Math.abs(shoulder.x - hip.x);
  const dy = Math.abs(shoulder.y - hip.y);
  return Math.atan2(dx, dy) * 180 / Math.PI;
}

function assessPlank(landmarks: NormalizedLandmark[]): PoseFeedback {
  const joints: Joint[] = ['shoulder', 'hip', 'ankle'];
  const side = bestSide(landmarks, joints);
  if (sideVisibility(landmarks, side, joints) < 0.58) return waiting();
  const shoulder = point(landmarks, 'shoulder', side);
  const hip = point(landmarks, 'hip', side);
  const ankle = point(landmarks, 'ankle', side);
  const bodyAngle = angle(shoulder, hip, ankle);
  const expectedHipY = (shoulder.y + ankle.y) / 2;

  if (bodyAngle < 158) {
    return hip.y > expectedHipY
      ? adjust('raise_hips', 45 + bodyAngle / 4)
      : adjust('lower_hips', 45 + bodyAngle / 4);
  }
  return good(Math.min(98, 75 + (bodyAngle - 150)));
}

function assessPushUp(landmarks: NormalizedLandmark[]): PoseFeedback {
  const joints: Joint[] = ['shoulder', 'elbow', 'wrist', 'hip', 'ankle'];
  const side = bestSide(landmarks, joints);
  if (sideVisibility(landmarks, side, joints) < 0.58) return waiting();
  const shoulder = point(landmarks, 'shoulder', side);
  const elbow = point(landmarks, 'elbow', side);
  const wrist = point(landmarks, 'wrist', side);
  const hip = point(landmarks, 'hip', side);
  const ankle = point(landmarks, 'ankle', side);
  const bodyAngle = angle(shoulder, hip, ankle);
  const elbowAngle = angle(shoulder, elbow, wrist);
  const expectedHipY = (shoulder.y + ankle.y) / 2;

  if (bodyAngle < 158) {
    return hip.y > expectedHipY ? adjust('raise_hips', 55) : adjust('lower_hips', 55);
  }
  if (elbowAngle < 45) return adjust('open_elbows', 65);
  return good(Math.min(98, 82 + (bodyAngle - 158) / 2));
}

function assessSquat(landmarks: NormalizedLandmark[]): PoseFeedback {
  const joints: Joint[] = ['shoulder', 'hip', 'knee', 'ankle'];
  const side = bestSide(landmarks, joints);
  if (sideVisibility(landmarks, side, joints) < 0.58) return waiting();
  const shoulder = point(landmarks, 'shoulder', side);
  const hip = point(landmarks, 'hip', side);
  const knee = point(landmarks, 'knee', side);
  const ankle = point(landmarks, 'ankle', side);
  const kneeAngle = angle(hip, knee, ankle);
  const torsoTilt = torsoTiltFromVertical(shoulder, hip);

  if (torsoTilt > 48) return adjust('chest_up', 58);
  if (kneeAngle > 145) return adjust('lower_squat', 62);
  if (kneeAngle < 62) return adjust('squat_too_deep', 72);
  if (kneeAngle > 125) return adjust('lower_squat', 76);
  return good(Math.min(98, 91 + (125 - kneeAngle) / 12));
}

function assessLunge(landmarks: NormalizedLandmark[]): PoseFeedback {
  const joints: Joint[] = ['shoulder', 'hip', 'knee', 'ankle'];
  if (sideVisibility(landmarks, 'left', joints) < 0.52 || sideVisibility(landmarks, 'right', joints) < 0.52) {
    return waiting('both_legs_required');
  }
  const leftKnee = angle(point(landmarks, 'hip', 'left'), point(landmarks, 'knee', 'left'), point(landmarks, 'ankle', 'left'));
  const rightKnee = angle(point(landmarks, 'hip', 'right'), point(landmarks, 'knee', 'right'), point(landmarks, 'ankle', 'right'));
  const front: Side = leftKnee <= rightKnee ? 'left' : 'right';
  const frontAngle = Math.min(leftKnee, rightKnee);
  const backAngle = Math.max(leftKnee, rightKnee);
  const torsoTilt = torsoTiltFromVertical(point(landmarks, 'shoulder', front), point(landmarks, 'hip', front));

  if (torsoTilt > 38) return adjust('chest_up', 60);
  if (frontAngle > 135) return adjust('lower_lunge', 64);
  if (frontAngle < 62) return adjust('shorten_lunge', 70);
  if (backAngle > 165) return adjust('bend_back_knee', 74);
  return good(92);
}

export function assessPose(exercise: SupportedExercise, landmarks: NormalizedLandmark[]): PoseFeedback {
  if (landmarks.length < 29) return waiting();
  switch (exercise) {
    case 'plank': return assessPlank(landmarks);
    case 'push-up': return assessPushUp(landmarks);
    case 'squat': return assessSquat(landmarks);
    case 'lunge': return assessLunge(landmarks);
  }
}
