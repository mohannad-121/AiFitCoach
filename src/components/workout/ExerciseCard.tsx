import React from 'react';
import { motion } from 'framer-motion';
import { Camera, ExternalLink, Play, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { type Exercise } from '@/data/exercises';
import { getExerciseVideoUrl, isLocalExerciseVideo } from '@/data/exerciseVideoResolver';
import { localizedLabel, repairMojibake } from '@/lib/text';
import { buildExerciseInstructions } from '@/components/workout/exerciseInstructions';

interface ExerciseCardProps {
  exercise: Exercise;
  selectedGender?: 'male' | 'female' | null;
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
  selectedGender = null,
  isExpanded = false,
  onToggleExpanded,
  onCollapse,
  onTrainWithCamera,
}: ExerciseCardProps) {
  const { language } = useLanguage();
  const resolvedVideoUrl = getExerciseVideoUrl(exercise, selectedGender);
  const localVideo = isLocalExerciseVideo(resolvedVideoUrl);
  const hasVideo = localVideo && resolvedVideoUrl.length > 0;
  const externalDemoUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${exercise.name} exercise form`)}`;

  const englishName = repairMojibake(exercise.name);
  const arabicName = repairMojibake(exercise.nameAr || exercise.name);
  const name = localizedLabel(englishName, arabicName, language);
  const descriptionPoints = buildExerciseInstructions(exercise);
  const howToTitle = localizedLabel('How to do this exercise', 'طريقة أداء التمرين', language);
  const watchLabel = hasVideo
    ? localizedLabel('Watch Exercise', 'شاهد التمرين', language)
    : localizedLabel('Open Demo', 'افتح الشرح', language);

  const tags = [
    localizedLabel(muscleLabelsEn[exercise.muscle] || exercise.muscle, muscleLabelsAr[exercise.muscle] || exercise.muscle, language),
    formatGoal(exercise.goal, language),
    formatLocation(exercise.location, language),
    `${exercise.sets} x ${exercise.reps}`,
  ];

  return (
    <motion.div
      whileHover={isExpanded ? undefined : { y: -8, rotateX: 3, rotateY: -3 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      style={{ transformStyle: 'preserve-3d', perspective: 1400 }}
      className="group relative overflow-hidden rounded-[1.9rem] border border-white/12 bg-[linear-gradient(180deg,rgba(9,12,28,0.95),rgba(6,8,19,0.96))] shadow-[0_24px_80px_rgba(0,0,0,0.36)]"
    >
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] p-px">
        <div className="h-full w-full rounded-[inherit] bg-[linear-gradient(135deg,rgba(255,255,255,0.12),rgba(165,112,255,0.16),rgba(82,237,228,0.12),rgba(255,255,255,0.06))]" />
      </div>

      <div className="relative overflow-hidden rounded-[inherit] bg-[#070b18]">
        <div
          className="relative h-72 cursor-pointer overflow-hidden sm:h-80"
          onClick={() => {
            if (hasVideo) {
              onToggleExpanded?.();
              return;
            }
            window.open(externalDemoUrl, '_blank', 'noopener,noreferrer');
          }}
        >
          <div className="absolute inset-0 z-10 bg-[linear-gradient(180deg,rgba(5,7,16,0.1),rgba(6,10,24,0.2)_42%,rgba(6,8,18,0.92)_100%)]" />
          <div className="absolute inset-0 z-10 bg-[radial-gradient(circle_at_top,rgba(96,233,233,0.12),transparent_30%),radial-gradient(circle_at_80%_20%,rgba(224,86,255,0.16),transparent_24%)]" />
          <div className="absolute -inset-y-full left-[-32%] z-20 w-1/3 rotate-12 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.18),transparent)] opacity-0 transition-all duration-700 group-hover:translate-x-[380%] group-hover:opacity-100" />

          {hasVideo ? (
            <video
              src={resolvedVideoUrl}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.08]"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src="/placeholder.svg"
              alt={name}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.08]"
            />
          )}

          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <motion.div
              whileHover={{ scale: 1.06 }}
              className="flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-[linear-gradient(135deg,rgba(244,65,197,0.95),rgba(113,87,255,0.95),rgba(61,224,216,0.82))] shadow-[0_20px_40px_rgba(120,82,255,0.32)]"
            >
              {hasVideo ? (
                <Play className="ml-1 h-8 w-8 text-white" />
              ) : (
                <ExternalLink className="h-7 w-7 text-white" />
              )}
            </motion.div>
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={`${exercise.id}-${tag}`}
                  className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-white/72 backdrop-blur-md"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.26em] text-cyan-100/72">
                  {localizedLabel('Targeted Exercise', 'تمرين مستهدف', language)}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{name}</h3>
              </div>
              <div className="hidden rounded-full border border-fuchsia-400/18 bg-fuchsia-400/10 px-3 py-1.5 text-xs font-medium text-fuchsia-100/80 sm:inline-flex">
                <Sparkles className="mr-2 h-3.5 w-3.5" />
                AI Match
              </div>
            </div>
          </div>
        </div>

        <div className="relative z-20 flex flex-col gap-4 px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
          <p className="text-sm leading-7 text-white/62">
            {localizedLabel(repairMojibake(exercise.description), repairMojibake(exercise.descriptionAr), language)}
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <InfoBadge label={localizedLabel('Sets', 'المجموعات', language)} value={String(exercise.sets)} />
              <InfoBadge label={localizedLabel('Reps', 'التكرارات', language)} value={exercise.reps} />
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              onClick={() => {
                if (hasVideo) {
                  onToggleExpanded?.();
                  return;
                }
                window.open(externalDemoUrl, '_blank', 'noopener,noreferrer');
              }}
              className="group/button relative w-full overflow-hidden rounded-full border border-white/10 bg-[linear-gradient(135deg,rgba(255,91,210,0.96),rgba(117,92,255,0.94))] px-5 text-white shadow-[0_14px_32px_rgba(124,88,255,0.28)] sm:w-auto"
            >
              <span className="absolute inset-y-0 left-[-45%] w-1/3 rotate-12 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent)] transition-transform duration-700 group-hover/button:translate-x-[340%]" />
              <span className="relative flex items-center justify-center gap-2">
                <Play className="h-4 w-4" />
                {watchLabel}
              </span>
            </Button>
            {onTrainWithCamera && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onTrainWithCamera(exercise)}
                className="w-full rounded-full border border-cyan-300/20 bg-cyan-400/10 px-5 text-cyan-100 hover:bg-cyan-400/15 hover:text-white sm:w-auto"
              >
                <Camera className="mr-2 h-4 w-4" />
                {localizedLabel('Train with camera', 'تدرب بالكاميرا', language)}
              </Button>
            )}
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="border-t border-white/10 bg-black/20"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-100/70">{howToTitle}</p>
              <h4 className="mt-2 text-lg font-semibold text-white">{name}</h4>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white"
              onClick={() => onCollapse?.()}
              aria-label="Close exercise details"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="grid gap-0 lg:grid-cols-[1.3fr_0.95fr]">
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              {localVideo ? (
                <video
                  src={resolvedVideoUrl}
                  className="h-full w-full object-contain bg-black"
                  controls
                  autoPlay
                  playsInline
                />
              ) : (
                <iframe
                  src={`${resolvedVideoUrl}?autoplay=1`}
                  className="h-full w-full"
                  allow="autoplay; encrypted-media"
                  allowFullScreen
                  title={name}
                />
              )}
            </div>

            <div className="max-h-[34rem] overflow-y-auto border-t border-white/10 bg-white/[0.03] p-5 lg:border-l lg:border-t-0 lg:p-6">
              <ol className="space-y-4 text-sm leading-7 text-white/68">
                {descriptionPoints.map((point, index) => (
                  <li
                    key={`${exercise.id}-point-${index + 1}`}
                    className="rounded-[1.25rem] border border-white/10 bg-black/20 p-4"
                  >
                    {language === 'ar' ? (
                      <p className="font-medium text-right text-white" dir="rtl">
                        {index + 1}. {point.ar}
                      </p>
                    ) : (
                      <p className="font-medium text-white">
                        {index + 1}. {point.en}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
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
