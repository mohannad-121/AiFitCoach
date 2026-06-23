import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Apple,
  ArrowDownUp,
  BellRing,
  CalendarDays,
  Dumbbell,
  Inbox,
  MessageSquareText,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/hooks/use-toast';
import { buildScheduleTargetUrl } from '@/lib/adminNoteTargets';
import { cn } from '@/lib/utils';
import {
  CoachNotification,
  fetchCoachNotifications,
  getReadCoachNotificationIds,
  markCoachNotificationsRead,
  parseCoachNotification,
  setLastCoachNotificationTimestamp,
} from '@/lib/coachNotifications';
import './CoachNotifications.css';

const POLL_INTERVAL_MS = 20000;
type CategoryFilter = 'all' | CoachNotification['note_category'];
type RoleFilter = 'all' | CoachNotification['author_role'];
type SortOrder = 'newest' | 'oldest';

const categories: Array<{ value: CategoryFilter; icon: typeof BellRing }> = [
  { value: 'all', icon: BellRing },
  { value: 'general', icon: MessageSquareText },
  { value: 'workout', icon: Dumbbell },
  { value: 'nutrition', icon: Apple },
];

function formatDateTime(value: string | null | undefined, language: string) {
  if (!value) return language === 'ar' ? 'غير متوفر' : 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(language === 'ar' ? 'ar-JO' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function getCategoryLabel(category: CategoryFilter, language: string) {
  const labels = language === 'ar'
    ? { all: 'الكل', general: 'عام', workout: 'تمرين', nutrition: 'تغذية' }
    : { all: 'All', general: 'General', workout: 'Workout', nutrition: 'Nutrition' };
  return labels[category];
}

function getCategoryIcon(category: CoachNotification['note_category']) {
  if (category === 'workout') return Dumbbell;
  if (category === 'nutrition') return Apple;
  return MessageSquareText;
}

function timestamp(value?: string | null) {
  const result = value ? new Date(value).getTime() : 0;
  return Number.isFinite(result) ? result : 0;
}

export function CoachNotificationsPage() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<CoachNotification[]>([]);
  const [newThisVisit, setNewThisVisit] = useState<Set<string>>(() => new Set());
  const [storageReady, setStorageReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [role, setRole] = useState<RoleFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [query, setQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const text = useCallback((en: string, ar: string) => (language === 'ar' ? ar : en), [language]);

  const loadNotifications = useCallback(async (showErrorToast = true) => {
    if (!user?.id) {
      setNotifications([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetchCoachNotifications(user.id, 100);
      const previouslyRead = new Set(getReadCoachNotificationIds(user.id));
      const unreadNow = response.notifications.filter((item) => !previouslyRead.has(item.id)).map((item) => item.id);
      setNewThisVisit((current) => new Set([...current, ...unreadNow]));
      setNotifications(response.notifications);
      setStorageReady(response.storage_ready);
      setLastUpdated(new Date());

      const latest = [...response.notifications].sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at))[0];
      if (latest?.created_at) setLastCoachNotificationTimestamp(user.id, latest.created_at);
      markCoachNotificationsRead(user.id, response.notifications.map((notification) => notification.id));
    } catch (error) {
      if (showErrorToast) {
        toast({
          variant: 'destructive',
          title: text('Could not load notifications', 'تعذر تحميل الإشعارات'),
          description: error instanceof Error ? error.message : 'Request failed.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [text, toast, user?.id]);

  useEffect(() => {
    setNewThisVisit(new Set());
    void loadNotifications(false);
  }, [loadNotifications, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const intervalId = window.setInterval(() => void loadNotifications(false), POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadNotifications, user?.id]);

  const categoryCounts = useMemo(() => notifications.reduce<Record<string, number>>((counts, item) => {
    counts[item.note_category] = (counts[item.note_category] || 0) + 1;
    return counts;
  }, {}), [notifications]);

  const visibleNotifications = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return notifications
      .filter((item) => category === 'all' || item.note_category === category)
      .filter((item) => role === 'all' || item.author_role === role)
      .filter((item) => {
        if (!normalizedQuery) return true;
        const parsed = parseCoachNotification(item);
        return [item.author_name, parsed.clean_text, item.pinned_exercise?.name, item.related_date]
          .filter(Boolean)
          .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => sortOrder === 'newest'
        ? timestamp(b.created_at) - timestamp(a.created_at)
        : timestamp(a.created_at) - timestamp(b.created_at));
  }, [category, notifications, query, role, sortOrder]);

  return (
    <div className="coach-notes-page min-h-screen pb-24 md:pb-10">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl px-4 pt-24 sm:px-6">
        <motion.header
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="coach-notes-hero"
        >
          <div className="coach-notes-title-block">
            <div className="coach-notes-kicker"><BellRing />{text('COACH NOTES', 'ملاحظات المدرب')}</div>
            <h1>{text('Guidance, organized around you', 'إرشادات منظمة حول تقدمك')}</h1>
            <p>{text(
              'Review every workout, nutrition, and follow-up note from your coach or doctor in one focused timeline.',
              'راجع كل ملاحظات التمرين والتغذية والمتابعة من مدربك أو طبيبك في مكان واحد.'
            )}</p>
          </div>
          <div className="coach-notes-summary" aria-label={text('Notification summary', 'ملخص الإشعارات')}>
            <div><span>{text('Total notes', 'كل الملاحظات')}</span><strong>{notifications.length}</strong></div>
            <div><span>{text('New this visit', 'جديد في هذه الزيارة')}</span><strong>{newThisVisit.size}</strong></div>
            <Button variant="outline" onClick={() => void loadNotifications(true)} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              {text('Refresh', 'تحديث')}
            </Button>
          </div>
        </motion.header>

        {!storageReady && (
          <div className="coach-notes-warning">
            {text('The admin notes table is not ready yet. Run the admin_user_notes Supabase migration first.', 'جدول ملاحظات الإدارة غير جاهز. شغّل ترحيل admin_user_notes في Supabase أولاً.')}
          </div>
        )}

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.45 }}
          className="coach-notes-toolbar"
          aria-label={text('Notification filters', 'مرشحات الإشعارات')}
        >
          <div className="coach-notes-search">
            <Search />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text('Search notes or exercises', 'ابحث في الملاحظات أو التمارين')} />
          </div>

          <div className="coach-notes-category-tabs">
            {categories.map((item) => {
              const Icon = item.icon;
              const count = item.value === 'all' ? notifications.length : categoryCounts[item.value] || 0;
              return (
                <button key={item.value} type="button" onClick={() => setCategory(item.value)} className={cn(category === item.value && 'is-active')}>
                  <Icon /><span>{getCategoryLabel(item.value, language)}</span><small>{count}</small>
                </button>
              );
            })}
          </div>

          <div className="coach-notes-selects">
            <Select value={role} onValueChange={(value) => setRole(value as RoleFilter)}>
              <SelectTrigger aria-label={text('Filter by sender', 'تصفية حسب المرسل')}><UserRound /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{text('All senders', 'كل المرسلين')}</SelectItem>
                <SelectItem value="coach">{text('Coaches', 'المدربون')}</SelectItem>
                <SelectItem value="doctor">{text('Doctors', 'الأطباء')}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as SortOrder)}>
              <SelectTrigger aria-label={text('Sort notes', 'ترتيب الملاحظات')}><ArrowDownUp /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">{text('Newest first', 'الأحدث أولاً')}</SelectItem>
                <SelectItem value="oldest">{text('Oldest first', 'الأقدم أولاً')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </motion.section>

        <div className="coach-notes-results-meta">
          <span>{text(`${visibleNotifications.length} notes`, `${visibleNotifications.length} ملاحظات`)}</span>
          {lastUpdated && <span>{text('Updated', 'آخر تحديث')}: {lastUpdated.toLocaleTimeString(language === 'ar' ? 'ar-JO' : 'en-US', { hour: '2-digit', minute: '2-digit' })}</span>}
        </div>

        <section className="coach-notes-list" aria-live="polite">
          {loading && notifications.length === 0 && (
            <div className="coach-notes-loading" aria-label={text('Loading notes', 'جاري تحميل الملاحظات')}>
              {[0, 1, 2].map((item) => <span key={item} />)}
            </div>
          )}
          <AnimatePresence mode="popLayout">
            {visibleNotifications.map((notification, index) => {
              const parsedNotification = parseCoachNotification(notification);
              const CategoryIcon = getCategoryIcon(notification.note_category);
              const isNew = newThisVisit.has(notification.id);
              return (
                <motion.article
                  layout
                  key={notification.id}
                  initial={{ opacity: 0, y: 22, rotateX: 3 }}
                  animate={{ opacity: 1, y: 0, rotateX: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ delay: Math.min(index * 0.045, 0.3), duration: 0.4 }}
                  whileHover={{ y: -4, rotateX: 1, rotateY: index % 2 ? -0.7 : 0.7 }}
                  className={cn('coach-note-card', `is-${notification.note_category}`, isNew && 'is-new')}
                >
                  <div className="coach-note-accent" aria-hidden="true" />
                  <div className="coach-note-icon">
                    {notification.author_role === 'doctor' ? <Stethoscope /> : <ShieldCheck />}
                  </div>
                  <div className="coach-note-content">
                    <div className="coach-note-topline">
                      <div>
                        <div className="coach-note-author">
                          <strong>{notification.author_name || (notification.author_role === 'doctor' ? text('Doctor', 'الطبيب') : text('Coach', 'المدرب'))}</strong>
                          {isNew && <span className="coach-note-new"><Sparkles />{text('New', 'جديد')}</span>}
                        </div>
                        <div className="coach-note-tags">
                          <span><CategoryIcon />{getCategoryLabel(notification.note_category, language)}</span>
                          <span>{notification.author_role === 'doctor' ? text('Doctor', 'طبيب') : text('Coach', 'مدرب')}</span>
                        </div>
                      </div>
                      <div className="coach-note-date">
                        <time dateTime={notification.created_at || undefined}>{formatDateTime(notification.created_at, language)}</time>
                        {notification.related_date && <span><CalendarDays />{notification.related_date}</span>}
                      </div>
                    </div>

                    <p className="coach-note-message">{parsedNotification.clean_text}</p>

                    {parsedNotification.schedule_target && (
                      <div className="coach-note-actions">
                        {parsedNotification.schedule_target.itemName && (
                          <span className="coach-note-target">{parsedNotification.schedule_target.itemName}</span>
                        )}
                        <Button variant="outline" onClick={() => navigate(buildScheduleTargetUrl(parsedNotification.schedule_target!))}>
                          <CalendarDays />{text('Open in schedule', 'فتح في الجدول')}
                        </Button>
                      </div>
                    )}
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>

          {!loading && visibleNotifications.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="coach-notes-empty">
              <Inbox />
              <h2>{query || category !== 'all' || role !== 'all' ? text('No matching notes', 'لا توجد ملاحظات مطابقة') : text('No notes yet', 'لا توجد ملاحظات بعد')}</h2>
              <p>{text('New guidance from your coach or doctor will appear here.', 'ستظهر هنا أي إرشادات جديدة من مدربك أو طبيبك.')}</p>
            </motion.div>
          )}
        </section>
      </main>
    </div>
  );
}
