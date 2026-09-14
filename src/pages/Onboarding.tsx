import { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { AppEmoji, type EmojiName } from '@/components/brand/AppEmoji';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUser } from '@/contexts/UserContext';
import { useAuth } from '@/hooks/useAuth';
import { profileSchema, saveProfileForUser, type OnboardingDraft } from '@/lib/profile';

const steps: { title: [string, string]; description: [string, string]; icon: EmojiName; fields: (keyof OnboardingDraft)[] }[] = [
  { title: ['First, a little about you', 'لنتعرف عليك أولاً'], description: ['Your plan starts with your own answers.', 'خطتك تبدأ بإجاباتك أنت.'], icon: 'person', fields: ['name', 'age', 'gender'] },
  { title: ['Your starting point', 'نقطة البداية'], description: ['Add your current measurements. You can update them later.', 'أدخل قياساتك الحالية. يمكنك تحديثها لاحقاً.'], icon: 'ruler', fields: ['weight', 'height'] },
  { title: ['What brings you here?', 'ما هدفك؟'], description: ['Choose the goal that matters most to you.', 'اختر الهدف الأهم بالنسبة لك.'], icon: 'sparkle', fields: ['goal'] },
  { title: ['Find your rhythm', 'اختر إيقاعك'], description: ['A sustainable plan fits your experience and week.', 'الخطة المناسبة تراعي خبرتك ووقتك.'], icon: 'calendar', fields: ['fitnessLevel', 'trainingDaysPerWeek', 'activityLevel'] },
  { title: ['Make room to move', 'مساحتك للتدريب'], description: ['Tell us where you train and what you have available.', 'أخبرنا أين تتدرب وما المعدات المتاحة.'], icon: 'muscle', fields: ['location', 'equipment'] },
  { title: ['Your health matters', 'صحتك أولاً'], description: ['Share conditions or injuries your coach should consider. Optional.', 'شارك الحالات أو الإصابات التي يجب مراعاتها. اختياري.'], icon: 'heart', fields: ['chronicConditions', 'injuries'] },
  { title: ['Fuel your everyday', 'غذاؤك اليومي'], description: ['Any food preferences or allergies? Leave blank if none.', 'هل لديك تفضيلات غذائية أو حساسية؟ اتركها فارغة إن لم توجد.'], icon: 'leaf', fields: ['dietaryPreferences', 'allergies'] },
];
const choices = {
  gender: ['male', 'female'], goal: ['bulking', 'cutting', 'fitness'], fitnessLevel: ['beginner', 'intermediate', 'advanced'],
  activityLevel: ['low', 'moderate', 'high'], location: ['home', 'gym'],
} as const;
const labels: Record<string, [string, string]> = {
  name: ['Your name', 'اسمك'], age: ['Age', 'العمر'], gender: ['Gender', 'الجنس'], weight: ['Weight', 'الوزن'], height: ['Height', 'الطول'],
  goal: ['Your goal', 'هدفك'], fitnessLevel: ['Experience', 'الخبرة'], trainingDaysPerWeek: ['Days per week', 'أيام الأسبوع'],
  activityLevel: ['Daily activity', 'النشاط اليومي'], location: ['Training location', 'مكان التدريب'], equipment: ['Available equipment', 'المعدات المتاحة'],
  chronicConditions: ['Health conditions', 'الحالات الصحية'], injuries: ['Injuries or pain', 'الإصابات أو الألم'], dietaryPreferences: ['Dietary preferences', 'التفضيلات الغذائية'], allergies: ['Allergies', 'الحساسية'],
};
const numeric = { age: [13, 120, 'years', 'سنة'], weight: [25, 350, 'kg', 'كغ'], height: [100, 250, 'cm', 'سم'], trainingDaysPerWeek: [1, 7, 'days', 'أيام'] } as const;
export function OnboardingPage() {
  const { language, setLanguage, t } = useLanguage();
  const { user } = useAuth();
  const { setProfile } = useUser();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<OnboardingDraft>({});
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const ar = language === 'ar';
  const copy = (pair: readonly [string, string]) => pair[ar ? 1 : 0];
  const current = steps[step];
  const next = async () => {
    if (savingRef.current) return;
    const parsed = profileSchema.safeParse({ ...draft, onboardingCompleted: true });
    const issue = parsed.success ? undefined : parsed.error.issues.find(issue => current.fields.includes(issue.path[0] as keyof OnboardingDraft));
    if (issue) { setError(ar ? 'أكمل هذا الاختيار أو أدخل قيمة صحيحة للمتابعة.' : 'Complete this choice or enter a valid value to continue.'); document.getElementById(`onboard-${issue.path[0]}`)?.focus(); return; }
    setError('');
    if (step < steps.length - 1) { setStep(value => value + 1); return; }
    if (!parsed.success || !user) { setError(ar ? 'راجع إجاباتك قبل الحفظ.' : 'Review your answers before saving.'); return; }
    savingRef.current = true; setSaving(true);
    try { const saved = await saveProfileForUser(user.id, parsed.data); setProfile(saved); navigate('/workouts', { replace: true }); }
    catch { setError(ar ? 'تعذر حفظ ملفك. إجاباتك محفوظة هنا، حاول مجدداً.' : 'Your profile could not be saved. Your answers are still here; please try again.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return <main className="onboarding-page">
    <header><BrandLogo /><Button variant="ghost" onClick={() => setLanguage(ar ? 'en' : 'ar')}>{ar ? 'English' : 'العربية'}</Button></header>
    <div className="onboarding-layout"><aside><span className="aura-eyebrow">NextAura FIT</span><h1>{ar ? 'خطوات صغيرة. بداية أفضل.' : 'Small steps. A better beginning.'}</h1><p>{ar ? 'لنضع خطة تشبهك وتناسب حياتك.' : 'Let’s make a plan that feels like you, and fits your life.'}</p><ol>{steps.map((item, i) => <li key={item.icon} aria-current={i === step ? 'step' : undefined}><span>{i < step ? <Check size={15} /> : i + 1}</span>{copy(item.title)}</li>)}</ol></aside>
    <section className="onboarding-panel"><div className="onboarding-progress" role="progressbar" aria-label={ar ? 'تقدم الإعداد' : 'Setup progress'} aria-valuenow={step + 1} aria-valuemin={0} aria-valuemax={steps.length}><span style={{ width: `${(step + 1) / steps.length * 100}%` }} /></div><p className="aura-eyebrow">{ar ? 'الخطوة' : 'Step'} {step + 1} / {steps.length}</p>
      <AnimatePresence mode="wait"><motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: .18 }}>
        <AppEmoji name={current.icon} /><h2>{copy(current.title)}</h2><p className="onboarding-description">{copy(current.description)}</p>
        <form onSubmit={event => { event.preventDefault(); void next(); }} className="onboarding-fields">
          {current.fields.map(field => {
            const options = choices[field as keyof typeof choices];
            const number = numeric[field as keyof typeof numeric];
            return <div key={field}><label htmlFor={`onboard-${field}`}>{copy(labels[field])}{number && <small>{String(number[ar ? 3 : 2])}</small>}</label>
              {options ? <div id={`onboard-${field}`} tabIndex={-1} role="group" aria-label={copy(labels[field])} className="onboarding-choices">{options.map(value => <button type="button" key={value} aria-pressed={draft[field] === value} onClick={() => { setDraft(previous => ({ ...previous, [field]: value })); setError(''); }}>{t(field === 'activityLevel' ? `onboarding.activity.${value}` : `onboarding.${value}`)}{draft[field] === value && <Check size={18} />}</button>)}</div>
                : number ? <Input id={`onboard-${field}`} type="number" inputMode="decimal" min={number[0]} max={number[1]} step={field === 'weight' ? .1 : 1} value={draft[field] ?? ''} onChange={event => setDraft(previous => ({ ...previous, [field]: event.target.value === '' ? undefined : Number(event.target.value) }))} />
                : field === 'name' ? <Input id={`onboard-${field}`} autoComplete="given-name" value={draft.name ?? ''} onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} />
                : <Textarea id={`onboard-${field}`} value={draft[field] ?? ''} onChange={event => setDraft(previous => ({ ...previous, [field]: event.target.value }))} rows={3} />}
            </div>;
          })}
          {error && <p role="alert" className="text-destructive">{error}</p>}
          <footer>{step > 0 && <Button type="button" variant="outline" disabled={saving} onClick={() => { setError(''); setStep(value => value - 1); }}><ArrowLeft className="rtl:rotate-180" />{ar ? 'السابق' : 'Back'}</Button>}<Button type="submit" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : step === steps.length - 1 ? (ar ? 'احفظ وابدأ' : 'Save & get started') : (ar ? 'متابعة' : 'Continue')}<ArrowRight className="rtl:rotate-180" /></Button></footer>
        </form>
      </motion.div></AnimatePresence>
    </section></div>
  </main>;
}
