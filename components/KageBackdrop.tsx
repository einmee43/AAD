'use client';

import { useEffect, useRef } from 'react';

export default function KageBackdrop({ theme = 'kage' }: { theme?: 'kage' | 'mono' }) {
  const glowRef = useRef<HTMLDivElement | null>(null);
  const isMono = theme === 'mono';

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (glowRef.current) {
        glowRef.current.style.transform = `translate3d(${e.clientX - 240}px, ${e.clientY - 240}px, 0)`;
      }
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-0 overflow-hidden transition-colors duration-300 ${
        isMono ? 'bg-[#050506]' : 'bg-[#070506]'
      }`}
    >
      <iframe
        src="/bg/phase-space/index.html"
        title="Phase Space Background"
        className={`absolute inset-0 w-full h-full border-0 pointer-events-none blur-xl scale-110 transition-[filter] duration-300 ${
          isMono ? 'grayscale contrast-125 brightness-90' : ''
        }`}
        tabIndex={-1}
      />
      <div
        ref={glowRef}
        className="absolute top-0 left-0 w-[480px] h-[480px] rounded-full pointer-events-none transition-transform duration-150 ease-out"
        style={{
          background: isMono
            ? 'radial-gradient(circle, rgba(255,255,255,0.09) 0%, rgba(161,161,170,0.04) 40%, transparent 70%)'
            : 'radial-gradient(circle, rgba(255,74,99,0.14) 0%, rgba(255,154,31,0.05) 40%, transparent 70%)',
        }}
      />
      <div className={`absolute inset-0 ${isMono ? 'bg-[#050506]/65' : 'bg-[#070506]/55'}`} />
    </div>
  );
}
