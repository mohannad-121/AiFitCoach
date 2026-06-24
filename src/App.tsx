import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { UserProvider } from "@/contexts/UserContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useAuth } from "@/hooks/useAuth";
import { CoachNotificationsListener } from "@/components/CoachNotificationsListener";
import "./AppSurface.css";

const Index = lazy(() => import("./pages/Index"));
const AuthPage = lazy(() => import("./pages/Auth").then((module) => ({ default: module.AuthPage })));
const OnboardingPage = lazy(() => import("./pages/Onboarding").then((module) => ({ default: module.OnboardingPage })));
const WorkoutsPage = lazy(() => import("./pages/Workouts").then((module) => ({ default: module.WorkoutsPage })));
const CoachPage = lazy(() => import("./pages/Coach").then((module) => ({ default: module.CoachPage })));
const CoachNotificationsPage = lazy(() => import("./pages/CoachNotifications").then((module) => ({ default: module.CoachNotificationsPage })));
const ProfilePage = lazy(() => import("./pages/Profile").then((module) => ({ default: module.ProfilePage })));
const SchedulePage = lazy(() => import("./pages/Schedule").then((module) => ({ default: module.SchedulePage })));
const LiveCoachPage = lazy(() => import("./pages/LiveCoach").then((module) => ({ default: module.LiveCoachPage })));
const AdminPage = lazy(() => import("./pages/Admin").then((module) => ({ default: module.AdminPage })));
const SubscriptionPage = lazy(() => import("./pages/Subscription").then((module) => ({ default: module.SubscriptionPage })));
const NotFound = lazy(() => import("./pages/NotFound"));

function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

const hasConfiguredSupabase = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
);

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  
  // تحقق من localStorage مباشرة - هذا أسرع من الانتظار للـ user state
  const storedMockUser = hasConfiguredSupabase ? null : localStorage.getItem('fitcoach_mock_user');
  const hasAuth = !!user || !!storedMockUser;
  
  // إذا كان لدينا auth (user أو localStorage)، اسمح بالدخول
  if (hasAuth) {
    return <>{children}</>;
  }
  
  // أثناء التحميل والذي لا نملك auth، اعود للـ Auth page
  if (!hasAuth && !loading) {
    return <Navigate to="/auth" replace />;
  }
  
  // أثناء التحميل ولم نقرر بعد
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
      <p className="text-muted-foreground text-sm">جاري التحميل...</p>
    </div>
  );
}

function AppRoutes() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const routeSegment = location.pathname.split("/").filter(Boolean)[0] || "not-found";
  const knownRoutes = new Set(["auth", "onboarding", "workouts", "coach", "coach-notifications", "profile", "subscription", "schedule", "live-coach", "admin", "reports"]);
  const routeName = isHome ? "home" : (knownRoutes.has(routeSegment) ? routeSegment : "not-found");

  useEffect(() => {
    document.body.classList.toggle("app-premium-mode", !isHome);
    document.body.classList.toggle("app-native-mode", Capacitor.isNativePlatform());
    return () => {
      document.body.classList.remove("app-premium-mode");
      document.body.classList.remove("app-native-mode");
    };
  }, [isHome]);

  return (
    <div className={isHome ? "route-home" : `app-page-shell app-route-${routeName}`}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
          <Route path="/workouts" element={<ProtectedRoute><WorkoutsPage /></ProtectedRoute>} />
          <Route path="/coach" element={<ProtectedRoute><CoachPage /></ProtectedRoute>} />
          <Route path="/coach-notifications" element={<ProtectedRoute><CoachNotificationsPage /></ProtectedRoute>} />
          <Route path="/reports" element={<Navigate to="/admin" replace />} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/subscription" element={<ProtectedRoute><SubscriptionPage /></ProtectedRoute>} />
          <Route path="/schedule" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
          <Route path="/live-coach" element={<ProtectedRoute><LiveCoachPage /></ProtectedRoute>} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <LanguageProvider>
        <UserProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <CoachNotificationsListener />
              <AppRoutes />
            </BrowserRouter>
          </TooltipProvider>
        </UserProvider>
      </LanguageProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
