import { useEffect, useState, useRef } from 'react'

/**
 * Custom hook to detect if user has requested reduced motion.
 */
export function useReducedMotion(): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return matches
}

/**
 * Returns a style object with a staggered animation delay (20ms step).
 * Guarded to ensure delay calculation is fixed on mount.
 */
export function useStaggerDelay(index: number, stepMs = 20): { animationDelay: string } {
  const initialIndex = useRef(index)
  const isReducedMotion = useReducedMotion()

  if (isReducedMotion) {
    return { animationDelay: '0ms' }
  }

  return { animationDelay: `${initialIndex.current * stepMs}ms` }
}

export interface CountUpProps {
  end: number
  start?: number
  durationMs?: number
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
}

/**
 * CountUp component that eases numeric values up to <= 900ms.
 * Instantly displays final value if `prefers-reduced-motion: reduce` is active.
 */
export function CountUp({
  end,
  start = 0,
  durationMs = 800,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
}: CountUpProps) {
  const isReducedMotion = useReducedMotion()
  const [value, setValue] = useState<number>(isReducedMotion ? end : start)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    if (isReducedMotion) {
      setValue(end)
      return
    }

    const startTime = performance.now()
    const startVal = start
    const endVal = end

    function animate(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / durationMs, 1)

      // Cubic ease-out: 1 - Math.pow(1 - progress, 3)
      const easeOut = 1 - Math.pow(1 - progress, 3)
      const current = startVal + (endVal - startVal) * easeOut

      setValue(current)

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate)
      } else {
        setValue(endVal)
      }
    }

    frameRef.current = requestAnimationFrame(animate)

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
      }
    }
  }, [end, start, durationMs, isReducedMotion])

  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}{formatted}{suffix}
    </span>
  )
}
