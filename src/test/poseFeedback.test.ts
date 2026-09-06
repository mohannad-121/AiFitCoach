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

  it('recognizes the standing squat endpoint without asking for extra depth', () => {
    expect(assessPose('squat',pose({11:[.3,.2],23:[.3,.5],25:[.3,.7],27:[.3,.9]}))).toMatchObject({level:'good',repPhase:'top'});
  });

  it('requires individually visible joints on both legs for lunges', () => {
    const landmarks=pose({11:[.3,.2],23:[.3,.5],25:[.3,.7],27:[.3,.9],12:[.6,.2],24:[.6,.5],26:[.6,.7],28:[.6,.9]});
    landmarks[28].visibility=0;
    expect(assessPose('lunge',landmarks).score).toBeNull();
  });

  it('checks curls without treating a hidden wrist as good form', () => {
    const landmarks = pose({ 11:[.4,.2], 13:[.4,.45], 15:[.4,.7], 23:[.4,.6] });
    expect(assessPose('curl', landmarks)).toMatchObject({ level: 'good', repPhase: 'bottom', supportLevel: 'basic' });
    landmarks[15].visibility = 0;
    expect(assessPose('curl', landmarks).score).toBeNull();
  });
  it('does not score nonfinite or collapsed skeletons', () => {
    const landmarks = pose({ 11:[.3,.2], 23:[.4,.5], 27:[.6,.7] });
    landmarks[23].x = NaN;
    expect(assessPose('plank', landmarks).score).toBeNull();
    expect(assessPose('plank', pose({11:[.5,.5],23:[.5,.5],27:[.5,.5]})).score).toBeNull();
  });
  it('corrects rectangular image proportions before measuring a squat', () => {
    const square = pose({ 11:[.3,.3],23:[.3,.7],25:[.5,.7],27:[.55,.9] });
    const widescreen = square.map(item => ({ ...item, x: item.x / (16/9) }));
    expect(assessPose('squat', widescreen, 16/9)).toEqual(assessPose('squat', square));
  });
  it('returns specific experimental cues for new movement families', () => {
    expect(assessPose('lateral-raise', pose({11:[.4,.2],13:[.7,.05],23:[.4,.7]})).message).toBe('shoulder_height');
    expect(assessPose('shoulder-press', pose({11:[.4,.2],13:[.6,.3],15:[.6,.7],23:[.4,.6]})).message).toBe('press_setup');
    expect(assessPose('bridge', pose({11:[.4,.2],23:[.4,.5],25:[.5,.7],27:[.5,.9]})).message).toBe('bridge_setup');
    expect(assessPose('hip-hinge', pose({11:[.3,.2],23:[.3,.5],25:[.3,.7],27:[.3,.9]})).repPhase).toBe('top');
  });
});
