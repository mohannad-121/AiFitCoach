import { useEffect, useState } from 'react';
import { BrandLogo } from '@/components/brand/BrandLogo';
import { useLanguage } from '@/contexts/LanguageContext';
export function LoadingScreen() {
  const { language } = useLanguage();
  const [slow, setSlow] = useState(false);
  useEffect(() => { const timer = window.setTimeout(() => setSlow(true), 3500); return () => window.clearTimeout(timer); }, []);
  return <div className="aura-loading" role="status" aria-live="polite">
    <div className={slow ? 'aura-loading-symbol' : 'aura-loading-symbol is-loading'}><BrandLogo mark /></div>
    <h1>NextAura <span>FIT</span></h1><p>AI-Powered Healthy Lifestyle</p>
    {slow ? <div><p>{language === 'ar' ? 'يستغرق الاتصال وقتاً أطول من المعتاد.' : 'Connecting is taking longer than usual.'}</p><button onClick={() => window.location.reload()}>{language === 'ar' ? 'إعادة المحاولة' : 'Try again'}</button></div> : <div className="aura-loading-progress" />}
  </div>;
}
