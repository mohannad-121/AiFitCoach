import { exercises, type Exercise } from '@/data/exercises';

export const muscleGroups = {
  chest: ['Chest', 'الصدر'], back: ['Back', 'الظهر'], shoulders: ['Shoulders', 'الأكتاف'],
  biceps: ['Biceps & forearms', 'الباي والساعد'], triceps: ['Triceps', 'التراي'], abs: ['Core', 'البطن'],
  quads: ['Quadriceps', 'الفخذ الأمامي'], hamstrings: ['Hamstrings', 'الفخذ الخلفي'],
  glutes: ['Glutes', 'المؤخرة'], calves: ['Calves', 'السمانة'],
} as const;

export function muscleLabel(muscle: string, language: 'en' | 'ar') {
  return muscleGroups[muscle as keyof typeof muscleGroups]?.[language === 'ar' ? 1 : 0] ?? muscle;
}

function normalize(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u064B-\u065F\u0670\u0300-\u036f]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export interface ScheduledExercise { id?: string; exerciseId?: string; exercise_id?: string; name?: string; nameAr?: string; muscle?: string; target_muscle?: string; sets?: number | string; reps?: number | string; }

// Exact IDs/names only: an unfamiliar AI-generated movement must not silently become a different exercise.
export function resolveScheduledExercise(item: ScheduledExercise): Exercise | undefined {
  const id = item.exerciseId || item.exercise_id || item.id;
  const byId = exercises.find((exercise) => exercise.id === id);
  if (byId) return byId;
  const names = [item.name, item.nameAr].filter(Boolean).map(value => normalize(value!));
  return exercises.find(exercise => [exercise.name, exercise.nameAr, exercise.id].some(value => names.includes(normalize(value))));
}

export function scheduledMuscles(items: ScheduledExercise[]): string[] {
  return [...new Set(items.flatMap(item => {
    const known = resolveScheduledExercise(item);
    const muscle = known?.muscle || item.muscle || item.target_muscle;
    return muscle && muscle in muscleGroups ? [muscle] : [];
  }))];
}

export function workoutDayLink(items: ScheduledExercise[], date: string) {
  const ids = items.map(resolveScheduledExercise).filter((item): item is Exercise => Boolean(item)).map(item => item.id);
  const params = new URLSearchParams({ from: 'schedule', date });
  if (ids.length) params.set('exerciseIds', [...new Set(ids)].join(','));
  const prescription = items.flatMap(item => {
    const known = resolveScheduledExercise(item);
    return known ? [{ id: known.id, sets: String(item.sets ?? ''), reps: String(item.reps ?? '') }] : [];
  });
  if (prescription.some(item => item.sets || item.reps)) params.set('prescription', JSON.stringify(prescription));
  const muscles = scheduledMuscles(items);
  if (muscles.length) params.set('muscles', muscles.join(','));
  return `/workouts?${params.toString()}`;
}

export function resolveWorkoutSelection(ids: string[], prescription: string | null): Exercise[] {
  let doses: Array<{ id?: string; sets?: string; reps?: string }> = [];
  try { const parsed: unknown = JSON.parse(prescription || '[]'); if (Array.isArray(parsed)) doses = parsed.filter(item => item && typeof item === 'object'); } catch { /* Ignore malformed link metadata. */ }
  const safeText = (value: unknown) => typeof value === 'string' && value.trim().length <= 80 ? value.trim() : '';
  return [...new Set(ids)].flatMap(id => {
    const exercise = exercises.find(item => item.id === id);
    if (!exercise) return [];
    const dose = doses.find(item => item.id === id);
    return [{ ...exercise, sets: safeText(dose?.sets) || exercise.sets, reps: safeText(dose?.reps) || exercise.reps }];
  });
}
