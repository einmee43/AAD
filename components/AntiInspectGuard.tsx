'use client';

import { useEffect } from 'react';

export default function AntiInspectGuard() {
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toUpperCase();
      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      // F12
      if (e.key === 'F12') {
        e.preventDefault();
        return;
      }
      // Ctrl+Shift+I / J / C / K (DevTools / Console / Inspect / Firefox)
      if (ctrlOrMeta && e.shiftKey && ['I', 'J', 'C', 'K'].includes(key)) {
        e.preventDefault();
        return;
      }
      // macOS Cmd+Option+I / J / C / U
      if (e.metaKey && e.altKey && ['I', 'J', 'C', 'U'].includes(key)) {
        e.preventDefault();
        return;
      }
      // Ctrl+U (View Source) & Ctrl+S (Save Page)
      if (ctrlOrMeta && ['U', 'S'].includes(key)) {
        e.preventDefault();
      }
    };

    const onDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === 'IMG') {
        e.preventDefault();
      }
    };

    document.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('dragstart', onDragStart);

    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('dragstart', onDragStart);
    };
  }, []);

  return null;
}
