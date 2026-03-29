CREATE TABLE IF NOT EXISTS public.fitbit_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'fitbit',
  fitbit_user_id TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  scope TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMP WITH TIME ZONE,
  profile_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sync_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.fitbit_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own fitbit connection" ON public.fitbit_connections
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own fitbit connection" ON public.fitbit_connections
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own fitbit connection" ON public.fitbit_connections
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own fitbit connection" ON public.fitbit_connections
FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_fitbit_connections_updated_at
BEFORE UPDATE ON public.fitbit_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();