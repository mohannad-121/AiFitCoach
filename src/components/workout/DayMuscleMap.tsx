import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUser } from '@/contexts/UserContext';
import { muscleGroups, muscleLabel, resolveScheduledExercise, scheduledMuscles, workoutDayLink, type ScheduledExercise } from '@/lib/trainingCatalog';

const Body = lazy(() => import('./AnatomyBody').then(module => ({ default: module.AnatomyBody })));

export function DayMuscleMap({ items, pending, date }: { items: ScheduledExercise[]; pending: ScheduledExercise[]; date: string }) {
  const { language } = useLanguage();
  const { profile } = useUser();
  const ar = language === 'ar';
  const targetMuscles = scheduledMuscles(pending);
  const allMuscles = scheduledMuscles(items);
  const matched = items.filter(resolveScheduledExercise);
  const names = Object.fromEntries(Object.keys(muscleGroups).map(key => [`muscle.${key}`, muscleLabel(key, language)]));
  return <section className="day-muscle-map" aria-label={ar ? 'عضلات يومك' : 'Your day’s muscles'}>
    <header><span>{ar ? 'عضلات يومك' : 'Your day’s muscles'}</span><small>{date}</small></header>
    <Suspense fallback={<div className="anatomy-loading">{ar ? 'تحميل الجسم…' : 'Loading body…'}</div>}>
      <Body compact highlightGroups genderOverride={profile?.gender} selectedMuscles={targetMuscles} onMuscleToggle={() => {}} muscleNames={names} />
    </Suspense>
    <div className="day-muscle-tags">{allMuscles.map(muscle => <span key={muscle} className={targetMuscles.includes(muscle) ? 'is-pending' : 'is-done'}>{!targetMuscles.includes(muscle) && <Check size={12} />}{muscleLabel(muscle, language)}</span>)}</div>
    <p>{items.length === 0 ? (ar ? 'يوم راحة؛ لا توجد عضلات مستهدفة اليوم.' : 'Rest day. No muscles scheduled.') : pending.length === 0 ? (ar ? 'أنهيت تمارين اليوم.' : 'Today’s training is complete.') : targetMuscles.length ? (ar ? 'العضلات الملوّنة ما زال لها تمارين متبقية.' : 'Highlighted muscles still have exercises to complete.') : (ar ? 'أسماء هذه التمارين غير مطابقة للمكتبة بعد؛ راجع قائمة يومك.' : 'These exercise names are not matched to the library yet. Review your day’s list.')}</p>
    {matched.length > 0 && matched.length < items.length && <p>{ar ? `${items.length - matched.length} تمارين مخصصة تبقى في قائمة الجدول؛ الرابط يفتح التمارين المطابقة فقط.` : `${items.length - matched.length} custom exercises remain in the schedule. The link opens matched movements only.`}</p>}
    {matched.length > 0 && <Link className="training-action" to={workoutDayLink(items, date)}>{ar ? 'شاهد تمارين هذا اليوم' : 'See this day’s exercises'}<ArrowUpRight size={17} /></Link>}
  </section>;
}
