import React, { useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { AI_BACKEND_URL } from '@/lib/backendUrl';

type HeartRatePoint = {
  time: string;
  bpm: number;
  timestamp: string;
};

type HeartRatePayload = {
  configured: boolean;
  connected: boolean;
  date?: string;
  detail_level?: string;
  resting_heart_rate?: number | null;
  points: HeartRatePoint[];
};

type HeartRateTimelinePanelProps = {
  userId: string | null | undefined;
  enabled?: boolean;
  className?: string;
};

function downsampleHeartPoints(points: HeartRatePoint[]) {
  if (points.length <= 240) {
    return points;
  }
  const step = Math.ceil(points.length / 240);
  return points.filter((_, index) => index % step === 0 || index === points.length - 1);
}

function formatHeartTick(value: string) {
  const hour = value.slice(0, 2);
  const minute = value.slice(3, 5);
  return minute === '00' ? `${hour}:00` : `${hour}:${minute}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function HeartRateTimelinePanel({ userId, enabled = true, className = '' }: HeartRateTimelinePanelProps) {
  const { language } = useLanguage();
  const [selectedDay, setSelectedDay] = useState(todayIso());
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<HeartRatePayload | null>(null);

  useEffect(() => {
    setSelectedDay(todayIso());
  }, [userId]);

  useEffect(() => {
    if (!userId || !enabled) {
      setPayload(null);
      return;
    }

    let isActive = true;

    const fetchTimeline = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${AI_BACKEND_URL}/integrations/fitbit/heart-intraday?user_id=${encodeURIComponent(userId)}&day=${encodeURIComponent(selectedDay)}&detail_level=1min`
        );
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.detail || 'Failed loading Fitbit heart timeline');
        }
        if (!isActive) {
          return;
        }
        const points = Array.isArray(body?.points) ? downsampleHeartPoints(body.points as HeartRatePoint[]) : [];
        setPayload({
          configured: Boolean(body?.configured),
          connected: Boolean(body?.connected),
          date: body?.date,
          detail_level: body?.detail_level,
          resting_heart_rate: body?.resting_heart_rate ?? null,
          points,
        });
      } catch {
        if (isActive) {
          setPayload(null);
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    };

    void fetchTimeline();
    return () => {
      isActive = false;
    };
  }, [enabled, selectedDay, userId]);

  const points = payload?.points || [];
  const stats = useMemo(() => {
    if (!points.length) {
      return { min: null as number | null, max: null as number | null, avg: null as number | null };
    }
    const values = points.map((point) => point.bpm);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    return { min, max, avg };
  }, [points]);

  const isToday = selectedDay === todayIso();

  return (
    <div className={`rounded-2xl bg-secondary/40 p-4 ${className}`.trim()}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-3">
        <div>
          <p className="text-sm text-muted-foreground mb-1">{language === 'ar' ? 'منحنى نبض القلب' : 'Heart-rate timeline'}</p>
          <p className="text-xs text-muted-foreground">
            {language === 'ar'
              ? 'اختر اليوم لعرض قراءات Fitbit الزمنية بالدقائق.'
              : 'Pick a day to inspect Fitbit time-series heart-rate readings.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={selectedDay}
            max={todayIso()}
            onChange={(event) => setSelectedDay(event.target.value || todayIso())}
            className="rounded-xl border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Button variant="outline" size="sm" onClick={() => setSelectedDay(todayIso())} disabled={isToday}>
            {language === 'ar' ? 'اليوم' : 'Today'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
        <div className="rounded-xl bg-background/70 px-3 py-3">
          <p className="text-muted-foreground mb-1">{language === 'ar' ? 'نبض الراحة' : 'Resting HR'}</p>
          <p className="font-semibold text-foreground">{payload?.resting_heart_rate ?? '--'}</p>
        </div>
        <div className="rounded-xl bg-background/70 px-3 py-3">
          <p className="text-muted-foreground mb-1">{language === 'ar' ? 'المتوسط' : 'Average'}</p>
          <p className="font-semibold text-foreground">{stats.avg ?? '--'}</p>
        </div>
        <div className="rounded-xl bg-background/70 px-3 py-3">
          <p className="text-muted-foreground mb-1">{language === 'ar' ? 'الأدنى' : 'Min'}</p>
          <p className="font-semibold text-foreground">{stats.min ?? '--'}</p>
        </div>
        <div className="rounded-xl bg-background/70 px-3 py-3">
          <p className="text-muted-foreground mb-1">{language === 'ar' ? 'الأعلى' : 'Max'}</p>
          <p className="font-semibold text-foreground">{stats.max ?? '--'}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" />
          {language === 'ar' ? 'جاري تحميل منحنى نبض القلب...' : 'Loading heart-rate timeline...'}
        </p>
      ) : points.length ? (
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 12, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
              <XAxis
                dataKey="time"
                tickFormatter={formatHeartTick}
                minTickGap={28}
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 12 }}
              />
              <YAxis
                dataKey="bpm"
                width={44}
                stroke="hsl(var(--muted-foreground))"
                tick={{ fontSize: 12 }}
                domain={['dataMin - 5', 'dataMax + 5']}
              />
              <Tooltip
                formatter={(value: number) => [`${value} bpm`, language === 'ar' ? 'النبض' : 'Heart rate']}
                labelFormatter={(label: string) => `${language === 'ar' ? 'الوقت' : 'Time'}: ${label}`}
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '0.75rem',
                }}
              />
              <Line type="monotone" dataKey="bpm" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            {language === 'ar'
              ? 'لا توجد قراءات زمنية متاحة لهذا اليوم من Fitbit.'
              : 'No time-series Fitbit readings are available for this day.'}
          </p>
          <p className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            {language === 'ar'
              ? 'جرّب يومًا آخر أو أعد المزامنة بعد وجود نشاط كافٍ.'
              : 'Try another day or sync again after enough activity has been recorded.'}
          </p>
        </div>
      )}
    </div>
  );
}