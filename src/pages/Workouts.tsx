import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Dumbbell, RotateCcw } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { AnatomyBody, advancedToGroupMap } from '@/components/workout/AnatomyBody';
import { ExerciseCard } from '@/components/workout/ExerciseCard';
import { ReferenceVideos } from '@/components/workout/ReferenceVideos';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUser } from '@/contexts/UserContext';
import { exercises as catalog, getExercisesByFilters } from '@/data/exercises';
import { muscleGroups, muscleLabel, resolveWorkoutSelection } from '@/lib/trainingCatalog';
import './TrainingFlow.css';

export function WorkoutsPage() {
  const { language } = useLanguage();
  const { profile } = useUser();
  const ar = language === 'ar';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requested = (params.get('exerciseIds') || '').split(',').filter(id => catalog.some(item => item.id === id));
  const dayMode = params.get('from') === 'schedule' && requested.length > 0;
  const [muscles, setMuscles] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [genderChoice, setGender] = useState<string | null>(null);
  const [placeChoice, setPlace] = useState<string | null>(null);
  const [goal, setGoal] = useState('all');
  const gender = genderChoice ?? profile?.gender ?? 'all';
  const place = placeChoice ?? profile?.location ?? 'all';
  const queryKey = params.toString();
  useEffect(() => {
    const query = new URLSearchParams(queryKey);
    const ids = (query.get('exerciseIds') || '').split(',');
    const matches = catalog.filter(item => ids.includes(item.id));
    const groups = (query.get('muscles') || '').split(',').filter(item => item in muscleGroups);
    setMuscles(matches.length ? [...new Set(matches.map(item => item.muscle))] : groups);
    setExpanded(matches.length === 1 ? matches[0].id : null);
  }, [queryKey]);
  const groups = [...new Set(muscles.map(muscle => advancedToGroupMap[muscle] || muscle))];
  const results = requested.length ? resolveWorkoutSelection(requested, params.get('prescription')) : getExercisesByFilters(groups, goal === 'all' ? null : goal, place === 'all' ? null : place, gender === 'all' ? null : gender);
  const names = Object.fromEntries(Object.keys(muscleGroups).map(key => ['muscle.' + key, muscleLabel(key, language)]));
  const toggle = (id: string) => {
    const group = advancedToGroupMap[id] || id;
    if (requested.length) { setParams({ muscles: group }); return; }
    setExpanded(null);
    setMuscles(current => current.includes(group) ? current.filter(item => item !== group) : [...current, group]);
  };
  return <div className="workouts-simple training-simple min-h-screen pb-24">
    <Navbar />
    <main className="mx-auto px-4 pt-24">
      <header className="training-page-heading"><div><span>FITCOACH / {ar ? 'التمارين' : 'WORKOUTS'}</span><h1>{dayMode ? (ar ? 'تمارين يومك.' : 'Your day. Ready.') : (ar ? 'اختر العضلة. ابدأ تمرينك.' : 'Choose a muscle. Start training.')}</h1><p>{ar ? 'جسمك وتمارينك وتوجيه الكاميرا في خطوة واحدة.' : 'Your muscle map, exercises, and camera coaching in one place.'}</p></div>{dayMode && <Link to="/schedule">{ar ? 'العودة للجدول' : 'Back to schedule'}</Link>}</header>
      {dayMode && <div className="day-workouts-banner"><div><strong>{ar ? 'من جدولك' : 'From your schedule'}</strong><p>{params.get('date')} · {results.length} {ar ? 'تمارين' : 'exercises'}</p></div><button onClick={() => setParams({})}>{ar ? 'تصفّح المكتبة' : 'Browse library'}</button></div>}
      <div className="workouts-browser">
        <aside className="workouts-body-panel">
          <AnatomyBody compact highlightGroups genderOverride={gender === 'female' ? 'female' : gender === 'male' ? 'male' : undefined} selectedMuscles={groups} onMuscleToggle={toggle} muscleNames={names} />
          <div className="workouts-muscle-buttons">{Object.keys(muscleGroups).map(muscle => <button type="button" key={muscle} aria-pressed={groups.includes(muscle)} onClick={() => toggle(muscle)}>{muscleLabel(muscle, language)}</button>)}</div>
        </aside>
        <section className="workouts-results" aria-label={ar ? 'التمارين المناسبة' : 'Matching exercises'}>
          {!dayMode && <div className="workouts-filters">
            <label>{ar ? 'الجنس' : 'Profile'}<select value={gender} onChange={event => setGender(event.target.value)}><option value="all">{ar ? 'الكل' : 'All'}</option><option value="male">{ar ? 'ذكر' : 'Male'}</option><option value="female">{ar ? 'أنثى' : 'Female'}</option></select></label>
            <label>{ar ? 'المكان' : 'Location'}<select value={place} onChange={event => setPlace(event.target.value)}><option value="all">{ar ? 'الكل' : 'All'}</option><option value="home">{ar ? 'البيت' : 'Home'}</option><option value="gym">{ar ? 'الجيم' : 'Gym'}</option></select></label>
            <label>{ar ? 'الهدف' : 'Goal'}<select value={goal} onChange={event => setGoal(event.target.value)}><option value="all">{ar ? 'كل الأهداف' : 'All goals'}</option><option value="bulking">{ar ? 'بناء عضلات' : 'Build muscle'}</option><option value="cutting">{ar ? 'خسارة الوزن' : 'Lose weight'}</option><option value="fitness">{ar ? 'لياقة' : 'Fitness'}</option></select></label>
            <button type="button" aria-label={ar ? 'إعادة ضبط الفلاتر' : 'Reset filters'} onClick={() => { setGender('all'); setPlace('all'); setGoal('all'); }}><RotateCcw size={17} /></button>
          </div>}
          {groups.length || dayMode ? <><div className="workouts-results-heading"><strong>{groups.map(muscle => muscleLabel(muscle, language)).join(' / ')}</strong><span>{results.length} {ar ? 'تمارين' : 'exercises'}</span></div>
            <div className="workouts-exercise-list">{results.map(item => <ExerciseCard key={item.id} exercise={item} isExpanded={expanded === item.id} onToggleExpanded={() => setExpanded(value => value === item.id ? null : item.id)} onCollapse={() => setExpanded(null)} onTrainWithCamera={() => navigate('/live-coach?exerciseId=' + encodeURIComponent(item.id))} />)}</div>
            {!results.length && <p className="training-empty">{ar ? 'لا توجد نتائج. جرّب تغيير المكان أو الهدف.' : 'No matches. Try another location or goal.'}</p>}
            {groups[0] && <ReferenceVideos key={groups[0] + gender + place} muscle={groups[0]} gender={gender} location={place} />}
          </> : <div className="training-empty"><Dumbbell size={30} /><h2>{ar ? 'من أين نبدأ؟' : 'Where shall we start?'}</h2><p>{ar ? 'اختر عضلة لعرض التمارين المناسبة.' : 'Select a muscle to view matching exercises.'}</p></div>}
        </section>
      </div>
    </main>
  </div>;
}
