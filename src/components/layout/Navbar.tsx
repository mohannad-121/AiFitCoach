import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  BellRing,
  Calendar,
  ChevronDown,
  Crown,
  Dumbbell,
  Globe,
  Home,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  ScanLine,
  Shield,
  User,
} from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { buttonVariants, Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

type NavbarVariant = 'default' | 'home';

interface NavbarProps {
  variant?: NavbarVariant;
}

const primaryNavPaths = new Set(['/', '/workouts', '/live-coach', '/coach']);
const mobileNavPaths = new Set(['/', '/workouts', '/live-coach', '/coach', '/schedule']);

export function Navbar({ variant = 'default' }: NavbarProps) {
  const { t, language, setLanguage } = useLanguage();
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isArabic = language === 'ar';
  const navItems = [
    { path: '/', icon: Home, label: t('nav.home') },
    { path: '/workouts', icon: Dumbbell, label: t('nav.workouts') },
    { path: '/live-coach', icon: ScanLine, label: t('nav.liveCoach') },
    { path: '/coach', icon: MessageCircle, label: t('nav.coach') },
    { path: '/schedule', icon: Calendar, label: t('nav.schedule') },
    { path: '/coach-notifications', icon: BellRing, label: t('nav.coachNotes') },
    { path: '/profile', icon: User, label: t('nav.profile') },
    { path: '/subscription', icon: Crown, label: t('nav.subscription') },
  ];
  const adminItem = { path: '/admin', icon: Shield, label: t('nav.admin') };

  const desktopNavItems = navItems.filter((item) => primaryNavPaths.has(item.path));
  const moreNavItems = [...navItems.filter((item) => !primaryNavPaths.has(item.path)), adminItem];
  const mobileNavItems = navItems.filter((item) => mobileNavPaths.has(item.path));
  const isMoreActive = moreNavItems.some((item) => item.path === location.pathname);

  const toggleLanguage = () => {
    setLanguage(isArabic ? 'en' : 'ar');
  };

  /* theme toggle owns its accessible label */
  /* const themeLabel = isArabic
    ? theme === 'dark'
      ? 'التبديل إلى الوضع الفاتح'
      : 'التبديل إلى الوضع الداكن'
    : theme === 'dark'
      ? 'Switch to light mode'
      : 'Switch to dark mode'; */
  const languageLabel = isArabic ? 'التبديل إلى الإنجليزية' : 'Switch to Arabic';
  const primaryNavigationLabel = isArabic ? 'التنقل الرئيسي' : 'Primary navigation';
  const quickNavigationLabel = isArabic ? 'التنقل السريع' : 'Quick navigation';

  return (
    <>
      <nav
        aria-label={primaryNavigationLabel}
        data-variant={variant}
        className={cn(
          'site-navbar fixed left-0 right-0 top-0 pointer-events-auto border-b border-border/50 glass-card',
          mobileMenuOpen ? 'z-40' : 'z-[100]',
          variant === 'home' && 'is-home',
        )}
      >
      <div className="container mx-auto px-4">
        <div className="site-navbar-inner flex h-16 items-center justify-between gap-3">
          <Link to="/" className="site-logo flex min-h-11 shrink-0 items-center gap-2" aria-label="FitCoach AI">
            <div className="site-logo-mark flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-primary" aria-hidden="true">
              <Dumbbell className="h-6 w-6 text-primary-foreground" />
            </div>
            <span className="site-logo-word font-display text-2xl tracking-wide text-foreground">
              FITCOACH <small className="font-sans text-[0.55em] font-bold tracking-[0.14em]">AI</small>
            </span>
          </Link>

          <div className="site-nav-links hidden items-center gap-1 xl:flex">
            {desktopNavItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    buttonVariants({ variant: isActive ? 'default' : 'ghost' }),
                    'site-nav-link min-h-11 px-3',
                    isActive ? 'is-active bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant={isMoreActive ? 'default' : 'ghost'}
                  className={cn(
                    'site-nav-link min-h-11 px-3',
                    isMoreActive ? 'is-active bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t('nav.menu')}
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={10}
                collisionPadding={12}
                className="site-nav-more-menu z-[120] min-w-[230px] border-border/60 bg-background/95 p-2 backdrop-blur-xl"
              >
                {moreNavItems.map((item, index) => {
                  const isActive = location.pathname === item.path;
                  const isAdmin = item.path === adminItem.path;
                  return (
                    <React.Fragment key={item.path}>
                      {isAdmin && index > 0 ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem
                        asChild
                        className={cn(
                          'site-nav-more-item min-h-11 cursor-pointer gap-3 rounded-md px-3',
                          isActive && 'is-active bg-primary/10 text-primary',
                        )}
                      >
                        <Link to={item.path} aria-current={isActive ? 'page' : undefined}>
                          <item.icon className="h-4 w-4" />
                          {item.label}
                        </Link>
                      </DropdownMenuItem>
                    </React.Fragment>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="site-nav-actions flex shrink-0 items-center gap-2">
            <ThemeToggle />

            <Button
              type="button"
              variant="outline"
              onClick={toggleLanguage}
              className="site-nav-utility min-h-11 border-border/50 px-3 text-muted-foreground hover:text-foreground"
              aria-label={languageLabel}
              aria-pressed={isArabic}
            >
              <Globe className="h-4 w-4" />
              {isArabic ? 'EN' : 'عربي'}
            </Button>

            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="site-nav-utility min-h-11 min-w-11 border-border/50 xl:hidden"
                  aria-label={t('nav.menu')}
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side={isArabic ? 'left' : 'right'}
                className="mobile-app-menu z-[120] overflow-y-auto overscroll-contain border-border/60 bg-background/95 pb-8 pt-14 backdrop-blur-xl"
              >
                <SheetHeader className="text-start">
                  <SheetTitle>{t('nav.menu')}</SheetTitle>
                </SheetHeader>
                <div className="mt-6 grid gap-2">
                  {navItems.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                      <SheetClose asChild key={item.path}>
                        <Link
                          to={item.path}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            buttonVariants({ variant: isActive ? 'default' : 'ghost' }),
                            'site-drawer-link h-12 justify-start gap-3',
                            isActive && 'is-active',
                          )}
                        >
                          <item.icon className="h-5 w-5" />
                          {item.label}
                        </Link>
                      </SheetClose>
                    );
                  })}
                  <SheetClose asChild>
                    <Link
                      to={adminItem.path}
                      aria-current={location.pathname === adminItem.path ? 'page' : undefined}
                      className={cn(
                        buttonVariants({ variant: location.pathname === adminItem.path ? 'default' : 'ghost' }),
                        'site-drawer-link h-12 justify-start gap-3',
                        location.pathname === adminItem.path && 'is-active',
                      )}
                    >
                      <Shield className="h-5 w-5" />
                      {adminItem.label}
                    </Link>
                  </SheetClose>
                  {user ? (
                    <SheetClose asChild>
                      <Button type="button" variant="ghost" onClick={signOut} className="site-nav-utility h-12 justify-start gap-3">
                        <LogOut className="h-5 w-5" />
                        {t('nav.logout')}
                      </Button>
                    </SheetClose>
                  ) : (
                    <SheetClose asChild>
                      <Link
                        to="/auth?force=1"
                        className={cn(buttonVariants({ variant: 'default' }), 'site-nav-launch h-12 justify-start gap-3')}
                      >
                        <LogIn className="h-5 w-5" />
                        {t('nav.login')}
                      </Link>
                    </SheetClose>
                  )}
                </div>
              </SheetContent>
            </Sheet>

            {user ? (
              <Button
                type="button"
                variant="ghost"
                onClick={signOut}
                className="site-nav-utility hidden min-h-11 text-muted-foreground hover:text-foreground xl:inline-flex"
              >
                <LogOut className="h-4 w-4" />
                {t('nav.logout')}
              </Button>
            ) : (
              <Link
                to="/auth?force=1"
                className={cn(
                  buttonVariants({ variant: 'default', size: 'sm' }),
                  'site-nav-launch hidden min-h-11 bg-primary text-primary-foreground xl:inline-flex',
                )}
              >
                <LogIn className="h-4 w-4" />
                {t('nav.login')}
              </Link>
            )}
          </div>
        </div>
      </div>

      </nav>

      <nav aria-label={quickNavigationLabel} className="site-mobile-nav fixed bottom-0 left-0 right-0 z-[100] border-t border-border/50 px-2 py-1.5 glass-card md:hidden">
        <div className="flex justify-around overflow-x-auto">
          {mobileNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'mobile-nav-item flex min-h-[52px] min-w-0 flex-1 flex-col items-center gap-1 px-1 py-1.5',
                  isActive ? 'is-active text-primary' : 'text-muted-foreground',
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[10px] leading-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
