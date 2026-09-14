import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { profileSchema, saveProfileForUser, type UserProfile } from '@/lib/profile';

const fields = [
  ['name','Name','الاسم'],['age','Age (years)','العمر (سنة)'],['weight','Weight (kg)','الوزن (كغ)'],['height','Height (cm)','الطول (سم)'],
  ['gender','Gender','الجنس',['male','female']],['goal','Goal','الهدف',['bulking','cutting','fitness']],
  ['fitnessLevel','Experience','المستوى',['beginner','intermediate','advanced']],['trainingDaysPerWeek','Days per week','أيام التدريب أسبوعياً'],
  ['location','Training location','مكان التدريب',['home','gym']],['activityLevel','Activity level','النشاط',['low','moderate','high']],
  ['equipment','Equipment (optional)','المعدات (اختياري)'],['injuries','Injuries (optional)','الإصابات (اختياري)'],
  ['dietaryPreferences','Dietary preferences (optional)','التفضيلات الغذائية (اختياري)'],['chronicConditions','Conditions (optional)','الحالات الصحية (اختياري)'],['allergies','Allergies (optional)','الحساسية (اختياري)'],
] as const;
export function ProfileEditor({ profile, userId, onSaved, onClose }: { profile: UserProfile; userId: string; onSaved: (profile: UserProfile) => void; onClose: () => void }) {
  const { language, t } = useLanguage(); const ar = language === 'ar';
  const [draft, setDraft] = useState(profile); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving) return;
    const result = profileSchema.safeParse(draft);
    if (!result.success) { setError(ar ? 'راجع الحقول المطلوبة والقيم الرقمية.' : 'Please check required fields and measurement ranges.'); return; }
    setSaving(true); setError('');
    try { onSaved(await saveProfileForUser(userId, result.data)); onClose(); }
    catch { setError(ar ? 'تعذر حفظ التغييرات. بياناتك هنا، حاول مجدداً.' : 'Changes could not be saved. Your edits are still here—please retry.'); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl" dir={ar ? 'rtl' : 'ltr'}><DialogHeader><DialogTitle>{ar ? 'تعديل ملفك' : 'Make it yours'}</DialogTitle><DialogDescription>{ar ? 'معلوماتك تساعد مدربك على تخصيص تجربتك.' : 'Your details help your coach personalize your experience.'}</DialogDescription></DialogHeader><form onSubmit={save} className="profile-edit-form">
    {fields.map(field => { const [key,en,arabic] = field; const options = field.length === 4 ? field[3] : undefined; const numeric = ['age','weight','height','trainingDaysPerWeek'].includes(key);
      return <label key={key}>{ar ? arabic : en}{options ? <select value={String(draft[key])} onChange={e => setDraft(value => ({ ...value, [key]: e.target.value }))}>{options.map(option => <option key={option} value={option}>{t(`onboarding.${key === 'activityLevel' ? 'activity.' : ''}${option}`)}</option>)}</select> : <input required={numeric || key === 'name'} type={numeric ? 'number' : 'text'} step={key === 'weight' || key === 'height' ? '0.1' : '1'} value={draft[key]} onChange={e => setDraft(value => ({ ...value, [key]: numeric ? (e.target.value === '' ? Number.NaN : Number(e.target.value)) : e.target.value }))} />}</label>;
    })}
    {error && <p role="alert" className="text-destructive col-span-full">{error}</p>}<footer><Button type="button" variant="outline" onClick={onClose} disabled={saving}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button type="submit" disabled={saving}>{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : (ar ? 'حفظ التغييرات' : 'Save changes')}</Button></footer>
  </form></DialogContent></Dialog>;
}
