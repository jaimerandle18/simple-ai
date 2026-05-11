'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import { RegressionModal } from './RegressionModal';

export function RegressionPill() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;
  const [runId, setRunId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.runId) setRunId(detail.runId);
    };
    window.addEventListener('regression-started', onStart);
    return () => window.removeEventListener('regression-started', onStart);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    api('/regression/pending', { tenantId })
      .then(data => {
        if (data.run?.runId && !data.run.decision) setRunId(data.run.runId);
      })
      .catch(() => {});
  }, [tenantId]);

  const handleDone = useCallback((decision: 'apply' | 'revert') => {
    setRunId(null);
    setExpanded(false);
    if (decision === 'apply') window.dispatchEvent(new Event('config-changed'));
  }, []);

  if (!runId) return null;

  if (expanded) {
    return <RegressionModal runId={runId} onDone={handleDone} />;
  }

  return (
    <div className="fixed bottom-5 right-5 z-[90]">
      <PillContent runId={runId} tenantId={tenantId!} onExpand={() => setExpanded(true)} />
    </div>
  );
}

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
      onClick={onExpand}
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
