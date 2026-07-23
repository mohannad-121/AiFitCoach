import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Compass, Dumbbell, Home } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';

const NotFound = () => {
  const location = useLocation();
  const { language, t } = useLanguage();

  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route:', location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <Navbar />
      <main className="flex min-h-screen items-center justify-center px-4 pt-20">
        <motion.section
          initial={{ opacity: 0, y: 24, rotateX: 4 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ duration: 0.55 }}
          className="not-found-panel glass-card"
        >
          <div className="not-found-icon"><Compass /></div>
          <span>{t('notFound.eyebrow')}</span>
          <h1>404</h1>
          <h2>{t('notFound.title')}</h2>
          <p>{t('notFound.description')}</p>
          <div className="not-found-actions">
            <Link to="/" className={cn(buttonVariants({ variant: 'default' }))}><Home />{t('notFound.home')}</Link>
            <Link to="/workouts" className={cn(buttonVariants({ variant: 'outline' }))}><Dumbbell />{t('notFound.workouts')}{language === 'ar' ? <ArrowLeft /> : <ArrowRight />}</Link>
          </div>
        </motion.section>
      </main>
    </div>
  );
};

export default NotFound;
