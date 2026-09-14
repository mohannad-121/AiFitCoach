export function BrandLogo({ mark = false, className = '' }: { mark?: boolean; className?: string }) {
  return <img src={`/logos/nextaura-fit-${mark ? 'mark' : 'full'}.png`} alt="NextAura FIT" className={`brand-logo ${mark ? 'brand-mark' : 'brand-wordmark'} ${className}`} />;
}
