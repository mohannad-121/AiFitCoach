import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Apple,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  CalendarCheck,
  Cpu,
  Dumbbell,
  Flame,
  HeartPulse,
  ScanLine,
  Sparkles,
  Target,
  UserRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Navbar } from '@/components/layout/Navbar';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUser } from '@/contexts/UserContext';
import { useAuth } from '@/hooks/useAuth';
import heroBg from '@/assets/hero-bg.jpg';
import './Index.css';

const reveal = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 },
};

const coachingFeatures = [
  {
    icon: Target,
    accent: 'cyan',
    title: 'Personalized Workout Plans',
    description: 'Adaptive training built around your goals, experience, equipment, and weekly rhythm.',
    metric: 'ADAPTIVE PROGRAMMING',
  },
  {
    icon: Apple,
    accent: 'pink',
    title: 'Nutrition Guidance',
    description: 'Practical calorie and macro guidance shaped by your preferences and training load.',
    metric: 'DAILY FUEL STRATEGY',
  },
  {
    icon: BrainCircuit,
    accent: 'purple',
    title: 'Real-time AI Coach',
    description: 'Live form analysis and immediate coaching cues while you train, without recording video.',
    metric: 'LIVE POSE INTELLIGENCE',
  },
];

const workflow = [
  { icon: UserRound, step: '01', title: 'Profile Data', copy: 'Goals, ability, schedule' },
  { icon: Cpu, step: '02', title: 'AI Analysis', copy: 'Context becomes insight' },
  { icon: Sparkles, step: '03', title: 'Smart Plan Generation', copy: 'Training built for you' },
  { icon: Activity, step: '04', title: 'Progress Optimization', copy: 'Every session improves the next' },
];

const particles = Array.from({ length: 10 }, (_, index) => ({
  id: index,
  x: `${8 + ((index * 23) % 86)}%`,
  y: `${12 + ((index * 37) % 76)}%`,
  delay: `${(index % 6) * 0.55}s`,
  duration: `${5 + (index % 5)}s`,
}));

const Index = () => {
  const { t, language } = useLanguage();
  const { isOnboarded } = useUser();
  const { user } = useAuth();
  const heroRef = useRef<HTMLElement>(null);
  const frameRef = useRef<number | null>(null);

  const primaryDestination = user ? (isOnboarded ? '/workouts' : '/onboarding') : '/auth?force=1';
  const heroTitle = t('hero.title');
  const heroTitleWords = heroTitle.trim().split(/\s+/);
  const heroTitleBreak = Math.max(1, heroTitleWords.length - 1);

  const updateParallax = (clientX: number, clientY: number) => {
    if (!heroRef.current) return;
    const bounds = heroRef.current.getBoundingClientRect();
    const x = ((clientX - bounds.left) / bounds.width - 0.5) * 2;
    const y = ((clientY - bounds.top) / bounds.height - 0.5) * 2;
    heroRef.current.style.setProperty('--pointer-x', x.toFixed(3));
    heroRef.current.style.setProperty('--pointer-y', y.toFixed(3));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => updateParallax(event.clientX, event.clientY));
  };

  return (
    <div className="fitcoach-home min-h-screen bg-[#050510] text-white">
      <Navbar />

      <main>
        <section ref={heroRef} className="home-hero" onPointerMove={handlePointerMove} aria-labelledby="home-hero-title">
          <div className="home-hero-media" aria-hidden="true">
            <img src={heroBg} alt="" />
            <div className="home-hero-overlay" />
            <div className="home-beam home-beam-cyan" />
            <div className="home-beam home-beam-pink" />
            <div className="home-beam home-beam-purple" />
          </div>

          <div className="home-particles" aria-hidden="true">
            {particles.map((particle) => (
              <span
                key={particle.id}
                style={{ left: particle.x, top: particle.y, animationDelay: particle.delay, animationDuration: particle.duration }}
              />
            ))}
          </div>

          <div className="home-hero-shell">
            <div className="home-hero-content">
              <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.09, delayChildren: 0.08 } } }}
              >
              <motion.div variants={reveal} transition={{ duration: 0.65 }} className="home-eyebrow">
                <ScanLine /> {t('hero.eyebrow')}
              </motion.div>
              <motion.h1 variants={reveal} transition={{ duration: 0.7 }} id="home-hero-title">
                <span className="home-title-desktop">{heroTitle}</span>
                <span className="home-title-mobile">
                  <span>{heroTitleWords.slice(0, heroTitleBreak).join(' ')}</span>
                  <span>{heroTitleWords.slice(heroTitleBreak).join(' ')}</span>
                </span>
              </motion.h1>
              <motion.p variants={reveal} transition={{ duration: 0.7 }} className="home-hero-copy">
                {t('hero.subtitle')}
              </motion.p>
              <motion.div variants={reveal} transition={{ duration: 0.7 }} className="home-hero-actions">
                <Link to={primaryDestination} className={cn(buttonVariants({ variant: 'hero', size: 'xl' }), 'home-cta home-cta-primary')}>
                  <span>{t('hero.cta')}</span>{language === 'ar' ? <ArrowLeft /> : <ArrowRight />}
                </Link>
                <a href="#ai-coaching" className={cn(buttonVariants({ variant: 'glass', size: 'xl' }), 'home-cta home-cta-secondary')}>
                  <Sparkles /><span>{t('hero.secondary')}</span>
                </a>
              </motion.div>
              </motion.div>
            </div>

            <motion.div
              className="home-ai-visual"
              initial={{ opacity: 0, x: 50, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={{ delay: 0.45, duration: 0.9, ease: 'easeOut' }}
              aria-label="FitCoach AI live intelligence preview"
            >
              <div className="home-ai-rings" aria-hidden="true"><i /><i /><i /></div>
              <div className="home-ai-core">
                <div className="home-ai-core-glow" />
                <BrainCircuit />
                <span>FITCOACH AI</span>
                <strong>ONLINE</strong>
              </div>
              <div className="home-ai-card home-ai-card-score">
                <span>FORM SCORE</span><strong>96<small>%</small></strong>
                <i><b /></i>
              </div>
              <div className="home-ai-card home-ai-card-plan">
                <Sparkles /><div><span>NEXT SET</span><strong>12 REPS</strong></div>
              </div>
              <div className="home-ai-orbit-dot" aria-hidden="true" />
            </motion.div>
          </div>

          <a href="#ai-coaching" className="home-scroll-cue" aria-label="Scroll to AI powered coaching">
            <span>EXPLORE</span><ArrowDown />
          </a>
        </section>

        <section id="ai-coaching" className="home-section home-coaching-section">
          <div className="home-section-inner">
            <SectionHeading eyebrow="INTELLIGENCE IN MOTION" title="AI POWERED COACHING" copy="Three connected systems. One training experience that adapts as you improve." />
            <div className="home-feature-grid">
              {coachingFeatures.map((feature, index) => (
                <motion.article
                  key={feature.title}
                  className={`home-feature-card home-accent-${feature.accent}`}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.25 }}
                  transition={{ delay: index * 0.08, duration: 0.5 }}
                  whileHover={{ y: -5, rotateX: 0.8, rotateY: index === 1 ? 0 : index === 0 ? -0.8 : 0.8 }}
                >
                  <div className="home-feature-icon"><feature.icon /></div>
                  <span className="home-feature-index">0{index + 1}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                  <div className="home-feature-metric"><span />{feature.metric}</div>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section home-workflow-section">
          <div className="home-section-inner">
            <SectionHeading eyebrow="FROM SIGNAL TO STRATEGY" title="HOW FITCOACH AI WORKS" copy="Your data becomes a plan, and every completed session makes the system more useful." />
            <div className="home-workflow">
              <div className="home-workflow-line" aria-hidden="true"><span /></div>
              {workflow.map((item, index) => (
                <motion.div
                  key={item.step}
                  className="home-workflow-step"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ delay: index * 0.09, duration: 0.42 }}
                >
                  <div className="home-workflow-node"><item.icon /></div>
                  <span>{item.step}</span>
                  <h3>{item.title}</h3>
                  <p>{item.copy}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section home-dashboard-section">
          <div className="home-section-inner home-dashboard-layout">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6 }}
            >
              <SectionHeading eyebrow="PROGRESS, MADE VISIBLE" title="LIVE FITNESS DASHBOARD" copy="A clear view of today, this week, and the next decision your training demands." align="left" />
              <Link to={user ? '/profile' : '/auth?force=1'} className="home-inline-link">
                Open your progress <ArrowRight />
              </Link>
            </motion.div>

            <motion.div
              className="home-dashboard"
              initial={{ opacity: 0, y: 30, rotateX: 5 }}
              whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.6 }}
            >
              <div className="home-dashboard-header">
                <div><span>FITCOACH / TODAY</span><strong>Performance overview</strong></div>
                <span className="home-live-status"><i />LIVE SYNC</span>
              </div>
              <div className="home-dashboard-grid">
                <DashboardMetric icon={Flame} label="Calories" value={684} unit="kcal" accent="cyan" />
                <DashboardMetric icon={HeartPulse} label="Heart Rate" value={128} unit="bpm" accent="pink" pulse />
                <div className="home-dash-panel home-progress-panel">
                  <div className="home-dash-label"><Activity /> Workout progress <strong>78%</strong></div>
                  <div className="home-progress-track"><motion.span initial={{ width: 0 }} whileInView={{ width: '78%' }} viewport={{ once: true }} transition={{ duration: 1.1, delay: 0.2 }} /></div>
                  <div className="home-progress-meta"><span>4 exercises complete</span><span>1 remaining</span></div>
                </div>
                <div className="home-dash-panel home-week-panel">
                  <div className="home-dash-label"><CalendarCheck /> Weekly goal <strong>4 / 5</strong></div>
                  <div className="home-week-bars">
                    {[82, 68, 94, 52, 78, 28, 18].map((height, index) => (
                      <span key={index} className={index < 5 ? 'is-active' : ''}>
                        <motion.i
                          initial={{ height: 0 }}
                          whileInView={{ height: `${height}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.75, delay: 0.08 * index, ease: 'easeOut' }}
                        />
                      </span>
                    ))}
                  </div>
                  <div className="home-week-days"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        <section className="home-final-cta">
          <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <span>YOUR NEXT SESSION STARTS HERE</span>
            <h2>TRAIN SMARTER. MOVE BETTER.</h2>
            <Link to={primaryDestination} className={cn(buttonVariants({ variant: 'hero', size: 'xl' }), 'home-cta home-cta-primary')}>
              Get Started Free <ArrowRight />
            </Link>
          </motion.div>
        </section>
      </main>

      <footer className="home-footer">
        <div><Dumbbell /><strong>FITCOACH</strong></div>
        <p>© 2026 FitCoach. All rights reserved.</p>
      </footer>
    </div>
  );
};

function SectionHeading({ eyebrow, title, copy, align = 'center' }: { eyebrow: string; title: string; copy: string; align?: 'left' | 'center' }) {
  return (
    <motion.header
      className={cn('home-section-heading', align === 'left' && 'is-left')}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.55 }}
    >
      <span>{eyebrow}</span><h2>{title}</h2><p>{copy}</p>
    </motion.header>
  );
}

function DashboardMetric({ icon: Icon, label, value, unit, accent, pulse = false }: {
  icon: typeof Flame;
  label: string;
  value: number;
  unit: string;
  accent: 'cyan' | 'pink';
  pulse?: boolean;
}) {
  return (
    <div className={`home-dash-panel home-metric-panel home-accent-${accent}`}>
      <div className="home-dash-label"><Icon /> {label}</div>
      <strong><AnimatedNumber value={value} /><small>{unit}</small></strong>
      {pulse && <div className="home-mini-heartline"><i /><i /><i /><i /><i /><i /></div>}
    </div>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    let started = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started) return;
      started = true;
      const began = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - began) / 1100, 1);
        setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      observer.disconnect();
    }, { threshold: 0.5 });
    observer.observe(node);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [value]);

  return <span ref={ref}>{display}</span>;
}

export default Index;
