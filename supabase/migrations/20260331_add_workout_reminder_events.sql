CREATE TABLE IF NOT EXISTS public.workout_reminder_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL DEFAULT 'missed_workout',
  reminder_date DATE NOT NULL,
  reminder_status TEXT NOT NULL DEFAULT 'sent',
  reminder_message TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, reminder_type, reminder_date)
);

CREATE INDEX IF NOT EXISTS idx_workout_reminder_events_user_date
  ON public.workout_reminder_events(user_id, reminder_date DESC);

ALTER TABLE public.workout_reminder_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workout reminder events"
  ON public.workout_reminder_events FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workout reminder events"
  ON public.workout_reminder_events FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workout reminder events"
  ON public.workout_reminder_events FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_workout_reminder_events_updated_at
  BEFORE UPDATE ON public.workout_reminder_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();