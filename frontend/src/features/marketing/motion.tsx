import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode, type RefObject } from 'react';
import clsx from 'clsx';

/* Small, dependency-free motion toolkit for the public website.
 * Everything respects `prefers-reduced-motion`: content is shown immediately and nothing moves. */

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** True once the element has scrolled into view (stays true). */
export function useInView<T extends Element>(ref: RefObject<T | null>, rootMargin = '0px 0px -12% 0px') {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') return setSeen(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin, threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, seen]);
  return seen;
}

type RevealVariant = 'up' | 'left' | 'right' | 'zoom' | 'tilt' | 'blur';

/** Animates its children in when they scroll into view. */
export function Reveal({
  children, as: Tag = 'div', variant = 'up', delay = 0, className, style,
}: { children: ReactNode; as?: ElementType; variant?: RevealVariant; delay?: number; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLElement>(null);
  const visible = useInView(ref);
  return (
    <Tag ref={ref} data-reveal={variant} className={clsx('reveal', visible && 'is-visible', className)} style={{ ...style, '--reveal-delay': `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}

/**
 * 0 → 1 progress of a tall section scrolling past a sticky viewport: 0 when its top reaches the
 * top of the screen, 1 when its bottom reaches the bottom.
 */
export function useSectionProgress<T extends HTMLElement>(ref: RefObject<T | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const travel = r.height - window.innerHeight;
        setP(travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : r.top < 0 ? 1 : 0);
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
    };
  }, [ref]);
  return p;
}

/** Moves its children slower/faster than the page for depth. */
export function Parallax({ children, speed = 0.15, className }: { children: ReactNode; speed?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const offset = (r.top + r.height / 2 - window.innerHeight / 2) * -speed;
        el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
      });
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', on);
    };
  }, [speed, reduced]);
  return <div ref={ref} className={clsx('will-change-transform', className)}>{children}</div>;
}

/** Card that tilts in 3D towards the pointer, with a moving light glare. */
export function TiltCard({ children, className, max = 8 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const move = (e: React.PointerEvent) => {
    if (reduced || e.pointerType === 'touch') return;
    const el = ref.current!;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${((0.5 - y) * max).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((x - 0.5) * max).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  };
  const leave = () => {
    const el = ref.current!;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  };
  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={clsx('tilt-card', className)}>
      {children}
    </div>
  );
}

/** Counts up to `value` the first time it is visible. */
export function CountUp({ value, duration = 1400, decimals = 0, prefix = '', suffix = '' }: { value: number; duration?: number; decimals?: number; prefix?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const visible = useInView(ref);
  const reduced = usePrefersReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!visible) return;
    if (reduced) return setN(value);
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      setN(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, value, duration, reduced]);
  return (
    <span ref={ref} className="tabular-nums">
      {prefix}{n.toLocaleString('en', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
    </span>
  );
}
