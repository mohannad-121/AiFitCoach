import { Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSubscription } from '@/hooks/useSubscription';
import type { Subscription } from '@/lib/subscription';

export function UsageWidget({ value }: { value?: Subscription | null }) {
  const state = useSubscription();
  const subscription = value === undefined ? state.subscription : value;
  const loading = value === undefined ? state.loading : false;
  const navigate = useNavigate();
  if (loading || !subscription) return null;
  const { usage } = subscription;
  const left = (used: number, limit: number | null) => limit == null ? 'Unlimited' : Math.max(0, limit - used);
  return <button onClick={() => navigate('/subscription')} className="w-full rounded-2xl border border-fuchsia-400/20 bg-slate-950/60 p-3 text-left shadow-[0_0_30px_rgba(168,85,247,.10)] backdrop-blur-xl transition hover:border-cyan-300/30">
    <div className="mb-2 flex items-center justify-between text-xs"><span className="flex items-center gap-1.5 font-semibold text-fuchsia-200"><Sparkles className="h-3.5 w-3.5"/> {subscription.plan.toUpperCase()}</span><span className="text-cyan-200">View plan</span></div>
    <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-300"><span>Messages <b>{left(usage.chatMessagesUsed, usage.chatMessagesLimit)}</b></span><span>Uploads <b>{left(usage.uploadsUsed, usage.uploadsLimit)}</b></span><span>Plans <b>{left(usage.generatedPlansUsed, usage.generatedPlansLimit)}</b></span></div>
    {usage.generatedPlansLimit != null && usage.generatedPlansUsed >= usage.generatedPlansLimit && <p className="mt-2 flex items-center justify-between gap-2 text-[11px] text-amber-300"><span>Plan credits used</span><span className="rounded-full border border-fuchsia-300/20 px-2 py-0.5 text-fuchsia-200">Upgrade</span></p>}
  </button>;
}
