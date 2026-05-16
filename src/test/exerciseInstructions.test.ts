import { describe, expect, it } from 'vitest';
import { buildExerciseInstructions } from '@/components/workout/exerciseInstructions';
import { exercises } from '@/data/exercises';

describe('buildExerciseInstructions', () => {
  it('returns numbered instruction points for every exercise', () => {
    for (const exercise of exercises) {
      const points = buildExerciseInstructions(exercise);

      expect(points.length).toBeGreaterThanOrEqual(4);
      for (const point of points) {
        expect(point.en.length).toBeGreaterThan(10);
        expect(point.ar.length).toBeGreaterThan(10);
      }
    }
  });

  it('uses a movement-specific template for push-ups', () => {
    const pushUps = exercises.find((exercise) => exercise.id === 'push-ups');

    expect(pushUps).toBeDefined();
    const points = buildExerciseInstructions(pushUps!);

    expect(points[0].en).toMatch(/Push-Ups/i);
    expect(points[1].en).toMatch(/core/i);
  });
});