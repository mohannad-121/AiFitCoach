import { describe, expect, it } from 'vitest';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { assessPose, getPoseFeedbackSupport } from '@/lib/poseFeedback';

function pose(points: Record<number, [number, number]>) {
  return Array.from({ length: 33 }, (_, index): NormalizedLandmark => ({
    x: points[index]?.[0] ?? 0,
    y: points[index]?.[1] ?? 0,
    z: 0,
    visibility: points[index] ? 0.99 : 0,
  }));
}

describe('assessPose', () => {
  it('accepts a straight plank', () => {
    const landmarks = pose({ 11: [0.2, 0.5], 23: [0.5, 0.5], 27: [0.8, 0.5] });
    expect(assessPose('plank', landmarks).level).toBe('good');
  });

  it('asks the user to raise low hips in a plank', () => {
    const landmarks = pose({ 11: [0.2, 0.5], 23: [0.5, 0.72], 27: [0.8, 0.5] });
    expect(assessPose('plank', landmarks).message).toBe('raise_hips');
  });

  it('accepts a controlled squat position', () => {
    const landmarks = pose({ 11: [0.3, 0.3], 23: [0.3, 0.7], 25: [0.5, 0.7], 27: [0.55, 0.9] });
    expect(assessPose('squat', landmarks).level).toBe('good');
  });

  it('does not score a pose when required joints are hidden', () => {
    expect(assessPose('push-up', pose({ 11: [0.2, 0.5] })).level).toBe('waiting');
  });

  it('returns camera guidance instead of scoring when confidence is low', () => {
    const landmarks = pose({ 11: [0.2, 0.5], 23: [0.5, 0.5], 27: [0.8, 0.5] });
    landmarks[11].visibility = 0.4;
    landmarks[23].visibility = 0.4;
    landmarks[27].visibility = 0.4;

    const feedback = assessPose('plank', landmarks);

    expect(feedback.level).toBe('waiting');
    expect(feedback.message).toBe('low_pose_confidence');
    expect(feedback.score).toBeNull();
    expect(feedback.confidence).toBe(40);
  });

  it('returns structured feedback for reliable exercises', () => {
    const landmarks = pose({ 11: [0.2, 0.5], 13: [0.35, 0.5], 15: [0.5, 0.5], 23: [0.5, 0.5], 27: [0.8, 0.5] });
    const feedback = assessPose('push-up', landmarks);

    expect(feedback.supportLevel).toBe('full');
    expect(feedback.confidence).toBeGreaterThan(90);
    expect(feedback.repPhase).toBeTruthy();
    expect(feedback.status).toMatch(/good_form|needs_adjustment/);
  });

  it('keeps lunge available as basic tracking', () => {
    expect(getPoseFeedbackSupport('lunge')).toBe('basic');
  });
});
