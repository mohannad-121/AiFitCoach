import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { hasConfiguredSupabase, profileSchema, type UserProfile } from '@/lib/profile';
export type { UserProfile } from '@/lib/profile';
interface UserContextType {
  profile: UserProfile | null; setProfile: (profile: UserProfile) => void;
  updateProfile: (updates: Partial<UserProfile>) => void; isOnboarded: boolean;
  profileLoading: boolean; profileError: string; retryProfile: () => void;
}
const UserContext = createContext<UserContextType | undefined>(undefined);
export function UserProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<{ userId: string; profile: UserProfile | null }>({ userId: '', profile: null });
  const [loadedUser, setLoadedUser] = useState<string | null>(null);
  const [profileError, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (authLoading) return;
    let active = true;
    setError('');
    const userId = user?.id || '';
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10000);
    const load = async () => {
      try {
        if (!userId) { setState({ userId, profile: null }); return; }
        if (!hasConfiguredSupabase) {
          const parsed = profileSchema.safeParse(JSON.parse(localStorage.getItem(`fitcoach_profile_${userId}`) || 'null'));
          if (active) setState({ userId, profile: parsed.success ? parsed.data : null });
          return;
        }
        const { data, error } = await supabase.from('profiles').select('*').eq('user_id', userId).order('updated_at', { ascending: false }).limit(1).abortSignal(controller.signal);
        if (error) throw error;
        const row = data?.[0];
        const parsed = row ? profileSchema.safeParse({
          name: row.name, age: row.age, gender: row.gender, weight: row.weight == null ? undefined : Number(row.weight),
          height: row.height == null ? undefined : Number(row.height), goal: row.goal, location: row.location,
          fitnessLevel: row.fitness_level, trainingDaysPerWeek: row.training_days_per_week,
          activityLevel: row.activity_level, equipment: row.equipment || '', injuries: row.injuries || '',
          dietaryPreferences: row.dietary_preferences || '', chronicConditions: row.chronic_conditions || '',
          allergies: row.allergies || '', avatarUrl: row.avatar_url || '', onboardingCompleted: Boolean(row.onboarding_completed),
        }) : null;
        if (active) setState({ userId, profile: parsed?.success ? parsed.data : null });
      } catch {
        if (active) setError('Could not load your profile. Please try again.');
      } finally {
        window.clearTimeout(timer);
        if (active) setLoadedUser(userId);
      }
    };
    void load();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [user?.id, authLoading, retry]);
  const profile = state.userId === user?.id ? state.profile : null;
  const setProfile = useCallback((value: UserProfile) => {
    if (!user) return;
    const parsed = profileSchema.parse(value);
    setState({ userId: user.id, profile: parsed });
    if (!hasConfiguredSupabase) localStorage.setItem(`fitcoach_profile_${user.id}`, JSON.stringify(parsed));
  }, [user]);
  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    if (profile) setProfile({ ...profile, ...updates });
  }, [profile, setProfile]);
  return <UserContext.Provider value={{ profile, setProfile, updateProfile, isOnboarded: profile?.onboardingCompleted === true,
    profileLoading: authLoading || loadedUser !== (user?.id || ''), profileError,
    retryProfile: () => { setLoadedUser(null); setRetry(value => value + 1); },
  }}>{children}</UserContext.Provider>;
}
export function useUser(): UserContextType {
  const context = useContext(UserContext);
  if (!context) throw new Error('useUser requires UserProvider');
  return context;
}
