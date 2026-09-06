import type { Exercise } from '@/data/exercises';
import type { SupportedExercise } from '@/lib/poseFeedback';

export type TrackingSupport = 'full' | 'basic' | 'unsupported';

export interface ExerciseTrackingConfig {
  support: TrackingSupport;
  pose: SupportedExercise | null;
  reason: string;
  reasonAr?: string;
  cameraAngle?: 'side' | 'front';
}

const fullAnalysisAliases: Partial<Record<SupportedExercise, string[]>> = {
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

  const movementProfiles: Array<{ ids: string[]; pose: SupportedExercise; cameraAngle: 'side' | 'front' }> = [
    { ids: ['lunges', 'reverse-lunges', 'walking-lunges', 'split-squat'], pose: 'lunge', cameraAngle: 'side' },
    { ids: ['bicep-curls', 'hammer-curls', 'light-bicep-curls', 'band-curls', 'alternating-curls'], pose: 'curl', cameraAngle: 'side' },
    { ids: ['lateral-raises', 'light-lateral-raises', 'band-lateral-raises'], pose: 'lateral-raise', cameraAngle: 'front' },
    { ids: ['shoulder-press', 'dumbbell-shoulder-press', 'seated-dumbbell-press'], pose: 'shoulder-press', cameraAngle: 'front' },
    { ids: ['romanian-deadlift', 'dumbbell-rdl', 'bodyweight-hip-hinge', 'cable-pull-through'], pose: 'hip-hinge', cameraAngle: 'side' },
    { ids: ['glute-bridge', 'hip-thrust', 'banded-glute-bridge'], pose: 'bridge', cameraAngle: 'side' },
    { ids: ['goblet-squats', 'sumo-squats', 'bodyweight-squat', 'dumbbell-squat'], pose: 'squat', cameraAngle: 'side' },
    { ids: ['diamond-push-ups', 'incline-push-ups', 'wall-push-ups'], pose: 'push-up', cameraAngle: 'side' },
  ];
  const profile = movementProfiles.find(item => item.ids.includes(exercise.id));
  if (profile) return {
    support: 'basic', pose: profile.pose, cameraAngle: profile.cameraAngle,
    reason: 'Movement cues (beta). Checks visible joint alignment; does not assess load, pain, or every form error.',
    reasonAr: 'توجيه الحركة (تجريبي): يفحص محاذاة المفاصل الظاهرة، ولا يقيّم الوزن أو الألم أو جميع أخطاء الأداء.',
  };

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
        reasonAr: 'تحليل زوايا ووضعية الحركة. ضع الكاميرا من الجانب وأظهر المفاصل كاملة.',
        cameraAngle: 'side',
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
