import { CheckCircle2, ChevronDown, Leaf, Dumbbell } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
export interface PlannerDay { date: string; label: string; today: boolean; items: string[]; completed: number; activity: boolean; muscles: string[] }
export function WeeklyPlanner({ days, selected, onSelect, onOpen }: { days: PlannerDay[]; selected: number; onSelect: (index: number) => void; onOpen: () => void }) {
  const { language } = useLanguage(); const ar = language === 'ar';
  return <div className="weekly-planner">{days.map((day,index) => {
    const expanded = index === selected; const active = day.items.length > 0;
    const complete = active && day.completed >= day.items.length;
    return <article key={day.date} className={`planner-day ${day.today ? 'is-today' : ''} ${active ? 'is-training' : 'is-recovery'}`}>
      <button className="planner-day-summary" aria-expanded={expanded} aria-controls={`planner-${day.date}`} onClick={() => onSelect(expanded ? -1 : index)}>
        <span className="planner-day-icon">{complete ? <CheckCircle2 /> : active ? <Dumbbell /> : <Leaf />}</span>
        <span className="planner-day-date"><strong>{day.label}</strong><small>{day.date}{day.today && <> · {ar ? 'اليوم' : 'Today'}</>}</small></span>
        <span className="planner-day-info"><strong>{active ? (ar ? `${day.items.length} عناصر مخططة` : `${day.items.length} planned items`) : (ar ? 'مساحة للتعافي' : 'Room to recover')}</strong><small>{day.muscles.join(' · ') || (active ? (ar ? 'خطتك الشخصية' : 'Your personal plan') : (ar ? 'لا يوجد تدريب مجدول' : 'No training scheduled'))}</small></span>
        <span className="planner-day-status">{complete ? (ar ? 'مكتمل' : 'Complete') : active ? `${day.completed}/${day.items.length}` : day.activity ? (ar ? 'نشاط مسجل' : 'Activity logged') : (ar ? 'راحة' : 'Rest')}<ChevronDown size={17} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} /></span>
      </button>
      {expanded && <div className="planner-day-detail" id={`planner-${day.date}`}>
        {active ? <><progress max={day.items.length} value={day.completed} aria-label={ar ? 'تقدم اليوم' : 'Day progress'} /><ol>{day.items.map((item,itemIndex) => <li key={`${itemIndex}-${item}`}>{item}</li>)}</ol></> : <p>{ar ? 'يوم هادئ. أضف ملاحظاتك أو راجع خطة الأسبوع.' : 'A little breathing room. Add a note or review your weekly plan.'}</p>}
        <button className="planner-open" onClick={onOpen}>{ar ? 'فتح تفاصيل اليوم والملاحظات' : 'Open day details & notes'}</button>
      </div>}
    </article>;
  })}</div>;
}
