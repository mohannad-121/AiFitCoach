import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Brain,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Droplets,
  Edit,
  Flame,
  Footprints,
  HeartPulse,
  LogOut,
  MapPin,
  Ruler,
  Scale,
  ShieldAlert,
  Sparkles,
  Target,
  User,
  Utensils,
  Weight,
  Zap,
} from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { useUser } from '@/contexts/UserContext';
import { useAuth } from '@/hooks/useAuth';
import { useLocation, useNavigate } from 'react-router-dom';
import { HeartRateTimelinePanel } from '@/components/HeartRateTimelinePanel';
import { supabase } from '@/integrations/supabase/client';
import { AI_BACKEND_URL } from '@/lib/backendUrl';

type FitbitStatus = {
  configured: boolean;
  connected: boolean;
  fitbit_user_id?: string;
  expires_at?: string | null;
  last_sync_at?: string | null;
  scope?: string[];
  profile?: {
    display_name?: string;
    avatar_url?: string;
    member_since?: string;
    weight_kg?: number | null;
  };
  today_summary?: {
    date?: string;
    steps?: number;
    calories_out?: number;
    calories_in?: number;
    distance_km?: number;
    resting_heart_rate?: number | null;
    very_active_minutes?: number;
    weight_kg?: number | null;
    latest_weight_kg?: number | null;
    bmi?: number | null;
    water_ml?: number;
    foods_logged?: number;
    protein_g?: number | null;
    carbs_g?: number | null;
    fat_g?: number | null;
    food_names?: string[];
  };
};

const EXPIRED_FITBIT_MESSAGE = 'Your Fitbit connection expired. Reconnect Fitbit and try again.';
const hasConfiguredSupabase = Boolean(
  import.meta.env.VITE_SUPABASE_URL &&
  (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
);

type StatCardProps = {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  helper?: string;
};

function StatCard({ icon: Icon, label, value, helper }: StatCardProps) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="rounded-[1.35rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] px-4 py-4 shadow-[0_16px_38px_rgba(0,0,0,0.16)]"
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/15 bg-cyan-400/10">
          <Icon className="h-4 w-4 text-cyan-300" />
        </span>
        <span>{label}</span>
      </div>
      <div className="mt-3 text-lg font-semibold leading-tight text-foreground">{value}</div>
      {helper ? <p className="mt-1 text-xs text-muted-foreground">{helper}</p> : null}
    </motion.div>
  );
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === '') return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SectionCard({
  title,
  kicker,
  icon: Icon,
  children,
  className = '',
}: {
  title: string;
  kicker?: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-[linear-gradient(180deg,rgba(15,19,40,0.88),rgba(9,12,28,0.84))] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur-xl ${className}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          {kicker ? <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.26em] text-cyan-100/70">{kicker}</p> : null}
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        </div>
        {Icon ? (
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/15 bg-cyan-400/10">
            <Icon className="h-5 w-5 text-cyan-300" />
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function StatusBadge({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'success' | 'warning';
}) {
  const styles = tone === 'success'
    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
    : tone === 'warning'
      ? 'border-amber-400/20 bg-amber-400/10 text-amber-100'
      : 'border-white/10 bg-white/[0.05] text-white/80';

  return <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${styles}`}>{children}</span>;
}

function getFitbitErrorMessage(error: unknown, language: string) {
  if (error instanceof Error && error.message === EXPIRED_FITBIT_MESSAGE) {
    return language === 'ar'
      ? 'انتهت صلاحية ربط Fitbit. اربط الحساب من جديد ثم حاول مرة أخرى.'
      : 'Your Fitbit session expired. Reconnect Fitbit and try again.';
  }
  return error instanceof Error ? error.message : (language === 'ar' ? 'تعذر تحديث Fitbit.' : 'Could not sync Fitbit.');
}

export function ProfilePage() {
  const { t, language } = useLanguage();
  const { profile, updateProfile } = useUser();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<typeof profile>>(profile || {});
  const [fitbitStatus, setFitbitStatus] = useState<FitbitStatus | null>(null);
  const [fitbitLoading, setFitbitLoading] = useState(false);
  const [fitbitBusyAction, setFitbitBusyAction] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const currentUserId = user?.id || '';

  const fetchFitbitStatus = async (targetUserId: string) => {
    if (!targetUserId) {
      setFitbitStatus(null);
      return;
    }

    setFitbitLoading(true);
    try {
      const response = await fetch(`${AI_BACKEND_URL}/integrations/fitbit/status?user_id=${encodeURIComponent(targetUserId)}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || 'Failed loading Fitbit status');
      setFitbitStatus(payload as FitbitStatus);
    } catch (error) {
      console.warn('Failed loading Fitbit status:', error);
      setFitbitStatus({ configured: false, connected: false });
    } finally {
      setFitbitLoading(false);
    }
  };

  useEffect(() => {
    setEditData(profile || {});
  }, [profile]);

  useEffect(() => {
    if (!currentUserId) {
      setFitbitStatus(null);
      return;
    }
    fetchFitbitStatus(currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const fitbitResult = params.get('fitbit');
    const fitbitMessage = params.get('fitbit_message');
    if (!fitbitResult) return;

    if (fitbitResult === 'connected') {
      toast({
        title: language === 'ar' ? 'تم ربط Fitbit' : 'Fitbit connected',
        description: language === 'ar' ? 'تم ربط حساب Fitbit بنجاح.' : 'Your Fitbit account is now connected.',
      });
      if (currentUserId) fetchFitbitStatus(currentUserId);
    } else {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'فشل ربط Fitbit' : 'Fitbit connection failed',
        description: fitbitMessage || (language === 'ar' ? 'تعذر إكمال ربط Fitbit.' : 'Could not complete the Fitbit connection.'),
      });
    }

    navigate('/profile', { replace: true });
  }, [location.search, navigate, toast, language, currentUserId]);

  useEffect(() => {
    if (!user) return;

    supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data && data.onboarding_completed) {
          const profileUpdates = {
            name: data.name,
            age: data.age,
            gender: data.gender as 'male' | 'female',
            weight: Number(data.weight),
            height: Number(data.height),
            goal: data.goal as 'bulking' | 'cutting' | 'fitness',
            location: data.location as 'home' | 'gym',
            fitnessLevel: (data as any).fitness_level || 'beginner',
            trainingDaysPerWeek: Number((data as any).training_days_per_week ?? 3),
            equipment: (data as any).equipment || '',
            injuries: (data as any).injuries || '',
            activityLevel: (data as any).activity_level || 'moderate',
            dietaryPreferences: (data as any).dietary_preferences || '',
            chronicConditions: (data as any).chronic_conditions || '',
            allergies: (data as any).allergies || '',
            onboardingCompleted: data.onboarding_completed,
          };
          const remoteAvatarUrl = String((data as any).avatar_url || '').trim();
          updateProfile(remoteAvatarUrl ? { ...profileUpdates, avatarUrl: remoteAvatarUrl } : profileUpdates);
        }
      });
  }, [user]);

  if (!profile || !profile.onboardingCompleted) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Button variant="hero" onClick={() => navigate('/onboarding')}>
              {language === 'ar' ? 'أكمل ملفك الشخصي' : 'Complete Your Profile'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const stats = [
    { icon: User, label: t('onboarding.age'), value: `${profile.age} ${language === 'ar' ? 'سنة' : 'years'}` },
    { icon: Ruler, label: t('onboarding.height'), value: `${profile.height} cm` },
    { icon: Weight, label: t('onboarding.weight'), value: `${profile.weight} kg` },
    { icon: Target, label: language === 'ar' ? 'الهدف' : 'Goal', value: t(`onboarding.${profile.goal}`) },
    { icon: MapPin, label: language === 'ar' ? 'المكان' : 'Location', value: t(`onboarding.${profile.location}`) },
  ];

  const bmi = profile.weight / Math.pow(profile.height / 100, 2);
  const bmiCategory = bmi < 18.5 ? (language === 'ar' ? 'نقص وزن' : 'Underweight') : bmi < 25 ? (language === 'ar' ? 'طبيعي' : 'Normal') : bmi < 30 ? (language === 'ar' ? 'زيادة وزن' : 'Overweight') : (language === 'ar' ? 'سمنة' : 'Obese');
  const displayAvatarUrl = profile.avatarUrl || fitbitStatus?.profile?.avatar_url || '';
  const displayGoal = t(`onboarding.${profile.goal}`);
  const displayGender = t(`onboarding.${profile.gender}`);
  const fitbitMetricCards = [
    { icon: Footprints, label: language === 'ar' ? 'الخطوات اليوم' : 'Steps today', value: fitbitStatus?.today_summary?.steps ?? 0 },
    { icon: Flame, label: language === 'ar' ? 'السعرات المحروقة' : 'Calories out', value: fitbitStatus?.today_summary?.calories_out ?? 0 },
    { icon: Activity, label: language === 'ar' ? 'المسافة' : 'Distance', value: `${fitbitStatus?.today_summary?.distance_km ?? 0} km` },
    { icon: HeartPulse, label: language === 'ar' ? 'نبض الراحة' : 'Resting HR', value: fitbitStatus?.today_summary?.resting_heart_rate ?? '--' },
    {
      icon: Scale,
      label: language === 'ar' ? 'الوزن المتزامن' : 'Synced weight',
      value: `${fitbitStatus?.today_summary?.latest_weight_kg ?? fitbitStatus?.profile?.weight_kg ?? '--'}${(fitbitStatus?.today_summary?.latest_weight_kg ?? fitbitStatus?.profile?.weight_kg) != null ? ' kg' : ''}`,
    },
    { icon: Droplets, label: language === 'ar' ? 'الماء اليوم' : 'Water today', value: `${fitbitStatus?.today_summary?.water_ml ?? 0} ml` },
    { icon: Utensils, label: language === 'ar' ? 'سعرات الطعام' : 'Calories in', value: fitbitStatus?.today_summary?.calories_in ?? 0 },
    { icon: Target, label: language === 'ar' ? 'الأطعمة المسجلة' : 'Foods logged', value: fitbitStatus?.today_summary?.foods_logged ?? 0 },
  ];

  const saveAvatarUrl = async (avatarUrl: string) => {
    updateProfile({ avatarUrl });
    if (user && supabase && supabase.from) {
      try {
        const { error } = await supabase.from('profiles').update({
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        }).eq('user_id', user.id);
        if (error) throw error;
      } catch (error) {
        console.warn('Failed updating profile avatar:', error);
      }
    }
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'ملف غير مدعوم' : 'Unsupported file',
        description: language === 'ar' ? 'اختر صورة فقط.' : 'Choose an image file.',
      });
      return;
    }

    try {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      const processedImage = await new Promise<{ dataUrl: string; blob: Blob }>((resolve, reject) => {
        image.onload = () => {
          const size = 320;
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) {
            reject(new Error('Canvas is unavailable.'));
            return;
          }

          canvas.width = size;
          canvas.height = size;
          const sourceSize = Math.min(image.width, image.height);
          const sourceX = (image.width - sourceSize) / 2;
          const sourceY = (image.height - sourceSize) / 2;
          context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Could not prepare the image.'));
              return;
            }
            resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.82), blob });
          }, 'image/jpeg', 0.82);
        };
        image.onerror = () => reject(new Error('Could not read the image.'));
        image.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);

      if (user && hasConfiguredSupabase && supabase?.storage) {
        const storagePath = `${user.id}/avatar.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('profile-pictures')
          .upload(storagePath, processedImage.blob, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: true,
          });

        if (uploadError) {
          console.warn('Profile picture storage unavailable; saving optimized avatar to the profile record.', uploadError);
          await saveAvatarUrl(processedImage.dataUrl);
          toast({
            title: language === 'ar' ? 'تم تحديث الصورة' : 'Profile image updated',
            description: language === 'ar' ? 'تم حفظ الصورة في ملفك الشخصي.' : 'Your optimized image was saved to your profile.',
          });
          return;
        }

        const { data: publicUrlData } = supabase.storage.from('profile-pictures').getPublicUrl(storagePath);
        const publicUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;
        const { error: metadataError } = await supabase.from('profile_pictures').upsert({
          user_id: user.id,
          storage_path: storagePath,
          public_url: publicUrl,
          original_filename: file.name,
          mime_type: 'image/jpeg',
          size_bytes: processedImage.blob.size,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (metadataError) throw metadataError;
        await saveAvatarUrl(publicUrl);
      } else {
        await saveAvatarUrl(processedImage.dataUrl);
      }

      toast({ title: language === 'ar' ? 'تم تحديث الصورة' : 'Profile image updated' });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'فشل تحديث الصورة' : 'Image update failed',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleFitbitConnect = () => {
    if (!currentUserId) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'لا يوجد مستخدم' : 'No user found',
        description: language === 'ar' ? 'سجل الدخول أولاً قبل ربط Fitbit.' : 'Sign in before connecting Fitbit.',
      });
      return;
    }

    if (!fitbitStatus?.configured) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'Fitbit غير مهيأ' : 'Fitbit not configured',
        description: language === 'ar' ? 'أكمل إعداد Fitbit في الخادم أولاً.' : 'Complete the backend Fitbit configuration first.',
      });
      return;
    }

    setFitbitBusyAction('connect');
    const frontendRedirect = `${window.location.origin}/profile`;
    window.location.href = `${AI_BACKEND_URL}/integrations/fitbit/connect?user_id=${encodeURIComponent(currentUserId)}&frontend_redirect=${encodeURIComponent(frontendRedirect)}`;
  };

  const handleFitbitSync = async () => {
    if (!currentUserId) return;

    setFitbitBusyAction('sync');
    try {
      const response = await fetch(`${AI_BACKEND_URL}/integrations/fitbit/sync?user_id=${encodeURIComponent(currentUserId)}`, { method: 'POST' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || 'Failed syncing Fitbit');
      setFitbitStatus(payload as FitbitStatus);
      toast({
        title: language === 'ar' ? 'تم تحديث Fitbit' : 'Fitbit synced',
        description: language === 'ar' ? 'تم جلب أحدث بيانات Fitbit.' : 'Fetched the latest Fitbit data.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'فشل التحديث' : 'Sync failed',
        description: getFitbitErrorMessage(error, language),
      });
      if (error instanceof Error && error.message === EXPIRED_FITBIT_MESSAGE) {
        setFitbitStatus((previous) => ({ configured: previous?.configured ?? true, connected: false }));
      }
      await fetchFitbitStatus(currentUserId);
    } finally {
      setFitbitBusyAction(null);
    }
  };

  const handleFitbitDisconnect = async () => {
    if (!currentUserId) return;

    setFitbitBusyAction('disconnect');
    try {
      const response = await fetch(`${AI_BACKEND_URL}/integrations/fitbit/connection?user_id=${encodeURIComponent(currentUserId)}`, { method: 'DELETE' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.detail || 'Failed disconnecting Fitbit');
      setFitbitStatus(payload as FitbitStatus);
      toast({
        title: language === 'ar' ? 'تم فصل Fitbit' : 'Fitbit disconnected',
        description: language === 'ar' ? 'تم حذف الربط مع Fitbit.' : 'The Fitbit connection was removed.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'فشل الفصل' : 'Disconnect failed',
        description: error instanceof Error ? error.message : (language === 'ar' ? 'تعذر فصل Fitbit.' : 'Could not disconnect Fitbit.'),
      });
    } finally {
      setFitbitBusyAction(null);
    }
  };

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return language === 'ar' ? 'صباح الخير' : 'Good Morning';
    if (hour < 18) return language === 'ar' ? 'مساء الخير' : 'Good Afternoon';
    return language === 'ar' ? 'مساء الخير' : 'Good Evening';
  })();

  const profileFields = [
    profile.name,
    profile.age,
    profile.gender,
    profile.weight,
    profile.height,
    profile.goal,
    profile.location,
    profile.fitnessLevel,
    profile.trainingDaysPerWeek,
    profile.activityLevel,
    profile.equipment,
    profile.injuries,
    profile.dietaryPreferences,
  ];
  const profileCompletion = Math.round((profileFields.filter(Boolean).length / profileFields.length) * 100);
  const bmiProgress = Math.max(8, Math.min((bmi / 35) * 100, 100));
  const bmiTone = bmi < 18.5 ? 'warning' : bmi < 25 ? 'success' : bmi < 30 ? 'default' : 'warning';
  const bmiExplanation = language === 'ar'
    ? 'هذا المؤشر يعطي قراءة سريعة عن حالة الجسم الحالية ليخصص الذكاء الاصطناعي خطتك بشكل أفضل.'
    : 'A quick body-status reading your AI Coach uses to better personalize training and nutrition.';
  const bmiFocus = language === 'ar'
    ? profile.goal === 'cutting'
      ? 'التركيز المقترح: خسارة الدهون، الاستمرارية، وتنظيم التغذية.'
      : profile.goal === 'bulking'
        ? 'التركيز المقترح: فائض متزن، تقدم تدريجي، وتعافي قوي.'
        : 'التركيز المقترح: لياقة عامة، حركة ثابتة، وتوازن بالعادات.'
    : profile.goal === 'cutting'
      ? 'Recommended focus: fat loss, consistency, and controlled nutrition.'
      : profile.goal === 'bulking'
        ? 'Recommended focus: controlled surplus, progressive overload, and recovery.'
        : 'Recommended focus: general fitness, movement consistency, and balanced habits.';

  const trainingRows = [
    { icon: Zap, label: language === 'ar' ? 'المستوى' : 'Level', value: t(`onboarding.${profile.fitnessLevel}`) },
    { icon: Calendar, label: language === 'ar' ? 'أيام التدريب / الأسبوع' : 'Training Days / Week', value: profile.trainingDaysPerWeek },
    { icon: Activity, label: language === 'ar' ? 'مستوى النشاط' : 'Activity Level', value: t(`onboarding.activity.${profile.activityLevel}`) },
    { icon: Target, label: language === 'ar' ? 'الهدف الحالي' : 'Current Goal', value: displayGoal },
    { icon: MapPin, label: language === 'ar' ? 'مكان التدريب' : 'Training Place', value: t(`onboarding.${profile.location}`) },
    { icon: Weight, label: language === 'ar' ? 'المعدات' : 'Equipment', value: profile.equipment || (language === 'ar' ? 'غير محدد' : 'Not specified') },
  ];

  const aiInsight = (() => {
    const days = profile.trainingDaysPerWeek || 3;
    const activity = t(`onboarding.activity.${profile.activityLevel}`);
    const intro = language === 'ar'
      ? `هدفك الحالي هو ${displayGoal}. مع ${days} أيام تدريب أسبوعياً ومستوى نشاط ${activity}، الأفضل أن يركز المدرب الذكي على خطة واضحة يمكن الالتزام بها باستمرار.`
      : `Your current goal is ${displayGoal}. With ${days} training days per week and a ${activity.toLowerCase()} activity level, your AI Coach should prioritize a plan you can follow consistently.`;
    const goalLine = profile.goal === 'cutting'
      ? (language === 'ar' ? 'الأولوية المناسبة: تمارين منخفضة الاحتكاك، ضبط السعرات، ومتابعة ثابتة للتقدم.' : 'Best priority: consistent workouts, controlled nutrition, and low-friction progress tracking.')
      : profile.goal === 'bulking'
        ? (language === 'ar' ? 'الأولوية المناسبة: شدة تدريب محسوبة، تعافي جيد، وزيادة تدريجية في الحمل.' : 'Best priority: progressive overload, recovery quality, and a measured increase in training load.')
        : (language === 'ar' ? 'الأولوية المناسبة: لياقة عامة، حركة يومية، واستدامة في الروتين.' : 'Best priority: general conditioning, daily movement, and sustainable routines.');
    const injuryLine = profile.injuries
      ? (language === 'ar'
          ? `بسبب الإصابات المذكورة (${profile.injuries}) يجب أن تبقى التمارين حذرة ومعدلة حتى يتم التأكد من ملاءمتها لك.`
          : `Because you reported ${profile.injuries}, your plan should stay cautious and avoid risky movement patterns until appropriate.`)
      : '';
    return [intro, goalLine, injuryLine].filter(Boolean).join(' ');
  })();

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#050816] pb-24 md:pb-8">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(18,27,64,0.75),rgba(4,7,18,0.98)_58%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(95,132,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(95,132,255,0.05)_1px,transparent_1px)] bg-[size:72px_72px] opacity-35" />
        <div className="absolute -left-20 top-20 h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(124,92,255,0.24),transparent_68%)] blur-3xl" />
        <div className="absolute right-[-8rem] top-[16%] h-96 w-96 rounded-full bg-[radial-gradient(circle,rgba(0,214,201,0.16),transparent_70%)] blur-3xl" />
        <div className="absolute inset-x-0 bottom-0 h-48 bg-[radial-gradient(ellipse_at_center,_rgba(0,0,0,0),_rgba(0,0,0,0.65)_72%)]" />
      </div>

      <Navbar />
      <main className="relative z-10 mx-auto grid max-w-7xl gap-6 px-4 pt-24 sm:px-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(16,20,44,0.9),rgba(8,10,25,0.88))] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.32)] xl:col-span-2"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_24%,rgba(193,93,255,0.18),transparent_28%),radial-gradient(circle_at_82%_18%,rgba(65,227,217,0.15),transparent_24%)]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="relative h-28 w-28 shrink-0">
                <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(135,94,255,0.48),rgba(135,94,255,0.08)_58%,transparent_72%)] blur-2xl" />
                <div className="relative h-full w-full overflow-hidden rounded-full border border-cyan-300/20 bg-white/5 p-1 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_0_35px_rgba(126,91,255,0.22)]">
                  <div className="h-full w-full overflow-hidden rounded-full bg-muted">
                    {displayAvatarUrl ? (
                      <img src={displayAvatarUrl} alt={profile.name || 'Profile'} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-secondary">
                        <User className="h-12 w-12 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="absolute bottom-1 right-1 flex h-10 w-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(255,92,210,0.96),rgba(117,92,255,0.94))] text-white shadow-[0_14px_28px_rgba(124,88,255,0.28)]"
                  aria-label={language === 'ar' ? 'تغيير صورة الملف الشخصي' : 'Change profile image'}
                >
                  <Camera className="h-4 w-4" />
                </button>
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
              </div>

              <div className="min-w-0">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.34em] text-cyan-100/78">
                  {language === 'ar' ? 'ملف اللياقة الذكي' : 'AI FITNESS PROFILE'}
                </p>
                <h1 className="font-display text-4xl text-white md:text-5xl">
                  {greeting}, {profile.name || (language === 'ar' ? 'مستخدم' : 'Athlete')}
                </h1>
                <p className="mt-3 text-lg text-white/68">{profile.name || 'User'}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusBadge>{displayGoal}</StatusBadge>
                  <StatusBadge>{displayGender}</StatusBadge>
                  <StatusBadge>{t(`onboarding.${profile.location}`)}</StatusBadge>
                  <StatusBadge tone="success">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {language === 'ar' ? `${profileCompletion}% اكتمال الملف` : `Profile ${profileCompletion}% Complete`}
                  </StatusBadge>
                </div>
              </div>
            </div>

            <Button variant="outline" onClick={() => setIsEditing(true)} className="rounded-full border-white/12 bg-white/[0.04] text-white hover:bg-white/[0.08]">
              <Edit className="mr-2 h-4 w-4" />
              {language === 'ar' ? 'تعديل الملف' : 'Edit Profile'}
            </Button>
          </div>
        </motion.section>

        <div className="space-y-6">
          <SectionCard title={language === 'ar' ? 'ذكاء الجسم' : 'Body Intelligence'} kicker={language === 'ar' ? 'مؤشر ذكي' : 'Body Intelligence'} icon={Brain}>
            <div className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
              <div>
                <p className="text-5xl font-bold text-transparent bg-[linear-gradient(135deg,#ff7dd8,#9f7bff,#5cf1ff)] bg-clip-text">
                  {bmi.toFixed(1)}
                </p>
                <p className="mt-2 text-sm font-medium text-white/72">{bmiCategory}</p>
              </div>
              <div>
                <div className="mb-3 h-3 overflow-hidden rounded-full bg-white/8">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${bmiProgress}%` }} transition={{ duration: 0.9, ease: 'easeOut' }} className="h-full rounded-full bg-[linear-gradient(90deg,rgba(255,92,210,0.96),rgba(117,92,255,0.94),rgba(92,241,255,0.86))]" />
                </div>
                <div className="mb-4 flex flex-wrap gap-2">
                  <StatusBadge tone={bmiTone}>{bmiCategory}</StatusBadge>
                  <StatusBadge>{language === 'ar' ? 'تحليل فوري' : 'Live body reading'}</StatusBadge>
                </div>
                <p className="text-sm leading-7 text-white/62">{bmiExplanation}</p>
                <p className="mt-3 text-sm font-medium text-cyan-100/85">{bmiFocus}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title={language === 'ar' ? 'إحصاءاتك' : 'Your Stats'} kicker={language === 'ar' ? 'الهوية البدنية' : 'Personal Stats'} icon={Sparkles}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {stats.map((stat, index) => (
                <StatCard key={index} icon={stat.icon} label={stat.label} value={stat.value} />
              ))}
              <StatCard icon={User} label={language === 'ar' ? 'الجنس' : 'Gender'} value={displayGender} />
            </div>
          </SectionCard>

          <SectionCard title={language === 'ar' ? 'ملف التدريب' : 'Training Profile'} kicker={language === 'ar' ? 'التخصيص الذكي' : 'Training Details'} icon={Zap}>
            <div className="space-y-4">
              <p className="text-sm text-white/56">
                {language === 'ar' ? 'المدرب الذكي يستخدم هذه البيانات لتخصيص الخطة والجرعة التدريبية.' : 'Your AI Coach uses this profile to personalize plans, load, and progression.'}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {trainingRows.map((row) => (
                  <div key={row.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/15 bg-cyan-400/10">
                        <row.icon className="h-4 w-4 text-cyan-300" />
                      </span>
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{row.label}</p>
                        <p className="mt-1 text-base font-semibold text-foreground">{row.value}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {profile.injuries && (
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/8 p-4">
                  <div className="flex items-center gap-2 text-amber-100">
                    <ShieldAlert className="h-4 w-4" />
                    <span className="text-sm font-semibold">{language === 'ar' ? 'تنبيه إصابات' : 'Injury Notice'}</span>
                  </div>
                  <p className="mt-2 text-sm text-amber-50/85">{profile.injuries}</p>
                </div>
              )}
            </div>
          </SectionCard>

          {(profile.chronicConditions || profile.allergies || profile.dietaryPreferences) && (
            <SectionCard title={language === 'ar' ? 'معلومات صحية' : 'Health Information'} kicker={language === 'ar' ? 'سياق صحي' : 'Health Context'} icon={ShieldAlert}>
              <div className="grid gap-3">
                {profile.chronicConditions && <InfoRow label={language === 'ar' ? 'الأمراض المزمنة' : 'Chronic Conditions'} value={profile.chronicConditions} />}
                {profile.allergies && <InfoRow label={language === 'ar' ? 'الحساسيات' : 'Allergies'} value={profile.allergies} />}
                {profile.dietaryPreferences && <InfoRow label={language === 'ar' ? 'التفضيلات الغذائية' : 'Dietary Preferences'} value={profile.dietaryPreferences} />}
              </div>
            </SectionCard>
          )}
        </div>

        <div className="space-y-6">
          <SectionCard title="Fitbit Health Sync" kicker={language === 'ar' ? 'المزامنة الصحية' : 'Live Sync'} icon={HeartPulse}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <p className="max-w-md text-sm leading-7 text-white/58">
                {language === 'ar' ? 'بيانات النشاط والعافية المباشرة التي يستخدمها المدرب الذكي لفهم تقدمك اليومي.' : 'Live activity and wellness data used by your AI Coach.'}
              </p>
              <StatusBadge tone={fitbitStatus?.connected ? 'success' : 'default'}>
                {fitbitStatus?.connected ? (language === 'ar' ? 'متصل' : 'Connected') : (language === 'ar' ? 'غير متصل' : 'Not connected')}
              </StatusBadge>
            </div>

            {fitbitLoading ? (
              <p className="text-sm text-muted-foreground">{language === 'ar' ? 'جاري تحميل حالة Fitbit...' : 'Loading Fitbit status...'}</p>
            ) : !fitbitStatus?.configured ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'أكمل إعداد Fitbit على الخادم أولاً ثم ضع رابط callback الصحيح في لوحة Fitbit.' : 'Complete the Fitbit backend configuration first, then set the correct callback URL in Fitbit.'}
                </p>
                <code className="block rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-xs break-all text-white/70">
                  {AI_BACKEND_URL}/integrations/fitbit/callback
                </code>
              </div>
            ) : fitbitStatus.connected ? (
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {fitbitMetricCards.map((metric) => (
                    <StatCard key={metric.label} icon={metric.icon} label={metric.label} value={metric.value} />
                  ))}
                </div>

                <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.03] p-4">
                  <HeartRateTimelinePanel userId={currentUserId} enabled={fitbitStatus.connected} />
                </div>

                <div className="grid gap-3 text-sm text-muted-foreground">
                  {fitbitStatus.profile?.display_name && <InfoRow label={language === 'ar' ? 'حساب Fitbit' : 'Fitbit account'} value={fitbitStatus.profile.display_name} />}
                  {fitbitStatus.last_sync_at && <InfoRow label={language === 'ar' ? 'آخر مزامنة' : 'Last synced'} value={new Date(fitbitStatus.last_sync_at).toLocaleString()} />}
                  {fitbitStatus.profile?.member_since && <InfoRow label={language === 'ar' ? 'عضو منذ' : 'Member since'} value={fitbitStatus.profile.member_since} />}
                  {Array.isArray(fitbitStatus.today_summary?.food_names) && fitbitStatus.today_summary.food_names.length > 0 && (
                    <InfoRow label={language === 'ar' ? 'أطعمة اليوم' : "Today's foods"} value={fitbitStatus.today_summary.food_names.join(', ')} />
                  )}
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button variant="hero" onClick={handleFitbitSync} disabled={fitbitBusyAction !== null}>
                    {fitbitBusyAction === 'sync' ? (language === 'ar' ? 'جاري التحديث...' : 'Syncing...') : (language === 'ar' ? 'تحديث البيانات' : 'Sync Data')}
                  </Button>
                  <Button variant="outline" onClick={handleFitbitDisconnect} disabled={fitbitBusyAction !== null}>
                    {fitbitBusyAction === 'disconnect' ? (language === 'ar' ? 'جاري الفصل...' : 'Disconnecting...') : (language === 'ar' ? 'فصل Fitbit' : 'Disconnect Fitbit')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {language === 'ar' ? 'بعد الربط سيتم سحب النشاط، الوزن، الطعام، والماء من Fitbit مع كل مزامنة.' : 'After connecting, the app will pull activity, weight, food, and water data from Fitbit on every sync.'}
                </p>
                <Button variant="hero" onClick={handleFitbitConnect} disabled={fitbitBusyAction !== null}>
                  {fitbitBusyAction === 'connect' ? (language === 'ar' ? 'جاري التحويل...' : 'Redirecting...') : (language === 'ar' ? 'ربط Fitbit' : 'Connect Fitbit')}
                </Button>
              </div>
            )}
          </SectionCard>

          <SectionCard title={language === 'ar' ? 'بصيرة الملف الذكية' : 'AI Profile Insight'} kicker={language === 'ar' ? 'توصية ذكية' : 'AI Recommendation'} icon={Brain}>
            <p className="text-sm leading-8 text-white/68">{aiInsight}</p>
            <Button variant="outline" className="mt-5 rounded-full border-white/12 bg-white/[0.04]" onClick={() => navigate('/coach')}>
              <Brain className="mr-2 h-4 w-4" />
              {language === 'ar' ? 'اسأل المدرب الذكي' : 'Ask AI Coach'}
            </Button>
          </SectionCard>

          <SectionCard title={language === 'ar' ? 'إجراءات سريعة' : 'Quick Actions'} kicker={language === 'ar' ? 'الخطوة التالية' : 'Quick Actions'} icon={ChevronRight}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Button variant="hero" className="h-12 justify-start" onClick={() => setIsEditing(!isEditing)}>
                <Edit className="mr-2 h-4 w-4" />
                {isEditing ? (language === 'ar' ? 'إلغاء' : 'Cancel') : (language === 'ar' ? 'تعديل البيانات' : 'Edit Data')}
              </Button>
              <Button variant="outline" className="h-12 justify-start" onClick={() => navigate('/schedule')}>
                <Calendar className="mr-2 h-4 w-4" />
                {language === 'ar' ? 'جدول التمارين' : 'Workout Schedule'}
              </Button>
              {fitbitStatus?.connected && (
                <Button variant="outline" className="h-12 justify-start" onClick={handleFitbitSync} disabled={fitbitBusyAction !== null}>
                  <Clock3 className="mr-2 h-4 w-4" />
                  {fitbitBusyAction === 'sync' ? (language === 'ar' ? 'جاري التحديث...' : 'Syncing...') : (language === 'ar' ? 'مزامنة Fitbit' : 'Sync Fitbit')}
                </Button>
              )}
              {user && (
                <Button variant="ghost" className="h-12 justify-start border border-red-400/14 bg-red-400/8 text-red-100 hover:bg-red-400/12 hover:text-red-50" onClick={signOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {language === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}
                </Button>
              )}
            </div>
          </SectionCard>
        </div>

        {isEditing && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="xl:col-span-2">
            <SectionCard title={language === 'ar' ? 'تعديل الملف' : 'Edit Profile Data'} kicker={language === 'ar' ? 'تحديث سريع' : 'Profile Editing'} icon={Edit}>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm text-muted-foreground">{language === 'ar' ? 'المستوى' : 'Fitness Level'}</label>
                  <select value={editData.fitnessLevel || 'beginner'} onChange={(e) => setEditData({ ...editData, fitnessLevel: e.target.value as any })} className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-foreground">
                    <option value="beginner">{t('onboarding.beginner')}</option>
                    <option value="intermediate">{t('onboarding.intermediate')}</option>
                    <option value="advanced">{t('onboarding.advanced')}</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{language === 'ar' ? 'أيام التدريب / الأسبوع' : 'Training Days / Week'}</label>
                  <input type="number" min={1} max={7} value={editData.trainingDaysPerWeek || 3} onChange={(e) => setEditData({ ...editData, trainingDaysPerWeek: parseInt(e.target.value) || 0 })} className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-foreground" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{language === 'ar' ? 'مستوى النشاط' : 'Activity Level'}</label>
                  <select value={editData.activityLevel || 'moderate'} onChange={(e) => setEditData({ ...editData, activityLevel: e.target.value as any })} className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-foreground">
                    <option value="low">{t('onboarding.activity.low')}</option>
                    <option value="moderate">{t('onboarding.activity.moderate')}</option>
                    <option value="high">{t('onboarding.activity.high')}</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{language === 'ar' ? 'المعدات' : 'Equipment'}</label>
                  <input type="text" value={editData.equipment || ''} onChange={(e) => setEditData({ ...editData, equipment: e.target.value })} className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-foreground" placeholder={language === 'ar' ? 'مثال: دمبل، بار...' : 'e.g. dumbbells, barbell...'} />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{language === 'ar' ? 'إصابات' : 'Injuries'}</label>
                  <input type="text" value={editData.injuries || ''} onChange={(e) => setEditData({ ...editData, injuries: e.target.value })} className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-foreground" placeholder={language === 'ar' ? 'اكتب أي إصابة...' : 'List any injuries...'} />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{language === 'ar' ? 'الأمراض المزمنة' : 'Chronic Conditions'}</label>
                  <input type="text" value={editData.chronicConditions || ''} onChange={(e) => setEditData({ ...editData, chronicConditions: e.target.value })} className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-foreground" placeholder={language === 'ar' ? 'أدخل الأمراض المزمنة' : 'Enter chronic conditions'} />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{language === 'ar' ? 'الحساسيات' : 'Allergies'}</label>
                  <input type="text" value={editData.allergies || ''} onChange={(e) => setEditData({ ...editData, allergies: e.target.value })} className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-foreground" placeholder={language === 'ar' ? 'أدخل الحساسيات' : 'Enter allergies'} />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">{language === 'ar' ? 'التفضيلات الغذائية' : 'Dietary Preferences'}</label>
                  <input type="text" value={editData.dietaryPreferences || ''} onChange={(e) => setEditData({ ...editData, dietaryPreferences: e.target.value })} className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-foreground" placeholder={language === 'ar' ? 'أدخل التفضيلات الغذائية' : 'Enter dietary preferences'} />
                </div>
              </div>
              <Button
                variant="hero"
                className="mt-5 w-full md:w-auto"
                onClick={async () => {
                  updateProfile(editData as any);
                  setIsEditing(false);
                  if (user && supabase && supabase.from) {
                    try {
                      await supabase.from('profiles').update({
                        fitness_level: editData.fitnessLevel || null,
                        training_days_per_week: editData.trainingDaysPerWeek || null,
                        equipment: editData.equipment || null,
                        injuries: editData.injuries || null,
                        activity_level: editData.activityLevel || null,
                        dietary_preferences: editData.dietaryPreferences || null,
                        chronic_conditions: editData.chronicConditions || null,
                        allergies: editData.allergies || null,
                        updated_at: new Date().toISOString(),
                      }).eq('user_id', user.id);
                    } catch (error) {
                      console.warn('Failed updating profile in Supabase:', error);
                    }
                  }
                }}
              >
                {language === 'ar' ? 'حفظ التغييرات' : 'Save Changes'}
              </Button>
            </SectionCard>
          </motion.div>
        )}
      </main>
    </div>
  );
}
