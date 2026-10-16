import type { Variants } from 'framer-motion'

export const easeOut = [0.22, 1, 0.36, 1] as const

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: easeOut },
  },
}

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.4, ease: easeOut },
  },
}

export const fadeLeft: Variants = {
  hidden: { opacity: 0, x: -20 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.45, ease: easeOut },
  },
}

export const fadeRight: Variants = {
  hidden: { opacity: 0, x: 20 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.45, ease: easeOut },
  },
}

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: easeOut },
  },
}

export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.04,
    },
  },
}

export const staggerFast: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.02,
    },
  },
}

/** Route shell — avoid opacity 0 on exit (AnimatePresence mode="wait" caused blank screens). */
export const pageTransition: Variants = {
  initial: { opacity: 1 },
  animate: {
    opacity: 1,
    transition: { duration: 0.2, ease: easeOut },
  },
  exit: {
    opacity: 1,
    transition: { duration: 0.12, ease: easeOut },
  },
}

export const stepPanel: Variants = {
  initial: { opacity: 0, x: 28 },
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.32, ease: easeOut },
  },
  exit: {
    opacity: 0,
    x: -18,
    transition: { duration: 0.22, ease: easeOut },
  },
}

export const tapScale = { scale: 0.97 }
export const hoverLift = { y: -3, transition: { duration: 0.18 } }
export const hoverScale = { scale: 1.03, transition: { duration: 0.18 } }
