import { useState } from 'react';
import { Check, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { Navbar } from '@/components/layout/Navbar';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/hooks/useSubscription';
import { subscriptionRequest } from '@/lib/subscription';
import { useLanguage } from '@/contexts/LanguageContext';
import { AppEmoji } from '@/components/brand/AppEmoji';
import './Subscription.css';
const plans = [
  { id:'free', monthly:0, yearly:0, total:0, uploads:2, messages:30, plans:1 },
  { id:'plus', monthly:10, yearly:7, total:84, uploads:15, messages:60, plans:3 },
  { id:'pro', monthly:15, yearly:11, total:132, uploads:30, messages:100, plans:10 },
] as const;
export function SubscriptionPage() {
  const { language, t } = useLanguage(); const ar = language === 'ar';
  const { subscription, loading, error } = useSubscription();
  const [yearly,setYearly] = useState(false); const [busy,setBusy] = useState(''); const [actionError,setActionError] = useState('');
  const copy=(en:string,arabic:string)=>ar?arabic:en;
  const checkout=async(plan:'plus'|'pro')=>{
    if(busy)return; setBusy(plan);setActionError('');
    try { const {url}=await subscriptionRequest('/api/billing/create-checkout-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan,billingCycle:yearly?'yearly':'monthly'})}); window.location.assign(url); }
    catch { setActionError(copy('Checkout is unavailable for this plan right now. Please try again later.','الدفع لهذه الخطة غير متاح حالياً. حاول لاحقاً.')); }
    finally{setBusy('');}
  };
  const portal=async()=>{if(busy)return;setBusy('portal');setActionError('');try{const {url}=await subscriptionRequest('/api/billing/create-portal-session',{method:'POST'});window.location.assign(url);}catch{setActionError(copy('Billing management is temporarily unavailable.','إدارة الفوترة غير متاحة مؤقتاً.'));}finally{setBusy('');}};
  return <div className="aura-subscription min-h-screen pb-24"><Navbar/><main><header><span className="aura-eyebrow">NextAura FIT {copy('MEMBERSHIP','العضوية')}</span><h1>{copy('More support. More possibilities.','دعم أكبر. إمكانيات أكثر.')}</h1><p>{copy('Choose the space you need for your next chapter.','اختر الخطة المناسبة لخطوتك القادمة.')}</p></header>
    <div className="billing-toggle-row"><span>{copy('Monthly','شهري')}</span><button type="button" role="switch" aria-checked={yearly} aria-label={copy('Yearly billing','الفوترة السنوية')} className="billing-toggle" onClick={()=>setYearly(value=>!value)}><span/></button><span>{copy('Yearly','سنوي')}</span><small>{copy('Save up to 30%','وفّر حتى 30%')}</small></div>
    {actionError&&<p className="billing-error" role="alert">{actionError}</p>}
    {error&&<p className="billing-error" role="status">{copy('We could not load your membership. Checkout is paused until billing reconnects.','تعذر تحميل عضويتك. الدفع متوقف حتى عودة الاتصال.')}</p>}
    <section className="pricing-plans">{plans.map(plan=>{const current=subscription?.plan===plan.id;return <article key={plan.id} className={plan.id==='pro'?'pricing-plan is-featured':'pricing-plan'}>{plan.id==='pro'&&<span className="pricing-recommendation">{copy('For your bigger goals','لأهدافك الأكبر')}</span>}<AppEmoji name={plan.id==='free'?'leaf':plan.id==='plus'?'muscle':'sparkle'}/><h2>{plan.id.toUpperCase()}</h2><p className="pricing-description">{copy(plan.id==='free'?'Your first good step.':plan.id==='plus'?'Build your everyday rhythm.':'Room to grow with your goals.',plan.id==='free'?'خطوتك الأولى.':plan.id==='plus'?'ابنِ عاداتك اليومية.':'مساحة أكبر لتحقيق أهدافك.')}</p><div className="pricing-amount" dir="ltr"><strong>$ {yearly?plan.yearly:plan.monthly}</strong><span>/{copy('month','شهر')}</span></div><p className="pricing-cadence">{yearly?copy('$'+plan.total+' billed yearly','$'+plan.total+' تُدفع سنوياً'):copy('Billed monthly','تُدفع شهرياً')}</p><ul><li><Check/>{plan.uploads} {copy('file uploads','مرفقات')}</li><li><Check/>{plan.messages} {copy('coach messages','رسائل للمدرب')}</li><li><Check/>{plan.plans} {copy('generated plans','خطط منشأة')}</li></ul><p className="pricing-limit-note">{copy('Credits per billing period.','الأرصدة لكل فترة فوترة.')}</p><Button variant={plan.id==='pro'?'default':'outline'} disabled={loading||Boolean(error)||Boolean(busy)||current||plan.id==='free'} onClick={()=>plan.id!=='free'&&void checkout(plan.id)}>{busy===plan.id?<Loader2 className="animate-spin"/>:current?copy('Your current plan','خطتك الحالية'):plan.id==='free'?copy('Manage in billing','تُدار من الفوترة'):copy('Choose '+plan.id,'اختر '+plan.id)}{!current&&<ArrowRight size={16}/>}</Button></article>;})}</section>
    <p className="billing-trust"><ShieldCheck size={18}/>{copy('Secure checkout through PayPal. Review the total before you approve.','دفع آمن عبر PayPal. راجع الإجمالي قبل الموافقة.')}</p>
    {loading?<p className="text-center"><Loader2 className="inline animate-spin"/>{copy('Loading membership…','جارٍ تحميل العضوية…')}</p>:subscription&&!error&&<section className="membership-summary"><header><div><span className="aura-eyebrow">{copy('YOUR MEMBERSHIP','عضويتك')}</span><h2>{subscription.plan.toUpperCase()} · {subscription.status}</h2><p>{subscription.billingCycle==='yearly'?copy('Billed yearly','فوترة سنوية'):copy('Billed monthly','فوترة شهرية')}</p></div>{subscription.plan!=='free'&&<Button variant="outline" onClick={()=>void portal()} disabled={Boolean(busy)}>{t('subscription.manageBilling')}</Button>}</header><div className="membership-usage">{[
      {name:copy('Uploads','المرفقات'),used:subscription.usage.uploadsUsed,limit:subscription.usage.uploadsLimit},
      {name:copy('Messages','الرسائل'),used:subscription.usage.chatMessagesUsed,limit:subscription.usage.chatMessagesLimit},
      {name:copy('Plans','الخطط'),used:subscription.usage.generatedPlansUsed,limit:subscription.usage.generatedPlansLimit},
    ].map(item=><div key={item.name}><span>{item.name}<strong>{item.used} / {item.limit??copy('Unlimited','غير محدود')}</strong></span><progress max={item.limit||1} value={item.limit==null?0:item.used} aria-label={item.name}/></div>)}</div>{subscription.plan!=='free'&&<p>{copy('To change billing cadence or manage an existing plan, open Manage billing.','لتغيير فترة الفوترة أو إدارة خطة حالية، افتح إدارة الفوترة.')}</p>}</section>}
  </main></div>;
}
