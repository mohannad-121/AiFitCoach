import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BellRing, RefreshCw, ShieldCheck, Stethoscope } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { buildScheduleTargetUrl } from '@/lib/adminNoteTargets';
import {
  CoachNotification,
  fetchCoachNotifications,
  getReadCoachNotificationIds,
  markCoachNotificationsRead,
  parseCoachNotification,
  setLastCoachNotificationTimestamp,
} from '@/lib/coachNotifications';

const POLL_INTERVAL_MS = 20000;

function formatDateTime(value: string | null | undefined, language: string) {
  if (!value) {
    return language === 'ar' ? 'غير متوفر' : 'Not available';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function getCategoryLabel(category: CoachNotification['note_category'], language: string) {
  if (language === 'ar') {
    return {
      general: 'ملاحظة عامة',
      workout: 'ملاحظة تمرين',
      nutrition: 'ملاحظة تغذية',
    }[category] || 'ملاحظة عامة';
  }

  return {
    general: 'General',
    workout: 'Workout',
    nutrition: 'Nutrition',
  }[category] || 'General';
}

export function CoachNotificationsPage() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<CoachNotification[]>([]);
  const [storageReady, setStorageReady] = useState(true);
  const [loading, setLoading] = useState(false);

  const unreadIds = useMemo(() => {
    if (!user?.id) {
      return [];
    }
    const readIds = new Set(getReadCoachNotificationIds(user.id));
    return notifications.filter((notification) => !readIds.has(notification.id)).map((notification) => notification.id);
  }, [notifications, user?.id]);

  const loadNotifications = async (showErrorToast = true) => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetchCoachNotifications(user.id, 100);
      setNotifications(response.notifications);
      setStorageReady(response.storage_ready);

      if (response.notifications.length > 0 && response.notifications[0].created_at) {
        setLastCoachNotificationTimestamp(user.id, response.notifications[0].created_at);
      }
      markCoachNotificationsRead(user.id, response.notifications.map((notification) => notification.id));
    } catch (error) {
      if (showErrorToast) {
        toast({
          variant: 'destructive',
          title: language === 'ar' ? 'تعذر تحميل الإشعارات' : 'Could not load notifications',
          description: error instanceof Error ? error.message : 'Request failed.',
        });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNotifications(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadNotifications(false);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [user?.id]);

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <Navbar />
      <main className="container mx-auto max-w-5xl px-4 pt-24">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-primary">
              <BellRing className="h-4 w-4" />
              <span>{language === 'ar' ? 'إشعارات المدرب والطبيب' : 'Coach Notifications'}</span>
            </div>
            <h1 className="font-display mb-2 text-4xl text-foreground">
              {language === 'ar' ? 'كل الملاحظات التي وصلتك' : 'All notes sent to you'}
            </h1>
            <p className="max-w-3xl text-muted-foreground">
              {language === 'ar'
                ? 'هنا ستجد جميع الملاحظات التي يرسلها لك الطبيب أو المدرب، سواء كانت عن التمرين أو التغذية أو أي متابعة عامة.'
                : 'This page collects every note your coach or doctor sends you about workouts, nutrition, or general follow-up.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-border/60 bg-secondary/30 px-4 py-3 text-sm text-muted-foreground">
              {language === 'ar' ? 'الإشعارات غير المقروءة قبل الفتح' : 'Unread before opening'}: <span className="font-semibold text-foreground">{unreadIds.length}</span>
            </div>
            <Button variant="outline" onClick={() => void loadNotifications(true)} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {language === 'ar' ? 'تحديث' : 'Refresh'}
            </Button>
          </div>
        </motion.div>

        {!storageReady && (
          <div className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            {language === 'ar'
              ? 'جدول ملاحظات الإدارة غير جاهز بعد. شغّل هجرة Supabase الخاصة بـ admin_user_notes أولاً.'
              : 'The admin notes table is not ready yet. Run the admin_user_notes Supabase migration first.'}
          </div>
        )}

        <div className="space-y-4">
          {notifications.map((notification) => {
            const parsedNotification = parseCoachNotification(notification);
            return (
              <div key={notification.id} className="glass-card rounded-3xl border border-border/60 p-6">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      {notification.author_role === 'doctor' ? <Stethoscope className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                    </div>
                    <div>
                      <div className="font-semibold text-foreground">{notification.author_name || (notification.author_role === 'doctor' ? 'Doctor' : 'Coach')}</div>
                      <div className="text-sm text-muted-foreground">
                        {notification.author_role === 'doctor'
                          ? language === 'ar' ? 'طبيب' : 'Doctor'
                          : language === 'ar' ? 'مدرب' : 'Coach'}
                        {' • '}
                        {getCategoryLabel(notification.note_category, language)}
                      </div>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <div>{formatDateTime(notification.created_at, language)}</div>
                    {notification.related_date && (
                      <div>
                        {language === 'ar' ? 'مرتبط بتاريخ' : 'Related date'}: {notification.related_date}
                      </div>
                    )}
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-base text-foreground">{parsedNotification.clean_text}</p>
                {parsedNotification.schedule_target && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {parsedNotification.schedule_target.itemName && (
                      <button
                        type="button"
                        onClick={() => navigate(buildScheduleTargetUrl(parsedNotification.schedule_target as NonNullable<typeof parsedNotification.schedule_target>))}
                        className="rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary hover:text-primary-foreground"
                      >
                        {parsedNotification.schedule_target.itemName}
                      </button>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => navigate(buildScheduleTargetUrl(parsedNotification.schedule_target as NonNullable<typeof parsedNotification.schedule_target>))}
                    >
                      {language === 'ar' ? 'افتح في الجدول' : 'Open in schedule'}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}

          {!loading && notifications.length === 0 && (
            <div className="glass-card rounded-3xl border border-border/60 p-10 text-center text-muted-foreground">
              {language === 'ar' ? 'لا توجد ملاحظات من المدرب أو الطبيب حتى الآن.' : 'No coach or doctor notes have been sent to you yet.'}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}