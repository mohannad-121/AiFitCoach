import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  Calendar,
  Camera,
  Droplets,
  Edit,
  Flame,
  Footprints,
  HeartPulse,
  LogOut,
  MapPin,
  Ruler,
  Scale,
  Target,
  User,
  Utensils,
  Weight,
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
};

function StatCard({ icon: Icon, label, value }: StatCardProps) {
  return (
    <div className="rounded-lg bg-muted/60 px-4 py-3 min-h-[72px]">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" />
        <span>{label}</span>
      </div>
      <div className="mt-2 text-lg font-semibold leading-tight text-foreground">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return (
    <div>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SectionCard({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass-card rounded-lg border border-border/70 p-5 ${className}`}>
      <h2 className="mb-4 text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
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
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed loading Fitbit status');
      }
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
    if (!fitbitResult) {
      return;
    }

    if (fitbitResult === 'connected') {
      toast({
        title: language === 'ar' ? 'تم ربط Fitbit' : 'Fitbit connected',
        description: language === 'ar' ? 'تم ربط حساب Fitbit بنجاح.' : 'Your Fitbit account is now connected.',
      });
      if (currentUserId) {
        fetchFitbitStatus(currentUserId);
      }
    } else {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'فشل ربط Fitbit' : 'Fitbit connection failed',
        description: fitbitMessage || (language === 'ar' ? 'تعذر إكمال ربط Fitbit.' : 'Could not complete the Fitbit connection.'),
      });
    }

    navigate('/profile', { replace: true });
  }, [location.search, navigate, toast, language, currentUserId]);

  // Sync profile from DB on mount
  useEffect(() => {
    if (user) {
      supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data && data.onboarding_completed) {
            updateProfile({
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
              avatarUrl: (data as any).avatar_url || profile.avatarUrl || '',
              onboardingCompleted: data.onboarding_completed,
            });
          }
        });
    }
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
        await supabase
          .from('profiles')
          .update({
            avatar_url: avatarUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id);
      } catch (error) {
        console.warn('Failed updating profile avatar:', error);
      }
    }
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

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
            description: language === 'ar'
              ? 'تم حفظ الصورة في ملفك الشخصي.'
              : 'Your optimized image was saved to your profile.',
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
      toast({
        title: language === 'ar' ? 'تم تحديث الصورة' : 'Profile image updated',
      });
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
    if (!currentUserId) {
      return;
    }

    setFitbitBusyAction('sync');
    try {
      const response = await fetch(`${AI_BACKEND_URL}/integrations/fitbit/sync?user_id=${encodeURIComponent(currentUserId)}`, {
        method: 'POST',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed syncing Fitbit');
      }
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
        setFitbitStatus((previous) => ({
          configured: previous?.configured ?? true,
          connected: false,
        }));
      }
      await fetchFitbitStatus(currentUserId);
    } finally {
      setFitbitBusyAction(null);
    }
  };

  const handleFitbitDisconnect = async () => {
    if (!currentUserId) {
      return;
    }

    setFitbitBusyAction('disconnect');
    try {
      const response = await fetch(`${AI_BACKEND_URL}/integrations/fitbit/connection?user_id=${encodeURIComponent(currentUserId)}`, {
        method: 'DELETE',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed disconnecting Fitbit');
      }
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

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <Navbar />
      <main className="container mx-auto grid max-w-5xl gap-5 px-4 pt-24 lg:grid-cols-[0.85fr_1.2fr]">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-2 lg:col-span-2">
          <h1 className="font-display text-4xl text-primary md:text-5xl">
            {language === 'ar' ? 'مساء الخير!' : 'Good evening!'}
          </h1>
          <div className="mt-3 flex items-center gap-4">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full border border-primary/25 bg-muted shadow-glow">
              {displayAvatarUrl ? (
                <img src={displayAvatarUrl} alt={profile.name || 'Profile'} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-secondary">
                  <User className="h-9 w-9 text-muted-foreground" />
                </div>
              )}
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
                aria-label={language === 'ar' ? 'تغيير صورة الملف الشخصي' : 'Change profile image'}
                title={language === 'ar' ? 'تغيير الصورة' : 'Change image'}
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h2 className="font-display text-3xl text-foreground md:text-4xl">{profile.name || 'User'}</h2>
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label={language === 'ar' ? 'تعديل البيانات' : 'Edit profile'}
                >
                  <Edit className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {displayGender} • {displayGoal}
              </p>
            </div>
          </div>
          <p className="hidden">
            {t(`onboarding.${profile.gender}`)} • {t(`onboarding.${profile.goal}`)}
          </p>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="glass-card rounded-lg border border-border/70 p-5 lg:col-start-1 lg:row-start-2"
        >
          <h2 className="text-lg font-semibold mb-4">{language === 'ar' ? 'مؤشر كتلة الجسم' : 'Body Mass Index'}</h2>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-4xl font-bold gradient-text">{bmi.toFixed(1)}</span>
              <p className="text-muted-foreground mt-1">{bmiCategory}</p>
            </div>
            <div className="w-32 h-3 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-gradient-primary rounded-full transition-all" style={{ width: `${Math.min((bmi / 40) * 100, 100)}%` }} />
            </div>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card rounded-lg border border-border/70 p-5 lg:col-start-1 lg:row-start-3"
        >
          <h2 className="text-lg font-semibold mb-4">{language === 'ar' ? 'إحصائياتك' : 'Your Stats'}</h2>
          <div className="grid grid-cols-2 gap-4">
            {stats.map((stat, index) => (
              <StatCard key={index} icon={stat.icon} label={stat.label} value={stat.value} />
            ))}
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }}
          className="glass-card rounded-lg border border-border/70 p-5 lg:col-start-2 lg:row-span-4 lg:row-start-2"
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-lg font-semibold">Fitbit</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {language === 'ar'
                  ? 'اربط Fitbit لسحب النشاط، الوزن، الطعام، والماء من حسابك.'
                  : 'Connect Fitbit to pull activity, weight, food, and water data from your account.'}
              </p>
            </div>
            <div className={`text-xs px-3 py-1 rounded-full ${fitbitStatus?.connected ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
              {fitbitStatus?.connected
                ? (language === 'ar' ? 'متصل' : 'Connected')
                : (language === 'ar' ? 'غير متصل' : 'Not connected')}
            </div>
          </div>

          {fitbitLoading ? (
            <p className="text-sm text-muted-foreground">
              {language === 'ar' ? 'جاري تحميل حالة Fitbit...' : 'Loading Fitbit status...'}
            </p>
          ) : !fitbitStatus?.configured ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {language === 'ar'
                  ? 'يجب إعداد متغيرات Fitbit في الخادم أولاً، ثم تغيير Redirect URL في لوحة Fitbit إلى رابط callback الخاص بالباك إند.'
                  : 'Set the Fitbit environment variables on the backend first, then change the Fitbit app Redirect URL to the backend callback URL.'}
              </p>
              <code className="block text-xs rounded-lg bg-secondary/50 px-3 py-2 break-all">
                {AI_BACKEND_URL}/integrations/fitbit/callback
              </code>
            </div>
          ) : fitbitStatus.connected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-secondary/50 rounded-xl p-4">
                  <p className="text-sm text-muted-foreground mb-1">{language === 'ar' ? 'الخطوات اليوم' : 'Steps today'}</p>
                  <p className="text-xl font-semibold">{fitbitStatus.today_summary?.steps ?? 0}</p>
                </div>
                <div className="bg-secondary/50 rounded-xl p-4">
                  <p className="text-sm text-muted-foreground mb-1">{language === 'ar' ? 'السعرات المحروقة' : 'Calories out'}</p>
                  <p className="text-xl font-semibold">{fitbitStatus.today_summary?.calories_out ?? 0}</p>
                </div>
                <div className="bg-secondary/50 rounded-xl p-4">
                  <p className="text-sm text-muted-foreground mb-1">{language === 'ar' ? 'المسافة' : 'Distance'}</p>
                  <p className="text-xl font-semibold">{fitbitStatus.today_summary?.distance_km ?? 0} km</p>
                </div>
                <div className="bg-secondary/50 rounded-xl p-4">
                  <p className="text-sm text-muted-foreground mb-1">{language === 'ar' ? 'نبض الراحة' : 'Resting HR'}</p>
                  <p className="text-xl font-semibold">{fitbitStatus.today_summary?.resting_heart_rate ?? '--'}</p>
                </div>
                <div className="bg-secondary/50 rounded-xl p-4">
                  <p className="text-sm text-muted-foreground mb-1">{language === 'ar' ? 'الوزن المتزامن' : 'Synced weight'}</p>
                  <p className="text-xl font-semibold">{fitbitStatus.today_summary?.latest_weight_kg ?? fitbitStatus.profile?.weight_kg ?? '--'}{(fitbitStatus.today_summary?.latest_weight_kg ?? fitbitStatus.profile?.weight_kg) != null ? ' kg' : ''}</p>
                </div>
                <div className="bg-secondary/50 rounded-xl p-4">
                  <p className="text-sm text-muted-foreground mb-1">{language === 'ar' ? 'الماء اليوم' : 'Water today'}</p>
                  <p className="text-xl font-semibold">{fitbitStatus.today_summary?.water_ml ?? 0} ml</p>
                </div>
                <div className="bg-secondary/50 rounded-xl p-4">
                  <p className="text-sm text-muted-foreground mb-1">{language === 'ar' ? 'سعرات الطعام' : 'Calories in'}</p>
                  <p className="text-xl font-semibold">{fitbitStatus.today_summary?.calories_in ?? 0}</p>
                </div>
                <div className="bg-secondary/50 rounded-xl p-4">
                  <p className="text-sm text-muted-foreground mb-1">{language === 'ar' ? 'الأطعمة المسجلة' : 'Foods logged'}</p>
                  <p className="text-xl font-semibold">{fitbitStatus.today_summary?.foods_logged ?? 0}</p>
                </div>
              </div>

              <HeartRateTimelinePanel userId={currentUserId} enabled={fitbitStatus.connected} />

              <div className="space-y-2 text-sm text-muted-foreground">
                {fitbitStatus.profile?.display_name && (
                  <p>
                    {language === 'ar' ? 'اسم حساب Fitbit:' : 'Fitbit account:'} <span className="text-foreground font-medium">{fitbitStatus.profile.display_name}</span>
                  </p>
                )}
                {fitbitStatus.last_sync_at && (
                  <p>
                    {language === 'ar' ? 'آخر مزامنة:' : 'Last synced:'} <span className="text-foreground font-medium">{new Date(fitbitStatus.last_sync_at).toLocaleString()}</span>
                  </p>
                )}
                {fitbitStatus.profile?.member_since && (
                  <p>
                    {language === 'ar' ? 'عضو منذ:' : 'Member since:'} <span className="text-foreground font-medium">{fitbitStatus.profile.member_since}</span>
                  </p>
                )}
                {Array.isArray(fitbitStatus.today_summary?.food_names) && fitbitStatus.today_summary!.food_names!.length > 0 && (
                  <p>
                    {language === 'ar' ? 'طعام اليوم:' : 'Today\'s foods:'} <span className="text-foreground font-medium">{fitbitStatus.today_summary!.food_names!.join(', ')}</span>
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button variant="hero" onClick={handleFitbitSync} disabled={fitbitBusyAction !== null}>
                  {fitbitBusyAction === 'sync'
                    ? (language === 'ar' ? 'جاري التحديث...' : 'Syncing...')
                    : (language === 'ar' ? 'تحديث البيانات' : 'Sync Data')}
                </Button>
                <Button variant="outline" onClick={handleFitbitDisconnect} disabled={fitbitBusyAction !== null}>
                  {fitbitBusyAction === 'disconnect'
                    ? (language === 'ar' ? 'جاري الفصل...' : 'Disconnecting...')
                    : (language === 'ar' ? 'فصل Fitbit' : 'Disconnect Fitbit')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {language === 'ar'
                  ? 'بعد الربط، سيستطيع التطبيق سحب النشاط، الوزن، الطعام، والماء من Fitbit مع كل مزامنة.'
                  : 'After connecting, the app will be able to pull activity, weight, food, and water data from Fitbit on every sync.'}
              </p>
              <Button variant="hero" onClick={handleFitbitConnect} disabled={fitbitBusyAction !== null}>
                {fitbitBusyAction === 'connect'
                  ? (language === 'ar' ? 'جاري التحويل...' : 'Redirecting...')
                  : (language === 'ar' ? 'ربط Fitbit' : 'Connect Fitbit')}
              </Button>
            </div>
          )}
        </motion.div>

        {(profile.chronicConditions || profile.allergies || profile.dietaryPreferences) && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
            className="glass-card rounded-lg border border-border/70 p-5 lg:col-start-1"
          >
            <h2 className="text-lg font-semibold mb-4">{language === 'ar' ? 'معلومات صحية' : 'Health Information'}</h2>
            <div className="space-y-4">
              {profile.chronicConditions && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    {language === 'ar' ? 'الأمراض المزمنة' : 'Chronic Conditions'}
                  </p>
                  <p className="text-base text-foreground">{profile.chronicConditions}</p>
                </div>
              )}
              {profile.allergies && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    {language === 'ar' ? 'الحساسيات' : 'Allergies'}
                  </p>
                  <p className="text-base text-foreground">{profile.allergies}</p>
                </div>
              )}
              {profile.dietaryPreferences && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">
                    {language === 'ar' ? 'التفضيلات الغذائية' : 'Dietary Preferences'}
                  </p>
                  <p className="text-base text-foreground">{profile.dietaryPreferences}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {(profile.fitnessLevel || profile.trainingDaysPerWeek || profile.equipment || profile.injuries || profile.activityLevel) && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28 }}
            className="glass-card rounded-lg border border-border/70 p-5 lg:col-start-1"
          >
            <h2 className="text-lg font-semibold mb-4">{language === 'ar' ? 'تفاصيل التدريب' : 'Training Details'}</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  {language === 'ar' ? 'المستوى' : 'Level'}
                </p>
                <p className="text-base text-foreground">{t(`onboarding.${profile.fitnessLevel}`)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  {language === 'ar' ? 'أيام التمرين بالأسبوع' : 'Training Days / Week'}
                </p>
                <p className="text-base text-foreground">{profile.trainingDaysPerWeek}</p>
              </div>
              {profile.activityLevel && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    {language === 'ar' ? 'مستوى النشاط' : 'Activity Level'}
                  </p>
                  <p className="text-base text-foreground">{t(`onboarding.activity.${profile.activityLevel}`)}</p>
                </div>
              )}
              {profile.equipment && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    {language === 'ar' ? 'المعدات' : 'Equipment'}
                  </p>
                  <p className="text-base text-foreground">{profile.equipment}</p>
                </div>
              )}
              {profile.injuries && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">
                    {language === 'ar' ? 'إصابات' : 'Injuries'}
                  </p>
                  <p className="text-base text-foreground">{profile.injuries}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="space-y-3 lg:col-span-2">
          <Button variant="outline" className="w-full" onClick={() => setIsEditing(!isEditing)}>
            <Edit className="w-4 h-4 mr-2" />
            {isEditing ? (language === 'ar' ? 'إلغاء' : 'Cancel') : (language === 'ar' ? 'تعديل البيانات' : 'Edit Data')}
          </Button>
          
          {isEditing && (
            <div className="glass-card rounded-2xl p-6 space-y-4 mb-4">
              <div>
                <label className="text-sm text-muted-foreground">{language === 'ar' ? 'المستوى' : 'Fitness Level'}</label>
                <select
                  value={editData.fitnessLevel || 'beginner'}
                  onChange={(e) => setEditData({ ...editData, fitnessLevel: e.target.value as any })}
                  className="w-full mt-2 px-3 py-2 bg-secondary/50 rounded-lg border border-border text-foreground"
                >
                  <option value="beginner">{t('onboarding.beginner')}</option>
                  <option value="intermediate">{t('onboarding.intermediate')}</option>
                  <option value="advanced">{t('onboarding.advanced')}</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{language === 'ar' ? 'أيام التمرين بالأسبوع' : 'Training Days / Week'}</label>
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={editData.trainingDaysPerWeek || 3}
                  onChange={(e) => setEditData({ ...editData, trainingDaysPerWeek: parseInt(e.target.value) || 0 })}
                  className="w-full mt-2 px-3 py-2 bg-secondary/50 rounded-lg border border-border text-foreground"
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{language === 'ar' ? 'مستوى النشاط' : 'Activity Level'}</label>
                <select
                  value={editData.activityLevel || 'moderate'}
                  onChange={(e) => setEditData({ ...editData, activityLevel: e.target.value as any })}
                  className="w-full mt-2 px-3 py-2 bg-secondary/50 rounded-lg border border-border text-foreground"
                >
                  <option value="low">{t('onboarding.activity.low')}</option>
                  <option value="moderate">{t('onboarding.activity.moderate')}</option>
                  <option value="high">{t('onboarding.activity.high')}</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{language === 'ar' ? 'المعدات' : 'Equipment'}</label>
                <input
                  type="text"
                  value={editData.equipment || ''}
                  onChange={(e) => setEditData({ ...editData, equipment: e.target.value })}
                  className="w-full mt-2 px-3 py-2 bg-secondary/50 rounded-lg border border-border text-foreground"
                  placeholder={language === 'ar' ? 'مثال: دمبل، بار...' : 'e.g. dumbbells, barbell...'}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{language === 'ar' ? 'إصابات' : 'Injuries'}</label>
                <input
                  type="text"
                  value={editData.injuries || ''}
                  onChange={(e) => setEditData({ ...editData, injuries: e.target.value })}
                  className="w-full mt-2 px-3 py-2 bg-secondary/50 rounded-lg border border-border text-foreground"
                  placeholder={language === 'ar' ? 'اكتب أي إصابة...' : 'List any injuries...'}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{language === 'ar' ? 'الأمراض المزمنة' : 'Chronic Conditions'}</label>
                <input
                  type="text"
                  value={editData.chronicConditions || ''}
                  onChange={(e) => setEditData({...editData, chronicConditions: e.target.value})}
                  className="w-full mt-2 px-3 py-2 bg-secondary/50 rounded-lg border border-border text-foreground"
                  placeholder={language === 'ar' ? 'أدخل الأمراض المزمنة' : 'Enter chronic conditions'}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{language === 'ar' ? 'الحساسيات' : 'Allergies'}</label>
                <input
                  type="text"
                  value={editData.allergies || ''}
                  onChange={(e) => setEditData({...editData, allergies: e.target.value})}
                  className="w-full mt-2 px-3 py-2 bg-secondary/50 rounded-lg border border-border text-foreground"
                  placeholder={language === 'ar' ? 'أدخل الحساسيات' : 'Enter allergies'}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground">{language === 'ar' ? 'التفضيلات الغذائية' : 'Dietary Preferences'}</label>
                <input
                  type="text"
                  value={editData.dietaryPreferences || ''}
                  onChange={(e) => setEditData({...editData, dietaryPreferences: e.target.value})}
                  className="w-full mt-2 px-3 py-2 bg-secondary/50 rounded-lg border border-border text-foreground"
                  placeholder={language === 'ar' ? 'أدخل التفضيلات الغذائية' : 'Enter dietary preferences'}
                />
              </div>
              <Button
                variant="hero"
                className="w-full"
                onClick={async () => {
                  updateProfile(editData as any);
                  setIsEditing(false);
                  if (user && supabase && supabase.from) {
                    try {
                      await supabase
                        .from('profiles')
                        .update({
                          fitness_level: editData.fitnessLevel || null,
                          training_days_per_week: editData.trainingDaysPerWeek || null,
                          equipment: editData.equipment || null,
                          injuries: editData.injuries || null,
                          activity_level: editData.activityLevel || null,
                          dietary_preferences: editData.dietaryPreferences || null,
                          chronic_conditions: editData.chronicConditions || null,
                          allergies: editData.allergies || null,
                          updated_at: new Date().toISOString(),
                        })
                        .eq('user_id', user.id);
                    } catch (error) {
                      console.warn('Failed updating profile in Supabase:', error);
                    }
                  }
                }}
              >
                {language === 'ar' ? 'حفظ التغييرات' : 'Save Changes'}
              </Button>
            </div>
          )}
          
          <Button variant="outline" className="w-full" onClick={() => navigate('/schedule')}>
            <Calendar className="w-4 h-4 mr-2" />
            {language === 'ar' ? 'جدول التمارين' : 'Workout Schedule'}
          </Button>
          {user && (
            <Button variant="ghost" className="w-full text-destructive hover:text-destructive" onClick={signOut}>
              <LogOut className="w-4 h-4 mr-2" />
              {language === 'ar' ? 'تسجيل الخروج' : 'Sign Out'}
            </Button>
          )}
        </motion.div>
      </main>
    </div>
  );
}
