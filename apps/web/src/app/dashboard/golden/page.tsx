'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';

interface Golden {
  goldenId: string;
  conversationId: string;
  savedAt: string;
  turnCount: number;
  tags: string[];
  status: string;
  lastValidated: string;
  lastVerdict: string;
  preview: string;
  notes: string;
}

interface TurnResult {
  turnNumber: number;
  userMessage: string;
  originalResponse: string;
  newResponse: string;
  judgement: {
    mejor_o_peor_general: string;
    severidad_regresion: string;
    razon: string;
    [key: string]: string;
  };
}

interface RunResult {
  goldenId: string;
  preview: string;
  tags: string[];
  overallVerdict: string;
  worstSeverity: string;
  turnResults: TurnResult[];
}

interface RegressionSummary {
  total: number;
  passed: number;
  warnings: number;
  failed: number;
}

export default function GoldenPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [goldens, setGoldens] = useState<Golden[]>([]);
  const [loading, setLoading] = useState(true);
  const [runLoading, setRunLoading] = useState(false);
  const [runStatus, setRunStatus] = useState('');
  const [runResults, setRunResults] = useState<{ summary: RegressionSummary; results: RunResult[] } | null>(null);
  const [selectedResult, setSelectedResult] = useState<RunResult | null>(null);
  const [compareTurn, setCompareTurn] = useState<TurnResult | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    loadGoldens();
  }, [tenantId]);

  const loadGoldens = async () => {
    try {
      const data = await api('/golden/list', { tenantId: tenantId! });
      setGoldens(data.goldens || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const handleArchive = async (goldenId: string) => {
    try {
      await api(`/golden/${goldenId}`, { method: 'DELETE', tenantId: tenantId! });
      setGoldens(prev => prev.filter(g => g.goldenId !== goldenId));
    } catch (err) {
      console.error(err);
    }
  };

  const handleValidate = async (goldenId: string) => {
    try {
      const res = await api(`/golden/${goldenId}/validate`, { method: 'POST', tenantId: tenantId!, body: {} });
      // Reload to get updated verdict
      await loadGoldens();
      // Show inline result
      setSelectedResult(res);
    } catch (err) {
      console.error(err);
    }
  };

  const handleVerify = async () => {
    setRunLoading(true);
    setRunResults(null);
    const count = goldens.length;
    const toRun = Math.min(count, 15);
    setRunStatus(`Verificando ${toRun} conversacion${toRun === 1 ? '' : 'es'}${count > 15 ? ` (de ${count} totales)` : ''}...`);
    try {
      const res = await api('/golden/run-regression', {
        method: 'POST',
        tenantId: tenantId!,
        body: { triggerType: 'verify' },
      });
      setRunStatus('');
      setRunResults({ summary: res.summary, results: res.results });
    } catch (err: any) {
      setRunStatus('Error: ' + (err.message || 'intenta de nuevo'));
    }
    setRunLoading(false);
  };

  const verdictIcon = (v: string) => {
    if (v === 'pass') return <span className="text-emerald-500">&#10003;</span>;
    if (v === 'warning') return <span className="text-amber-500">&#9888;</span>;
    if (v === 'failed') return <span className="text-red-500">&#10007;</span>;
    return <span className="text-gray-400">-</span>;
  };

  const verdictBg = (v: string) => {
    if (v === 'pass') return 'border-emerald-200 bg-emerald-50';
    if (v === 'warning') return 'border-amber-200 bg-amber-50';
    if (v === 'failed') return 'border-red-200 bg-red-50';
    return 'border-gray-200';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Conversaciones de referencia</h1>
          <p className="text-gray-500 text-sm mt-1">
            {goldens.length} conversaciones guardadas para verificar cambios
          </p>
        </div>
        <button
          onClick={handleVerify}
          disabled={runLoading || goldens.length === 0}
          className="text-sm px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
        >
          {runLoading ? 'Verificando...' : 'Verificar'}
        </button>
      </div>

      {/* Run status */}
      {runLoading && runStatus && (
        <div className="mb-6 bg-primary-50 border border-primary-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-primary-700">{runStatus}</p>
              <p className="text-xs text-primary-500 mt-0.5">Cada conversacion se replaya turno por turno y un juez evalua las respuestas</p>
            </div>
          </div>
        </div>
      )}

      {/* Error status */}
      {!runLoading && runStatus && !runResults && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-700">{runStatus}</p>
        </div>
      )}

      {/* Run results */}
      {runResults && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Resultado de la verificacion</h2>
            <button onClick={() => setRunResults(null)} className="text-xs text-gray-400 hover:text-gray-600">Cerrar</button>
          </div>
          <div className="flex gap-6 mb-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-emerald-600">{runResults.summary.passed}</p>
              <p className="text-xs text-gray-500">Pass</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-amber-600">{runResults.summary.warnings}</p>
              <p className="text-xs text-gray-500">Warning</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600">{runResults.summary.failed}</p>
              <p className="text-xs text-gray-500">Failed</p>
            </div>
          </div>
          <div className="space-y-2">
            {runResults.results.map((r) => (
              <div
                key={r.goldenId}
                className={`border rounded-lg p-3 cursor-pointer hover:shadow-sm transition ${verdictBg(r.overallVerdict)}`}
                onClick={() => setSelectedResult(r)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {verdictIcon(r.overallVerdict)}
                    <span className="text-sm text-gray-700">{r.preview || r.goldenId}</span>
                  </div>
                  <div className="flex gap-1">
                    {(r.tags || []).map(t => (
                      <span key={t} className="text-[10px] bg-white/70 text-gray-500 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                </div>
                {r.worstSeverity !== 'ninguna' && (
                  <p className="text-xs text-gray-500 mt-1">
                    Severidad: {r.worstSeverity} - {r.turnResults.find(t => t.judgement.severidad_regresion !== 'ninguna')?.judgement.razon}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detail of selected result */}
      {selectedResult && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Detalle: {selectedResult.preview}</h2>
            <button onClick={() => { setSelectedResult(null); setCompareTurn(null); }} className="text-xs text-gray-400 hover:text-gray-600">Cerrar</button>
          </div>
          <div className="space-y-2">
            {selectedResult.turnResults.map((t) => (
              <div
                key={t.turnNumber}
                className={`border rounded-lg p-3 cursor-pointer hover:shadow-sm ${
                  t.judgement.severidad_regresion === 'grave' ? 'border-red-200 bg-red-50'
                    : t.judgement.severidad_regresion === 'leve' ? 'border-amber-200 bg-amber-50'
                    : 'border-gray-100'
                }`}
                onClick={() => setCompareTurn(t)}
              >
                <p className="text-xs text-gray-500">T{t.turnNumber}: &quot;{t.userMessage.slice(0, 60)}&quot;</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className={`text-xs font-medium ${
                    t.judgement.mejor_o_peor_general === 'mejor' ? 'text-emerald-600'
                      : t.judgement.mejor_o_peor_general === 'peor' ? 'text-red-600'
                      : 'text-gray-500'
                  }`}>{t.judgement.mejor_o_peor_general}</span>
                  {t.judgement.razon && <span className="text-xs text-gray-400">{t.judgement.razon}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Side-by-side comparison modal */}
      {compareTurn && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setCompareTurn(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">Comparar respuestas - Turno {compareTurn.turnNumber}</h3>
              <button onClick={() => setCompareTurn(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <p className="text-sm text-gray-500 mb-4 bg-gray-50 p-3 rounded-lg">
              <span className="font-medium">Cliente:</span> {compareTurn.userMessage}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Original</p>
                <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap">
                  {compareTurn.originalResponse}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Nueva</p>
                <div className={`rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap ${
                  compareTurn.judgement.severidad_regresion === 'grave' ? 'bg-red-50'
                    : compareTurn.judgement.severidad_regresion === 'leve' ? 'bg-amber-50'
                    : 'bg-emerald-50'
                }`}>
                  {compareTurn.newResponse}
                </div>
              </div>
            </div>
            <div className="mt-4 bg-gray-50 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Evaluacion automatica</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {Object.entries(compareTurn.judgement).filter(([k]) => k !== 'razon').map(([k, v]) => (
                  <div key={k} className="bg-white rounded p-2">
                    <p className="text-gray-400">{k.replace(/_/g, ' ')}</p>
                    <p className={`font-medium ${
                      v === 'peor' || v === 'no' || v === 'grave' ? 'text-red-600'
                        : v === 'mejor' || v === 'si' ? 'text-emerald-600'
                        : 'text-gray-700'
                    }`}>{v}</p>
                  </div>
                ))}
              </div>
              {compareTurn.judgement.razon && (
                <p className="mt-2 text-xs text-gray-500">Razon: {compareTurn.judgement.razon}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Golden list */}
      {goldens.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-gray-500">No hay conversaciones de referencia.</p>
          <p className="text-gray-400 text-sm mt-1">Anda a una conversacion y usa &quot;Guardar como referencia&quot;.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {goldens.map(g => (
            <div key={g.goldenId} className={`bg-white border rounded-xl p-4 shadow-sm ${verdictBg(g.lastVerdict)}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {verdictIcon(g.lastVerdict)}
                    <span className="text-sm font-medium text-gray-900">{g.preview || g.goldenId}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {g.tags.map(t => (
                      <span key={t} className="text-[10px] bg-primary-50 text-primary-600 px-1.5 py-0.5 rounded-full">{t}</span>
                    ))}
                  </div>
                  <div className="flex gap-4 mt-2 text-xs text-gray-400">
                    <span>{g.turnCount} turnos</span>
                    <span>Guardada: {new Date(g.savedAt).toLocaleDateString()}</span>
                    {g.lastValidated && <span>Validada: {new Date(g.lastValidated).toLocaleDateString()}</span>}
                    {g.notes && <span>Nota: {g.notes}</span>}
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button
                    onClick={() => handleValidate(g.goldenId)}
                    className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                  >
                    Verificar
                  </button>
                  <button
                    onClick={() => handleArchive(g.goldenId)}
                    className="text-xs px-3 py-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                  >
                    Quitar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
