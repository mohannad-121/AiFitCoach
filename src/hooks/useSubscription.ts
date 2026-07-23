import { useCallback, useEffect, useState } from 'react';
import { Subscription, subscriptionRequest } from '@/lib/subscription';

const toUsageCount = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
);

const toUsageLimit = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
);

const normalizeSubscription = (value: unknown): Subscription => {
  const candidate = value && typeof value === 'object' ? value as Partial<Subscription> : {};
  const usage: Partial<Subscription['usage']> = candidate.usage && typeof candidate.usage === 'object'
    ? candidate.usage
    : {};

  return {
    plan: candidate.plan === 'plus' || candidate.plan === 'pro' ? candidate.plan : 'free',
    status: typeof candidate.status === 'string' && candidate.status.trim() ? candidate.status : 'offline',
    currentPeriodStart: typeof candidate.currentPeriodStart === 'string' ? candidate.currentPeriodStart : null,
    currentPeriodEnd: typeof candidate.currentPeriodEnd === 'string' ? candidate.currentPeriodEnd : null,
    isUnlimited: typeof candidate.isUnlimited === 'boolean' ? candidate.isUnlimited : true,
    usage: {
      uploadsUsed: toUsageCount(usage.uploadsUsed),
      uploadsLimit: toUsageLimit(usage.uploadsLimit),
      chatMessagesUsed: toUsageCount(usage.chatMessagesUsed),
      chatMessagesLimit: toUsageLimit(usage.chatMessagesLimit),
      generatedPlansUsed: toUsageCount(usage.generatedPlansUsed),
      generatedPlansLimit: toUsageLimit(usage.generatedPlansLimit),
    },
  };
};

const FALLBACK_SUBSCRIPTION = normalizeSubscription(null);

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setSubscription(normalizeSubscription(await subscriptionRequest('/api/subscription/me')));
    } catch (e) {
      setSubscription(FALLBACK_SUBSCRIPTION);
      setError(e instanceof Error ? e.message : 'Unable to load subscription.');
    }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { subscription, loading, error, refresh };
}
