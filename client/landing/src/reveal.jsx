import { useEffect, useRef, useState } from 'react';

/**
 * Reveal-on-scroll.
 *
 * Adds `is-visible` the first time an element enters the viewport. Doing this
 * with IntersectionObserver rather than a scroll listener keeps it cheap, and
 * the `once` behaviour means content never flickers back out.
 */
export function useReveal({ threshold = 0.15, rootMargin = '0px 0px -60px 0px' } = {}) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    // Respect the user's motion preference: show everything immediately.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return undefined;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.unobserve(entry.target);
          }
        }
      },
      { threshold, rootMargin },
    );

    io.observe(el);
    return () => io.disconnect();
  }, [threshold, rootMargin]);

  return { ref, visible };
}

/** Wrapper that fades + slides its children in when scrolled into view. */
export function Reveal({ children, delay = 0, as: Tag = 'div', className = '', ...rest }) {
  const { ref, visible } = useReveal();
  return (
    <Tag
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
