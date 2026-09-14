import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
export function StorySection({ number, title, description, action, to, children, reverse = false }: { number: string; title: string; description: string; action: string; to: string; children: ReactNode; reverse?: boolean }) {
  const reduced = useReducedMotion();
  return <section className={`aura-story ${reverse ? 'is-reversed' : ''}`}>
    <motion.div className="aura-story-copy" initial={{ opacity: reduced ? 1 : 0, x: reduced ? 0 : reverse ? 18 : -18 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .2 }} transition={{ duration: .5 }}>
      <span className="aura-eyebrow">{number} / NEXTAURA FIT</span><h2>{title}</h2><p>{description}</p><Link to={to}>{action}<ArrowRight size={18} className="rtl:rotate-180" /></Link>
    </motion.div>
    <motion.div className="aura-story-visual" initial={{ opacity: reduced ? 1 : 0, x: reduced ? 0 : reverse ? -18 : 18 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true, amount: .15 }} transition={{ duration: .55 }}>{children}</motion.div>
  </section>;
}
