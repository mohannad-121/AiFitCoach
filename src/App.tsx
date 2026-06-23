import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { UserProvider } from "@/contexts/UserContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useAuth } from "@/hooks/useAuth";
import { CoachNotificationsListener } from "@/components/CoachNotificationsListener";
import Index from "./pages/Index";
import { AuthPage } from "./pages/Auth";
import { OnboardingPage } from "./pages/Onboarding";
import { WorkoutsPage } from "./pages/Workouts";
import { CoachPage } from "./pages/Coach";
import { CoachNotificationsPage } from "./pages/CoachNotifications";
import { ProfilePage } from "./pages/Profile";
import { SchedulePage } from "./pages/Schedule";
import { LiveCoachPage } from "./pages/LiveCoach";
import { AdminPage } from "./pages/Admin";
import NotFound from "./pages/NotFound";
import "./AppSurface.css";

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
  const knownRoutes = new Set(["auth", "onboarding", "workouts", "coach", "coach-notifications", "profile", "schedule", "live-coach", "admin", "reports"]);
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
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
        <Route path="/workouts" element={<ProtectedRoute><WorkoutsPage /></ProtectedRoute>} />
        <Route path="/coach" element={<ProtectedRoute><CoachPage /></ProtectedRoute>} />
        <Route path="/coach-notifications" element={<ProtectedRoute><CoachNotificationsPage /></ProtectedRoute>} />
        <Route path="/reports" element={<Navigate to="/admin" replace />} />
        <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path="/schedule" element={<ProtectedRoute><SchedulePage /></ProtectedRoute>} />
        <Route path="/live-coach" element={<ProtectedRoute><LiveCoachPage /></ProtectedRoute>} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
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
