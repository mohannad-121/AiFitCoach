import { lazy, Suspense, useState } from 'react';
import { MotionConfig, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, Dumbbell, Instagram, Linkedin, LockKeyhole, MessageCircle, ScanLine, Youtube } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUser } from '@/contexts/UserContext';
import { useAuth } from '@/hooks/useAuth';
import { getExercisesByFilters } from '@/data/exercises';
import { muscleGroups, muscleLabel } from '@/lib/trainingCatalog';
import './Index.css';
import './TrainingFlow.css';
import './HomeEditorial.css';

const Anatomy = lazy(() => import('@/components/workout/AnatomyBody').then(module => ({ default: module.AnatomyBody })));
const chapters = ['plan','move','repeat'] as const;
const targets = ['chest','shoulders','biceps','abs','quads'] as const;
export default function Index() {
  const { language } = useLanguage();
  const { profile, isOnboarded } = useUser();
  const { user } = useAuth();
  const reduced = useReducedMotion();
  const ar = language === 'ar';
  const [target, setTarget] = useState('chest');
  const [chapter, setChapter] = useState<typeof chapters[number]>('plan');
  const [demoDay,setDemoDay] = useState(0);
  const Arrow = ar ? ArrowLeft : ArrowRight;
  const selected = getExercisesByFilters([target],null,profile?.location ?? null,profile?.gender ?? null);
  const names = Object.fromEntries(Object.keys(muscleGroups).map(key => ['muscle.'+key,muscleLabel(key,language)]));
  const start = user ? isOnboarded ? '/schedule' : '/onboarding' : '/auth?force=1';
  const workoutLink = '/workouts?muscles='+encodeURIComponent(target);
  const content = {
    plan:{number:'01',label:ar?'اختر هدفك':'Find your focus',title:ar?'عضلة محددة.\nبداية واضحة.':'A clear target.\nA better start.',description:ar?'اختر العضلة، وشاهد تمارين تناسب مكانك وملفك.':'Choose your muscle. Find movements for your space and your profile.',action:ar?'استكشف التمارين':'Explore workouts',route:workoutLink},
    move:{number:'02',label:ar?'اضبط حركتك':'Make your move',title:ar?'تدرّب.\nواسمع الملاحظة.':'Make the move.\nGet the cue.',description:ar?'ملاحظات على المفاصل الظاهرة، أثناء الحركات المدعومة. الفيديو لا يُسجَّل.':'Visible-joint feedback during supported movements. Your workout video is not recorded.',action:ar?'افتح الكاميرا':'Open live coach',route:'/live-coach?exerciseId=squats'},
    repeat:{number:'03',label:ar?'كمّل يومك':'Keep it going',title:ar?'يومك مرتب.\nخطوتك معروفة.':'Know your day.\nOwn your progress.',description:ar?'عضلات اليوم، تمارينك، وإنجازك. كلّها في مكان واحد.':'Today’s muscles, your exercises, and your progress. All in one place.',action:ar?'افتح جدولي':'Open my schedule',route:'/schedule'}
  };
  const active=content[chapter];
  return <MotionConfig reducedMotion="user"><div className="fitcoach-home home-product home-editorial">
    <a className="home-skip-link" href="#home-main">{ar?'انتقل إلى المحتوى':'Skip to content'}</a>
    <Navbar variant="home" />
    <main id="home-main">
      <section className="editorial-hero" aria-labelledby="hero-title">
        <div className="editorial-hero-copy">
          <motion.p initial={{opacity:0}} animate={{opacity:1}} className="editorial-eyebrow"><span />{ar?'تدريب شخصي. بذكاء.':'PERSONAL TRAINING. INTELLIGENTLY.'}</motion.p>
          <motion.h1 id="hero-title" initial={{opacity:0,y:reduced?0:24}} animate={{opacity:1,y:0}} transition={{duration:.65}}>{ar?<><span>جسمك.</span><span>هدفك.</span><em>على طريقتك.</em></>:<><span>YOUR BODY.</span><span>YOUR GOALS.</span><em>YOUR WAY.</em></>}</motion.h1>
          <p className="editorial-intro">{ar?'من أول حركة، إلى عادتك القادمة. تدريب يبدأ منك ويرافقك.':'From your first move to your next milestone. Training that starts with you.'}</p>
          <div className="editorial-actions"><Link className="editorial-primary" to={start}>{ar?'ابدأ رحلتك':'Find your next move'}<Arrow size={20}/></Link><a className="editorial-tour" href="#experience">{ar?'اكتشف التجربة':'See how it works'}<ArrowDown size={16}/></a></div>
          <div className="editorial-hero-meta"><span>01 — 03</span><p>{ar?'خطط. تحرّك. تقدّم.':'PLAN. MOVE. PROGRESS.'}</p></div>
        </div>
        <div className="editorial-body-scene">
          <span className="editorial-background-word" aria-hidden="true">YOU</span>
          <div className="editorial-body-caption"><span>BODY / FOCUS</span><span>{ar?'خريطة تفاعلية':'INTERACTIVE ANATOMY'}</span></div>
          <Suspense fallback={<div className="editorial-body-loading">{ar?'تجهيز خريطة الجسم…':'Preparing your muscle map…'}</div>}>
            <Anatomy compact highlightGroups genderOverride={profile?.gender} selectedMuscles={[target]} onMuscleToggle={id=>{if(id in muscleGroups)setTarget(id);}} muscleNames={names}/>
          </Suspense>
          <div className="editorial-target-card" aria-live="polite"><span>{ar?'نقطة البداية':'YOUR STARTING POINT'}</span><strong>{muscleLabel(target,language)}</strong><Link to={workoutLink}>{selected.length} {ar?'تمارين في المكتبة':'movements to explore'}<ArrowUpRight size={18}/></Link></div>
          <div className="editorial-targets" aria-label={ar?'اختر عضلة':'Choose a muscle'}>{targets.map(item=><button key={item} onClick={()=>setTarget(item)} aria-pressed={target===item}>{muscleLabel(item,language)}</button>)}</div>
        </div>
      </section>
      <div className="editorial-divider"><span>FITCOACH — {ar?'تجربة واحدة مترابطة':'ONE CONNECTED EXPERIENCE'}</span><a href="#experience">{ar?'اكتشف ما بعد ذلك':'EXPLORE WHAT’S NEXT'}<ArrowDown size={14}/></a></div>
      <section className="editorial-experience" id="experience" aria-labelledby="experience-title">
        <header><span className="editorial-eyebrow">{ar?'كل خطوة، لها معنى':'EVERY STEP HAS A PURPOSE'}</span><h2 id="experience-title">{ar?'أقل حيرة.\nحركة أكثر.':'LESS GUESSWORK.\nMORE MOVEMENT.'}</h2></header>
        <div className="editorial-chapters" role="tablist" aria-label={ar?'مراحل التجربة':'Training journey'}>{chapters.map((id,index)=><button key={id} id={'chapter-'+id} role="tab" aria-selected={chapter===id} aria-controls="chapter-panel" tabIndex={chapter===id?0:-1} onClick={()=>setChapter(id)} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const step=(event.key==='ArrowRight'?1:-1)*(ar?-1:1);const next=event.key==='Home'?0:event.key==='End'?2:(index+step+3)%3;setChapter(chapters[next]);document.getElementById('chapter-'+chapters[next])?.focus();}}}><span>0{index+1}</span>{content[id].label}<ArrowUpRight size={17}/></button>)}</div>
        <div id="chapter-panel" role="tabpanel" aria-labelledby={'chapter-'+chapter} className="editorial-chapter-panel">
          <div className="editorial-chapter-copy"><span className="editorial-chapter-number">{active.number}</span><h3>{active.title}</h3><p>{active.description}</p><Link to={active.route}>{active.action}<Arrow size={20}/></Link></div>
          <motion.div key={chapter} className={'editorial-chapter-visual is-'+chapter} initial={{opacity:0,y:reduced?0:12}} animate={{opacity:1,y:0}} transition={{duration:.28}}>
            {chapter==='plan'&&<><div className="editorial-visual-label"><Dumbbell size={18}/><span>{muscleLabel(target,language)}</span><small>{ar?'من مكتبة التمارين':'FROM THE LIBRARY'}</small></div><div className="editorial-exercise-preview">{selected.slice(0,3).map((item,index)=><Link key={item.id} to={'/workouts?exerciseIds='+item.id}><span>0{index+1}</span><strong>{ar?item.nameAr:item.name}</strong><small>{item.sets} × {item.reps}</small><ArrowUpRight size={18}/></Link>)}</div><p className="editorial-visual-note">{ar?'اختر عضلة في الأعلى لتتغير التمارين هنا.':'Pick a muscle above. The movements here change with it.'}</p></>}
            {chapter==='move'&&<><div className="editorial-visual-label"><ScanLine size={18}/><span>{ar?'توجيه الحركة':'MOVEMENT COACHING'}</span><small>{ar?'طريقة الاستخدام':'HOW IT WORKS'}</small></div><div className="editorial-camera-frame"><ScanLine size={72} strokeWidth={.8}/><strong>{ar?'مساحتك.\nجلستك.':'YOUR SPACE.\nYOUR SESSION.'}</strong><p>{ar?'ضع الكاميرا جانبًا للسكوات، وأظهر جسمك كاملًا.':'For squats, position the camera to the side with your full body visible.'}</p></div><span className="editorial-private"><LockKeyhole size={13}/>{ar?'الكاميرا لا تعمل في هذا العرض':'Camera is off in this preview'}</span></>}
            {chapter==='repeat'&&<><div className="editorial-visual-label"><CalendarDays size={18}/><span>{ar?'إيقاع أسبوعك':'YOUR WEEKLY RHYTHM'}</span><small>{ar?'مثال توضيحي':'ILLUSTRATIVE WEEK'}</small></div><div className="editorial-week">{(ar?['س','ح','ن','ث','ر','خ','ج']:['S','S','M','T','W','T','F']).map((day,index)=><button key={index} aria-label={(ar?'اليوم ':'Day ')+(index+1)} aria-pressed={demoDay===index} onClick={()=>setDemoDay(index)}><span>{day}</span><strong>{index+1}</strong>{index%2===0?<Dumbbell size={15}/>:<span>—</span>}</button>)}</div><div className="editorial-day-summary"><span>{demoDay%2===0?<Dumbbell size={30}/>:<Check size={30}/>}</span><div><strong>{demoDay%2===0?(ar?'يوم تدريب':'Training day'):(ar?'مساحة للتعافي':'Room to recover')}</strong><p>{ar?'جدول حسابك يعرض خطتك الفعلية.':'Your account’s schedule shows your actual plan.'}</p></div></div></>}
          </motion.div>
        </div>
      </section>
      <section className="editorial-finale"><p>{ar?'الخطوة القادمة، لك.':'THE NEXT MOVE IS YOURS.'}</p><h2>{ar?'خلّينا نبدأ.':'LET’S GET\nMOVING.'}</h2><Link to={start} aria-label={ar?'ابدأ التدريب':'Start training'}><Arrow size={38}/></Link><span>{ar?'في البيت أو الجيم. بطريقتك أنت.':'AT HOME. AT THE GYM. ON YOUR TERMS.'}</span></section>
    </main>
    <footer className="editorial-footer"><Link to="/"><Dumbbell size={18}/>FITCOACH<span>AI</span></Link><p>{ar?'تدريب يبدأ منك.':'PERSONAL BY DESIGN.'}</p><div className="editorial-social" aria-label="Social links"><a href="https://www.instagram.com/nextauraai/" target="_blank" rel="noreferrer" aria-label="Instagram"><Instagram /></a><a href="https://www.linkedin.com/company/nextaura-ai" target="_blank" rel="noreferrer" aria-label="LinkedIn"><Linkedin /></a><a href="https://api.whatsapp.com/send/?phone=962799195498&text&type=phone_number&app_absent=0" target="_blank" rel="noreferrer" aria-label="WhatsApp"><MessageCircle /></a><a href="https://www.youtube.com/@NextAuraAI-Solutions" target="_blank" rel="noreferrer" aria-label="YouTube"><Youtube /></a></div><small>© 2026 FITCOACH</small></footer>
  </div></MotionConfig>;
}
