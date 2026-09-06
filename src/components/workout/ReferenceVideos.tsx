import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUser } from '@/contexts/UserContext';

interface Source { muscle: string; target: string; gender: string; location: string; level: string; }
interface Reference { id: string; url: string; sources: Source[]; }
let catalogPromise: Promise<Reference[]> | undefined;

export function ReferenceVideos({ muscle, gender, location }: { muscle: string; gender?: string; location?: string }) {
  const { language } = useLanguage();
  const { profile } = useUser();
  const ar = language === 'ar';
  const [open, setOpen] = useState(false);
  const [videos, setVideos] = useState<Reference[]>([]);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (!catalogPromise) catalogPromise = fetch('/exercise-references/catalog.json').then(response => {
      if (!response.ok) throw new Error('References unavailable');
      return response.json();
    }).then(data => data.videos);
    catalogPromise.then(data => { if (!cancelled) setVideos(data); }).catch(() => {
      catalogPromise = undefined;
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, [open]);
  const matching = useMemo(() => videos.filter(video => video.sources.some(source =>
    source.muscle === muscle && (gender === 'all' || (gender ? source.gender === gender : !profile?.gender || source.gender === profile.gender))
    && (!location || location === 'all' ? true : source.location === location || source.location === 'both')
  )), [videos, muscle, gender, location, profile?.gender]);
  const active = matching[selected] ?? matching[0];
  return <details className="training-references" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{ar ? 'شاهد فيديوهات العضلة' : 'Watch muscle references'}</summary>
    {open && <div>
      <p>{ar ? 'مراجع للعضلة المختارة؛ قد تعرض حركات مختلفة عن تمرينك الحالي.' : 'References for this muscle; movements may differ from the selected exercise.'}</p>
      {active ? <>
        <video key={active.id} src={active.url} controls playsInline preload="metadata" aria-label={ar ? 'مرجع حركة للعضلة' : 'Muscle movement reference'} />
        <div className="reference-controls"><button disabled={selected <= 0} onClick={() => setSelected(value => Math.max(0, value - 1))}>{ar ? 'السابق' : 'Previous'}</button><span>{Math.min(selected + 1, matching.length)} / {matching.length}</span><button disabled={selected >= matching.length - 1} onClick={() => setSelected(value => value + 1)}>{ar ? 'التالي' : 'Next'}</button></div>
      </> : <p>{failed ? (ar ? 'تعذر تحميل المراجع.' : 'References could not load.') : videos.length ? (ar ? 'لا توجد مراجع لهذا الاختيار.' : 'No references for these filters.') : (ar ? 'تحميل المراجع…' : 'Loading references…')}</p>}
    </div>}
  </details>;
}
