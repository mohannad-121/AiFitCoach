import { supabase } from '@/integrations/supabase/client';
import { AI_BACKEND_URL } from '@/lib/backendUrl';

export type Subscription = {
  plan: 'free' | 'plus' | 'pro'; status: string; currentPeriodStart: string | null; currentPeriodEnd: string | null;
  isUnlimited: boolean;
  usage: { uploadsUsed: number; uploadsLimit: number | null; chatMessagesUsed: number; chatMessagesLimit: number | null; generatedPlansUsed: number; generatedPlansLimit: number | null };
};

export async function authHeaders(extra: Record<string, string> = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export async function subscriptionRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${AI_BACKEND_URL}${path}`, { ...init, headers: await authHeaders(init.headers as Record<string, string> || {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.detail || 'Something went wrong.'), { status: response.status, data });
  return data;
}
