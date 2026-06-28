import type { Exercise } from '@/data/exercises';
import type { SupportedExercise } from '@/lib/poseFeedback';

export type TrackingSupport = 'full' | 'basic' | 'unsupported';

export interface ExerciseTrackingConfig {
  support: TrackingSupport;
  pose: SupportedExercise | null;
  reason: string;
}

const fullAnalysisAliases: Record<SupportedExercise, string[]> = {
  plank: ['plank'],
  squat: ['squat', 'squats'],
  'push-up': ['push up', 'push ups', 'push-up', 'push-ups', 'pushup', 'pushups'],
  lunge: [],
};

const basicTrackingTerms = [
  'bench press',
  'bent over row',
  'bicep curl',
  'bulgarian split squat',
  'calf raise',
  'chest fly',
  'chest press',
  'chin up',
  'crunch',
  'dead bug',
  'deadlift',
  'dip',
  'donkey kick',
  'extension',
  'face pull',
  'fire hydrant',
  'front raise',
  'glute bridge',
  'hip thrust',
  'jump rope',
  'kickback',
  'lat pulldown',
  'lateral raise',
  'leg curl',
  'leg extension',
  'leg press',
  'leg raise',
  'lunge',
  'mountain climber',
  'nordic curl',
  'overhead',
  'pike push up',
  'pull through',
  'pull up',
  'raise',
  'resistance band row',
  'romanian deadlift',
  'row',
  'russian twist',
  'seated cable row',
  'shoulder press',
  'single arm row',
  'single leg bridge',
  'single leg calf raise',
  'sumo squat',
  'superman',
  'tricep',
  'wall sit',
];

const unsupportedTerms = [
  'breathing',
  'meditation',
  'nutrition',
  'rest',
  'stretch only',
];

export function normalizeExerciseName(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function hasWholeTerm(value: string, term: string) {
  return new RegExp(`(^| )${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(value);
}

function exerciseSearchText(exercise: Exercise) {
  return normalizeExerciseName(`${exercise.id} ${exercise.name} ${exercise.description} ${exercise.muscle}`);
}

export function getExerciseTrackingConfig(exercise: Exercise): ExerciseTrackingConfig {
  const searchable = exerciseSearchText(exercise);
  const exactNames = [normalizeExerciseName(exercise.id), normalizeExerciseName(exercise.name)];

  if (unsupportedTerms.some((term) => hasWholeTerm(searchable, term))) {
    return {
      support: 'unsupported',
      pose: null,
      reason: 'This movement does not provide enough visible body mechanics for camera tracking.',
    };
  }

  for (const [pose, aliases] of Object.entries(fullAnalysisAliases) as Array<[SupportedExercise, string[]]>) {
    if (aliases.some((alias) => exactNames.includes(normalizeExerciseName(alias)))) {
      return {
        support: 'full',
        pose,
        reason: 'Full form analysis is available for this movement pattern.',
      };
    }
  }

  if (basicTrackingTerms.some((term) => hasWholeTerm(searchable, term))) {
    return {
      support: 'basic',
      pose: null,
      reason: 'Camera pose tracking can monitor visibility and movement confidence, but detailed form scoring is not available yet.',
    };
  }

  return {
    support: 'basic',
    pose: null,
    reason: 'General camera tracking is available; detailed form scoring is not available yet.',
  };
}
