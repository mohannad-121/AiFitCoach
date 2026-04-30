import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import {
  fetchCoachNotifications,
  getLastCoachNotificationTimestamp,
  markCoachNotificationsRead,
  setLastCoachNotificationTimestamp,
  truncateNotificationText,
} from '@/lib/coachNotifications';

const POLL_INTERVAL_MS = 15000;

export function CoachNotificationsListener() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const location = useLocation();
  const isFetchingRef = useRef(false);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      return;
    }

    let isMounted = true;

    const pollNotifications = async () => {
      if (!isMounted || isFetchingRef.current) {
        return;
      }

      isFetchingRef.current = true;
      try {
        const response = await fetchCoachNotifications(userId, 20);
        const latestTimestamp = response.notifications[0]?.created_at;
        const previousTimestamp = getLastCoachNotificationTimestamp(userId);

        if (!previousTimestamp) {
          if (latestTimestamp) {
            setLastCoachNotificationTimestamp(userId, latestTimestamp);
          }
          return;
        }

        const previousTimeValue = new Date(previousTimestamp).getTime();
        const nextNotifications = response.notifications.filter((notification) => {
          if (!notification.created_at) {
            return false;
          }
          return new Date(notification.created_at).getTime() > previousTimeValue;
        });

        if (nextNotifications.length > 0) {
          const newest = nextNotifications[0];
          if (location.pathname !== '/coach-notifications') {
            toast({
              title: language === 'ar' ? 'وصلتك ملاحظة جديدة من المدرب أو الطبيب' : 'New coach or doctor note',
              description:
                nextNotifications.length > 1
                  ? language === 'ar'
                    ? `${nextNotifications.length} ملاحظات جديدة. أحدثها: ${truncateNotificationText(newest.note_text, 110)}`
                    : `${nextNotifications.length} new notes. Latest: ${truncateNotificationText(newest.note_text, 110)}`
                  : truncateNotificationText(newest.note_text, 140),
            });
          } else {
            markCoachNotificationsRead(userId, nextNotifications.map((notification) => notification.id));
          }

          if (newest.created_at) {
            setLastCoachNotificationTimestamp(userId, newest.created_at);
          }
        }
      } catch {
        // Silent polling failures keep the main app responsive.
      } finally {
        isFetchingRef.current = false;
      }
    };

    void pollNotifications();
    const intervalId = window.setInterval(() => {
      void pollNotifications();
    }, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [language, location.pathname, toast, user?.id]);

  return null;
}