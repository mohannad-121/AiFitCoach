import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FileHeart, HeartPulse, Activity, ShieldCheck, RefreshCw } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

const AI_BACKEND_URL = (import.meta.env.VITE_AI_BACKEND_URL || 'http://127.0.0.1:8002').replace(/\/$/, '');

type WorkoutEvidenceRow = {
  id: string;
  evidence_date: string;
  workout_detected_today: boolean;
  confidence: string;
  evidence_score: number;
  evidence_threshold: number;
  detection_reasons: string[];
  detection_summary?: {
    metrics?: {
      resting_heart_rate?: number | null;
      active_minutes_total?: number;
      heart_zone_active_minutes?: number;
      manual_workout_completions_today?: number;
    };
  };
  schedule_summary?: {
    has_workout_planned_today?: boolean;
    planned_workout_items_today?: number;
    planned_workout_names_today?: string[];
  };
  synced_at?: string | null;
};

type WorkoutEvidenceReport = {
  user_id: string;
  generated_at: string;
  storage_ready?: boolean;
  latest_status?: {
    detection?: {
      workout_detected_today?: boolean;
      confidence?: string;
      evidence_score?: number;
      metrics?: {
        resting_heart_rate?: number | null;
        active_minutes_total?: number;
        heart_zone_active_minutes?: number;
        manual_workout_completions_today?: number;
      };
      reasons?: string[];
    };
    schedule?: {
      has_workout_planned_today?: boolean;
      planned_workout_items_today?: number;
      planned_workout_names_today?: string[];
    };
  };
  records: WorkoutEvidenceRow[];
};

const formatConfidence = (value: string | undefined, language: string) => {
  const normalized = String(value || 'none').toLowerCase();
  if (language === 'ar') {
    return { high: 'عالٍ', medium: 'متوسط', none: 'لا يوجد' }[normalized] || normalized;
  }
  return normalized;
};

type WorkoutEvidenceReportSectionProps = {
  userId: string | null | undefined;
  compact?: boolean;
};

export function WorkoutEvidenceReportSection({ userId, compact = false }: WorkoutEvidenceReportSectionProps) {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<WorkoutEvidenceReport | null>(null);

  const fetchReport = async () => {
    if (!userId) {
      setReport(null);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${AI_BACKEND_URL}/reports/workout-evidence?user_id=${encodeURIComponent(userId)}&limit=14`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail || 'Failed loading workout evidence report');
      }
      setReport(payload as WorkoutEvidenceReport);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: language === 'ar' ? 'فشل تحميل التقرير' : 'Failed loading report',
        description: error instanceof Error ? error.message : (language === 'ar' ? 'تعذر تحميل تقرير التمرين.' : 'Could not load workout report.'),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [userId]);

  const latestMetrics = report?.latest_status?.detection?.metrics;
  const latestSchedule = report?.latest_status?.schedule;

  return (
    <div className={compact ? '' : 'min-h-screen pb-24 md:pb-8'}>
      {!compact && <Navbar />}
      <main className={compact ? '' : 'container mx-auto px-4 pt-24 max-w-5xl'}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-8">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 text-primary px-4 py-2 mb-4">
              <FileHeart className="w-4 h-4" />
              <span>{language === 'ar' ? 'تقرير إثبات التمرين' : 'Workout Evidence Report'}</span>
            </div>
            <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 mb-4 ml-0 md:ml-3 ${report?.storage_ready ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
              <ShieldCheck className="w-4 h-4" />
              <span>
                {report?.storage_ready
                  ? (language === 'ar' ? 'جدول الأدلة جاهز' : 'Evidence Table Ready')
                  : (language === 'ar' ? 'الهجرة مطلوبة' : 'Migration Needed')}
              </span>
            </div>
            <h1 className="font-display text-4xl text-foreground mb-2">
              {language === 'ar' ? 'تقرير الطبيب والإدارة' : 'Doctor and Admin Report'}
            </h1>
            <p className="text-muted-foreground max-w-2xl">
              {language === 'ar'
                ? 'يعرض هذا التقرير دلائل Fitbit ونشاط الخطة لتحديد ما إذا كان التمرين قد تم تنفيذه.'
                : 'This report combines Fitbit evidence and plan activity to determine whether a workout likely happened.'}
            </p>
          </div>
          <Button variant="outline" onClick={fetchReport} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            {language === 'ar' ? 'تحديث التقرير' : 'Refresh Report'}
          </Button>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-2"><ShieldCheck className="w-4 h-4" />{language === 'ar' ? 'تم اكتشاف تمرين' : 'Workout Detected'}</div>
            <div className="text-2xl font-semibold">{report?.latest_status?.detection?.workout_detected_today ? (language === 'ar' ? 'نعم' : 'Yes') : (language === 'ar' ? 'لا' : 'No')}</div>
          </div>
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-2"><Activity className="w-4 h-4" />{language === 'ar' ? 'مستوى الثقة' : 'Confidence'}</div>
            <div className="text-2xl font-semibold">{formatConfidence(report?.latest_status?.detection?.confidence, language)}</div>
          </div>
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-2"><HeartPulse className="w-4 h-4" />{language === 'ar' ? 'نبضات القلب/الدقيقة' : 'Heart Beats / Min'}</div>
            <div className="text-2xl font-semibold">{latestMetrics?.resting_heart_rate ?? '--'}</div>
          </div>
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-2 text-muted-foreground mb-2"><Activity className="w-4 h-4" />{language === 'ar' ? 'دقائق النبض النشط' : 'Heart-Zone Minutes'}</div>
            <div className="text-2xl font-semibold">{latestMetrics?.heart_zone_active_minutes ?? 0}</div>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-3">{language === 'ar' ? 'ملخص اليوم' : 'Today Summary'}</h2>
          {!report?.storage_ready && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
              {language === 'ar'
                ? 'لم يتم تطبيق جدول workout_evidence في Supabase بعد. شغّل ملف الهجرة أولاً حتى يتم حفظ السجلات.'
                : 'The workout_evidence table has not been applied in Supabase yet. Run the migration first so evidence records can be saved.'}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="bg-secondary/40 rounded-xl p-4">
              <div className="text-muted-foreground mb-1">{language === 'ar' ? 'التمارين المخططة اليوم' : 'Planned Workout Items Today'}</div>
              <div className="text-xl font-semibold">{latestSchedule?.planned_workout_items_today ?? 0}</div>
            </div>
            <div className="bg-secondary/40 rounded-xl p-4">
              <div className="text-muted-foreground mb-1">{language === 'ar' ? 'الدقائق النشطة' : 'Active Minutes'}</div>
              <div className="text-xl font-semibold">{latestMetrics?.active_minutes_total ?? 0}</div>
            </div>
            <div className="bg-secondary/40 rounded-xl p-4">
              <div className="text-muted-foreground mb-1">{language === 'ar' ? 'الإكمالات اليدوية' : 'Manual Completions'}</div>
              <div className="text-xl font-semibold">{latestMetrics?.manual_workout_completions_today ?? 0}</div>
            </div>
          </div>
          {Array.isArray(report?.latest_status?.detection?.reasons) && report!.latest_status!.detection!.reasons!.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-muted-foreground mb-2">{language === 'ar' ? 'أسباب الاكتشاف' : 'Detection Reasons'}</p>
              <div className="flex flex-wrap gap-2">
                {report!.latest_status!.detection!.reasons!.map((reason, index) => (
                  <span key={`${reason}-${index}`} className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary">
                    {reason}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="glass-card rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-4">{language === 'ar' ? 'سجل 14 يومًا' : '14-Day Evidence History'}</h2>
          <div className="space-y-3">
            {(report?.records || []).map((row) => (
              <div key={row.id} className="rounded-xl border border-border/60 bg-secondary/30 p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                  <div>
                    <p className="font-semibold">{row.evidence_date}</p>
                    <p className="text-sm text-muted-foreground">
                      {row.workout_detected_today ? (language === 'ar' ? 'تم اكتشاف تمرين' : 'Workout detected') : (language === 'ar' ? 'لم يتم اكتشاف تمرين' : 'No workout detected')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-3 py-1 rounded-full bg-primary/10 text-primary">{language === 'ar' ? 'الثقة' : 'Confidence'}: {formatConfidence(row.confidence, language)}</span>
                    <span className="px-3 py-1 rounded-full bg-secondary text-foreground">{language === 'ar' ? 'النتيجة' : 'Score'}: {row.evidence_score}/{row.evidence_threshold}</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">{language === 'ar' ? 'نبضات القلب/الدقيقة' : 'Heart Beats / Min'}</p>
                    <p className="font-medium">{row.detection_summary?.metrics?.resting_heart_rate ?? '--'}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{language === 'ar' ? 'دقائق النبض النشط' : 'Heart-Zone Minutes'}</p>
                    <p className="font-medium">{row.detection_summary?.metrics?.heart_zone_active_minutes ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{language === 'ar' ? 'الدقائق النشطة' : 'Active Minutes'}</p>
                    <p className="font-medium">{row.detection_summary?.metrics?.active_minutes_total ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">{language === 'ar' ? 'آخر مزامنة' : 'Last Sync'}</p>
                    <p className="font-medium">{row.synced_at ? new Date(row.synced_at).toLocaleString() : '--'}</p>
                  </div>
                </div>
                {Array.isArray(row.detection_reasons) && row.detection_reasons.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.detection_reasons.map((reason, index) => (
                      <span key={`${row.id}-${index}`} className="text-xs px-3 py-1 rounded-full bg-primary/10 text-primary">
                        {reason}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {!loading && (!report?.records || report.records.length === 0) && (
              <p className="text-muted-foreground text-sm">
                {language === 'ar' ? 'لا توجد سجلات بعد. اربط Fitbit ثم اضغط مزامنة لإنشاء أول تقرير.' : 'No evidence records yet. Connect Fitbit and sync to generate the first report.'}
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export function ReportsPage() {
  const { user } = useAuth();

  return <WorkoutEvidenceReportSection userId={user?.id} />;
}