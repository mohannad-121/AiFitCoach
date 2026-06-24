import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { subscriptionRequest } from '@/lib/subscription';

export function UpgradeModal({ open, onOpenChange, reason }: { open: boolean; onOpenChange: (v: boolean) => void; reason: string }) {
  const upgrade = async (plan: 'plus' | 'pro') => {
    const { url } = await subscriptionRequest('/api/billing/create-checkout-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) });
    window.location.assign(url);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="border-fuchsia-400/20 bg-slate-950/95 text-white shadow-[0_0_80px_rgba(168,85,247,.25)]">
    <DialogHeader><DialogTitle>{reason.toLowerCase().includes('generated') ? 'You reached your generated plan limit' : 'You reached your plan limit'}</DialogTitle><DialogDescription className="text-slate-300">{reason}</DialogDescription></DialogHeader>
    <div className="grid gap-3 sm:grid-cols-2"><Button onClick={() => void upgrade('plus')} className="h-auto flex-col bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3"><span>Upgrade to Plus</span><span className="text-xs opacity-80">$10/month</span></Button><Button onClick={() => void upgrade('pro')} className="h-auto flex-col bg-gradient-to-r from-fuchsia-600 to-cyan-500 py-3"><span>Upgrade to Pro</span><span className="text-xs opacity-80">$15/month</span></Button></div>
    <Button variant="ghost" onClick={() => onOpenChange(false)}>Maybe later</Button>
  </DialogContent></Dialog>;
}
