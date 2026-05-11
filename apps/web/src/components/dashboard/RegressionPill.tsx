'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import { RegressionModal } from './RegressionModal';

/**
 * Pill flotante global que muestra el estado de regression runs.
 * Vive en el layout del dashboard → visible en todas las páginas.
 * Draggable: se puede mover a cualquier esquina.
 */
export function RegressionPill() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;
  const [runId, setRunId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Drag state
  const [pos, setPos] = useState({ x: -1, y: -1 }); // -1 = default (bottom-right)
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Escuchar evento custom para iniciar regression
  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.runId) setRunId(detail.runId);
    };
    window.addEventListener('regression-started', onStart);
    return () => window.removeEventListener('regression-started', onStart);
  }, []);

  // Chequear runs pendientes al montar
  useEffect(() => {
    if (!tenantId) return;
    api('/regression/pending', { tenantId })
      .then(data => {
        if (data.run?.runId && !data.run.decision) {
          setRunId(data.run.runId);
        }
      })
      .catch(() => {});
  }, [tenantId]);

  const handleDone = useCallback((decision: 'apply' | 'revert') => {
    setRunId(null);
    setExpanded(false);
    if (decision === 'apply') {
      window.dispatchEvent(new Event('config-changed'));
    }
  }, []);

  // Drag handlers
  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setPos({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const onMouseUp = () => { dragging.current = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  if (!runId) return null;

  if (expanded) {
    return <RegressionModal runId={runId} onDone={handleDone} />;
  }

  const style = pos.x >= 0
    ? { left: pos.x, top: pos.y, right: 'auto' as const, bottom: 'auto' as const }
    : { right: 20, bottom: 20 };

  return (
    <div
      className="fixed z-[90] cursor-grab active:cursor-grabbing select-none"
      style={style}
      onMouseDown={onMouseDown}
    >
      <PillContent runId={runId} tenantId={tenantId!} onExpand={() => setExpanded(true)} />
    </div>
  );
}

/** Contenido del pill — pollea status */
function PillContent({ runId, tenantId, onExpand }: { runId: string; tenantId: string; onExpand: () => void }) {
  const [status, setStatus] = useState<string>('queued');
  const [progress, setProgress] = useState({ current: 0, total: 1 });
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      while (!cancelled) {
        try {
          const data = await api(`/regression/status/${runId}`, { tenantId });
          setStatus(data.status);
          if (data.progress) setProgress(data.progress);
          if (data.status === 'completed') { setSummary(data.summary); break; }
          if (data.status === 'failed') break;
        } catch {}
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    poll();
    return () => { cancelled = true; };
  }, [runId, tenantId]);

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const hasFailures = summary?.failed > 0;
  const hasWarnings = summary?.warnings > 0;
  const allPass = summary && summary.failed === 0 && summary.warnings === 0;

  return (
    <button
      onClick={(e) => { e.stopPropagation(); onExpand(); }}
      className={`flex items-center gap-3 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium transition-all hover:scale-105 ${
        status === 'running' || status === 'queued'
          ? 'bg-white border-2 border-gray-200 text-gray-700'
          : status === 'failed' || hasFailures
          ? 'bg-red-600 text-white'
          : hasWarnings
          ? 'bg-amber-500 text-white'
          : 'bg-emerald-600 text-white'
      }`}
    >
      {(status === 'running' || status === 'queued') && (
        <>
          <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <span>Verificando {progress.current}/{progress.total}</span>
          <span className="text-xs opacity-60">{pct}%</span>
        </>
      )}
      {status === 'completed' && allPass && (
        <><span className="text-lg">&#10003;</span> Todo OK — click para aplicar</>
      )}
      {status === 'completed' && hasWarnings && !hasFailures && (
        <><span className="text-lg">&#9888;</span> {summary.warnings} warning{summary.warnings > 1 ? 's' : ''} — revisar</>
      )}
      {status === 'completed' && hasFailures && (
        <><span className="text-lg">&#10007;</span> {summary.failed} problema{summary.failed > 1 ? 's' : ''} — revisar</>
      )}
      {status === 'failed' && (
        <><span className="text-lg">&#10007;</span> Error — click para ver</>
      )}
    </button>
  );
}
