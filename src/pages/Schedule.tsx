import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, BellRing, Calendar, CheckCircle2, ChevronLeft, ChevronRight, Dumbbell, Loader2, MessageSquareText, Trash2, UtensilsCrossed } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLocation, useNavigate } from 'react-router-dom';

interface WorkoutExercise {
  name: string;
  nameAr: string;
  sets: string;
  reps: string;
}

interface NutritionMeal {
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  calories: string;
}

interface PlanDay {
  day: string;
  dayAr: string;
  exercises?: WorkoutExercise[];
  meals?: NutritionMeal[];
}

interface WorkoutPlan {
  id: string;
  title: string;
  title_ar: string;
  plan_data: PlanDay[];
  is_active: boolean;
  created_at: string;
}

interface Completion {
  id: string;
  plan_id: string;
  day_index: number;
  exercise_index: number;
  log_date: string;
  completed_at?: string;
}

interface DailyLog {
  id: string;
  log_date: string;
  workout_notes: string;
  nutrition_notes: string;
  mood: string;
}

interface WorkoutAdherenceStatus {
  evaluated_at: string;
  timezone: string;
  schedule: {
    has_active_workout_plan: boolean;
    has_workout_planned_today: boolean;
    planned_workout_items_today: number;
    planned_workout_names_today: string[];
    manual_completions_today: number;
    active_plan_titles: string[];
  };
  detection: {
    workout_detected_today: boolean;
    confidence: 'high' | 'medium' | 'none';
    evidence_score: number;
    evidence_threshold: number;
    reasons: string[];
    metrics: {
      steps: number;
      resting_heart_rate: number | null;
      fairly_active_minutes: number;
      very_active_minutes: number;
      active_minutes_total: number;
      heart_zone_active_minutes: number;
      manual_workout_completions_today: number;
    };
  };
  reminder: {
    eligible_today: boolean;
    after_cutoff: boolean;
    cutoff_hour_local: number;
    reminder_date: string;
    already_sent_today: boolean;
    should_send_now: boolean;
    sent_now: boolean;
    sent_at: string | null;
    show_banner: boolean;
    message: string;
    persistence_error: string | null;
  };
}

const AI_BACKEND_URL = (import.meta.env.VITE_AI_BACKEND_URL || 'http://127.0.0.1:8002').replace(/\/$/, '');

const getLocalPlansStorageKey = (userId: string) => `fitcoach_schedule_plans_${userId}`;
const getLocalCompletionsStorageKey = (userId: string) => `fitcoach_schedule_completions_${userId}`;

function readLocalPlans(userId: string): WorkoutPlan[] {
  try {
    const raw = localStorage.getItem(getLocalPlansStorageKey(userId));
    return raw ? (JSON.parse(raw) as WorkoutPlan[]) : [];
  } catch {
    return [];
  }
}

function writeLocalPlans(userId: string, plans: WorkoutPlan[]) {
  localStorage.setItem(getLocalPlansStorageKey(userId), JSON.stringify(plans));
}

function readLocalCompletions(userId: string): Completion[] {
  try {
    const raw = localStorage.getItem(getLocalCompletionsStorageKey(userId));
    return raw ? (JSON.parse(raw) as Completion[]) : [];
  } catch {
    return [];
  }
}

function writeLocalCompletions(userId: string, completions: Completion[]) {
  localStorage.setItem(getLocalCompletionsStorageKey(userId), JSON.stringify(completions));
}

const NUTRITION_PREFIXES = ['\u{1F37D}\uFE0F'];
const isNutritionPlanTitle = (title: string) => NUTRITION_PREFIXES.some(prefix => title.startsWith(prefix));
const WEEK_TEMPLATE = [
  { day: 'Saturday', dayAr: 'السبت' },
  { day: 'Sunday', dayAr: 'الأحد' },
  { day: 'Monday', dayAr: 'الاثنين' },
  { day: 'Tuesday', dayAr: 'الثلاثاء' },
  { day: 'Wednesday', dayAr: 'الأربعاء' },
  { day: 'Thursday', dayAr: 'الخميس' },
  { day: 'Friday', dayAr: 'الجمعة' },
] as const;
const JS_WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const LEGACY_WORKOUT_DAY_PATTERNS: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 5],
  5: [0, 1, 2, 4, 6],
  6: [0, 1, 2, 3, 4, 6],
  7: [0, 1, 2, 3, 4, 5, 6],
};

// Map plan day names to JS day numbers (0=Sun, 6=Sat)
const dayNameToIndex: Record<string, number> = {
  'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
  'thursday': 4, 'friday': 5, 'saturday': 6,
  'الأحد': 0, 'الاثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3,
  'الخميس': 4, 'الجمعة': 5, 'السبت': 6,
};

function getPlanDayIndex(dayStr: string): number {
  const lower = dayStr.toLowerCase().split(' - ')[0].split(' – ')[0].trim();
  return dayNameToIndex[lower] ?? -1;
}

function buildAnchoredWorkoutDayNames(daysPerWeek: number, anchorDate?: string): string[] {
  const clamped = Math.max(1, Math.min(7, daysPerWeek));
  const parsedAnchor = anchorDate ? new Date(anchorDate) : new Date();
  const safeAnchor = Number.isNaN(parsedAnchor.getTime()) ? new Date() : parsedAnchor;
  const anchorJsDay = safeAnchor.getDay();
  const jsDays = Array.from(new Set((LEGACY_WORKOUT_DAY_PATTERNS[clamped] || LEGACY_WORKOUT_DAY_PATTERNS[3]).map((offset) => (anchorJsDay + offset) % 7)));

  jsDays.sort((left, right) => ((left + 1) % 7) - ((right + 1) % 7));
  return jsDays.map((dayIndex) => JS_WEEKDAY_NAMES[dayIndex]);
}

function normalizeLegacyWorkoutPlan(plan: WorkoutPlan): WorkoutPlan {
  if (isNutritionPlanTitle(plan.title)) return plan;

  const days = Array.isArray(plan.plan_data) ? plan.plan_data : [];
  if (days.length !== WEEK_TEMPLATE.length) return plan;

  const activeDayIndexes = days
    .map((day, index) => (Array.isArray(day.exercises) && day.exercises.length > 0 ? index : -1))
    .filter((index) => index >= 0);
  const trainingDays = activeDayIndexes.length;
  const expectedIndexes = LEGACY_WORKOUT_DAY_PATTERNS[Math.max(1, Math.min(7, trainingDays))] || [];

  if (trainingDays === 0 || expectedIndexes.length !== activeDayIndexes.length) return plan;
  if (activeDayIndexes.some((index, position) => index !== expectedIndexes[position])) return plan;
  if (!days.every((day, index) => {
    const expectedDay = WEEK_TEMPLATE[index];
    const expectedIndex = getPlanDayIndex(expectedDay.day);
    return getPlanDayIndex(day.day) === expectedIndex || getPlanDayIndex(day.dayAr || '') === expectedIndex;
  })) {
    return plan;
  }

  const anchoredDayNames = buildAnchoredWorkoutDayNames(trainingDays, plan.created_at);
  const activeDays = activeDayIndexes.map((index) => days[index]);
  const repairedDays: PlanDay[] = WEEK_TEMPLATE.map((templateDay) => {
    const slot = anchoredDayNames.indexOf(templateDay.day);
    const sourceDay = slot >= 0 ? activeDays[slot] : null;
    return {
      day: templateDay.day,
      dayAr: templateDay.dayAr,
      exercises: sourceDay && Array.isArray(sourceDay.exercises) ? sourceDay.exercises : [],
    };
  });

  return JSON.stringify(repairedDays) === JSON.stringify(days)
    ? plan
    : { ...plan, plan_data: repairedDays };
}

function planDayHasItems(day: PlanDay | null | undefined): boolean {
  const exercises = Array.isArray(day?.exercises) ? day.exercises.length : 0;
  const meals = Array.isArray(day?.meals) ? day.meals.length : 0;
  return exercises + meals > 0;
}

function getPlanWindowStart(createdAt: string): Date | null {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  created.setHours(0, 0, 0, 0);
  return created;
}

function planAppliesToDate(plan: WorkoutPlan, date: Date): boolean {
  const start = getPlanWindowStart(plan.created_at);
  if (!start) return true;
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return target >= start && target <= end;
}

function getWeekDates(weekOffset: number): Date[] {
  const today = new Date();
  const currentDay = today.getDay(); // 0=Sun
  // Start week on Saturday (6)
  const satOffset = (currentDay + 1) % 7;
  const saturday = new Date(today);
  saturday.setDate(today.getDate() - satOffset + (weekOffset * 7));
  saturday.setHours(0, 0, 0, 0);
  
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(saturday);
    d.setDate(saturday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

function getWeekStart(date: Date): Date {
  const currentDay = date.getDay();
  const saturdayOffset = (currentDay + 1) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - saturdayOffset);
  start.setHours(0, 0, 0, 0);
  return start;
}

function normalizeItemLabel(value: string) {
  return String(value || '').trim().toLowerCase();
}

function formatLogDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const dayOrder = [6, 0, 1, 2, 3, 4, 5]; // Sat, Sun, Mon, Tue, Wed, Thu, Fri

export function SchedulePage() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [dailyLogs, setDailyLogs] = useState<DailyLog[]>([]);
  const [logDraft, setLogDraft] = useState({ workout_notes: '', nutrition_notes: '', mood: '' });
  const [savingLog, setSavingLog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDateIdx, setSelectedDateIdx] = useState(-1); // index into weekDates
  const [viewTab, setViewTab] = useState<'workout' | 'nutrition'>('workout');
  const [workoutAdherence, setWorkoutAdherence] = useState<WorkoutAdherenceStatus | null>(null);
  const [adherenceLoading, setAdherenceLoading] = useState(false);
  const [highlightItemName, setHighlightItemName] = useState('');
  const targetItemRef = useRef<HTMLDivElement | null>(null);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  // Auto-select today
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const idx = weekDates.findIndex(d => d.getTime() === today.getTime());
    setSelectedDateIdx(idx >= 0 ? idx : 0);
  }, [weekDates]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('focusToday') !== '1') return;

    const todayWeek = getWeekDates(0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const idx = todayWeek.findIndex(d => d.getTime() === today.getTime());

    setWeekOffset(0);
    if (idx >= 0) {
      setSelectedDateIdx(idx);
    }

    navigate('/schedule', { replace: true });
  }, [location.search, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const focusDate = params.get('focusDate');
    const nextView = params.get('view');
    const nextHighlightItem = params.get('highlightItem') || '';

    if (!focusDate && !nextView && !nextHighlightItem) {
      return;
    }

    if (nextView === 'workout' || nextView === 'nutrition') {
      setViewTab(nextView);
    }
    setHighlightItemName(nextHighlightItem);

    if (focusDate) {
      const parsedDate = new Date(focusDate);
      if (!Number.isNaN(parsedDate.getTime())) {
        parsedDate.setHours(0, 0, 0, 0);
        const currentWeekStart = getWeekStart(new Date());
        const targetWeekStart = getWeekStart(parsedDate);
        const diffDays = Math.round((targetWeekStart.getTime() - currentWeekStart.getTime()) / (1000 * 60 * 60 * 24));
        const nextWeekOffset = Math.round(diffDays / 7);
        const targetWeekDates = getWeekDates(nextWeekOffset);
        const idx = targetWeekDates.findIndex((date) => date.getTime() === parsedDate.getTime());

        setWeekOffset(nextWeekOffset);
        if (idx >= 0) {
          setSelectedDateIdx(idx);
        }
      }
    }

    navigate('/schedule', { replace: true });
  }, [location.search, navigate]);

  const workoutPlans = plans.filter(p => !isNutritionPlanTitle(p.title));
  const nutritionPlans = plans.filter(p => isNutritionPlanTitle(p.title));
  const activePlan = workoutPlans.find(p => p.is_active) || workoutPlans[0] || null;
  const activeNutritionPlan = nutritionPlans.find(p => p.is_active) || nutritionPlans[0] || null;

  useEffect(() => {
    if (user) fetchPlans();
  }, [user]);

  useEffect(() => {
    if (!user || loading) return;
    void fetchWorkoutAdherence();
  }, [user?.id, loading, completions.length, dailyLogs.length, plans.length]);

  const fetchPlans = async () => {
    if (!user) return;
    setLoading(true);

    const localPlans = readLocalPlans(user.id);
    const localCompletions = readLocalCompletions(user.id);

    try {
      const { data: plansData } = await supabase
        .from('workout_plans')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      const parsedRemotePlans = (plansData || []).map(p => ({
        ...p,
        plan_data: (p.plan_data as any) as PlanDay[],
      }));
      const normalizedRemotePlans = parsedRemotePlans.map(normalizeLegacyWorkoutPlan);
      const normalizedLocalPlans = localPlans.map(normalizeLegacyWorkoutPlan);

      const mergedPlans = [
        ...normalizedRemotePlans,
        ...normalizedLocalPlans.filter(localPlan => !normalizedRemotePlans.some(remotePlan => remotePlan.id === localPlan.id)),
      ];
      setPlans(mergedPlans);

      if (JSON.stringify(normalizedLocalPlans) !== JSON.stringify(localPlans)) {
        writeLocalPlans(user.id, normalizedLocalPlans);
      }

      const repairedRemotePlans = normalizedRemotePlans.filter((plan, index) => (
        JSON.stringify(plan.plan_data) !== JSON.stringify(parsedRemotePlans[index]?.plan_data || [])
      ));
      if (repairedRemotePlans.length > 0) {
        await Promise.all(
          repairedRemotePlans.map((plan) =>
            supabase
              .from('workout_plans')
              .update({ plan_data: plan.plan_data })
              .eq('id', plan.id)
              .eq('user_id', user.id)
          )
        );
      }

      const { data: compData } = await supabase
        .from('workout_completions')
        .select('id,plan_id,day_index,exercise_index,log_date,completed_at')
        .eq('user_id', user.id);
      setCompletions((compData && compData.length > 0) ? compData : localCompletions);

      const { data: logsData } = await supabase
        .from('daily_logs')
        .select('id,log_date,workout_notes,nutrition_notes,mood')
        .eq('user_id', user.id);
      if (logsData) setDailyLogs(logsData);
    } catch (error) {
      console.warn('Falling back to local schedule storage:', error);
      setPlans(localPlans);
      setCompletions(localCompletions);
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkoutAdherence = async () => {
    if (!user) return;

    setAdherenceLoading(true);
    try {
      const response = await fetch(`${AI_BACKEND_URL}/adherence/workout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: user.id,
          issue_reminder: true,
          cutoff_hour_local: 18,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed loading workout adherence status');
      }
      setWorkoutAdherence(payload as WorkoutAdherenceStatus);
    } catch (error) {
      console.warn('Failed loading workout adherence status:', error);
      setWorkoutAdherence(null);
    } finally {
      setAdherenceLoading(false);
    }
  };

  const saveDailyLog = async () => {
    if (!user) return;
    setSavingLog(true);
    try {
      const payload = {
        user_id: user.id,
        log_date: selectedLogDate,
        workout_notes: logDraft.workout_notes || '',
        nutrition_notes: logDraft.nutrition_notes || '',
        mood: logDraft.mood || '',
      };
      const { data } = await supabase
        .from('daily_logs')
        .upsert(payload, { onConflict: 'user_id,log_date' })
        .select()
        .single();
      if (data) {
        setDailyLogs(prev => {
          const existing = prev.find(log => log.log_date === selectedLogDate);
          if (existing) {
            return prev.map(log => log.log_date === selectedLogDate ? data : log);
          }
          return [...prev, data];
        });
      }
      toast({
        title: language === 'ar' ? 'تم الحفظ' : 'Saved',
        description: language === 'ar' ? 'تم حفظ ملاحظات اليوم.' : 'Daily log saved.',
      });
    } catch (error) {
      console.error('Failed saving daily log', error);
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'خطأ' : 'Error',
        description: language === 'ar' ? 'فشل حفظ الملاحظات.' : 'Could not save daily log.',
      });
    } finally {
      setSavingLog(false);
    }
  };

  const hasDailyActivity = (date: Date) => {
    const logDate = formatLogDate(date);
    const hasCompletion = completions.some((c) => c.log_date === logDate);
    const log = dailyLogs.find((l) => l.log_date === logDate);
    const hasNotes = Boolean(log && (log.workout_notes || log.nutrition_notes || log.mood));
    return hasCompletion || hasNotes;
  };

  // Find which plan day matches the selected calendar day
  const getMatchingPlanDay = (plan: WorkoutPlan | null, date: Date): { day: PlanDay; index: number } | null => {
    if (!plan) return null;
    if (!planAppliesToDate(plan, date)) return null;
    const jsDay = date.getDay(); // 0=Sun...6=Sat
    for (let i = 0; i < plan.plan_data.length; i++) {
      if (!planDayHasItems(plan.plan_data[i])) continue;
      const planDayIdx = getPlanDayIndex(plan.plan_data[i].day) !== -1 
        ? getPlanDayIndex(plan.plan_data[i].day) 
        : getPlanDayIndex(plan.plan_data[i].dayAr || '');
      if (planDayIdx === jsDay) return { day: plan.plan_data[i], index: i };
    }
    return null;
  };

  const currentPlan = viewTab === 'workout' ? activePlan : activeNutritionPlan;
  const selectedDate = weekDates[selectedDateIdx] || weekDates[0];
  const selectedLogDate = useMemo(() => formatLogDate(selectedDate), [selectedDate]);
  const matchingDay = getMatchingPlanDay(currentPlan, selectedDate);
  const planProgress = useMemo(() => {
    if (!currentPlan) return null;
    const totalItems = currentPlan.plan_data.reduce((sum, day) => {
      const exercises = Array.isArray(day.exercises) ? day.exercises.length : 0;
      const meals = Array.isArray(day.meals) ? day.meals.length : 0;
      return sum + exercises + meals;
    }, 0);
    const completedItems = completions.filter((c) => c.plan_id === currentPlan.id).length;
    const percent = totalItems > 0 ? Math.min(100, Math.round((completedItems / totalItems) * 100)) : 0;
    const remaining = totalItems > 0 ? Math.max(0, 100 - percent) : 100;
    return { totalItems, completedItems, percent, remaining };
  }, [currentPlan, completions]);

  const dailyProgress = useMemo(() => {
    if (!matchingDay || !currentPlan) return null;
    const exercises = Array.isArray(matchingDay.day.exercises) ? matchingDay.day.exercises.length : 0;
    const meals = Array.isArray(matchingDay.day.meals) ? matchingDay.day.meals.length : 0;
    const total = exercises + meals;
    if (total === 0) return { total: 0, completed: 0, percent: 0 };

    const completed = completions.filter(
      (c) =>
        c.plan_id === currentPlan.id &&
        c.day_index === matchingDay.index &&
        c.log_date === selectedLogDate
    ).length;
    const percent = Math.min(100, Math.round((completed / total) * 100));
    return { total, completed, percent };
  }, [matchingDay, currentPlan, completions, selectedLogDate]);

  const dayExercises = useMemo(() => {
    return Array.isArray(matchingDay?.day.exercises) ? matchingDay.day.exercises : [];
  }, [matchingDay]);

  const dayMeals = useMemo(() => {
    return Array.isArray(matchingDay?.day.meals) ? matchingDay.day.meals : [];
  }, [matchingDay]);

  const completedExerciseIndexesToday = useMemo(() => {
    if (!matchingDay || !currentPlan) return new Set<number>();

    return new Set(
      completions
        .filter(
          (completion) =>
            completion.plan_id === currentPlan.id &&
            completion.day_index === matchingDay.index &&
            completion.log_date === selectedLogDate &&
            typeof completion.exercise_index === 'number' &&
            completion.exercise_index < dayExercises.length
        )
        .map((completion) => completion.exercise_index)
    );
  }, [completions, currentPlan, dayExercises.length, matchingDay, selectedLogDate]);

  const completedMealIndexesToday = useMemo(() => {
    if (!matchingDay || !currentPlan) return new Set<number>();

    return new Set(
      completions
        .filter(
          (completion) =>
            completion.plan_id === currentPlan.id &&
            completion.day_index === matchingDay.index &&
            completion.log_date === selectedLogDate &&
            typeof completion.exercise_index === 'number' &&
            completion.exercise_index >= dayExercises.length
        )
        .map((completion) => completion.exercise_index - dayExercises.length)
    );
  }, [completions, currentPlan, dayExercises.length, matchingDay, selectedLogDate]);

  const completedExercisesToday = useMemo(() => {
    return dayExercises
      .filter((_, index) => completedExerciseIndexesToday.has(index))
      .map((exercise) => language === 'ar' ? exercise.nameAr || exercise.name : exercise.name)
      .filter(Boolean);
  }, [completedExerciseIndexesToday, dayExercises, language]);

  const missingExercisesToday = useMemo(() => {
    return dayExercises
      .filter((_, index) => !completedExerciseIndexesToday.has(index))
      .map((exercise) => language === 'ar' ? exercise.nameAr || exercise.name : exercise.name)
      .filter(Boolean);
  }, [completedExerciseIndexesToday, dayExercises, language]);

  const completedMealsToday = useMemo(() => {
    return dayMeals
      .filter((_, index) => completedMealIndexesToday.has(index))
      .map((meal) => language === 'ar' ? meal.nameAr || meal.name : meal.name)
      .filter(Boolean);
  }, [completedMealIndexesToday, dayMeals, language]);

  const missingMealsToday = useMemo(() => {
    return dayMeals
      .filter((_, index) => !completedMealIndexesToday.has(index))
      .map((meal) => language === 'ar' ? meal.nameAr || meal.name : meal.name)
      .filter(Boolean);
  }, [completedMealIndexesToday, dayMeals, language]);

  useEffect(() => {
    if (targetItemRef.current) {
      targetItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightItemName, selectedDateIdx, weekOffset, viewTab, matchingDay?.index]);

  const overallMissingPlanItems = useMemo(() => {
    if (!currentPlan) return [] as string[];

    const completedKeys = new Set(
      completions
        .filter((completion) => completion.plan_id === currentPlan.id)
        .map((completion) => `${completion.day_index}:${completion.exercise_index}`)
    );

    const missingItems: string[] = [];
    currentPlan.plan_data.forEach((day, dayIndex) => {
      const exercises = Array.isArray(day.exercises) ? day.exercises : [];
      const meals = Array.isArray(day.meals) ? day.meals : [];

      if (viewTab === 'workout') {
        exercises.forEach((exercise, exerciseIndex) => {
          if (!completedKeys.has(`${dayIndex}:${exerciseIndex}`)) {
            missingItems.push(language === 'ar' ? exercise.nameAr || exercise.name : exercise.name);
          }
        });
        return;
      }

      meals.forEach((meal, mealIndex) => {
        const completionIndex = exercises.length + mealIndex;
        if (!completedKeys.has(`${dayIndex}:${completionIndex}`)) {
          missingItems.push(language === 'ar' ? meal.nameAr || meal.name : meal.name);
        }
      });
    });

    return missingItems.filter(Boolean);
  }, [completions, currentPlan, language, viewTab]);

  const requestCoachProgressFeedback = () => {
    if (!currentPlan || !dailyProgress) return;

    const planPercent = planProgress?.percent ?? 0;
    const overallCompletedCount = planProgress?.completedItems ?? 0;
    const overallTotalCount = planProgress?.totalItems ?? 0;
    const overallMissingNames = overallMissingPlanItems.length > 0
      ? overallMissingPlanItems.join(', ')
      : (language === 'ar' ? 'لا يوجد عناصر ناقصة' : 'No missing items');

    const prompt = viewTab === 'nutrition'
      ? (
          language === 'ar'
            ? `حلل تقدمي الغذائي اليوم واعطني ملاحظات واضحة فقط بدون إنشاء خطة جديدة. اذكر بوضوح عدد الوجبات التي أكملتها وما هي الوجبات الناقصة بالاسم. التاريخ: ${selectedLogDate}. اسم الخطة الغذائية الحالية: ${currentPlan.title_ar || currentPlan.title}. الوجبات المكتملة اليوم: ${completedMealsToday.length > 0 ? completedMealsToday.join(', ') : 'لم أكمل أي وجبة بعد'}. الوجبات الناقصة اليوم: ${missingMealsToday.length > 0 ? missingMealsToday.join(', ') : 'لا يوجد وجبات ناقصة اليوم'}. تقدم اليوم الغذائي: ${dailyProgress.completed}/${dailyProgress.total} (${dailyProgress.percent}%). التقدم الكلي في الخطة الغذائية الحالية: ${overallCompletedCount}/${overallTotalCount} (${planPercent}%). العناصر الغذائية الناقصة في الخطة الحالية: ${overallMissingNames}.`
            : `Analyze my nutrition progress today and give me clear feedback only, without creating a new plan. Explicitly tell me how many meals I completed and which meals are still missing by name. Date: ${selectedLogDate}. Current nutrition plan title: ${currentPlan.title}. Completed meals today: ${completedMealsToday.length > 0 ? completedMealsToday.join(', ') : 'I have not completed any meals yet'}. Missing meals today: ${missingMealsToday.length > 0 ? missingMealsToday.join(', ') : 'No missing meals today'}. Daily nutrition progress: ${dailyProgress.completed}/${dailyProgress.total} (${dailyProgress.percent}%). Overall progress in my current nutrition plan: ${overallCompletedCount}/${overallTotalCount} (${planPercent}%). Missing items in my current nutrition plan: ${overallMissingNames}.`
        )
      : (
          language === 'ar'
            ? `حلل تقدمي في التمارين اليوم واعطني ملاحظات واضحة فقط بدون إنشاء خطة جديدة. التاريخ: ${selectedLogDate}. اسم التمرين الحالي: ${currentPlan.title_ar || currentPlan.title}. التمارين المكتملة اليوم: ${completedExercisesToday.length > 0 ? completedExercisesToday.join(', ') : 'لم أكمل أي تمرين بعد'}. التمارين الناقصة اليوم: ${missingExercisesToday.length > 0 ? missingExercisesToday.join(', ') : 'لا يوجد تمارين ناقصة اليوم'}. تقدم اليوم: ${dailyProgress.completed}/${dailyProgress.total} (${dailyProgress.percent}%). التقدم الكلي في الجدول الحالي: ${overallCompletedCount}/${overallTotalCount} (${planPercent}%). العناصر الناقصة في الجدول الحالي: ${overallMissingNames}.`
            : `Analyze my exercise progress today and give me clear feedback only, without creating a new plan. Date: ${selectedLogDate}. Current workout title: ${currentPlan.title}. Completed exercises today: ${completedExercisesToday.length > 0 ? completedExercisesToday.join(', ') : 'I have not completed any exercises yet'}. Missing exercises today: ${missingExercisesToday.length > 0 ? missingExercisesToday.join(', ') : 'No missing exercises today'}. Daily progress: ${dailyProgress.completed}/${dailyProgress.total} (${dailyProgress.percent}%). Overall progress in my current schedule: ${overallCompletedCount}/${overallTotalCount} (${planPercent}%). Missing items in my current schedule: ${overallMissingNames}.`
        );

    navigate('/coach', {
      state: {
        coachPrompt: prompt,
        coachPromptId: `${Date.now()}-${selectedLogDate}`,
        autoSendCoachPrompt: true,
      },
    });
  };

  const currentDailyLog = useMemo(() => {
    return dailyLogs.find((log) => log.log_date === selectedLogDate) || null;
  }, [dailyLogs, selectedLogDate]);

  const workoutDetectedToday = viewTab === 'workout' && workoutAdherence?.detection.workout_detected_today;
  const showMissedWorkoutReminder = viewTab === 'workout' && workoutAdherence?.reminder.show_banner;
  const planCollection = viewTab === 'workout' ? workoutPlans : nutritionPlans;
  const selectedDayTitle = matchingDay
    ? (language === 'ar' ? matchingDay.day.dayAr || matchingDay.day.day : matchingDay.day.day)
    : (language === 'ar' ? 'بدون عناصر مجدولة' : 'No scheduled items');
  const selectedItemsTotal = (dayExercises?.length || 0) + (dayMeals?.length || 0);
  const selectedItemsRemaining = dailyProgress ? Math.max(0, dailyProgress.total - dailyProgress.completed) : 0;
  const overviewCards = [
    {
      key: 'plan',
      label: language === 'ar' ? 'الخطة النشطة' : 'Active plan',
      value: currentPlan
        ? (language === 'ar' ? currentPlan.title_ar || currentPlan.title : currentPlan.title)
        : (language === 'ar' ? 'لا توجد خطة' : 'No active plan'),
      helper: language === 'ar'
        ? (viewTab === 'workout' ? 'التركيز الحالي للتمارين' : 'التركيز الحالي للتغذية')
        : (viewTab === 'workout' ? 'Current workout track' : 'Current nutrition track'),
    },
    {
      key: 'day',
      label: language === 'ar' ? 'اليوم المختار' : 'Selected day',
      value: selectedDayTitle,
      helper: language === 'ar'
        ? `التاريخ ${selectedLogDate}`
        : `Date ${selectedLogDate}`,
    },
    {
      key: 'overall',
      label: language === 'ar' ? 'التقدم الكلي' : 'Overall progress',
      value: planProgress
        ? `${planProgress.percent}%`
        : '0%',
      helper: planProgress
        ? (language === 'ar'
            ? `${planProgress.completedItems} من ${planProgress.totalItems} عناصر`
            : `${planProgress.completedItems} of ${planProgress.totalItems} items`)
        : (language === 'ar' ? 'بانتظار خطة نشطة' : 'Waiting for an active plan'),
    },
    {
      key: 'today',
      label: language === 'ar' ? 'تقدم اليوم' : 'Today progress',
      value: dailyProgress
        ? `${dailyProgress.percent}%`
        : '0%',
      helper: dailyProgress
        ? (language === 'ar'
            ? `${dailyProgress.completed}/${dailyProgress.total} مكتمل`
            : `${dailyProgress.completed}/${dailyProgress.total} completed`)
        : (language === 'ar' ? 'لا يوجد عناصر لهذا اليوم' : 'No items for this day'),
    },
  ];

  useEffect(() => {
    if (currentDailyLog) {
      setLogDraft({
        workout_notes: currentDailyLog.workout_notes || '',
        nutrition_notes: currentDailyLog.nutrition_notes || '',
        mood: currentDailyLog.mood || '',
      });
    } else {
      setLogDraft({ workout_notes: '', nutrition_notes: '', mood: '' });
    }
  }, [currentDailyLog]);

  const toggleCompletion = async (dayIndex: number, exerciseIndex: number, planId?: string) => {
    if (!user) return;
    const targetPlanId = planId || currentPlan?.id;
    if (!targetPlanId) return;
    
    const existing = completions.find(
      c =>
        c.plan_id === targetPlanId &&
        c.day_index === dayIndex &&
        c.exercise_index === exerciseIndex &&
        c.log_date === selectedLogDate
    );
    
    if (existing) {
      const next = completions.filter(c => c.id !== existing.id);
      setCompletions(next);
      writeLocalCompletions(user.id, next);
      try {
        await supabase.from('workout_completions').delete().eq('id', existing.id);
      } catch (error) {
        console.warn('Failed deleting completion from Supabase, kept local state:', error);
      }
    } else {
      const localRecord: Completion = {
        id: `local_${targetPlanId}_${dayIndex}_${exerciseIndex}_${selectedLogDate}`,
        plan_id: targetPlanId,
        day_index: dayIndex,
        exercise_index: exerciseIndex,
        log_date: selectedLogDate,
        completed_at: new Date().toISOString(),
      };
      const next = [...completions, localRecord];
      setCompletions(next);
      writeLocalCompletions(user.id, next);
      try {
        const { data } = await supabase.from('workout_completions').insert({
          user_id: user.id,
          plan_id: targetPlanId,
          day_index: dayIndex,
          exercise_index: exerciseIndex,
          log_date: selectedLogDate,
          completed_at: localRecord.completed_at,
        }).select().single();
        if (data) {
          const synced = next.map(item => item.id === localRecord.id ? data : item);
          setCompletions(synced);
          writeLocalCompletions(user.id, synced);
        }
      } catch (error) {
        console.warn('Failed saving completion to Supabase, kept local state:', error);
      }
    }
  };

  const isCompleted = (dayIndex: number, exerciseIndex: number, planId?: string) => {
    const pid = planId || currentPlan?.id;
    return completions.some(
      c =>
        c.plan_id === pid &&
        c.day_index === dayIndex &&
        c.exercise_index === exerciseIndex &&
        c.log_date === selectedLogDate
    );
  };

  const deletePlan = async (planId: string) => {
    if (!user) return;
    const next = plans.filter(p => p.id !== planId);
    setPlans(next);
    writeLocalPlans(user.id, next);
    try {
      await supabase.from('workout_plans').delete().eq('id', planId);
    } catch (error) {
      console.warn('Failed deleting plan from Supabase, kept local state:', error);
    }
    toast({ title: language === 'ar' ? 'تم حذف الخطة' : 'Plan deleted' });
  };

  const activatePlan = async (plan: WorkoutPlan) => {
    if (!user) return;
    const isNutrition = isNutritionPlanTitle(plan.title);
    const sameTypePlanIds = plans
      .filter(p => isNutrition ? isNutritionPlanTitle(p.title) : !isNutritionPlanTitle(p.title))
      .map(p => p.id);

    const next = plans.map(p =>
      (isNutrition ? isNutritionPlanTitle(p.title) : !isNutritionPlanTitle(p.title))
        ? { ...p, is_active: p.id === plan.id }
        : p
    );
    setPlans(next);
    writeLocalPlans(user.id, next);

    try {
      if (sameTypePlanIds.length > 0) {
        await supabase.from('workout_plans').update({ is_active: false }).in('id', sameTypePlanIds);
      }
      await supabase.from('workout_plans').update({ is_active: true }).eq('id', plan.id);
    } catch (error) {
      console.warn('Failed updating plan activation in Supabase, kept local state:', error);
    }

    toast({ title: language === 'ar' ? 'تم تفعيل الخطة' : 'Plan activated!' });
  };

  const formatDateShort = (date: Date) => {
    return date.toLocaleDateString(language === 'ar' ? 'ar' : 'en', { day: 'numeric' });
  };

  const formatDayName = (date: Date) => {
    return date.toLocaleDateString(language === 'ar' ? 'ar' : 'en', { weekday: 'short' });
  };

  const formatWeekRange = () => {
    const start = weekDates[0];
    const end = weekDates[6];
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const locale = language === 'ar' ? 'ar' : 'en';
    return `${start.toLocaleDateString(locale, opts)} - ${end.toLocaleDateString(locale, opts)}, ${end.getFullYear()}`;
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  };

  if (!user) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="flex items-center justify-center pt-32">
          <p className="text-muted-foreground">
            {language === 'ar' ? 'سجل دخولك لعرض الجدول' : 'Sign in to view your schedule'}
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="flex items-center justify-center pt-32">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 md:pb-8">
      <Navbar />
      <main className="container mx-auto px-4 pt-24 max-w-6xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6 space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-display text-4xl md:text-5xl text-foreground mb-2">
                {language === 'ar' ? 'الجدول اليومي' : 'DAILY SCHEDULE'}
              </h1>
              <p className="text-muted-foreground max-w-2xl">
                {language === 'ar'
                  ? 'رتب أسبوعك بوضوح: راقب اليوم المختار، العناصر المكتملة، ملاحظاتك، والخطط النشطة في مكان واحد.'
                  : 'Keep the page organized around one selected day, clear progress, your notes, and your active plans.'}
              </p>
            </div>

            <div className="flex bg-card/80 rounded-xl p-1 gap-1 border border-border/50 self-start lg:self-auto">
            <button onClick={() => setViewTab('workout')}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                viewTab === 'workout' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>
              <Dumbbell className="w-4 h-4" />
              {language === 'ar' ? 'التمارين' : 'Workouts'}
            </button>
            <button onClick={() => setViewTab('nutrition')}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                viewTab === 'nutrition' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>
              <UtensilsCrossed className="w-4 h-4" />
              {language === 'ar' ? 'التغذية' : 'Nutrition'}
            </button>
          </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {overviewCards.map((card) => (
              <div key={card.key} className="glass-card rounded-2xl p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</p>
                <p className="mt-2 text-base font-semibold text-foreground line-clamp-2">{card.value}</p>
                <p className="mt-2 text-xs text-muted-foreground">{card.helper}</p>
              </div>
            ))}
          </div>
        </motion.div>

        <section className="glass-card rounded-2xl p-5 mb-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {language === 'ar' ? 'التقويم الأسبوعي' : 'Weekly calendar'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {language === 'ar'
                  ? 'اختر اليوم لترى ما هو مخطط وما الذي تم إنجازه بالفعل.'
                  : 'Pick any day to inspect what is planned and what has already been completed.'}
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 md:justify-end">
              <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w - 1)}>
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <div className="text-center min-w-[180px]">
                <p className="text-sm font-semibold text-foreground">{formatWeekRange()}</p>
                {weekOffset !== 0 && (
                  <button onClick={() => setWeekOffset(0)} className="text-xs text-primary hover:underline">
                    {language === 'ar' ? 'العودة لليوم' : 'Back to today'}
                  </button>
                )}
              </div>
              <Button variant="ghost" size="icon" onClick={() => setWeekOffset(w => w + 1)}>
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {weekDates.map((date, idx) => {
              const today = isToday(date);
              const selected = idx === selectedDateIdx;
              const hasMatch = getMatchingPlanDay(currentPlan, date) !== null;
              const hasActivity = hasDailyActivity(date);
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedDateIdx(idx)}
                  className={`flex flex-col items-center py-3 px-1 rounded-xl transition-all text-xs min-h-[84px] ${
                    selected
                      ? 'bg-primary text-primary-foreground shadow-glow'
                      : today
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'bg-card/50 text-muted-foreground hover:bg-card border border-border/20'
                  }`}
                >
                  <span className="font-medium">{formatDayName(date)}</span>
                  <span className={`text-lg font-bold ${selected ? '' : 'text-foreground'}`}>{formatDateShort(date)}</span>
                  {!selected && (hasMatch || hasActivity) && (
                    <div className="mt-auto pt-2 flex items-center gap-1">
                      {hasMatch && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                      {hasActivity && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-primary" />{language === 'ar' ? 'يوجد عنصر مجدول' : 'Planned item exists'}</div>
            <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-accent" />{language === 'ar' ? 'يوجد نشاط أو ملاحظة' : 'Activity or note recorded'}</div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.95fr)]">
          <section>
        {currentPlan ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-8">
            {!adherenceLoading && workoutDetectedToday && workoutAdherence && (
              <div className="mb-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-left">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-emerald-500/20 p-2 text-emerald-600">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                      <span>{language === 'ar' ? 'تم اكتشاف نشاط تمرين اليوم' : 'Workout detected today'}</span>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs uppercase tracking-wide">
                        {workoutAdherence.detection.confidence}
                      </span>
                    </div>
                    <p className="text-sm text-emerald-900/80">
                      {workoutAdherence.reminder.message || workoutAdherence.detection.reasons[0] || (language === 'ar' ? 'تم تسجيل تمرين أو نشاط قوي اليوم.' : 'Strong workout evidence was recorded today.')}
                    </p>
                    <p className="mt-2 text-xs text-emerald-900/70">
                      {language === 'ar'
                        ? `الدقائق النشطة: ${workoutAdherence.detection.metrics.active_minutes_total} • دقائق النبض المرتفع: ${workoutAdherence.detection.metrics.heart_zone_active_minutes} • الإكمالات اليدوية: ${workoutAdherence.detection.metrics.manual_workout_completions_today}`
                        : `Active minutes: ${workoutAdherence.detection.metrics.active_minutes_total} • Heart-zone minutes: ${workoutAdherence.detection.metrics.heart_zone_active_minutes} • Manual completions: ${workoutAdherence.detection.metrics.manual_workout_completions_today}`}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!adherenceLoading && showMissedWorkoutReminder && workoutAdherence && (
              <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-left">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-amber-500/20 p-2 text-amber-600">
                    <BellRing className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-amber-700">
                      <span>{language === 'ar' ? 'تذكير التمرين اليوم' : 'Workout reminder for today'}</span>
                      {workoutAdherence.reminder.already_sent_today && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs uppercase tracking-wide">
                          {language === 'ar' ? 'تم الإرسال' : 'sent'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-amber-900/80">
                      {workoutAdherence.reminder.message || (language === 'ar' ? 'اليوم يوم تمرين مخطط ولم يتم اكتشاف تمرين بعد.' : 'Today is a scheduled workout day and no workout has been detected yet.')}
                    </p>
                    {workoutAdherence.schedule.planned_workout_names_today.length > 0 && (
                      <p className="mt-2 text-xs text-amber-900/70">
                        {language === 'ar'
                          ? `التمارين المخططة اليوم: ${workoutAdherence.schedule.planned_workout_names_today.slice(0, 4).join('، ')}`
                          : `Planned today: ${workoutAdherence.schedule.planned_workout_names_today.slice(0, 4).join(', ')}`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="glass-card rounded-2xl p-6">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between mb-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    {language === 'ar' ? 'منطقة اليوم المختار' : 'Selected day workspace'}
                  </p>
                  <h2 className="text-xl font-bold text-foreground">
                    {language === 'ar' ? currentPlan.title_ar || currentPlan.title : currentPlan.title}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    {language === 'ar'
                      ? `${selectedDayTitle} • ${selectedLogDate}`
                      : `${selectedDayTitle} • ${selectedLogDate}`}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-primary/20 text-primary">
                    {language === 'ar' ? 'نشط' : 'Active'}
                  </span>
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-secondary/70 text-foreground">
                    {language === 'ar'
                      ? `${selectedItemsTotal} عناصر اليوم`
                      : `${selectedItemsTotal} items today`}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3 mb-5">
                <div className="rounded-2xl border border-border/40 bg-card/40 p-4">
                  <p className="text-xs font-medium text-muted-foreground">{language === 'ar' ? 'المكتمل اليوم' : 'Completed today'}</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{dailyProgress?.completed ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-border/40 bg-card/40 p-4">
                  <p className="text-xs font-medium text-muted-foreground">{language === 'ar' ? 'المتبقي اليوم' : 'Remaining today'}</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{selectedItemsRemaining}</p>
                </div>
                <div className="rounded-2xl border border-border/40 bg-card/40 p-4">
                  <p className="text-xs font-medium text-muted-foreground">{language === 'ar' ? 'عناصر اليوم' : 'Scheduled today'}</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{selectedItemsTotal}</p>
                </div>
              </div>

              {viewTab === 'workout' && workoutAdherence && !workoutDetectedToday && !showMissedWorkoutReminder && workoutAdherence.schedule.has_workout_planned_today && (
                <div className="mb-5 flex items-start gap-3 rounded-2xl border border-sky-500/20 bg-sky-500/10 p-4 text-left">
                  <div className="rounded-xl bg-sky-500/20 p-2 text-sky-600">
                    <Activity className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-sky-700">
                      {language === 'ar' ? 'اليوم يوم تمرين مخطط' : 'A workout is planned for today'}
                    </div>
                    <p className="mt-1 text-sm text-sky-900/75">
                      {language === 'ar'
                        ? `لم يتم الوصول إلى وقت التذكير بعد. التمارين المخططة اليوم: ${workoutAdherence.schedule.planned_workout_items_today}`
                        : `The reminder cutoff has not been reached yet. Planned workout items today: ${workoutAdherence.schedule.planned_workout_items_today}`}
                    </p>
                  </div>
                </div>
              )}
              {planProgress && (
                <div className="mb-5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                    <span>{language === 'ar' ? 'التقدم' : 'Progress'}</span>
                    <span>
                      {planProgress.completedItems}/{planProgress.totalItems} · {planProgress.percent}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${planProgress.percent}%` }} />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {language === 'ar'
                      ? `المتبقي ${planProgress.remaining}%`
                      : `${planProgress.remaining}% remaining`}
                  </div>
                </div>
              )}

              {dailyProgress && dailyProgress.total > 0 && (
                <div className="mb-5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                    <span>{language === 'ar' ? 'تقدم اليوم' : 'Daily Progress'}</span>
                    <span>
                      {dailyProgress.completed}/{dailyProgress.total} · {dailyProgress.percent}%
                    </span>
                  </div>
                  <Progress value={dailyProgress.percent} className="h-2" />
                  <div className="mt-2 text-xs text-muted-foreground">
                    {language === 'ar'
                      ? `تاريخ اليوم: ${selectedLogDate}`
                      : `Today: ${selectedLogDate}`}
                  </div>
                </div>
              )}

              {dailyProgress && dailyProgress.completed > 0 && (
                <div className="mb-5 rounded-2xl border border-primary/25 bg-primary/8 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {language === 'ar'
                        ? (viewTab === 'nutrition' ? 'جاهز تاخذ ملاحظات غذائية من المدرب؟' : 'جاهز تاخذ ملاحظات من المدرب؟')
                        : (viewTab === 'nutrition' ? 'Ready for AI nutrition feedback?' : 'Ready for AI coach feedback?')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {language === 'ar'
                        ? (
                            viewTab === 'nutrition'
                              ? 'بعد ما علّمت الوجبات كمكتملة، اضغط الزر والمدرب راح يقرأ تقدمك الغذائي ويعطيك ملاحظات ويذكر لك شو ناقص.'
                              : 'بعد ما علّمت التمارين كمكتملة، اضغط الزر والمدرب راح يقرأ تقدمك ويعطيك ملاحظات.'
                          )
                        : (
                            viewTab === 'nutrition'
                              ? 'Now that you checked off meals, send today\'s nutrition progress to the AI Coach for feedback and missing-item recommendations.'
                              : 'Now that you checked off exercises, send today\'s progress to the AI Coach for feedback.'
                          )}
                    </p>
                  </div>
                  <Button onClick={requestCoachProgressFeedback} className="gap-2 self-start md:self-auto">
                    <MessageSquareText className="w-4 h-4" />
                    {language === 'ar'
                      ? (viewTab === 'nutrition' ? 'حلل تقدمي الغذائي الآن' : 'حلل تقدمي الآن')
                      : (viewTab === 'nutrition' ? 'Analyze My Nutrition Progress' : 'Analyze My Progress')}
                  </Button>
                </div>
              )}

              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {language === 'ar'
                      ? (viewTab === 'workout' ? 'عناصر التمرين لهذا اليوم' : 'عناصر التغذية لهذا اليوم')
                      : (viewTab === 'workout' ? 'Workout items for this day' : 'Nutrition items for this day')}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {language === 'ar'
                      ? 'علّم العناصر المكتملة، واترك الباقي واضحاً لليوم.'
                      : 'Check off completed items and keep the rest visible for the day.'}
                  </p>
                </div>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={`${viewTab}-${selectedDateIdx}-${weekOffset}`}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-3"
                >
                  {matchingDay ? (
                    <>
                      <p className="text-sm text-muted-foreground mb-3">
                        {language === 'ar' ? matchingDay.day.dayAr || matchingDay.day.day : matchingDay.day.day}
                      </p>

                      {/* Exercises */}
                      {matchingDay.day.exercises?.map((ex, exIdx) => {
                        const done = isCompleted(matchingDay.index, exIdx, currentPlan.id);
                        const exerciseLabel = language === 'ar' ? ex.nameAr || ex.name : ex.name;
                        const isHighlighted = Boolean(highlightItemName) && normalizeItemLabel(exerciseLabel) === normalizeItemLabel(highlightItemName);
                        return (
                          <div
                            key={`ex-${exIdx}`}
                            ref={isHighlighted ? targetItemRef : null}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleCompletion(matchingDay.index, exIdx, currentPlan.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleCompletion(matchingDay.index, exIdx, currentPlan.id);
                              }
                            }}
                            className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-start ${
                              isHighlighted
                                ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]'
                                : done ? 'bg-primary/10 border-primary/30' : 'bg-card/30 border-border/30 hover:bg-card/50'
                            }`}
                          >
                            <Checkbox
                              checked={done}
                              onCheckedChange={() => toggleCompletion(matchingDay.index, exIdx, currentPlan.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={language === 'ar' ? 'تمرين مكتمل' : 'Exercise completed'}
                              className="h-5 w-5"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <Dumbbell className="w-3.5 h-3.5 text-primary/70" />
                                <p className={`font-medium ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                                  {exerciseLabel}
                                </p>
                                {isHighlighted && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">{language === 'ar' ? 'مطلوب الآن' : 'Needed now'}</span>}
                              </div>
                              {ex.sets && <p className="text-xs text-muted-foreground mt-0.5">{ex.sets} × {ex.reps}</p>}
                            </div>
                          </div>
                        );
                      })}

                      {/* Meals */}
                      {matchingDay.day.meals?.map((meal, mIdx) => {
                        const idx = (matchingDay.day.exercises?.length || 0) + mIdx;
                        const done = isCompleted(matchingDay.index, idx, currentPlan.id);
                        const mealLabel = language === 'ar' ? meal.nameAr || meal.name : meal.name;
                        const isHighlighted = Boolean(highlightItemName) && normalizeItemLabel(mealLabel) === normalizeItemLabel(highlightItemName);
                        return (
                          <div
                            key={`meal-${mIdx}`}
                            ref={isHighlighted ? targetItemRef : null}
                            role="button"
                            tabIndex={0}
                            onClick={() => toggleCompletion(matchingDay.index, idx, currentPlan.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleCompletion(matchingDay.index, idx, currentPlan.id);
                              }
                            }}
                            className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-start ${
                              isHighlighted
                                ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]'
                                : done ? 'bg-primary/10 border-primary/30' : 'bg-card/30 border-border/30 hover:bg-card/50'
                            }`}
                          >
                            <Checkbox
                              checked={done}
                              onCheckedChange={() => toggleCompletion(matchingDay.index, idx, currentPlan.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={language === 'ar' ? 'وجبة مكتملة' : 'Meal completed'}
                              className="h-5 w-5"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <UtensilsCrossed className="w-3.5 h-3.5 text-accent-foreground/70" />
                                <p className={`font-medium ${done ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                                  {mealLabel}
                                </p>
                                {isHighlighted && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">{language === 'ar' ? 'مطلوب الآن' : 'Needed now'}</span>}
                                {meal.calories && <span className="text-xs text-muted-foreground">({meal.calories} cal)</span>}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {language === 'ar' ? meal.descriptionAr || meal.description : meal.description}
                              </p>
                            </div>
                          </div>
                        );
                      })}

                      {/* Rest Day */}
                      {(!matchingDay.day.exercises?.length && !matchingDay.day.meals?.length) && (
                        <div className="text-center py-8 text-muted-foreground">
                          <Calendar className="w-10 h-10 mx-auto mb-3 opacity-50" />
                          <p>{language === 'ar' ? 'يوم راحة 😴' : 'Rest Day 😴'}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Calendar className="w-10 h-10 mx-auto mb-3 opacity-50" />
                      <p>{language === 'ar' ? 'لا يوجد خطة لهذا اليوم' : 'No plan for this day'}</p>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        ) : (
          <div className="glass-card rounded-2xl p-10 text-center mb-8">
            {viewTab === 'workout' ? (
              <Dumbbell className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            ) : (
              <UtensilsCrossed className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
            )}
            <p className="text-muted-foreground mb-4">
              {viewTab === 'workout'
                ? (language === 'ar' ? 'ما عندك جدول تمارين. اسأل المدرب الذكي يعملك جدول!' : "No workout schedule. Ask AI Coach to create one!")
                : (language === 'ar' ? 'ما عندك نظام غذائي. اسأل المدرب الذكي يعملك نظام!' : "No nutrition plan. Ask AI Coach to create one!")}
            </p>
            <Button variant="hero" onClick={() => window.location.href = '/coach'}>
              {language === 'ar' ? 'اسأل المدرب' : 'Ask AI Coach'}
            </Button>
          </div>
        )}
          </section>

          <aside className="space-y-6">
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">
                  {language === 'ar' ? 'ملخص اليوم' : 'Day summary'}
                </h3>
                <span className="text-xs text-muted-foreground">{selectedLogDate}</span>
              </div>

              <div className="space-y-3 text-sm">
                <div className="rounded-xl border border-border/40 bg-card/40 p-3">
                  <p className="text-xs text-muted-foreground mb-1">{language === 'ar' ? 'نوع العرض' : 'Current view'}</p>
                  <p className="font-medium text-foreground">{language === 'ar' ? (viewTab === 'workout' ? 'التمارين' : 'التغذية') : (viewTab === 'workout' ? 'Workouts' : 'Nutrition')}</p>
                </div>
                <div className="rounded-xl border border-border/40 bg-card/40 p-3">
                  <p className="text-xs text-muted-foreground mb-1">{language === 'ar' ? 'العناصر المكتملة' : 'Completed items'}</p>
                  <p className="font-medium text-foreground">{dailyProgress ? dailyProgress.completed : 0}</p>
                </div>
                <div className="rounded-xl border border-border/40 bg-card/40 p-3">
                  <p className="text-xs text-muted-foreground mb-1">{language === 'ar' ? 'العناصر الناقصة' : 'Missing items'}</p>
                  <p className="font-medium text-foreground">{selectedItemsRemaining}</p>
                </div>
                <div className="rounded-xl border border-border/40 bg-card/40 p-3">
                  <p className="text-xs text-muted-foreground mb-1">{language === 'ar' ? 'إجمالي الخطط من هذا النوع' : 'Plans in this section'}</p>
                  <p className="font-medium text-foreground">{planCollection.length}</p>
                </div>
              </div>
            </div>

            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">
                  {language === 'ar' ? 'ملاحظات اليوم' : 'Daily log'}
                </h3>
                <span className="text-xs text-muted-foreground">{selectedLogDate}</span>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-2">
                    {language === 'ar' ? 'شو تمرنت اليوم؟' : 'What did you train today?'}
                  </label>
                  <Textarea
                    value={logDraft.workout_notes}
                    onChange={(e) => setLogDraft(prev => ({ ...prev, workout_notes: e.target.value }))}
                    placeholder={language === 'ar' ? 'اكتب تفاصيل التمرين...' : 'Add workout notes...'}
                    className="bg-secondary/40 border-border"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-2">
                    {language === 'ar' ? 'شو أكلت اليوم؟' : 'How was your nutrition today?'}
                  </label>
                  <Textarea
                    value={logDraft.nutrition_notes}
                    onChange={(e) => setLogDraft(prev => ({ ...prev, nutrition_notes: e.target.value }))}
                    placeholder={language === 'ar' ? 'اكتب ملاحظات التغذية...' : 'Add nutrition notes...'}
                    className="bg-secondary/40 border-border"
                    rows={3}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-2">
                    {language === 'ar' ? 'مزاجك/طاقتك اليوم' : 'Mood / Energy'}
                  </label>
                  <Input
                    value={logDraft.mood}
                    onChange={(e) => setLogDraft(prev => ({ ...prev, mood: e.target.value }))}
                    placeholder={language === 'ar' ? 'مثال: طاقة عالية، مرهق...' : 'e.g. High energy, tired...'}
                    className="bg-secondary/40 border-border"
                  />
                </div>

                <div className="flex flex-col gap-3">
                  <p className="text-xs text-muted-foreground">
                    {language === 'ar'
                      ? 'هذه الملاحظات تساعد المدرب الذكي على فهم تقدمك اليومي.'
                      : 'These notes help the AI coach track your daily progress.'}
                  </p>
                  <Button variant="hero" size="sm" onClick={saveDailyLog} disabled={savingLog} className="self-start">
                    {savingLog
                      ? (language === 'ar' ? 'جارٍ الحفظ...' : 'Saving...')
                      : (language === 'ar' ? 'حفظ' : 'Save')}
                  </Button>
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* All Plans */}
        {planCollection.length > 0 && (
          <section>
            <h3 className="text-lg font-semibold mb-4 text-foreground">
              {language === 'ar' ? 'مكتبة الخطط' : 'Plan library'}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {planCollection.map(plan => (
                <div key={plan.id} className="glass-card rounded-xl p-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {language === 'ar' ? plan.title_ar || plan.title : plan.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(plan.created_at).toLocaleDateString(language === 'ar' ? 'ar' : 'en')}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {language === 'ar'
                        ? `${plan.plan_data.filter(day => planDayHasItems(day)).length} أيام فيها عناصر`
                        : `${plan.plan_data.filter(day => planDayHasItems(day)).length} scheduled days`}
                    </p>
                  </div>
                  <div className="flex gap-2 self-start md:self-auto">
                    {!plan.is_active && (
                      <Button size="sm" variant="outline" onClick={() => activatePlan(plan)}>
                        {language === 'ar' ? 'تفعيل' : 'Activate'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => deletePlan(plan.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}


