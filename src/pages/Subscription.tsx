import { motion } from 'framer-motion';
import { Check, Crown, Loader2, Sparkles } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/hooks/useSubscription';
import { subscriptionRequest } from '@/lib/subscription';
import { useLanguage } from '@/contexts/LanguageContext';

const plans = [
  { id: 'free', price: 0, itemKeys: ['subscription.plan.free.uploads', 'subscription.plan.free.messages', 'subscription.plan.free.plans'], premium: false },
  { id: 'plus', price: 10, itemKeys: ['subscription.plan.plus.uploads', 'subscription.plan.plus.messages', 'subscription.plan.plus.plans'], premium: false },
  { id: 'pro', price: 15, itemKeys: ['subscription.plan.pro.uploads', 'subscription.plan.pro.messages', 'subscription.plan.pro.plans'], premium: true },
] as const;

function Bar({ label, used, limit, unlimitedLabel, limitReachedLabel }: { label: string; used: number; limit: number | null; unlimitedLabel: string; limitReachedLabel: string }) {
  const percent = limit == null ? 0 : Math.min(100, (used / limit) * 100);

  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-300">
        <span>{label}</span>
        <span dir="ltr">{used} / {limit ?? unlimitedLabel}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${
            percent >= 100 ? 'bg-rose-500' : percent >= 80 ? 'bg-amber-400' : 'bg-gradient-to-r from-violet-500 to-cyan-400'
          }`}
          style={{ width: `${limit == null ? 100 : percent}%` }}
        />
      </div>
      {percent >= 100 && <p className="mt-1 text-xs text-rose-300">{limitReachedLabel}</p>}
    </div>
  );
}

export function SubscriptionPage() {
  const { language, t } = useLanguage();
  const { subscription, loading, error } = useSubscription();
  const usage = {
    uploadsUsed: subscription?.usage?.uploadsUsed ?? 0,
    uploadsLimit: subscription?.usage?.uploadsLimit ?? null,
    chatMessagesUsed: subscription?.usage?.chatMessagesUsed ?? 0,
    chatMessagesLimit: subscription?.usage?.chatMessagesLimit ?? null,
    generatedPlansUsed: subscription?.usage?.generatedPlansUsed ?? 0,
    generatedPlansLimit: subscription?.usage?.generatedPlansLimit ?? null,
  };
  const statusLabel = language === 'ar'
    ? ({ active: 'نشط', offline: 'غير متصل', canceled: 'ملغى', past_due: 'متأخر' }[subscription?.status.toLowerCase() || ''] || subscription?.status)
    : subscription?.status;
  const formatBillingDate = (value: string | null | undefined) => (
    value ? new Date(value).toLocaleDateString(language === 'ar' ? 'ar-JO' : 'en-US') : '-'
  );

  const checkout = async (plan: 'plus' | 'pro') => {
    const { url } = await subscriptionRequest('/api/billing/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    window.location.assign(url);
  };

  const portal = async () => {
    const { url } = await subscriptionRequest('/api/billing/create-portal-session', { method: 'POST' });
    window.location.assign(url);
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#050611] text-white">
      <Navbar />
      <main className="relative mx-auto max-w-6xl px-4 pb-20 pt-28">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_30%_10%,rgba(168,85,247,.22),transparent_40%),radial-gradient(circle_at_75%_15%,rgba(34,211,238,.15),transparent_35%)]" />
        <div className="relative text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-fuchsia-300/20 bg-fuchsia-400/10 px-4 py-2 text-xs uppercase tracking-[.25em] text-fuchsia-200">
            <Sparkles className="h-4 w-4" /> {t('subscription.membership')}
          </span>
          <h1 className="mt-5 text-4xl font-black md:text-6xl">{t('subscription.title')}</h1>
          <p className="mx-auto mt-4 max-w-2xl text-slate-300">{t('subscription.subtitle')}</p>
        </div>

        {loading ? (
          <Loader2 className="mx-auto mt-16 animate-spin" />
        ) : subscription ? (
          <>
            {error && (
              <p className="relative mt-8 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-center text-sm text-amber-100">
                {t('subscription.billingUnavailable')}
              </p>
            )}

            <section className="relative mt-10 rounded-3xl border border-white/10 bg-white/[.045] p-6 backdrop-blur-2xl">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-400">{t('subscription.currentPlan')}</p>
                  <h2 className="text-2xl font-bold capitalize">
                    {t(`subscription.plan.${subscription.plan}.name`)}{' '}
                    <span className="ml-2 rounded-full bg-emerald-400/15 px-2 py-1 text-xs uppercase text-emerald-300">
                      {statusLabel}
                    </span>
                  </h2>
                </div>
                {subscription.plan !== 'free' && (
                  <Button variant="outline" onClick={() => void portal()}>
                    {t('subscription.manageBilling')}
                  </Button>
                )}
              </div>

              <p className="mb-5 text-xs text-slate-400">
                {t('subscription.billingPeriod')}: <span dir="ltr">{formatBillingDate(subscription.currentPeriodStart)} - {formatBillingDate(subscription.currentPeriodEnd)}</span>
              </p>
              <div className="grid gap-5 md:grid-cols-3">
                <Bar label={t('subscription.uploads')} used={usage.uploadsUsed} limit={usage.uploadsLimit} unlimitedLabel={t('subscription.unlimited')} limitReachedLabel={t('subscription.limitReached')} />
                <Bar label={t('subscription.messages')} used={usage.chatMessagesUsed} limit={usage.chatMessagesLimit} unlimitedLabel={t('subscription.unlimited')} limitReachedLabel={t('subscription.limitReached')} />
                <Bar label={t('subscription.generatedPlans')} used={usage.generatedPlansUsed} limit={usage.generatedPlansLimit} unlimitedLabel={t('subscription.unlimited')} limitReachedLabel={t('subscription.limitReached')} />
              </div>
            </section>

            <section className="relative mt-8 grid gap-5 md:grid-cols-3">
              {plans.map((plan, index) => (
                <motion.article
                  key={plan.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.08 }}
                  whileHover={{ y: -7 }}
                  className={`relative rounded-3xl border p-7 backdrop-blur-xl ${
                    plan.premium
                      ? 'border-fuchsia-400/50 bg-gradient-to-b from-fuchsia-500/15 to-cyan-500/5 shadow-[0_0_55px_rgba(217,70,239,.18)]'
                      : 'border-white/10 bg-white/[.045]'
                  }`}
                >
                  {plan.premium && (
                    <span className="absolute right-5 top-5 rounded-full bg-gradient-to-r from-fuchsia-500 to-cyan-400 px-3 py-1 text-xs font-bold text-slate-950">
                      {t('subscription.bestValue')}
                    </span>
                  )}
                  <Crown className={`h-8 w-8 ${plan.premium ? 'text-fuchsia-300' : 'text-violet-300'}`} />
                  <h3 className="mt-5 text-2xl font-bold">{t(`subscription.plan.${plan.id}.name`)}</h3>
                  <p dir="ltr" className="mt-2 text-4xl font-black">
                    ${plan.price}
                    <span className="text-sm font-normal text-slate-400">/month</span>
                  </p>
                  <ul className="my-7 space-y-3 text-sm text-slate-300">
                    {plan.itemKeys.map((itemKey) => (
                      <li key={itemKey} className="flex gap-2">
                        <Check className="h-4 w-4 text-cyan-300" />
                        {t(itemKey)}
                      </li>
                    ))}
                  </ul>
                  <Button
                    disabled={subscription.plan === plan.id || plan.id === 'free' || Boolean(error)}
                    onClick={() => plan.id !== 'free' && void checkout(plan.id)}
                    className="w-full bg-gradient-to-r from-violet-600 via-fuchsia-600 to-cyan-500"
                  >
                    {subscription.plan === plan.id
                      ? t('subscription.current')
                      : plan.id === 'free'
                        ? subscription.plan === 'free'
                          ? t('subscription.current')
                          : t('subscription.manageDowngrade')
                        : `${t('subscription.upgradeTo')} ${t(`subscription.plan.${plan.id}.name`)}`}
                  </Button>
                </motion.article>
              ))}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
