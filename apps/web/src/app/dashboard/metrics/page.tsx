'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';

interface Metrics {
  conversationsToday: number;
  conversationsThisWeek: number;
  conversationsTotal: number;
  openConversations: number;
  messagesToday: number;
  messagesThisWeek: number;
  contactsTotal: number;
  newContactsWeek: number;
  botMessages: number;
  humanMessages: number;
  inboundMessages: number;
  botAssigned: number;
  humanAssigned: number;
  avgResponseTime: number;
  tagCounts: Record<string, number>;
}

export default function MetricsPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    api('/metrics', { tenantId })
      .then(setMetrics)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const m = metrics;
  const tagEntries = Object.entries(m?.tagCounts || {}).sort((a, b) => b[1] - a[1]);
  const totalOutbound = (m?.botMessages || 0) + (m?.humanMessages || 0);

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Métricas</h1>
        <p className="text-gray-500 text-sm mt-1">Estadísticas de tus conversaciones y agente IA</p>
      </div>

      {/* Fila 1: Stats principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Conversaciones hoy" value={m?.conversationsToday ?? 0} color="primary" />
        <StatCard label="Mensajes hoy" value={m?.messagesToday ?? 0} color="secondary" />
        <StatCard label="Contactos nuevos (semana)" value={m?.newContactsWeek ?? 0} color="emerald" />
        <StatCard
          label="Tiempo respuesta promedio"
          value={m?.avgResponseTime ?? 0}
          suffix="s"
          color="amber"
        />
      </div>

      {/* Fila 2: Semana + totales */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <MiniCard label="Conv. esta semana" value={m?.conversationsThisWeek ?? 0} />
        <MiniCard label="Mensajes semana" value={m?.messagesThisWeek ?? 0} />
        <MiniCard label="Conv. abiertas" value={m?.openConversations ?? 0} />
        <MiniCard label="Contactos total" value={m?.contactsTotal ?? 0} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Agente IA vs Manual */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Agente IA vs Manual</h2>
          <div className="space-y-3">
            <BarRow
              label="Agente IA"
              value={m?.botAssigned ?? 0}
              total={(m?.botAssigned ?? 0) + (m?.humanAssigned ?? 0)}
              color="bg-emerald-500"
            />
            <BarRow
              label="Manual"
              value={m?.humanAssigned ?? 0}
              total={(m?.botAssigned ?? 0) + (m?.humanAssigned ?? 0)}
              color="bg-amber-500"
            />
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-700 mb-2">Mensajes enviados hoy</h3>
            <div className="space-y-2">
              <BarRow label="Agente IA" value={m?.botMessages ?? 0} total={totalOutbound} color="bg-emerald-500" />
              <BarRow label="Humano" value={m?.humanMessages ?? 0} total={totalOutbound} color="bg-amber-500" />
              <BarRow label="Clientes (entrantes)" value={m?.inboundMessages ?? 0} total={(m?.inboundMessages ?? 0) + totalOutbound} color="bg-gray-400" />
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Tags</h2>
          {tagEntries.length === 0 ? (
            <p className="text-sm text-gray-400">Sin tags todavía. Se asignan automáticamente o desde las conversaciones.</p>
          ) : (
            <div className="space-y-2">
              {tagEntries.map(([tag, count]) => (
                <div key={tag} className="flex items-center justify-between">
                  <span className="bg-primary-50 text-primary-700 text-xs font-medium px-2.5 py-1 rounded-full">
                    {tag}
                  </span>
                  <span className="text-sm text-gray-500">{count} conversaciones</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, suffix, color }: { label: string; value: number; suffix?: string; color: string }) {
  const colorMap: Record<string, string> = {
    primary: 'bg-primary-50 text-primary-600',
    secondary: 'bg-secondary-50 text-secondary-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <p className="text-sm text-gray-500 mb-2">{label}</p>
      <p className="text-3xl font-bold text-gray-900">
        {value}{suffix && <span className="text-lg text-gray-400 ml-0.5">{suffix}</span>}
      </p>
    </div>
  );
}

function MiniCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

function BarRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-gray-700">{label}</span>
        <span className="text-gray-500">{value} ({pct}%)</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
