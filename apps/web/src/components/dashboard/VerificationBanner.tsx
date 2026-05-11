'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import Link from 'next/link';

/**
 * Banner que aparece cuando hay cambios en el prompt sin verificar.
 * Compara lastConfigChange vs lastVerified del golden set.
 */
export function VerificationBanner() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;
  const [show, setShow] = useState(false);
  const [hasGoldens, setHasGoldens] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    checkStatus();

    // Escuchar cuando cualquier página avisa que cambió el config
    const onConfigChanged = () => { setDismissed(false); checkStatus(); };
    window.addEventListener('config-changed', onConfigChanged);
    return () => window.removeEventListener('config-changed', onConfigChanged);
  }, [tenantId]);

  const checkStatus = () => {
    if (!tenantId) return;
    Promise.all([
      api('/agents/main', { tenantId }).catch(() => null),
      api('/golden/list', { tenantId }).catch(() => ({ goldens: [] })),
    ]).then(([agent, goldenData]) => {
      if (!agent) return;

      const lastChange = agent.lastConfigChange;
      if (!lastChange) return;

      const goldens = goldenData?.goldens || [];
      setHasGoldens(goldens.length > 0);

      if (goldens.length === 0) {
        // Hay cambios pero no hay goldens → avisar que guarde referencia
        setShow(true);
        return;
      }

      const lastVerified = goldens
        .filter((g: any) => g.lastValidated)
        .map((g: any) => g.lastValidated)
        .sort()
        .pop();

      if (!lastVerified || lastChange > lastVerified) {
        setShow(true);
      } else {
        setShow(false);
      }
    });
  };

  // Solo mostrar si NO hay goldens (para que guarde conversaciones tipo)
  // Si hay goldens, la verificación ya es automática al confirmar cambios
  if (!show || dismissed || hasGoldens) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm text-amber-800">
        <span className="text-amber-500 text-lg">&#9888;</span>
        <span>Guarda conversaciones tipo para que los cambios se verifiquen automaticamente.</span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/dashboard/golden"
          className="text-xs font-medium bg-amber-100 text-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-200 transition whitespace-nowrap"
        >
          Ver como
        </Link>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-400 hover:text-amber-600 text-lg leading-none"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
