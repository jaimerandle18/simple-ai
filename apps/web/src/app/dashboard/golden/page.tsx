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

export default function GoldenPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [goldens, setGoldens] = useState<Golden[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    api('/golden/list', { tenantId })
      .then(data => setGoldens(data.goldens || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantId]);

  const handleArchive = async (goldenId: string) => {
    if (!tenantId) return;
    try {
      await api(`/golden/${goldenId}`, { method: 'DELETE', tenantId });
      setGoldens(prev => prev.filter(g => g.goldenId !== goldenId));
    } catch (err) {
      console.error(err);
    }
  };

  const verdictDot = (v: string) => {
    if (v === 'pass') return 'bg-emerald-400';
    if (v === 'warning') return 'bg-amber-400';
    if (v === 'failed') return 'bg-red-400';
    return 'bg-gray-300';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Conversaciones tipo</h1>
        <p className="text-gray-500 text-sm mt-1">
          Estas son las conversaciones que se usan como referencia. Cada vez que modifiques el prompt, se prueban automaticamente para verificar que nada se rompa.
        </p>
      </div>

      {goldens.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
          <div className="text-4xl mb-3">&#9733;</div>
          <p className="text-gray-700 font-medium">No hay conversaciones tipo todavia</p>
          <p className="text-gray-400 text-sm mt-1.5 max-w-sm mx-auto">
            Anda a una conversacion que te haya gustado como respondio el agente y apreta &quot;Guardar como referencia&quot;. Esas conversaciones se van a usar para verificar futuros cambios.
          </p>
          <a
            href="/dashboard/conversations"
            className="inline-block mt-4 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            Ir a conversaciones →
          </a>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-4">
            {goldens.length} conversacion{goldens.length === 1 ? '' : 'es'} guardada{goldens.length === 1 ? '' : 's'}
          </p>
          <div className="space-y-3">
            {goldens.map(g => (
              <div key={g.goldenId} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between">
                  <a href={`/dashboard/conversations?id=${g.conversationId}`} className="flex-1 min-w-0 hover:opacity-80 transition">
                    <div className="flex items-center gap-2">
                      {g.lastVerdict && (
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${verdictDot(g.lastVerdict)}`} title={`Ultima verificacion: ${g.lastVerdict}`} />
                      )}
                      <p className="text-sm font-medium text-gray-900 truncate">{g.preview || 'Sin preview'}</p>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {g.tags.map(t => (
                        <span key={t} className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span>{g.turnCount} turnos</span>
                      <span>{new Date(g.savedAt).toLocaleDateString()}</span>
                      {g.lastVerdict && g.lastValidated && (
                        <span>
                          Ultima verificacion: {g.lastVerdict === 'pass' ? 'ok' : g.lastVerdict} ({new Date(g.lastValidated).toLocaleDateString()})
                        </span>
                      )}
                    </div>
                  </a>
                  <button
                    onClick={() => handleArchive(g.goldenId)}
                    className="text-xs text-gray-400 hover:text-red-500 ml-3 flex-shrink-0 p-1"
                    title="Quitar de las conversaciones tipo"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500">
              Para agregar mas, anda a una conversacion y apreta <strong>&quot;Guardar como referencia&quot;</strong>. Para que la verificacion sea efectiva, te recomendamos tener al menos 3-5 conversaciones variadas (productos, envios, pagos, etc.)
            </p>
          </div>
        </>
      )}
    </div>
  );
}
