import { useCallback, useEffect, useState } from 'react';
import { Subscription, subscriptionRequest } from '@/lib/subscription';

const FALLBACK_SUBSCRIPTION: Subscription = {
  plan: 'free',
  status: 'offline',
  currentPeriodStart: null,
  currentPeriodEnd: null,
  isUnlimited: true,
  usage: {
    uploadsUsed: 0,
    uploadsLimit: null,
    chatMessagesUsed: 0,
    chatMessagesLimit: null,
    generatedPlansUsed: 0,
    generatedPlansLimit: null,
  },
};

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setSubscription(await subscriptionRequest('/api/subscription/me'));
    } catch (e) {
      setSubscription(FALLBACK_SUBSCRIPTION);
      setError(e instanceof Error ? e.message : 'Unable to load subscription.');
    }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { subscription, loading, error, refresh };
}
