import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Home, Dumbbell, MessageCircle, User, Globe, Calendar, LogOut, LogIn, Shield, BellRing, Moon, Sun, ScanLine, Menu, Crown } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/contexts/ThemeContext';
import { buttonVariants, Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

export function Navbar() {
  const { t, language, setLanguage } = useLanguage();
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  const navItems = [
    { path: '/', icon: Home, label: t('nav.home') },
    { path: '/workouts', icon: Dumbbell, label: t('nav.workouts') },
    { path: '/live-coach', icon: ScanLine, label: language === 'ar' ? 'مباشر' : 'Live Coach' },
    { path: '/coach', icon: MessageCircle, label: t('nav.coach') },
    { path: '/schedule', icon: Calendar, label: language === 'ar' ? 'الجدول' : 'Schedule' },
    { path: '/coach-notifications', icon: BellRing, label: language === 'ar' ? 'إشعارات المدرب' : 'Coach Notes' },
    { path: '/profile', icon: User, label: t('nav.profile') },
    { path: '/subscription', icon: Crown, label: language === 'ar' ? 'الاشتراك' : 'Subscription' },
  ];

  const mobileNavItems = navItems.filter((item) => ['/', '/workouts', '/live-coach', '/coach', '/schedule'].includes(item.path));
  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'ar' : 'en');
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-[9999] pointer-events-auto glass-card border-b border-border/50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center">
              <Dumbbell className="w-6 h-6 text-primary-foreground" />
            </div>
            <span className="font-display text-2xl tracking-wide text-foreground">
              FITCOACH
            </span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden xl:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    buttonVariants({ variant: isActive ? 'default' : 'ghost' }),
                    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <item.icon className="w-4 h-4 mr-2" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Right section */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleTheme}
              className="border-border/50 text-muted-foreground hover:text-foreground"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={toggleLanguage}
              className="border-border/50 text-muted-foreground hover:text-foreground"
            >
              <Globe className="w-4 h-4 mr-1" />
              {language === 'en' ? 'عربي' : 'EN'}
            </Button>

            <Link
              to="/admin"
              className={cn(
                buttonVariants({ variant: location.pathname === '/admin' ? 'default' : 'outline', size: 'sm' }),
                'hidden xl:inline-flex',
                location.pathname === '/admin'
                  ? 'bg-primary text-primary-foreground'
                  : 'border-border/50 text-muted-foreground hover:text-foreground'
              )}
            >
              <Shield className="w-4 h-4 md:mr-1" />
              <span className="hidden md:inline">{language === 'ar' ? 'الإدارة' : 'Admin'}</span>
            </Link>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="xl:hidden border-border/50" aria-label="Open app menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side={language === 'ar' ? 'left' : 'right'} className="mobile-app-menu border-border/60 bg-background/95 pt-14 backdrop-blur-xl">
                <SheetHeader className="text-start">
                  <SheetTitle>{language === 'ar' ? 'القائمة' : 'More'}</SheetTitle>
                </SheetHeader>
                <div className="mt-6 grid gap-2">
                  {navItems.map((item) => (
                    <SheetClose asChild key={item.path}>
                      <Link to={item.path} className={cn(buttonVariants({ variant: location.pathname === item.path ? 'default' : 'ghost' }), 'h-12 justify-start gap-3')}>
                        <item.icon className="h-5 w-5" />
                        {item.label}
                      </Link>
                    </SheetClose>
                  ))}
                  <SheetClose asChild>
                    <Link to="/admin" className={cn(buttonVariants({ variant: location.pathname === '/admin' ? 'default' : 'ghost' }), 'h-12 justify-start gap-3')}>
                      <Shield className="h-5 w-5" />
                      {language === 'ar' ? 'الإدارة' : 'Admin'}
                    </Link>
                  </SheetClose>
                  {user ? (
                    <SheetClose asChild>
                      <Button variant="ghost" onClick={signOut} className="h-12 justify-start gap-3">
                        <LogOut className="h-5 w-5" />
                        {language === 'ar' ? 'خروج' : 'Logout'}
                      </Button>
                    </SheetClose>
                  ) : (
                    <SheetClose asChild>
                      <Link to="/auth?force=1" className={cn(buttonVariants({ variant: 'ghost' }), 'h-12 justify-start gap-3')}>
                        <LogIn className="h-5 w-5" />
                        {language === 'ar' ? 'دخول' : 'Login'}
                      </Link>
                    </SheetClose>
                  )}
                </div>
              </SheetContent>
            </Sheet>

            {user ? (
              <Button variant="ghost" size="sm" onClick={signOut} className="hidden xl:flex text-muted-foreground hover:text-foreground">
                <LogOut className="w-4 h-4 mr-1" />
                {language === 'ar' ? 'خروج' : 'Logout'}
              </Button>
            ) : (
              <Link
                to="/auth?force=1"
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'hidden xl:flex text-muted-foreground hover:text-foreground'
                )}
              >
                <LogIn className="w-4 h-4 mr-1" />
                {language === 'ar' ? 'دخول' : 'Login'}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 glass-card border-t border-border/50 px-2 py-1.5">
        <div className="flex justify-around overflow-x-auto">
          {mobileNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'mobile-nav-item flex min-w-0 flex-1 flex-col items-center gap-1 h-auto py-1.5 px-1',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-[10px] leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
