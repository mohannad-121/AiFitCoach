import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, FileHeart, HeartPulse, LockKeyhole, RefreshCw, Search, ShieldCheck, StickyNote, Users } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { WorkoutEvidenceReportSection } from '@/pages/Reports';
import { useToast } from '@/hooks/use-toast';
import { encodeAdminNoteTarget, stripAdminNoteTarget } from '@/lib/adminNoteTargets';

const AI_BACKEND_URL = (import.meta.env.VITE_AI_BACKEND_URL || 'http://127.0.0.1:8002').replace(/\/$/, '');
const ADMIN_SESSION_KEY = 'fitcoach_admin_session';

type AdminSession = {
  password: string;
  actorName: string;
  role: 'coach' | 'doctor';
};

type AdminUserSummary = {
  user_id: string;
  name: string;
  goal?: string;
  fitness_level?: string;
  location?: string;
  updated_at?: string | null;
  tracking_summary?: {
    adherence_score?: number;
    completed_last_7_days?: number;
    last_completed_at?: string | null;
    last_log_date?: string | null;
    weekly_stats?: {
      workout_adherence_percent?: number;
      logging_consistency_percent?: number;
      current_workout_streak_days?: number;
    };
  };
  latest_note?: {
    note_text?: string;
    author_name?: string;
    created_at?: string | null;
  } | null;
};

type AdminUserDetail = {
  user_id: string;
  user?: Record<string, unknown>;
  context?: {
    tracking_summary?: {
      adherence_score?: number;
      completed_last_7_days?: number;
      total_tasks?: number;
      completed_tasks?: number;
      last_completed_at?: string | null;
      last_log_date?: string | null;
      active_plan_details?: Array<{
        title?: string;
        type?: string;
        weekly_days_with_items?: number;
        sample_exercises?: string[];
        sample_meals?: string[];
      }>;
      weekly_stats?: {
        workout_adherence_percent?: number;
        logging_consistency_percent?: number;
        current_workout_streak_days?: number;
        current_logging_streak_days?: number;
      };
      recent_activity?: Array<{
        date?: string;
        completed_exercises?: number;
        workout_notes?: string;
        nutrition_notes?: string;
        mood?: string;
      }>;
    };
  };
  fitbit_status?: {
    connected?: boolean;
    coach_summary?: {
      latest_resting_heart_rate?: number | null;
      active_minutes_total?: number;
      heart_zone_active_minutes?: number;
      last_sync_at?: string | null;
    };
  };
  evidence?: Array<{
    id: string;
    evidence_date?: string;
    confidence?: string;
    workout_detected_today?: boolean;
    evidence_score?: number;
    detection_reasons?: string[];
  }>;
  notes?: Array<{
    id: string;
    note_text?: string;
    note_category?: string;
    author_name?: string;
    author_role?: string;
    related_date?: string | null;
    created_at?: string | null;
  }>;
};

const formatDateTime = (value: string | null | undefined, language: string) => {
  if (!value) return language === 'ar' ? 'غير متوفر' : 'Not available';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const formatPercent = (value: number | undefined) => `${Math.round((value || 0) * 100)}%`;

const compactText = (value: string | undefined, fallback: string) => {
  const clean = String(value || '').trim();
  return clean || fallback;
};

export function AdminPage() {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [verifyingAccess, setVerifyingAccess] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [activePanel, setActivePanel] = useState<'overview' | 'notes' | 'report'>('overview');
  const [loginForm, setLoginForm] = useState({ password: '', actorName: '', role: 'coach' as 'coach' | 'doctor' });
  const [noteForm, setNoteForm] = useState({ note_text: '', note_category: 'general', related_date: '', target_item: '' });

  const adminHeaders = (activeSession: AdminSession) => ({
    'Content-Type': 'application/json',
    'X-Admin-Password': activeSession.password,
    'X-Admin-Actor': activeSession.actorName,
    'X-Admin-Role': activeSession.role,
  });

  const clearSession = () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    setSession(null);
    setUsers([]);
    setSelectedUserId(null);
    setDetail(null);
  };

  const handleUnauthorized = () => {
    clearSession();
    toast({
      variant: 'destructive',
      title: language === 'ar' ? 'انتهت جلسة الإدارة' : 'Admin session expired',
      description: language === 'ar' ? 'أدخل كلمة مرور لوحة الإدارة مرة أخرى.' : 'Enter the admin panel password again.',
    });
  };

  const fetchUsers = async (activeSession: AdminSession) => {
    setLoadingUsers(true);
    try {
      const response = await fetch(`${AI_BACKEND_URL}/admin/users?limit=30`, {
        headers: adminHeaders(activeSession),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed loading admin users');
      }
      const nextUsers = Array.isArray(payload?.users) ? (payload.users as AdminUserSummary[]) : [];
      setUsers(nextUsers);
      setSelectedUserId((current) => current || nextUsers[0]?.user_id || null);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'تعذر تحميل المستخدمين' : 'Could not load users',
        description: error instanceof Error ? error.message : 'Request failed.',
      });
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchDetail = async (activeSession: AdminSession, userId: string) => {
    setLoadingDetail(true);
    try {
      const response = await fetch(`${AI_BACKEND_URL}/admin/users/${encodeURIComponent(userId)}?evidence_limit=14&notes_limit=20`, {
        headers: adminHeaders(activeSession),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed loading user detail');
      }
      setDetail(payload as AdminUserDetail);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'تعذر تحميل التفاصيل' : 'Could not load details',
        description: error instanceof Error ? error.message : 'Request failed.',
      });
    } finally {
      setLoadingDetail(false);
    }
  };

  const verifyAndOpenAdmin = async () => {
    setVerifyingAccess(true);
    const nextSession: AdminSession = {
      password: loginForm.password.trim(),
      actorName: loginForm.actorName.trim(),
      role: loginForm.role,
    };

    try {
      const response = await fetch(`${AI_BACKEND_URL}/admin/status`, {
        headers: adminHeaders(nextSession),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Invalid admin access');
      }
      sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      toast({
        title: language === 'ar' ? 'تم فتح لوحة الإدارة' : 'Admin panel unlocked',
        description: language === 'ar' ? 'يمكنك الآن متابعة المستخدمين وإضافة الملاحظات.' : 'You can now track users and leave notes.',
      });
    } catch (error) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'فشل التحقق' : 'Access failed',
        description: error instanceof Error ? error.message : 'Request failed.',
      });
    } finally {
      setVerifyingAccess(false);
    }
  };

  const submitNote = async () => {
    if (!session || !selectedUserId) return;
    setSavingNote(true);
    try {
      const response = await fetch(`${AI_BACKEND_URL}/admin/users/${encodeURIComponent(selectedUserId)}/notes`, {
        method: 'POST',
        headers: adminHeaders(session),
        body: JSON.stringify({
          note_text: encodeAdminNoteTarget(
            noteForm.note_text,
            noteForm.note_category === 'workout'
              ? {
                  view: 'workout',
                  date: noteForm.related_date || new Date().toISOString().slice(0, 10),
                  itemName: noteForm.target_item || null,
                }
              : null,
          ),
          note_category: noteForm.note_category,
          related_date: noteForm.related_date || null,
          author_name: session.actorName,
          author_role: session.role,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.status === 403) {
        handleUnauthorized();
        return;
      }
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed saving note');
      }
      setNoteForm({ note_text: '', note_category: noteForm.note_category, related_date: '', target_item: '' });
      toast({
        title: language === 'ar' ? 'تم حفظ الملاحظة' : 'Note saved',
        description: language === 'ar' ? 'أصبحت الملاحظة متاحة في سجل المستخدم.' : 'The note is now visible in the user timeline.',
      });
      await fetchDetail(session, selectedUserId);
      await fetchUsers(session);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'تعذر حفظ الملاحظة' : 'Could not save note',
        description: error instanceof Error ? error.message : 'Request failed.',
      });
    } finally {
      setSavingNote(false);
    }
  };

  useEffect(() => {
    const stored = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as AdminSession;
      if (parsed?.password) {
        setSession(parsed);
        setLoginForm({
          password: parsed.password,
          actorName: parsed.actorName || '',
          role: parsed.role || 'coach',
        });
      }
    } catch {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    fetchUsers(session);
  }, [session]);

  useEffect(() => {
    if (!session || !selectedUserId) return;
    fetchDetail(session, selectedUserId);
  }, [session, selectedUserId]);

  const trackingSummary = detail?.context?.tracking_summary;
  const coachSummary = detail?.fitbit_status?.coach_summary;
  const workoutTargetOptions = useMemo(() => {
    const items = new Set<string>();
    (trackingSummary?.active_plan_details || []).forEach((plan) => {
      (plan.sample_exercises || []).forEach((exerciseName) => {
        const clean = String(exerciseName || '').trim();
        if (clean) {
          items.add(clean);
        }
      });
    });
    return Array.from(items);
  }, [trackingSummary?.active_plan_details]);

  const filteredUsers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) {
      return users;
    }

    return users.filter((user) => compactText(user.name, 'Unnamed user').toLowerCase().includes(normalizedSearch));
  }, [searchTerm, users]);
  const detailTabs = [
    {
      id: 'overview' as const,
      icon: Activity,
      label: language === 'ar' ? 'نظرة عامة' : 'Overview',
    },
    {
      id: 'notes' as const,
      icon: StickyNote,
      label: language === 'ar' ? 'الملاحظات' : 'Notes',
    },
    {
      id: 'report' as const,
      icon: FileHeart,
      label: language === 'ar' ? 'التقرير' : 'Report',
    },
  ];

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <Navbar />
      <main className="container mx-auto px-4 pt-24 max-w-7xl">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-4 py-2 mb-4">
              <ShieldCheck className="w-4 h-4" />
              <span>{language === 'ar' ? 'لوحة الإدارة الطبية' : 'Medical Admin Panel'}</span>
            </div>
            <h1 className="font-display text-4xl text-foreground mb-2">
              {language === 'ar' ? 'متابعة المستخدمين وخططهم' : 'Track users, plans, and notes'}
            </h1>
            <p className="text-muted-foreground max-w-3xl">
              {language === 'ar'
                ? 'هذه اللوحة مخصصة للمدربين والأطباء فقط. يمكنك مراجعة التقدم، التمارين المكتملة، بيانات Fitbit، ثم كتابة ملاحظات على التمرين أو التغذية.'
                : 'This panel is for coaches and doctors only. Review progress, completed workouts, Fitbit evidence, and leave workout or nutrition notes.'}
            </p>
          </div>
          {session && (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => fetchUsers(session)} disabled={loadingUsers}>
                <RefreshCw className={`w-4 h-4 mr-2 ${loadingUsers ? 'animate-spin' : ''}`} />
                {language === 'ar' ? 'تحديث' : 'Refresh'}
              </Button>
              <Button variant="ghost" onClick={clearSession}>
                {language === 'ar' ? 'قفل اللوحة' : 'Lock Panel'}
              </Button>
            </div>
          )}
        </motion.div>

        {!session ? (
          <div className="max-w-xl mx-auto glass-card rounded-3xl p-8 border border-border/60">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <LockKeyhole className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-2xl font-semibold">{language === 'ar' ? 'كلمة مرور خاصة' : 'Special password required'}</h2>
                <p className="text-sm text-muted-foreground">{language === 'ar' ? 'أدخل كلمة مرور الإدارة واسم الشخص الذي يكتب الملاحظات.' : 'Enter the admin password and the person leaving notes.'}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{language === 'ar' ? 'كلمة المرور' : 'Password'}</label>
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                  className="w-full rounded-xl border border-border/60 bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder={language === 'ar' ? 'أدخل كلمة مرور الإدارة' : 'Enter admin panel password'}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{language === 'ar' ? 'اسم الطبيب أو المدرب' : 'Coach or doctor name'}</label>
                <input
                  type="text"
                  value={loginForm.actorName}
                  onChange={(event) => setLoginForm((current) => ({ ...current, actorName: event.target.value }))}
                  className="w-full rounded-xl border border-border/60 bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder={language === 'ar' ? 'مثال: Dr. Sara' : 'Example: Dr. Sara'}
                />
              </div>
              <div>
                <label className="text-sm text-muted-foreground block mb-2">{language === 'ar' ? 'الدور' : 'Role'}</label>
                <select
                  value={loginForm.role}
                  onChange={(event) => setLoginForm((current) => ({ ...current, role: event.target.value as 'coach' | 'doctor' }))}
                  className="w-full rounded-xl border border-border/60 bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="coach">{language === 'ar' ? 'مدرب' : 'Coach'}</option>
                  <option value="doctor">{language === 'ar' ? 'طبيب' : 'Doctor'}</option>
                </select>
              </div>
              <Button className="w-full" onClick={verifyAndOpenAdmin} disabled={verifyingAccess || !loginForm.password.trim()}>
                <ShieldCheck className={`w-4 h-4 mr-2 ${verifyingAccess ? 'animate-pulse' : ''}`} />
                {language === 'ar' ? 'فتح اللوحة' : 'Unlock panel'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6">
            <aside className="glass-card rounded-3xl border border-border/60 p-5 h-fit xl:sticky xl:top-24">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground">{language === 'ar' ? 'المستخدمون' : 'Users'}</p>
                  <h2 className="text-xl font-semibold">{users.length}</h2>
                </div>
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div className="relative mb-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="w-full rounded-xl border border-border/60 bg-background py-3 pl-10 pr-4 outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder={language === 'ar' ? 'ابحث باسم المستخدم فقط' : 'Search by username only'}
                />
              </div>
              <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
                {filteredUsers.map((user) => {
                  const isActive = user.user_id === selectedUserId;
                  const weeklyStats = user.tracking_summary?.weekly_stats;
                  return (
                    <button
                      key={user.user_id}
                      type="button"
                      onClick={() => setSelectedUserId(user.user_id)}
                      className={`w-full rounded-2xl border px-4 py-4 text-left transition ${isActive ? 'border-primary bg-primary/10' : 'border-border/50 bg-secondary/20 hover:bg-secondary/40'}`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div>
                          <div className="font-semibold text-foreground">{compactText(user.name, 'Unnamed user')}</div>
                          <div className="text-xs text-muted-foreground">{language === 'ar' ? 'اسم المستخدم' : 'Username'}</div>
                        </div>
                        <span className="text-xs rounded-full bg-background/80 px-2 py-1 text-primary">{Math.round((user.tracking_summary?.adherence_score || 0) * 100)}%</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground mb-3">
                        <div>
                          <div>{language === 'ar' ? '7 أيام' : '7 days'}</div>
                          <div className="text-foreground font-medium">{user.tracking_summary?.completed_last_7_days || 0}</div>
                        </div>
                        <div>
                          <div>{language === 'ar' ? 'التزام' : 'Adherence'}</div>
                          <div className="text-foreground font-medium">{weeklyStats?.workout_adherence_percent || 0}%</div>
                        </div>
                        <div>
                          <div>{language === 'ar' ? 'سلسلة' : 'Streak'}</div>
                          <div className="text-foreground font-medium">{weeklyStats?.current_workout_streak_days || 0}</div>
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">{language === 'ar' ? 'آخر تحديث' : 'Last update'}: {formatDateTime(user.updated_at, language)}</div>
                      {user.latest_note?.note_text && (
                        <div className="mt-3 rounded-xl bg-background/60 px-3 py-2 text-xs text-muted-foreground line-clamp-2">
                          {stripAdminNoteTarget(user.latest_note.note_text || '').cleanText}
                        </div>
                      )}
                    </button>
                  );
                })}
                {!loadingUsers && filteredUsers.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-border/60 p-6 text-sm text-muted-foreground text-center">
                    {searchTerm.trim()
                      ? (language === 'ar' ? 'لا يوجد مستخدم بهذا الاسم.' : 'No user matched that username.')
                      : (language === 'ar' ? 'لا يوجد مستخدمون محفوظون بعد.' : 'No saved users yet.')}
                  </div>
                )}
              </div>
            </aside>

            <section className="space-y-6">
              {loadingDetail && (
                <div className="glass-card rounded-3xl border border-border/60 p-10 text-center text-muted-foreground">
                  <RefreshCw className="w-5 h-5 mx-auto mb-3 animate-spin" />
                  {language === 'ar' ? 'جار تحميل بيانات المستخدم...' : 'Loading user data...'}
                </div>
              )}

              {!loadingDetail && !detail && (
                <div className="glass-card rounded-3xl border border-border/60 p-10 text-center text-muted-foreground">
                  {language === 'ar' ? 'اختر مستخدمًا لعرض التفاصيل.' : 'Select a user to inspect progress and notes.'}
                </div>
              )}

              {!loadingDetail && detail && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="glass-card rounded-2xl p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2"><Activity className="w-4 h-4" />{language === 'ar' ? 'الالتزام العام' : 'Overall adherence'}</div>
                      <div className="text-2xl font-semibold">{formatPercent(trackingSummary?.adherence_score)}</div>
                    </div>
                    <div className="glass-card rounded-2xl p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2"><Activity className="w-4 h-4" />{language === 'ar' ? 'إكمالات 7 أيام' : '7-day completions'}</div>
                      <div className="text-2xl font-semibold">{trackingSummary?.completed_last_7_days || 0}</div>
                    </div>
                    <div className="glass-card rounded-2xl p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2"><HeartPulse className="w-4 h-4" />{language === 'ar' ? 'نبض القلب' : 'Heart rate'}</div>
                      <div className="text-2xl font-semibold">{coachSummary?.latest_resting_heart_rate ?? '--'}</div>
                    </div>
                    <div className="glass-card rounded-2xl p-5">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2"><StickyNote className="w-4 h-4" />{language === 'ar' ? 'الملاحظات' : 'Notes'}</div>
                      <div className="text-2xl font-semibold">{detail.notes?.length || 0}</div>
                    </div>
                  </div>

                  <div className="glass-card rounded-3xl border border-border/60 p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between mb-6">
                      <div>
                        <h2 className="mb-1 text-2xl font-semibold">{compactText(String(detail.user?.name || ''), 'Unnamed user')}</h2>
                        <p className="text-sm text-muted-foreground">{language === 'ar' ? 'ملف المستخدم المختار' : 'Selected user profile'}</p>
                      </div>
                      <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-3 lg:min-w-[520px]">
                        <div className="rounded-2xl bg-secondary/25 px-4 py-3">
                          <div>{language === 'ar' ? 'آخر تمرين' : 'Last completion'}</div>
                          <div className="mt-1 font-medium text-foreground">{formatDateTime(trackingSummary?.last_completed_at, language)}</div>
                        </div>
                        <div className="rounded-2xl bg-secondary/25 px-4 py-3">
                          <div>{language === 'ar' ? 'آخر تسجيل يومي' : 'Last daily log'}</div>
                          <div className="mt-1 font-medium text-foreground">{formatDateTime(trackingSummary?.last_log_date, language)}</div>
                        </div>
                        <div className="rounded-2xl bg-secondary/25 px-4 py-3">
                          <div>{language === 'ar' ? 'آخر مزامنة Fitbit' : 'Fitbit sync'}</div>
                          <div className="mt-1 font-medium text-foreground">{formatDateTime(coachSummary?.last_sync_at, language)}</div>
                        </div>
                      </div>
                    </div>

                    <div className="mb-6 flex flex-wrap gap-2 rounded-2xl bg-secondary/20 p-2">
                      {detailTabs.map((tab) => {
                        const isActive = activePanel === tab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActivePanel(tab.id)}
                            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm transition ${isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'}`}
                          >
                            <tab.icon className="h-4 w-4" />
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>

                    {activePanel === 'overview' && (
                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.95fr)]">
                        <div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 text-sm">
                            <div className="rounded-2xl bg-secondary/30 p-4">
                              <div className="text-muted-foreground mb-1">{language === 'ar' ? 'أيام الالتزام' : 'Workout adherence'}</div>
                              <div className="text-xl font-semibold">{trackingSummary?.weekly_stats?.workout_adherence_percent || 0}%</div>
                            </div>
                            <div className="rounded-2xl bg-secondary/30 p-4">
                              <div className="text-muted-foreground mb-1">{language === 'ar' ? 'تسجيل يومي' : 'Logging consistency'}</div>
                              <div className="text-xl font-semibold">{trackingSummary?.weekly_stats?.logging_consistency_percent || 0}%</div>
                            </div>
                            <div className="rounded-2xl bg-secondary/30 p-4">
                              <div className="text-muted-foreground mb-1">{language === 'ar' ? 'سلسلة التمرين' : 'Workout streak'}</div>
                              <div className="text-xl font-semibold">{trackingSummary?.weekly_stats?.current_workout_streak_days || 0}</div>
                            </div>
                          </div>

                          <div className="mb-6">
                            <h3 className="text-lg font-semibold mb-3">{language === 'ar' ? 'الخطط النشطة' : 'Active plans'}</h3>
                            <div className="space-y-3">
                              {(trackingSummary?.active_plan_details || []).map((plan, index) => (
                                <div key={`${plan.title || 'plan'}-${index}`} className="rounded-2xl border border-border/60 bg-secondary/20 p-4">
                                  <div className="flex items-center justify-between gap-3 mb-2">
                                    <div className="font-medium">{compactText(plan.title, language === 'ar' ? 'خطة بدون اسم' : 'Untitled plan')}</div>
                                    <span className="text-xs rounded-full bg-background px-2 py-1 text-muted-foreground">{plan.type || 'plan'}</span>
                                  </div>
                                  <p className="text-sm text-muted-foreground mb-2">{language === 'ar' ? 'أيام أسبوعية بها عناصر' : 'Weekly days with items'}: {plan.weekly_days_with_items || 0}</p>
                                  {Array.isArray(plan.sample_exercises) && plan.sample_exercises.length > 0 && (
                                    <p className="text-sm text-muted-foreground">{language === 'ar' ? 'تمارين' : 'Exercises'}: {plan.sample_exercises.join(', ')}</p>
                                  )}
                                  {Array.isArray(plan.sample_meals) && plan.sample_meals.length > 0 && (
                                    <p className="text-sm text-muted-foreground mt-1">{language === 'ar' ? 'وجبات' : 'Meals'}: {plan.sample_meals.join(', ')}</p>
                                  )}
                                </div>
                              ))}
                              {(trackingSummary?.active_plan_details || []).length === 0 && (
                                <div className="rounded-2xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                                  {language === 'ar' ? 'لا توجد خطط نشطة لهذا المستخدم.' : 'No active plans for this user.'}
                                </div>
                              )}
                            </div>
                          </div>

                          <div>
                            <h3 className="text-lg font-semibold mb-3">{language === 'ar' ? 'النشاط الحديث' : 'Recent activity'}</h3>
                            <div className="space-y-3">
                              {(trackingSummary?.recent_activity || []).map((item, index) => (
                                <div key={`${item.date || 'activity'}-${index}`} className="rounded-2xl border border-border/60 bg-secondary/20 p-4 text-sm">
                                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
                                    <div className="font-medium">{item.date || (language === 'ar' ? 'بدون تاريخ' : 'No date')}</div>
                                    <div className="text-muted-foreground">{language === 'ar' ? 'التمارين المكتملة' : 'Completed exercises'}: {item.completed_exercises || 0}</div>
                                  </div>
                                  {item.workout_notes && <p className="text-muted-foreground">{language === 'ar' ? 'ملاحظة التمرين' : 'Workout note'}: {item.workout_notes}</p>}
                                  {item.nutrition_notes && <p className="text-muted-foreground mt-1">{language === 'ar' ? 'ملاحظة التغذية' : 'Nutrition note'}: {item.nutrition_notes}</p>}
                                  {item.mood && <p className="text-muted-foreground mt-1">{language === 'ar' ? 'الحالة' : 'Mood'}: {item.mood}</p>}
                                </div>
                              ))}
                              {(trackingSummary?.recent_activity || []).length === 0 && (
                                <div className="rounded-2xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                                  {language === 'ar' ? 'لا توجد سجلات حديثة.' : 'No recent log activity.'}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-6">
                          <div className="rounded-3xl border border-border/60 bg-secondary/15 p-6">
                            <h3 className="text-lg font-semibold mb-4">{language === 'ar' ? 'دلائل التمرين' : 'Workout evidence'}</h3>
                            <div className="space-y-3">
                              {(detail.evidence || []).slice(0, 4).map((row) => (
                                <div key={row.id} className="rounded-2xl border border-border/60 bg-secondary/20 p-4 text-sm">
                                  <div className="flex items-center justify-between gap-3 mb-2">
                                    <div className="font-medium">{row.evidence_date || (language === 'ar' ? 'بدون تاريخ' : 'No date')}</div>
                                    <span className="text-xs rounded-full bg-background px-2 py-1 text-primary">{row.confidence || 'none'}</span>
                                  </div>
                                  <p className="text-muted-foreground mb-1">{language === 'ar' ? 'تم اكتشاف تمرين' : 'Workout detected'}: {row.workout_detected_today ? (language === 'ar' ? 'نعم' : 'Yes') : (language === 'ar' ? 'لا' : 'No')}</p>
                                  <p className="text-muted-foreground">{language === 'ar' ? 'النتيجة' : 'Score'}: {row.evidence_score ?? 0}</p>
                                  {Array.isArray(row.detection_reasons) && row.detection_reasons.length > 0 && (
                                    <p className="text-muted-foreground mt-2">{row.detection_reasons.join(' • ')}</p>
                                  )}
                                </div>
                              ))}
                              {(detail.evidence || []).length === 0 && (
                                <div className="rounded-2xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                                  {language === 'ar' ? 'لا توجد سجلات دلائل محفوظة حتى الآن.' : 'No workout evidence records are stored yet.'}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="rounded-3xl border border-border/60 bg-secondary/15 p-6">
                            <h3 className="text-lg font-semibold mb-4">{language === 'ar' ? 'آخر ملاحظة' : 'Latest note'}</h3>
                            {detail.notes?.[0] ? (
                              <div className="rounded-2xl border border-border/60 bg-secondary/20 p-4">
                                <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                  <span>{compactText(detail.notes[0].author_name, session.actorName || 'Coach')} • {detail.notes[0].author_role}</span>
                                  <span>{formatDateTime(detail.notes[0].created_at, language)}</span>
                                </div>
                                <div className="mb-2 text-xs text-primary uppercase tracking-wide">{detail.notes[0].note_category || 'general'}{detail.notes[0].related_date ? ` • ${detail.notes[0].related_date}` : ''}</div>
                                <p className="text-sm text-foreground whitespace-pre-wrap">{stripAdminNoteTarget(detail.notes[0].note_text || '').cleanText}</p>
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                                {language === 'ar' ? 'لا توجد ملاحظات لهذا المستخدم بعد.' : 'No notes for this user yet.'}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {activePanel === 'notes' && (
                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1fr)]">
                        <div className="rounded-3xl border border-border/60 bg-secondary/15 p-6">
                        <h3 className="text-lg font-semibold mb-4">{language === 'ar' ? 'إضافة ملاحظة' : 'Add coach or doctor note'}</h3>
                        <div className="space-y-3">
                          <select
                            value={noteForm.note_category}
                            onChange={(event) => setNoteForm((current) => ({
                              ...current,
                              note_category: event.target.value,
                              target_item: event.target.value === 'workout' ? current.target_item : '',
                            }))}
                            className="w-full rounded-xl border border-border/60 bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40"
                          >
                            <option value="general">{language === 'ar' ? 'ملاحظة عامة' : 'General note'}</option>
                            <option value="workout">{language === 'ar' ? 'ملاحظة تمرين' : 'Workout note'}</option>
                            <option value="nutrition">{language === 'ar' ? 'ملاحظة تغذية' : 'Nutrition note'}</option>
                          </select>
                          <input
                            type="date"
                            value={noteForm.related_date}
                            onChange={(event) => setNoteForm((current) => ({ ...current, related_date: event.target.value }))}
                            className="w-full rounded-xl border border-border/60 bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40"
                          />
                          {noteForm.note_category === 'workout' && workoutTargetOptions.length > 0 && (
                            <select
                              value={noteForm.target_item}
                              onChange={(event) => setNoteForm((current) => ({ ...current, target_item: event.target.value }))}
                              className="w-full rounded-xl border border-border/60 bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40"
                            >
                              <option value="">{language === 'ar' ? 'اربط خطة التمرين أو اختر تمرينًا' : 'Link the workout plan or choose an exercise'}</option>
                              {workoutTargetOptions.map((itemName) => (
                                <option key={itemName} value={itemName}>{itemName}</option>
                              ))}
                            </select>
                          )}
                          <textarea
                            rows={5}
                            value={noteForm.note_text}
                            onChange={(event) => setNoteForm((current) => ({ ...current, note_text: event.target.value }))}
                            className="w-full rounded-xl border border-border/60 bg-background px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40"
                            placeholder={language === 'ar' ? 'اكتب ملاحظة على التمرين، الغذاء، أو الالتزام...' : 'Write a note about workouts, food, or adherence...'}
                          />
                          <Button onClick={submitNote} disabled={savingNote || !noteForm.note_text.trim()} className="w-full">
                            {savingNote ? (language === 'ar' ? 'جار الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ الملاحظة' : 'Save note')}
                          </Button>
                        </div>
                        </div>

                        <div className="rounded-3xl border border-border/60 bg-secondary/15 p-6">
                          <h3 className="text-lg font-semibold mb-4">{language === 'ar' ? 'ملاحظات الفريق الطبي' : 'Coach and doctor notes'}</h3>
                          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                            {(detail.notes || []).map((note) => (
                              <div key={note.id} className="rounded-2xl border border-border/60 bg-secondary/20 p-4">
                                <div className="flex items-center justify-between gap-3 mb-2 text-xs text-muted-foreground">
                                  <span>{compactText(note.author_name, session.actorName || 'Coach')} • {note.author_role}</span>
                                  <span>{formatDateTime(note.created_at, language)}</span>
                                </div>
                                <div className="text-xs text-primary uppercase tracking-wide mb-2">{note.note_category || 'general'}{note.related_date ? ` • ${note.related_date}` : ''}</div>
                                <p className="text-sm text-foreground whitespace-pre-wrap">{stripAdminNoteTarget(note.note_text || '').cleanText}</p>
                              </div>
                            ))}
                            {(detail.notes || []).length === 0 && (
                              <div className="rounded-2xl border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
                                {language === 'ar' ? 'لا توجد ملاحظات بعد لهذا المستخدم.' : 'No notes have been added for this user yet.'}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {activePanel === 'report' && (
                      <div className="rounded-3xl border border-border/60 bg-secondary/15 p-6">
                        <WorkoutEvidenceReportSection userId={selectedUserId} compact />
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}