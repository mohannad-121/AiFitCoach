import { useCallback, useEffect, useState } from 'react';
import { Subscription, subscriptionRequest } from '@/lib/subscription';

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setSubscription(await subscriptionRequest('/api/subscription/me')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load subscription.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { subscription, loading, error, refresh };
}
