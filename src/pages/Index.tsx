import { useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Apple,
  ArrowDown,
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
  { icon: Sparkles, step: '03', title: 'Smart Plan', copy: 'Training built for you' },
  { icon: Activity, step: '04', title: 'Progress Tracking', copy: 'Every session improves the next' },
];

const particles = Array.from({ length: 18 }, (_, index) => ({
  id: index,
  x: `${8 + ((index * 23) % 86)}%`,
  y: `${12 + ((index * 37) % 76)}%`,
  delay: `${(index % 6) * 0.55}s`,
  duration: `${5 + (index % 5)}s`,
}));

const Index = () => {
  const { t } = useLanguage();
  const { isOnboarded } = useUser();
  const { user } = useAuth();
  const heroRef = useRef<HTMLElement>(null);
  const frameRef = useRef<number | null>(null);

  const primaryDestination = user ? (isOnboarded ? '/workouts' : '/onboarding') : '/auth?force=1';
  const workoutDestination = user ? '/workouts' : '/auth?force=1';
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

          <div className="home-hologram home-hologram-left" aria-hidden="true">
            <span /><span /><span />
          </div>
          <motion.div
            className="home-float-object home-float-dumbbell"
            initial={{ opacity: 0, x: -30, rotate: -10 }}
            animate={{ opacity: 1, x: 0, rotate: -5 }}
            transition={{ delay: 0.7, duration: 0.8 }}
            aria-hidden="true"
          >
            <Dumbbell />
            <span>STRENGTH</span>
          </motion.div>
          <motion.div
            className="home-float-object home-float-chip"
            initial={{ opacity: 0, x: 30, rotate: 10 }}
            animate={{ opacity: 1, x: 0, rotate: 4 }}
            transition={{ delay: 0.85, duration: 0.8 }}
            aria-hidden="true"
          >
            <Cpu />
            <span>AI ACTIVE</span>
          </motion.div>
          <motion.div
            className="home-heartline"
            initial={{ opacity: 0, scaleX: 0.4 }}
            animate={{ opacity: 1, scaleX: 1 }}
            transition={{ delay: 1, duration: 0.9 }}
            aria-hidden="true"
          >
            <HeartPulse />
            <svg viewBox="0 0 180 42" role="presentation">
              <polyline points="0,23 34,23 43,9 54,35 66,17 76,23 106,23 116,12 126,30 136,23 180,23" />
            </svg>
            <strong>128</strong><small>BPM</small>
          </motion.div>

          <div className="home-hero-content">
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.12, delayChildren: 0.12 } } }}
            >
              <motion.div variants={reveal} transition={{ duration: 0.65 }} className="home-eyebrow">
                <ScanLine /> AI TRAINING, BUILT AROUND YOU
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
                  <span>{t('hero.cta')}</span><ArrowRight />
                </Link>
                <Link to={workoutDestination} className={cn(buttonVariants({ variant: 'glass', size: 'xl' }), 'home-cta home-cta-secondary')}>
                  <Dumbbell /><span>{t('hero.secondary')}</span>
                </Link>
              </motion.div>
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
                  transition={{ delay: index * 0.1, duration: 0.55 }}
                  whileHover={{ y: -8, rotateX: 2, rotateY: index === 1 ? 0 : index === 0 ? -2 : 2 }}
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
                  transition={{ delay: index * 0.12, duration: 0.45 }}
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
              transition={{ duration: 0.7 }}
            >
              <div className="home-dashboard-header">
                <div><span>FITCOACH / TODAY</span><strong>Performance overview</strong></div>
                <span className="home-live-status"><i />LIVE SYNC</span>
              </div>
              <div className="home-dashboard-grid">
                <DashboardMetric icon={Flame} label="Calories" value="684" unit="kcal" accent="cyan" />
                <DashboardMetric icon={HeartPulse} label="Heart Rate" value="128" unit="bpm" accent="pink" pulse />
                <div className="home-dash-panel home-progress-panel">
                  <div className="home-dash-label"><Activity /> Workout progress <strong>78%</strong></div>
                  <div className="home-progress-track"><motion.span initial={{ width: 0 }} whileInView={{ width: '78%' }} viewport={{ once: true }} transition={{ duration: 1.1, delay: 0.2 }} /></div>
                  <div className="home-progress-meta"><span>4 exercises complete</span><span>1 remaining</span></div>
                </div>
                <div className="home-dash-panel home-week-panel">
                  <div className="home-dash-label"><CalendarCheck /> Weekly goal <strong>4 / 5</strong></div>
                  <div className="home-week-bars">
                    {[82, 68, 94, 52, 78, 28, 18].map((height, index) => (
                      <span key={index} className={index < 5 ? 'is-active' : ''}><i style={{ height: `${height}%` }} /></span>
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
  value: string;
  unit: string;
  accent: 'cyan' | 'pink';
  pulse?: boolean;
}) {
  return (
    <div className={`home-dash-panel home-metric-panel home-accent-${accent}`}>
      <div className="home-dash-label"><Icon /> {label}</div>
      <strong>{value}<small>{unit}</small></strong>
      {pulse && <div className="home-mini-heartline"><i /><i /><i /><i /><i /><i /></div>}
    </div>
  );
}

export default Index;
