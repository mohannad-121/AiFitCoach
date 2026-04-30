CREATE TABLE IF NOT EXISTS public.workout_evidence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type TEXT NOT NULL DEFAULT 'daily_workout_detection',
  evidence_date DATE NOT NULL,
  workout_detected_today BOOLEAN NOT NULL DEFAULT FALSE,
  confidence TEXT NOT NULL DEFAULT 'none',
  evidence_score INTEGER NOT NULL DEFAULT 0,
  evidence_threshold INTEGER NOT NULL DEFAULT 60,
  detection_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  schedule_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  detection_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  reminder_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  fitbit_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, report_type, evidence_date)
);

CREATE INDEX IF NOT EXISTS idx_workout_evidence_user_date
  ON public.workout_evidence(user_id, evidence_date DESC);

ALTER TABLE public.workout_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workout evidence"
  ON public.workout_evidence FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workout evidence"
  ON public.workout_evidence FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workout evidence"
  ON public.workout_evidence FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_workout_evidence_updated_at
  BEFORE UPDATE ON public.workout_evidence
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();