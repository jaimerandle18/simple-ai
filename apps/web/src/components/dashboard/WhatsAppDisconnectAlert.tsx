'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

const POLL_INTERVAL = 30_000;

export function WhatsAppDisconnectAlert() {
  const { data: session } = useSession();
  const [disconnected, setDisconnected] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tenantId = (session?.user as any)?.tenantId;

  useEffect(() => {
    if (!tenantId) return;
    check();
    pollRef.current = setInterval(check, POLL_INTERVAL);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [tenantId]);

  async function check() {
    try {
      const res = await fetch('/api/proxy/channels/waha/status', {
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
      });
      const data = await res.json();
      const s = data.status;
      if (s === 'STOPPED' || s === 'FAILED') {
        setDisconnected(true);
        setDismissed(false);
      } else {
        setDisconnected(false);
      }
    } catch {}
  }

  if (!disconnected || dismissed) return null;

  return (
    <div className="bg-red-600 text-white px-4 py-2.5 flex items-center justify-between gap-4 text-sm">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <span>WhatsApp desconectado. Los mensajes no se están procesando.</span>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Link
          href="/dashboard/settings"
          className="font-semibold underline hover:no-underline"
        >
          Reconectar
        </Link>
        <button onClick={() => setDismissed(true)} aria-label="Cerrar">
          <svg className="w-4 h-4 opacity-75 hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
