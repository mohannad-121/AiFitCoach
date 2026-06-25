import React, { type ComponentType, type ReactNode, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Brain,
  Dumbbell,
  MapPin,
  RotateCcw,
  Sparkles,
  Target,
  UserRound,
} from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { AnatomyBody, advancedToGroupMap } from '@/components/workout/AnatomyBody';
import { ExerciseCard } from '@/components/workout/ExerciseCard';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUser } from '@/contexts/UserContext';
import { getExercisesByFilters } from '@/data/exercises';
import { localizedLabel, repairMojibake } from '@/lib/text';

type FilterValue = string | null;

interface FilterOption<T extends FilterValue> {
  label: string;
  value: T;
}

interface FilterSegmentProps<T extends FilterValue> {
  label: string;
  icon: ComponentType<{ className?: string }>;
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

interface StatItem {
  label: string;
  value: string;
}

const insightAreaMap: Record<string, string> = {
  chest: 'Upper Body',
  shoulders: 'Upper Body',
  biceps: 'Upper Body',
  triceps: 'Upper Body',
  back: 'Posterior Chain',
  abs: 'Core',
  quads: 'Lower Body',
  hamstrings: 'Posterior Chain',
  glutes: 'Lower Body',
  calves: 'Lower Body',
};

const aiTips: Record<string, string> = {
  chest: 'For chest work, lock your shoulder blades down, control the lowering phase, and finish each rep with active pec tension instead of elbow flare.',
  shoulders: 'For shoulders, own the top position, keep the ribs quiet, and move with clean arcs instead of throwing the weight.',
  biceps: 'For biceps, keep the elbows quiet, squeeze at peak contraction, and remove momentum so the curl stays in the arm.',
  triceps: 'For triceps, keep the upper arm stable, fully extend with control, and avoid swinging through the lockout.',
  back: 'For back work, lead with the elbows, keep the chest proud, and think about pulling through the lats instead of the hands.',
  abs: 'For abs, focus on controlled reps, breathing, and core tension. Avoid using momentum.',
  quads: 'For quads, drive through the mid-foot, keep the knee path clean, and use a slow descent to maximize tension.',
  hamstrings: 'For hamstrings, hinge from the hips, keep the spine long, and stretch under control before driving back up.',
  glutes: 'For glutes, pause at peak contraction, keep the pelvis stable, and finish with glute squeeze instead of lower-back extension.',
  calves: 'For calves, use full ankle range, pause at the top, and slow the lowering phase so the tissue stays loaded.',
};

export function WorkoutsPage() {
  const { language } = useLanguage();
  const { profile } = useUser();

  const [selectedMuscles, setSelectedMuscles] = useState<string[]>([]);
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  const [locationFilter, setLocationFilter] = useState<string | null>(profile?.location || null);
  const [goalFilter, setGoalFilter] = useState<string | null>(profile?.goal || null);
  const [genderFilter, setGenderFilter] = useState<'male' | 'female' | null>(
    profile?.gender === 'male' || profile?.gender === 'female' ? profile.gender : null
  );

  const toggleMuscle = (muscleId: string) => {
    setExpandedExerciseId(null);
    setSelectedMuscles((prev) =>
      prev.includes(muscleId) ? prev.filter((muscle) => muscle !== muscleId) : [...prev, muscleId]
    );
  };

  const muscleNames: Record<string, string> = {
    'muscle.chest': localizedLabel('Chest', 'الصدر', language),
    'muscle.back': localizedLabel('Back', 'الظهر', language),
    'muscle.shoulders': localizedLabel('Shoulders', 'الأكتاف', language),
    'muscle.biceps': localizedLabel('Biceps', 'البايسبس', language),
    'muscle.triceps': localizedLabel('Triceps', 'الترايسبس', language),
    'muscle.abs': localizedLabel('Abs', 'البطن', language),
    'muscle.quads': localizedLabel('Quads', 'الفخذ الأمامي', language),
    'muscle.hamstrings': localizedLabel('Hamstrings', 'الفخذ الخلفي', language),
    'muscle.glutes': localizedLabel('Glutes', 'المؤخرة', language),
    'muscle.calves': localizedLabel('Calves', 'السمانة', language),
  };

  const mappedMuscles = selectedMuscles.map((muscle) => advancedToGroupMap[muscle] || muscle);
  const uniqueMuscles = [...new Set(mappedMuscles)];
  const hasMuscleSelection = uniqueMuscles.length > 0;
  const exercises = getExercisesByFilters(uniqueMuscles, goalFilter, locationFilter, genderFilter);

  const primaryMuscle = uniqueMuscles[0] || null;
  const additionalSelectionCount = Math.max(uniqueMuscles.length - 1, 0);
  const selectedMuscleLabel = primaryMuscle
    ? muscleNames[`muscle.${primaryMuscle}`] || primaryMuscle.replace(/_/g, ' ')
    : null;

  const goalDisplay = getGoalLabel(goalFilter, language);
  const placeDisplay = getPlaceLabel(locationFilter, language);
  const genderDisplay = getGenderLabel(genderFilter, language);
  const targetArea = primaryMuscle
    ? localizedLabel(
        insightAreaMap[primaryMuscle] || 'Full Body',
        mapAreaToArabic(insightAreaMap[primaryMuscle] || 'Full Body'),
        language
      )
    : null;
  const aiMatch = primaryMuscle
    ? Math.min(99, 88 + Math.min(exercises.length, 6) + (goalFilter ? 2 : 0) + (locationFilter ? 2 : 0) + (genderFilter ? 1 : 0))
    : 0;
  const exercisesFoundDisplay = language === 'ar'
    ? `${exercises.length} ${repairMojibake('تمارين متطابقة')}`
    : `${exercises.length} exercises found`;
  const exercisesFoundLabel = language === 'ar'
    ? `${exercises.length} تمارين متطابقة`
    : `${exercises.length} exercises found`;
  const coachTip = primaryMuscle
    ? localizedLabel(
        aiTips[primaryMuscle] || 'Stay controlled, own the full range, and keep tension on the target muscle.',
        mapTipToArabic(primaryMuscle),
        language
      )
    : null;

  const genderOptions: FilterOption<'male' | 'female' | null>[] = [
    { value: null, label: localizedLabel('All', 'الكل', language) },
    { value: 'male', label: localizedLabel('Male', 'ذكر', language) },
    { value: 'female', label: localizedLabel('Female', 'أنثى', language) },
  ];
  const placeOptions: FilterOption<string | null>[] = [
    { value: null, label: localizedLabel('All', 'الكل', language) },
    { value: 'home', label: localizedLabel('Home', 'البيت', language) },
    { value: 'gym', label: localizedLabel('Gym', 'الجيم', language) },
  ];
  const goalOptions: FilterOption<string | null>[] = [
    { value: null, label: localizedLabel('All', 'الكل', language) },
    { value: 'bulking', label: localizedLabel('Build Muscle', 'بناء عضلات', language) },
    { value: 'cutting', label: localizedLabel('Lose Weight', 'إنقاص الوزن', language) },
    { value: 'fitness', label: localizedLabel('General Fitness', 'لياقة عامة', language) },
  ];

  const resetFilters = () => {
    setExpandedExerciseId(null);
    setGenderFilter(null);
    setLocationFilter(null);
    setGoalFilter(null);
  };

  return (
    <div dir={language === 'ar' ? 'rtl' : 'ltr'} className="relative min-h-screen overflow-x-clip bg-[#050816] pb-24 text-white md:pb-10">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,22,54,0.88),_rgba(4,7,18,0.98)_60%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(95,132,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(95,132,255,0.06)_1px,transparent_1px)] bg-[size:72px_72px] opacity-40 animate-[workoutGridDrift_18s_linear_infinite]" />
        <div className="absolute -left-24 top-24 h-80 w-80 rounded-full bg-[radial-gradient(circle,_rgba(124,92,255,0.26),_transparent_68%)] blur-3xl animate-[workoutOrbFloat_13s_ease-in-out_infinite]" />
        <div className="absolute right-[-8rem] top-[20%] h-96 w-96 rounded-full bg-[radial-gradient(circle,_rgba(0,214,201,0.18),_transparent_70%)] blur-3xl animate-[workoutOrbFloat_17s_ease-in-out_infinite_reverse]" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-[radial-gradient(ellipse_at_center,_rgba(0,0,0,0),_rgba(0,0,0,0.65)_72%)]" />
        <div className="workout-noise absolute inset-0 opacity-[0.12]" />
        {Array.from({ length: 18 }).map((_, index) => (
          <span
            key={index}
            className="absolute h-1 w-1 rounded-full bg-white/60"
            style={{
              left: `${6 + index * 5.1}%`,
              top: `${8 + (index % 6) * 13}%`,
              animation: `workoutParticle ${7 + (index % 5)}s ease-in-out ${index * 0.15}s infinite`,
            }}
          />
        ))}
      </div>

      <Navbar />

      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 pt-24 sm:px-6 lg:px-8">
        <WorkoutHero language={language} />

        <motion.section
          initial={{ opacity: 0, y: 28, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
          className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.04] p-4 shadow-[0_30px_100px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-6 xl:p-8"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(183,109,255,0.12),_transparent_42%),radial-gradient(circle_at_80%_20%,_rgba(61,224,216,0.12),_transparent_32%)]" />
          <div className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />

          <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_20rem] xl:items-start">
            <AnatomyBody
              selectedMuscles={selectedMuscles}
              onMuscleToggle={toggleMuscle}
              muscleNames={muscleNames}
            />
            <SelectedMusclePanel
              language={language}
              selectedMuscleLabel={selectedMuscleLabel}
              targetArea={targetArea}
              additionalSelectionCount={additionalSelectionCount}
              aiMatch={aiMatch}
              stats={[
                {
                  label: localizedLabel('Exercises Found', 'التمارين الموجودة', language),
                  value: String(exercises.length),
                },
                {
                  label: localizedLabel('Current Goal', 'الهدف الحالي', language),
                  value: goalDisplay,
                },
                {
                  label: localizedLabel('Current Place', 'المكان الحالي', language),
                  value: placeDisplay,
                },
                {
                  label: localizedLabel('Profile Gender', 'الجنس', language),
                  value: genderDisplay,
                },
              ]}
            />
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.15 }}
          className="mt-8 overflow-hidden rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(12,16,35,0.8),rgba(7,10,24,0.78))] p-3 shadow-[0_20px_70px_rgba(93,59,255,0.16)] backdrop-blur-2xl sm:p-4"
        >
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-center xl:gap-4">
            <div className="overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex min-w-max flex-wrap items-center gap-2 xl:flex-nowrap xl:gap-3">
              <FilterSegment
                label={localizedLabel('Gender', 'الجنس', language)}
                icon={UserRound}
                options={genderOptions}
                value={genderFilter}
                onChange={(value) => {
                  setExpandedExerciseId(null);
                  setGenderFilter(value);
                }}
              />
              <FilterSegment
                label={localizedLabel('Place', 'المكان', language)}
                icon={MapPin}
                options={placeOptions}
                value={locationFilter}
                onChange={(value) => {
                  setExpandedExerciseId(null);
                  setLocationFilter(value);
                }}
              />
              <FilterSegment
                label={localizedLabel('Goal', 'الهدف', language)}
                icon={Target}
                options={goalOptions}
                value={goalFilter}
                onChange={(value) => {
                  setExpandedExerciseId(null);
                  setGoalFilter(value);
                }}
              />
            </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
              <div className="inline-flex h-10 items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 text-sm text-cyan-100 shadow-[0_0_20px_rgba(45,212,191,0.08)]">
                <Sparkles className="h-4 w-4" />
                <span>{hasMuscleSelection ? exercisesFoundDisplay : localizedLabel('AI targeting idle', 'التحليل الذكي غير مفعل', language)}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={resetFilters}
                className="group h-10 rounded-full border border-white/12 bg-white/[0.04] px-4 text-white/80 hover:bg-white/[0.08] hover:text-white"
              >
                <RotateCcw className="mr-2 h-4 w-4 transition-transform duration-300 group-hover:-rotate-90" />
                {localizedLabel('Reset Filters', 'إعادة ضبط الفلاتر', language)}
              </Button>
            </div>
          </div>
        </motion.section>

        {hasMuscleSelection && coachTip && (
          <AiCoachTip language={language} selectedMuscleLabel={selectedMuscleLabel || ''} tip={coachTip} />
        )}

        <section className="mt-8 pb-10">
          {hasMuscleSelection ? (
            exercises.length > 0 ? (
              <motion.div
                initial="hidden"
                animate="show"
                variants={{
                  hidden: {},
                  show: {
                    transition: {
                      staggerChildren: 0.06,
                    },
                  },
                }}
                className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3"
              >
                {exercises.map((exercise) => (
                  <motion.div
                    key={exercise.id}
                    variants={{
                      hidden: { opacity: 0, y: 26 },
                      show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
                    }}
                    className={expandedExerciseId === exercise.id ? 'md:col-span-2 xl:col-span-3' : ''}
                  >
                    <ExerciseCard
                      exercise={exercise}
                      selectedGender={genderFilter}
                      isExpanded={expandedExerciseId === exercise.id}
                      onToggleExpanded={() =>
                        setExpandedExerciseId((current) => (current === exercise.id ? null : exercise.id))
                      }
                      onCollapse={() => setExpandedExerciseId(null)}
                    />
                  </motion.div>
                ))}
              </motion.div>
            ) : (
              <EmptyWorkoutState
                icon={<Target className="h-14 w-14" />}
                title={localizedLabel('No matching exercise signals found', 'ما في نتائج مطابقة حالياً', language)}
                helper={localizedLabel(
                  'Your AI coach is ready. Try changing goal, place, or gender filters to reveal matching exercise videos.',
                  'مدربك الذكي جاهز. غيّر الهدف أو المكان أو الجنس لإظهار فيديوهات مطابقة.',
                  language
                )}
              />
            )
          ) : (
            <EmptyWorkoutState
              icon={<Dumbbell className="h-14 w-14" />}
              title={localizedLabel(
                'Select a muscle to unlock targeted exercises',
                'اختر عضلة لفتح التمارين المستهدفة',
                language
              )}
              helper={localizedLabel(
                'Your AI coach will filter videos by muscle, goal, place, and profile.',
                'مدربك الذكي سيصفي الفيديوهات حسب العضلة والهدف والمكان والملف الشخصي.',
                language
              )}
              srOnlyText={localizedLabel(
                'Select a muscle to view exercise videos.',
                'اختر عضلة لعرض فيديوهات التمرين.',
                language
              )}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function WorkoutHero({ language }: { language: 'en' | 'ar' }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto mb-8 max-w-4xl text-center"
    >
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-100/90">
        <Brain className="h-4 w-4 text-cyan-300" />
        <span>{localizedLabel('AI MUSCLE TARGETING', 'استهداف العضلات بالذكاء الاصطناعي', language)}</span>
      </div>
      <h1 className="text-balance font-display text-5xl leading-[0.95] text-white sm:text-6xl lg:text-7xl">
        {localizedLabel('Interactive Muscle Map', 'خريطة العضلات التفاعلية', language)}
      </h1>
      <div className="mx-auto mt-4 h-1.5 w-40 overflow-hidden rounded-full bg-white/8">
        <div className="h-full w-1/2 rounded-full bg-[linear-gradient(90deg,rgba(235,89,255,0.15),rgba(235,89,255,1),rgba(92,241,255,1))] animate-[workoutUnderline_3.8s_ease-in-out_infinite]" />
      </div>
      <p className="mx-auto mt-6 max-w-3xl text-balance text-base leading-8 text-white/68 sm:text-lg">
        {localizedLabel(
          'Select any muscle and unlock personalized exercise videos based on your goal, place, and body profile.',
          'اختر أي عضلة وافتح فيديوهات تمارين مخصصة حسب هدفك ومكان التدريب وملف جسمك.',
          language
        )}
      </p>
    </motion.section>
  );
}

function FilterSegment<T extends FilterValue>({
  label,
  icon: Icon,
  options,
  value,
  onChange,
}: FilterSegmentProps<T>) {
  return (
      <div className="inline-flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="inline-flex items-center gap-2 pr-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/55">
          <Icon className="h-3.5 w-3.5 text-cyan-300/90" />
          <span>{label}</span>
        </div>
      <div className="flex flex-wrap items-center gap-2">
        {options.map((option) => {
          const active = option.value === value;

          return (
            <motion.button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              whileHover={{ y: -1, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              className={`inline-flex h-10 items-center justify-center rounded-full border px-4 text-center text-sm font-medium transition duration-300 ${
                active
                  ? 'border-transparent bg-[linear-gradient(135deg,rgba(255,76,189,0.88),rgba(126,91,255,0.9),rgba(71,228,221,0.72))] text-white shadow-[0_10px_28px_rgba(161,88,255,0.28)]'
                  : 'border-white/10 bg-white/[0.035] text-white/70 hover:border-cyan-300/25 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              <span className="whitespace-nowrap">{option.label}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function SelectedMusclePanel({
  language,
  selectedMuscleLabel,
  targetArea,
  additionalSelectionCount,
  aiMatch,
  stats,
}: {
  language: 'en' | 'ar';
  selectedMuscleLabel: string | null;
  targetArea: string | null;
  additionalSelectionCount: number;
  aiMatch: number;
  stats: StatItem[];
}) {
  if (!selectedMuscleLabel || !targetArea) {
    return (
      <div className="h-full rounded-[1.75rem] border border-dashed border-white/12 bg-white/[0.03] p-6 text-center text-white/60 xl:min-h-[42rem] xl:p-7">
        <div className="flex h-full min-h-[16rem] flex-col items-center justify-center">
          <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 text-cyan-200">
            <Brain className="h-7 w-7" />
          </div>
          <p className="text-lg font-semibold text-white">
            {localizedLabel('Select a muscle to activate AI targeting.', 'اختر عضلة لتفعيل الاستهداف الذكي.', language)}
          </p>
          <p className="mt-3 max-w-xs text-sm leading-7 text-white/50">
            {localizedLabel(
              'Your live anatomy panel will surface targeted insights, active filters, and matching exercise output here.',
              'لوحة التشريح ستعرض هنا الرؤى المستهدفة والفلاتر النشطة والنتائج المطابقة.',
              language
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[1.75rem] border border-white/12 bg-[linear-gradient(180deg,rgba(10,14,32,0.94),rgba(8,10,24,0.88))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.36)] xl:sticky xl:top-28">
      <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-100 pulse-glow">
        <Sparkles className="h-3.5 w-3.5" />
        <span>{localizedLabel('AI Analysis Complete', 'اكتمل التحليل الذكي', language)}</span>
      </div>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/45">
          {localizedLabel('Selected Muscle', 'العضلة المختارة', language)}
        </p>
        <h2 className="mt-3 text-3xl font-semibold text-white">{selectedMuscleLabel}</h2>
        {additionalSelectionCount > 0 && (
          <p className="mt-2 text-sm text-fuchsia-200/85">
            {language === 'ar'
              ? `+${additionalSelectionCount} عضلات إضافية نشطة`
              : `+${additionalSelectionCount} more muscles armed`}
          </p>
        )}
      </div>

      <div className="mt-6 grid gap-3">
        <div className="rounded-[1.35rem] border border-white/10 bg-white/[0.04] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-white/45">
            {localizedLabel('Target Area', 'منطقة الاستهداف', language)}
          </p>
          <p className="mt-2 text-lg font-medium text-white">{targetArea}</p>
        </div>
        <div className="rounded-[1.35rem] border border-fuchsia-400/20 bg-[linear-gradient(135deg,rgba(255,99,216,0.12),rgba(108,86,255,0.08))] p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-fuchsia-100/70">
            {localizedLabel('AI Match', 'نسبة التطابق', language)}
          </p>
          <p className="mt-2 text-4xl font-semibold text-white">{aiMatch}%</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
        {stats.map((item) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4"
          >
            <p className="text-xs uppercase tracking-[0.22em] text-white/42">{item.label}</p>
            <p className="mt-2 text-base font-medium text-white">{item.value}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function AiCoachTip({
  language,
  selectedMuscleLabel,
  tip,
}: {
  language: 'en' | 'ar';
  selectedMuscleLabel: string;
  tip: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.2 }}
      className="mt-8 overflow-hidden rounded-[1.75rem] border border-cyan-400/15 bg-[linear-gradient(135deg,rgba(10,16,36,0.92),rgba(8,12,28,0.86))] shadow-[0_24px_80px_rgba(0,0,0,0.34)]"
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 shadow-[0_0_22px_rgba(75,220,255,0.16)]">
            <Brain className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100/72">
              {localizedLabel('AI Coach Tip', 'نصيحة المدرب الذكي', language)}
            </p>
            <h3 className="mt-2 text-xl font-semibold text-white">
              {language === 'ar' ? `توجيه ${selectedMuscleLabel}` : `${selectedMuscleLabel} guidance`}
            </h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-white/72">{tip}</p>
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function EmptyWorkoutState({
  icon,
  title,
  helper,
  srOnlyText,
}: {
  icon: ReactNode;
  title: string;
  helper: string;
  srOnlyText?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(10,12,25,0.92),rgba(6,8,18,0.92))] px-6 py-16 text-center shadow-[0_30px_90px_rgba(0,0,0,0.38)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(112,74,255,0.16),_transparent_42%)]" />
      <div className="relative mx-auto flex max-w-2xl flex-col items-center">
        <div className="relative mb-6 flex h-24 w-24 items-center justify-center">
          <span className="absolute inset-0 rounded-full border border-fuchsia-400/20 animate-[workoutPulseRing_3s_ease-out_infinite]" />
          <span className="absolute inset-2 rounded-full border border-cyan-300/20 animate-[workoutPulseRing_3s_ease-out_0.4s_infinite]" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full border border-white/12 bg-white/[0.05] text-cyan-100 shadow-[0_0_32px_rgba(112,74,255,0.22)]">
            {icon}
          </div>
        </div>
        <h3 className="text-2xl font-semibold text-white sm:text-3xl">{title}</h3>
        <p className="mt-4 max-w-xl text-sm leading-8 text-white/62 sm:text-base">{helper}</p>
        {srOnlyText ? <span className="sr-only">{srOnlyText}</span> : null}
      </div>
    </div>
  );
}

function getGoalLabel(goal: string | null, language: 'en' | 'ar') {
  switch (goal) {
    case 'bulking':
      return localizedLabel('Build Muscle', 'بناء عضلات', language);
    case 'cutting':
      return localizedLabel('Lose Weight', 'إنقاص الوزن', language);
    case 'fitness':
      return localizedLabel('General Fitness', 'لياقة عامة', language);
    default:
      return localizedLabel('All Goals', 'كل الأهداف', language);
  }
}

function getPlaceLabel(place: string | null, language: 'en' | 'ar') {
  switch (place) {
    case 'home':
      return localizedLabel('Home', 'البيت', language);
    case 'gym':
      return localizedLabel('Gym', 'الجيم', language);
    default:
      return localizedLabel('All Places', 'كل الأماكن', language);
  }
}

function getGenderLabel(gender: 'male' | 'female' | null, language: 'en' | 'ar') {
  switch (gender) {
    case 'male':
      return localizedLabel('Male', 'ذكر', language);
    case 'female':
      return localizedLabel('Female', 'أنثى', language);
    default:
      return localizedLabel('All Profiles', 'كل الملفات', language);
  }
}

function mapAreaToArabic(area: string) {
  switch (area) {
    case 'Upper Body':
      return 'الجزء العلوي';
    case 'Posterior Chain':
      return 'السلسلة الخلفية';
    case 'Core':
      return 'الجذع';
    case 'Lower Body':
      return 'الجزء السفلي';
    default:
      return 'الجسم بالكامل';
  }
}

function mapTipToArabic(primaryMuscle: string) {
  switch (primaryMuscle) {
    case 'chest':
      return 'في تمارين الصدر، ثبت لوحي الكتف للأسفل، وتحكم في النزول، وانهِ كل تكرار بانقباض فعلي للصدر بدون فتح المرفقين بشكل مبالغ.';
    case 'shoulders':
      return 'في تمارين الأكتاف، اثبت في أعلى الحركة، وحافظ على ثبات القفص الصدري، واجعل المسار نظيفاً بدون رمي الوزن.';
    case 'biceps':
      return 'في تمارين البايسبس، ثبت المرفقين، واعصر في أعلى التكرار، وأزل أي زخم حتى يبقى الجهد في الذراع.';
    case 'triceps':
      return 'في تمارين الترايسبس، حافظ على ثبات الجزء العلوي من الذراع، وامدد بالكامل بتحكم، وابتعد عن التأرجح.';
    case 'back':
      return 'في تمارين الظهر، قد الحركة بالمرفقين، وارفع الصدر، وفكر في السحب باللاتس وليس باليدين.';
    case 'abs':
      return 'في تمارين البطن، ركز على التكرارات المتحكم بها، والتنفس، وشد الجذع. تجنب استخدام الزخم.';
    case 'quads':
      return 'في تمارين الفخذ الأمامي، ادفع من منتصف القدم، وحافظ على مسار ركبة نظيف، واستخدم نزولاً بطيئاً لزيادة الشد.';
    case 'hamstrings':
      return 'في تمارين الفخذ الخلفي، ابدأ بالحوض، وحافظ على طول العمود الفقري، وخذ التمدد بتحكم قبل الصعود.';
    case 'glutes':
      return 'في تمارين المؤخرة، توقف لحظة عند أعلى انقباض، وثبت الحوض، وأنهِ الحركة بعصر المؤخرة لا بأسفل الظهر.';
    case 'calves':
      return 'في تمارين السمانة، استخدم المدى الكامل للكاحل، وتوقف أعلى الحركة، واهدأ في النزول حتى يبقى الشد مستمراً.';
    default:
      return 'تحرك بتحكم كامل، وامتلك مدى الحركة، وحافظ على الشد المستمر على العضلة المستهدفة.';
  }
}
