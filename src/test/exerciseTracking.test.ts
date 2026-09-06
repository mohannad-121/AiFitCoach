import { describe, expect, it } from 'vitest';
import { exercises } from '@/data/exercises';
import { getExerciseTrackingConfig, normalizeExerciseName } from '@/lib/exerciseTracking';

function exerciseById(id: string) {
  const exercise = exercises.find((item) => item.id === id);
  if (!exercise) throw new Error(`Missing exercise fixture: ${id}`);
  return exercise;
}

describe('exercise tracking mapping', () => {
  it('normalizes punctuation and casing for matching', () => {
    expect(normalizeExerciseName('Push-Ups & Core')).toBe('push ups and core');
  });

  it('maps canonical reliable exercises to full analysis', () => {
    expect(getExerciseTrackingConfig(exerciseById('push-ups'))).toMatchObject({ support: 'full', pose: 'push-up' });
    expect(getExerciseTrackingConfig(exerciseById('squats'))).toMatchObject({ support: 'full', pose: 'squat' });
    expect(getExerciseTrackingConfig(exerciseById('plank'))).toMatchObject({ support: 'full', pose: 'plank' });
  });

  it('routes supported variants to explicit experimental movement checks', () => {
    expect(getExerciseTrackingConfig(exerciseById('diamond-push-ups'))).toMatchObject({ support: 'basic', pose: 'push-up' });
    expect(getExerciseTrackingConfig(exerciseById('goblet-squats'))).toMatchObject({ support: 'basic', pose: 'squat' });
    expect(getExerciseTrackingConfig(exerciseById('lunges'))).toMatchObject({ support: 'basic', pose: 'lunge' });
    expect(getExerciseTrackingConfig(exerciseById('bicep-curls'))).toMatchObject({ support: 'basic', pose: 'curl' });
    expect(getExerciseTrackingConfig(exerciseById('bench-press'))).toMatchObject({ support: 'basic', pose: null });
    expect(getExerciseTrackingConfig(exerciseById('pike-push-ups'))).toMatchObject({ support: 'basic', pose: null });
  });
  it('never treats the muscle name alone as a recognized movement', () => {
    expect(getExerciseTrackingConfig({ ...exerciseById('squats'), id: 'unknown', name: 'Unknown', description: 'squat muscles' }).pose).toBeNull();
  });
});
