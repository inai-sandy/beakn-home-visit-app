'use client';

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type HTMLMotionProps,
} from 'framer-motion';
import type { ReactNode } from 'react';

// =============================================================================
// HVA-267: shared Framer Motion primitives
// =============================================================================
//
// Sandeep approved framer-motion on 2026-06-11 (trade-off presented).
// House rules, enforced by USING THESE PRIMITIVES instead of raw
// motion.* configs scattered across pages:
//
//   1. Client components only — never import this from a Server
//      Component (the page stays server-rendered; only interactive
//      islands animate).
//   2. prefers-reduced-motion is always respected: every primitive
//      collapses to a zero-motion variant for users (and cheap phones)
//      that ask for it.
//   3. List rows use enter/exit + layout so add/remove/reorder feels
//      physical. Simple fades/hovers stay CSS (Tailwind transition-*).
//
// Spring tuned for "snappy but calm" — high stiffness, medium damping.
// =============================================================================

const SPRING = { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 } as const;

/** Wrap a keyed list so its items can animate in/out. Place OUTSIDE the
 *  map; pair with <AnimatedItem key={...}> inside. */
export function AnimatedList({ children }: { children: ReactNode }) {
  return <AnimatePresence initial={false}>{children}</AnimatePresence>;
}

/** A list row that rises in on mount and collapses out on unmount.
 *  Forward `layout` so surviving siblings glide into place. */
export function AnimatedItem({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & HTMLMotionProps<'div'>) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, height: 0, marginBottom: 0, overflow: 'hidden' }}
      transition={SPRING}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Section/block entrance — a soft rise+fade for content that mounts
 *  with the page or after a tab switch. */
export function FadeRise({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export { motion, AnimatePresence, useReducedMotion, SPRING };
