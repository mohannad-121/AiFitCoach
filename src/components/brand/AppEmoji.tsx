import { Activity, CalendarDays, Dumbbell, Flame, Heart, Leaf, MapPin, Ruler, Sparkles, UserRound } from 'lucide-react';
// Original cross-platform SVG illustrations. Replace the asset map with a licensed
// emoji pack later without changing consumers. No proprietary Apple artwork.
const icons = { muscle: Dumbbell, fire: Flame, calendar: CalendarDays, heart: Heart, leaf: Leaf, location: MapPin, ruler: Ruler, sparkle: Sparkles, person: UserRound, activity: Activity };
export type EmojiName = keyof typeof icons;
export function AppEmoji({ name, label, className = '' }: { name: EmojiName; label?: string; className?: string }) {
  const Icon = icons[name];
  return <span className={`app-emoji app-emoji-${name} ${className}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}><Icon strokeWidth={1.8} /></span>;
}
