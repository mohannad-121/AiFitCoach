import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Compass, Dumbbell, Home } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NotFound = () => {
  const location = useLocation();

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
          <span>LOST REP</span>
          <h1>404</h1>
          <h2>This route is off the training plan.</h2>
          <p>Return to your dashboard or explore workouts to get back on track.</p>
          <div className="not-found-actions">
            <Link to="/" className={cn(buttonVariants({ variant: 'default' }))}><Home />Home</Link>
            <Link to="/workouts" className={cn(buttonVariants({ variant: 'outline' }))}><Dumbbell />Workouts<ArrowRight /></Link>
          </div>
        </motion.section>
      </main>
    </div>
  );
};

export default NotFound;
