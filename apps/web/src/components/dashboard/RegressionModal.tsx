'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';

interface Progress { current: number; total: number }
interface CurrentGolden { goldenId: string; preview: string; tags: string[] }
interface TurnResult { turnNumber: number; userMessage: string; originalResponse: string; newResponse: string; judgement: Record<string, string> }
interface RunResult { goldenId: string; preview: string; tags: string[]; overallVerdict: string; turnResults: TurnResult[] }
interface Summary { total: number; passed: number; warnings: number; failed: number; errors: number }

interface Props {
  runId: string;
  onDone: (decision: 'apply' | 'revert') => void;
}

type Phase = 'testing' | 'results' | 'error';

export function RegressionModal({ runId, onDone }: Props) {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [phase, setPhase] = useState<Phase>('testing');
  const [progress, setProgress] = useState<Progress>({ current: 0, total: 1 });
  const [currentGolden, setCurrentGolden] = useState<CurrentGolden | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [deciding, setDeciding] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [compareTurn, setCompareTurn] = useState<TurnResult | null>(null);
  const retries = useRef(0);

  // Polling cada 2s
  useEffect(() => {
    if (!tenantId || !runId) return;
    let cancelled = false;

    async function poll() {
      while (!cancelled) {
        try {
          const data = await api(`/regression/status/${runId}`, { tenantId: tenantId! });
          retries.current = 0;
          if (data.progress) setProgress(data.progress);
          if (data.currentGolden) setCurrentGolden(data.currentGolden);
          if (data.status === 'completed') {
            setSummary(data.summary);
            setResults(data.results || []);
            setPhase('results');
            break;
          }
          if (data.status === 'failed') {
            setErrorMsg(data.error || 'Error desconocido');
            setPhase('error');
            break;
          }
        } catch {
          retries.current++;
          if (retries.current >= 5) { setErrorMsg('Error de conexion'); setPhase('error'); break; }
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    poll();
    return () => { cancelled = true; };
  }, [runId, tenantId]);

  const handleDecision = async (decision: 'apply' | 'revert') => {
    if (!tenantId) return;
    setDeciding(true);
    try {
      await api(`/regression/decision/${runId}`, { method: 'POST', tenantId, body: { decision } });
      onDone(decision);
    } catch (err) { console.error(err); }
    setDeciding(false);
  };

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const hasFailures = (summary?.failed || 0) > 0;
  const hasWarnings = (summary?.warnings || 0) > 0;
  const allPass = summary && summary.failed === 0 && summary.warnings === 0;

  // ─── PILL (minimizado) ─────────────────────────────────
  if (!expanded) {
    return (
      <div className="fixed bottom-5 right-5 z-[90]">
        <button
          onClick={() => setExpanded(true)}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium transition-all hover:scale-105 ${
            phase === 'testing'
              ? 'bg-white border border-gray-200 text-gray-700'
              : phase === 'error' || hasFailures
              ? 'bg-red-600 text-white'
              : hasWarnings
              ? 'bg-amber-500 text-white'
              : 'bg-emerald-600 text-white'
          }`}
        >
          {phase === 'testing' && (
            <>
              <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              Verificando {progress.current}/{progress.total}
            </>
          )}
          {phase === 'results' && allPass && (
            <>&#10003; Todo OK — click para aplicar</>
          )}
          {phase === 'results' && hasWarnings && !hasFailures && (
            <>&#9888; {summary!.warnings} warning{summary!.warnings > 1 ? 's' : ''} — revisar</>
          )}
          {phase === 'results' && hasFailures && (
            <>&#10007; {summary!.failed} problema{summary!.failed > 1 ? 's' : ''} — revisar</>
          )}
          {phase === 'error' && (
            <>&#10007; Error — click para ver</>
          )}
        </button>
      </div>
    );
  }

  // ─── EXPANDIDO ─────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => phase === 'testing' && setExpanded(false)}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Header con botón minimizar */}
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {phase === 'testing' ? 'Verificando cambios' : phase === 'results' ? 'Resultado' : 'Error'}
          </h2>
          {phase === 'testing' && (
            <button onClick={() => setExpanded(false)} className="text-gray-400 hover:text-gray-600 text-xs">
              Minimizar
            </button>
          )}
        </div>

        {/* ─── TESTING ──────────────────────────────── */}
        {phase === 'testing' && (
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-500">
              Probando que tus cambios no rompan conversaciones anteriores.
            </p>
            <div>
              <div className="flex justify-between text-sm text-gray-600 mb-1.5">
                <span>{progress.current} de {progress.total}</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2.5">
                <div className="bg-primary-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
            {currentGolden && (
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <span className="text-gray-400">Probando: </span>
                <span className="text-gray-700 italic">&quot;{currentGolden.preview}&quot;</span>
              </div>
            )}
          </div>
        )}

        {/* ─── RESULTS ──────────────────────────────── */}
        {phase === 'results' && summary && (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-emerald-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-emerald-700">{summary.passed}</p>
                <p className="text-xs text-emerald-600">Pass</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{summary.warnings}</p>
                <p className="text-xs text-amber-600">Warnings</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-700">{summary.failed}</p>
                <p className="text-xs text-red-600">Failed</p>
              </div>
            </div>

            {(summary.warnings > 0 || summary.failed > 0) && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {results.filter(r => r.overallVerdict !== 'pass').map(r => (
                  <div
                    key={r.goldenId}
                    className={`border rounded-lg p-3 cursor-pointer transition ${r.overallVerdict === 'failed' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}
                    onClick={() => setExpandedResult(expandedResult === r.goldenId ? null : r.goldenId)}
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <span>{r.overallVerdict === 'failed' ? '✗' : '⚠'}</span>
                      <span className="text-gray-700">&quot;{r.preview}&quot;</span>
                    </div>
                    {expandedResult === r.goldenId && (
                      <div className="mt-2 space-y-1.5">
                        {r.turnResults.filter(t => t.judgement.severidad_regresion !== 'ninguna').map(t => (
                          <div key={t.turnNumber} className="text-xs bg-white/70 rounded p-2 cursor-pointer hover:bg-white" onClick={e => { e.stopPropagation(); setCompareTurn(t); }}>
                            <span className="font-medium">T{t.turnNumber}:</span> {t.judgement.razon || t.judgement.mejor_o_peor_general}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className={`text-sm ${allPass ? 'text-emerald-700' : hasFailures ? 'text-red-700' : 'text-amber-700'}`}>
              {allPass ? 'Tus cambios no rompieron ninguna conversacion.' : hasFailures ? 'Tu cambio rompio algunas conversaciones.' : 'Diferencias leves. Revisa si son esperadas.'}
            </p>

            <div className="flex gap-3 pt-1">
              <button onClick={() => handleDecision('revert')} disabled={deciding} className="flex-1 text-sm font-medium py-2.5 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                Revertir
              </button>
              <button onClick={() => handleDecision('apply')} disabled={deciding} className={`flex-1 text-sm font-medium py-2.5 px-4 rounded-lg disabled:opacity-50 ${hasFailures ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-primary-600 text-white hover:bg-primary-700'}`}>
                {hasFailures ? 'Aplicar igual' : 'Aplicar'}
              </button>
            </div>
          </div>
        )}

        {/* ─── ERROR ─────────────────────────────────── */}
        {phase === 'error' && (
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-600">{errorMsg}</p>
            <div className="flex gap-3">
              <button onClick={() => handleDecision('revert')} disabled={deciding} className="flex-1 text-sm py-2.5 px-4 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Revertir</button>
              <button onClick={() => handleDecision('apply')} disabled={deciding} className="flex-1 text-sm py-2.5 px-4 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50">Aplicar igual</button>
            </div>
          </div>
        )}
      </div>

      {/* ─── COMPARE MODAL ──────────────────────────── */}
      {compareTurn && (
        <div className="fixed inset-0 bg-black/40 z-[110] flex items-center justify-center p-4" onClick={() => setCompareTurn(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">Comparar — Turno {compareTurn.turnNumber}</h3>
              <button onClick={() => setCompareTurn(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <p className="text-sm text-gray-500 mb-4 bg-gray-50 p-3 rounded-lg"><span className="font-medium">Cliente:</span> {compareTurn.userMessage}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Original</p>
                <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap">{compareTurn.originalResponse}</div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Nueva</p>
                <div className={`rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap ${compareTurn.judgement.severidad_regresion === 'grave' ? 'bg-red-50' : compareTurn.judgement.severidad_regresion === 'leve' ? 'bg-amber-50' : 'bg-emerald-50'}`}>{compareTurn.newResponse}</div>
              </div>
            </div>
            {compareTurn.judgement.razon && <p className="mt-3 text-xs text-gray-500 bg-gray-50 rounded p-2">Razon: {compareTurn.judgement.razon}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
