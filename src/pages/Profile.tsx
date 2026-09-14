import { ProfileEditor } from '@/components/profile/ProfileEditor';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import './Profile.css';
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
      className="rounded-[1.35rem] border border-border bg-card px-4 py-4 shadow-sm"
    >
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/15 bg-cyan-400/10">
          <Icon className="h-4 w-4 text-cyan-700" />
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
    <div className="rounded-2xl border border-border bg-muted/40 p-4">
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
    <section className={`relative overflow-hidden rounded-[1.75rem] border border-border bg-card p-5 shadow-sm  ${className}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          {kicker ? <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.26em] text-cyan-700/70">{kicker}</p> : null}
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        </div>
        {Icon ? (
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-cyan-400/15 bg-cyan-400/10">
            <Icon className="h-5 w-5 text-cyan-700" />
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
    ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-700'
    : tone === 'warning'
      ? 'border-amber-400/20 bg-amber-400/10 text-amber-700'
      : 'border-border bg-muted/40 text-foreground';

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
  const [section, setSection] = useState('body');
  const [connectIntro, setConnectIntro] = useState(false);
  const [fitbitExpired, setFitbitExpired] = useState(false);
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
    if (user && supabase && supabase.from) {
        const { data, error } = await supabase.from('profiles').update({
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        }).eq('user_id', user.id).select('id');
        if (error) throw error;
        if (hasConfiguredSupabase && !data?.length) throw new Error(language === 'ar' ? 'تعذر حفظ الصورة.' : 'The photo could not be saved.');
    }
    updateProfile({ avatarUrl });
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
      setFitbitExpired(false);
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
        setFitbitExpired(true);
        setFitbitStatus((previous) => ({ configured: previous?.configured ?? true, connected: false }));
        return;
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


  const ar = language === 'ar';
  const sections = [
    ['body', ar ? 'الجسم والأهداف' : 'Body & goals', Target],
    ['training', ar ? 'تفضيلات التدريب' : 'Training preferences', Weight],
    ['health', ar ? 'الصحة والتغذية' : 'Health & nutrition', HeartPulse],
    ['activity', ar ? 'النشاط والتقدم' : 'Activity & progress', Activity],
    ['devices', ar ? 'الأجهزة المتصلة' : 'Connected devices', Zap],
    ['account', ar ? 'الحساب' : 'Account', User],
  ] as const;
  return <div className="aura-profile min-h-screen"><Navbar /><main>
    <header className="profile-identity">
      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
      <button type="button" className="profile-avatar" onClick={() => avatarInputRef.current?.click()} aria-label={ar ? 'تغيير الصورة' : 'Change profile photo'}>{displayAvatarUrl ? <img src={displayAvatarUrl} alt={profile.name} /> : <User size={30} />}<Camera /></button>
      <div><small className="text-primary">{ar ? 'مساحتك الشخصية' : 'YOUR HEALTH, YOUR WAY'}</small><h1>{profile.name}</h1><p>{displayGoal} · {ar ? 'تم إعداد ملفك' : 'Profile ready'}</p></div>
      <Button variant="outline" onClick={() => setIsEditing(true)}><Edit size={16} className="me-2" />{ar ? 'تعديل الملف' : 'Edit profile'}</Button>
    </header>
    <dl className="profile-metrics">{[
      [ar ? 'العمر' : 'Age',profile.age], [ar ? 'الطول' : 'Height',profile.height+' cm'], [ar ? 'الوزن' : 'Weight',profile.weight+' kg'], [ar ? 'الهدف' : 'Goal',displayGoal], [ar ? 'أيام أسبوعياً' : 'Days / week',profile.trainingDaysPerWeek],
    ].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="profile-layout"><nav className="profile-sections" aria-label={ar ? 'أقسام الملف' : 'Profile sections'}>{sections.map(([id,label,Icon]) => <button key={id} aria-current={section===id ? 'page' : undefined} onClick={() => setSection(id)}><Icon size={18} />{label}</button>)}</nav>
    <div className="profile-panel">
      {section === 'body' && <section><h2>{ar ? 'الجسم والأهداف' : 'Body & goals'}</h2><p>{ar ? 'أساس خطة تناسبك. حدّث قياساتك عندما تتغير.' : 'The starting point for a plan that fits you. Update your measurements as they change.'}</p><div className="profile-info-grid"><InfoRow label={ar ? 'هدفك' : 'Your focus'} value={displayGoal} /><InfoRow label={ar ? 'الجنس' : 'Gender'} value={displayGender} /><InfoRow label={ar ? 'الوزن الحالي' : 'Current weight'} value={profile.weight+' kg'} /><InfoRow label={ar ? 'الطول' : 'Height'} value={profile.height+' cm'} /></div><Button onClick={() => setIsEditing(true)}>{ar ? 'تحديث قياساتي' : 'Update my measurements'}</Button></section>}
      {section === 'training' && <section><h2>{ar ? 'تدريب يناسب حياتك' : 'Training that fits your life'}</h2><div className="profile-info-grid"><InfoRow label={ar ? 'المستوى' : 'Experience'} value={t('onboarding.'+profile.fitnessLevel)} /><InfoRow label={ar ? 'المكان' : 'Location'} value={t('onboarding.'+profile.location)} /><InfoRow label={ar ? 'أيام أسبوعياً' : 'Days per week'} value={profile.trainingDaysPerWeek} /><InfoRow label={ar ? 'المعدات' : 'Equipment'} value={profile.equipment || (ar ? 'غير محدد' : 'Not provided')} /></div><Button onClick={() => navigate('/workouts')}>{ar ? 'استكشف التمارين' : 'Explore workouts'}</Button></section>}
      {section === 'health' && <section><h2>{ar ? 'الصحة والتغذية' : 'Health & nutrition'}</h2><p>{ar ? 'هذه التفاصيل اختيارية. شارك ما يساعد على تخصيص تدريبك بأمان.' : 'These details are optional. Share what helps your coach adapt your training.'}</p><div className="profile-info-grid">{[[ar ? 'الإصابات' : 'Injuries',profile.injuries],[ar ? 'الحالات الصحية' : 'Conditions',profile.chronicConditions],[ar ? 'التفضيلات الغذائية' : 'Dietary preferences',profile.dietaryPreferences],[ar ? 'الحساسية' : 'Allergies',profile.allergies]].map(([label,value]) => <InfoRow key={label} label={label} value={value || (ar ? 'لم تتم المشاركة' : 'Not shared')} />)}</div><Button variant="outline" onClick={() => setIsEditing(true)}>{ar ? 'تحديث المعلومات الصحية' : 'Update health details'}</Button></section>}
      {section === 'activity' && <section><h2>{ar ? 'النشاط والتقدم' : 'Activity & progress'}</h2><p>{ar ? 'تابع روتينك الأسبوعي والبيانات التي سجلها جهازك.' : 'Keep your weekly routine and recorded activity in view.'}</p><div className="profile-info-grid"><InfoRow label={ar ? 'مستوى النشاط' : 'Activity level'} value={t('onboarding.activity.'+profile.activityLevel)} /><InfoRow label={ar ? 'هدف التدريب الأسبوعي' : 'Weekly training target'} value={profile.trainingDaysPerWeek} /></div>{fitbitStatus?.connected ? <HeartRateTimelinePanel userId={currentUserId} enabled /> : <p>{ar ? 'اربط Fitbit لعرض بيانات نشاطك.' : 'Connect Fitbit to see your recorded activity.'}</p>}<div className="profile-device-actions"><Button onClick={() => navigate('/schedule')}>{ar ? 'افتح مخططي' : 'Open my planner'}</Button><Button variant="outline" onClick={() => setSection('devices')}>{ar ? 'أجهزتي' : 'My devices'}</Button></div></section>}
      {section === 'devices' && <section><div className="flex justify-between gap-4"><h2>Fitbit</h2><StatusBadge tone={fitbitStatus?.connected && !fitbitExpired ? 'success' : 'default'}>{fitbitExpired ? (ar ? 'يلزم إعادة الربط' : 'Reconnect needed') : fitbitStatus?.connected ? (ar ? 'متصل' : 'Connected') : (ar ? 'غير متصل' : 'Not connected')}</StatusBadge></div>
        <p>{ar ? 'اربط Fitbit لمزامنة نشاطك وبياناتك الصحية تلقائياً.' : 'Connect your Fitbit to automatically sync activity and health metrics.'}</p>
        {fitbitLoading ? <p role="status">{ar ? 'جارٍ التحقق من الاتصال…' : 'Checking connection…'}</p> : fitbitStatus?.connected && !fitbitExpired ? <><p className="mt-4 text-sm">{ar ? 'آخر مزامنة: ' : 'Last synced: '}{fitbitStatus.last_sync_at ? new Date(fitbitStatus.last_sync_at).toLocaleString(ar ? 'ar' : 'en') : (ar ? 'لم تتم المزامنة بعد' : 'Not synced yet')}</p><div className="profile-info-grid">{fitbitMetricCards.map(metric => <InfoRow key={metric.label} label={metric.label} value={metric.value} />)}</div>{!!fitbitStatus.today_summary?.food_names?.length && <InfoRow label={ar ? 'أطعمة اليوم' : "Today's foods"} value={fitbitStatus.today_summary.food_names.join(', ')} />}<div className="profile-device-actions"><Button onClick={handleFitbitSync} disabled={fitbitBusyAction !== null}>{fitbitBusyAction === 'sync' ? (ar ? 'جارٍ المزامنة…' : 'Syncing…') : (ar ? 'مزامنة الآن' : 'Sync now')}</Button><Button variant="outline" onClick={handleFitbitDisconnect} disabled={fitbitBusyAction !== null}>{ar ? 'فصل الجهاز' : 'Disconnect'}</Button></div></> : <div className="profile-device-actions"><Button onClick={() => setConnectIntro(true)} disabled={!fitbitStatus?.configured || fitbitBusyAction !== null}>{fitbitExpired ? (ar ? 'إعادة ربط Fitbit' : 'Reconnect Fitbit') : (ar ? 'ربط Fitbit' : 'Connect Fitbit')}</Button>{!fitbitStatus?.configured && <p>{ar ? 'الاتصال غير متاح حالياً.' : 'Connection is currently unavailable.'} <button className="underline" onClick={() => fetchFitbitStatus(currentUserId)}>{ar ? 'إعادة المحاولة' : 'Retry'}</button></p>}</div>}
      </section>}
      {section === 'account' && <section><h2>{ar ? 'حسابك' : 'Your account'}</h2><div className="profile-info-grid"><InfoRow label={ar ? 'البريد الإلكتروني' : 'Email'} value={user?.email} /><InfoRow label={ar ? 'الملف' : 'Profile'} value={ar ? 'مكتمل' : 'Complete'} /></div><div className="profile-device-actions"><Button onClick={() => navigate('/subscription')}>{ar ? 'إدارة الاشتراك' : 'Manage subscription'}</Button><Button variant="outline" onClick={async () => { await signOut(); navigate('/auth'); }}><LogOut size={16} className="me-2" />{ar ? 'تسجيل الخروج' : 'Sign out'}</Button></div></section>}
    </div></div>
    {isEditing && <ProfileEditor profile={profile} userId={currentUserId} onSaved={updateProfile} onClose={() => setIsEditing(false)} />}
    <Dialog open={connectIntro} onOpenChange={setConnectIntro}><DialogContent dir={ar ? 'rtl' : 'ltr'}><DialogHeader><DialogTitle>{ar ? 'اربط جهاز Fitbit' : 'Connect your Fitbit'}</DialogTitle><DialogDescription>{ar ? 'ثلاث خطوات، وستكون جاهزاً.' : 'Three short steps, then you’re ready.'}</DialogDescription></DialogHeader><ol className="list-decimal ps-5 space-y-4 py-4"><li>{ar ? 'تابع إلى Fitbit بأمان.' : 'Continue securely to Fitbit.'}</li><li>{ar ? 'سجل الدخول ووافق على مشاركة بياناتك.' : 'Sign in and approve sharing your data.'}</li><li>{ar ? 'عد هنا لعرض حالة المزامنة.' : 'Return here to see your sync status.'}</li></ol><Button onClick={handleFitbitConnect} disabled={fitbitBusyAction !== null}>{ar ? 'المتابعة إلى Fitbit' : 'Continue to Fitbit'}</Button></DialogContent></Dialog>
  </main></div>;
}
