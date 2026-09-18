'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { alvoEditavel } from '@/lib/atalhos';

export function AtalhosGlobais() {
  const router = useRouter();
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || alvoEditavel(e.target)) return;
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"],dialog[open]')) {
        e.preventDefault();
        router.push('/app');
      }
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [router]);
  return null;
}
