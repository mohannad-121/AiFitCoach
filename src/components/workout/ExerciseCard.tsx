import React from 'react';
import { motion } from 'framer-motion';
import { Camera, Dumbbell, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { type Exercise } from '@/data/exercises';
import { localizedLabel, repairMojibake } from '@/lib/text';
import { buildExerciseInstructions } from '@/components/workout/exerciseInstructions';

interface ExerciseCardProps {
  exercise: Exercise;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  onCollapse?: () => void;
  onTrainWithCamera?: (exercise: Exercise) => void;
}

const muscleLabelsEn: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  abs: 'Abs',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
};

const muscleLabelsAr: Record<string, string> = {
  chest: 'الصدر',
  back: 'الظهر',
  shoulders: 'الأكتاف',
  biceps: 'البايسبس',
  triceps: 'الترايسبس',
  abs: 'البطن',
  quads: 'الفخذ الأمامي',
  hamstrings: 'الفخذ الخلفي',
  glutes: 'المؤخرة',
  calves: 'السمانة',
};

export function ExerciseCard({
  exercise,
  isExpanded = false,
  onToggleExpanded,
  onCollapse,
  onTrainWithCamera,
}: ExerciseCardProps) {
  const { language } = useLanguage();
  const englishName = repairMojibake(exercise.name);
  const arabicName = repairMojibake(exercise.nameAr || exercise.name);
  const name = localizedLabel(englishName, arabicName, language);
  const descriptionPoints = buildExerciseInstructions(exercise);
  const instructionsTitle = localizedLabel('Exercise instructions', 'تعليمات التمرين', language);
  const viewInstructionsLabel = localizedLabel('View instructions', 'عرض التعليمات', language);

  const tags = [
    localizedLabel(muscleLabelsEn[exercise.muscle] || exercise.muscle, muscleLabelsAr[exercise.muscle] || exercise.muscle, language),
    formatGoal(exercise.goal, language),
    formatLocation(exercise.location, language),
    `${exercise.sets} x ${exercise.reps}`,
  ];

  return (
    <motion.article
      whileHover={isExpanded ? undefined : { y: -6 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="group overflow-hidden rounded-2xl border border-white/12 bg-[#070b18] shadow-[0_24px_80px_rgba(0,0,0,0.36)]"
    >
      <div className="border-b border-white/10 bg-[linear-gradient(145deg,rgba(32,25,65,0.88),rgba(7,11,24,0.96)_55%,rgba(8,43,54,0.76))] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
              <Dumbbell className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/72">
                {localizedLabel('Targeted exercise', 'تمرين مستهدف', language)}
              </p>
              <h3 className="mt-2 text-2xl font-semibold text-white">{name}</h3>
            </div>
          </div>
          <span className="hidden shrink-0 items-center rounded-full border border-fuchsia-400/18 bg-fuchsia-400/10 px-3 py-1.5 text-xs font-medium text-fuchsia-100/80 sm:inline-flex">
            <Sparkles className="me-2 h-3.5 w-3.5" />
            {localizedLabel('AI Match', 'تطابق ذكي', language)}
          </span>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={`${exercise.id}-${tag}`}
              className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white/72"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 py-5 sm:px-6 sm:py-6">
        <p className="text-sm leading-7 text-white/68">
          {localizedLabel(repairMojibake(exercise.description), repairMojibake(exercise.descriptionAr), language)}
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <InfoBadge label={localizedLabel('Sets', 'المجموعات', language)} value={String(exercise.sets)} />
            <InfoBadge label={localizedLabel('Reps', 'التكرارات', language)} value={exercise.reps} />
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button type="button" onClick={onToggleExpanded} className="w-full sm:w-auto">
              {viewInstructionsLabel}
            </Button>
            {onTrainWithCamera && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onTrainWithCamera(exercise)}
                className="w-full border border-cyan-300/20 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15 hover:text-white sm:w-auto"
              >
                <Camera className="me-2 h-4 w-4" />
                {localizedLabel('Train with camera', 'تدرب بالكاميرا', language)}
              </Button>
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <motion.section
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="border-t border-white/10 bg-white/[0.03]"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100/70">{instructionsTitle}</p>
              <h4 className="mt-2 text-lg font-semibold text-white">{name}</h4>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
              onClick={onCollapse}
              aria-label={localizedLabel('Close instructions', 'إغلاق التعليمات', language)}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <ol className="space-y-3 p-5 text-sm leading-7 text-white/68 sm:p-6">
            {descriptionPoints.map((point, index) => (
              <li key={`${exercise.id}-point-${index + 1}`} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className={language === 'ar' ? 'text-right font-medium text-white' : 'font-medium text-white'} dir={language === 'ar' ? 'rtl' : undefined}>
                  {index + 1}. {language === 'ar' ? point.ar : point.en}
                </p>
              </li>
            ))}
          </ol>
        </motion.section>
      )}
    </motion.article>
  );
}

function InfoBadge({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/72">
      {label}: <span className="text-white">{value}</span>
    </span>
  );
}

function formatGoal(goal: Exercise['goal'], language: 'en' | 'ar') {
  switch (goal) {
    case 'bulking':
      return localizedLabel('Build Muscle', 'بناء عضلات', language);
    case 'cutting':
      return localizedLabel('Lose Weight', 'إنقاص الوزن', language);
    case 'fitness':
      return localizedLabel('Fitness', 'لياقة', language);
    default:
      return localizedLabel('All Goals', 'كل الأهداف', language);
  }
}

function formatLocation(location: Exercise['location'], language: 'en' | 'ar') {
  switch (location) {
    case 'home':
      return localizedLabel('Home', 'البيت', language);
    case 'gym':
      return localizedLabel('Gym', 'الجيم', language);
    default:
      return localizedLabel('Home / Gym', 'بيت / جيم', language);
  }
}
