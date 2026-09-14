import { useSyncExternalStore } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY));
type AuthState = { user: User | null; session: Session | null; loading: boolean };
let state: AuthState = { user: null, session: null, loading: true };
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
function publish(next: AuthState) { state = next; listeners.forEach(listener => listener()); }
function start() {
  if (!configured) {
    const read = () => {
      try { publish({ user: JSON.parse(localStorage.getItem('fitcoach_mock_user') || 'null'), session: null, loading: false }); }
      catch { publish({ user: null, session: null, loading: false }); }
    };
    read(); window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }
  let active = true;
  let received = false;
  const accept = (session: Session | null) => { if (active) { received = true; publish({ user: session?.user ?? null, session, loading: false }); } };
  const { data } = supabase.auth.onAuthStateChange((_event, session) => accept(session));
  void supabase.auth.getSession().then(({ data }) => { if (!received) accept(data.session); }).catch(() => { if (!received) accept(null); });
  return () => { active = false; data.subscription.unsubscribe(); };
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) stop = start();
  return () => { listeners.delete(listener); if (!listeners.size) { stop?.(); stop = undefined; } };
}
async function signOut() {
  if (configured) { const { error } = await supabase.auth.signOut(); if (error) throw error; }
  localStorage.removeItem('fitcoach_mock_user');
  publish({ user: null, session: null, loading: false });
  window.dispatchEvent(new Event('storage'));
}
export function useAuth() {
  return { ...useSyncExternalStore(subscribe, () => state, () => state), signOut };
}
