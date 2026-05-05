'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const { data: session } = useSession();
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    if (!tenantId) return;
    api('/metrics', { tenantId }).then(setMetrics).catch(console.error);
  }, [tenantId]);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Hola, {session?.user?.name?.split(' ')[0] || 'usuario'}
        </h1>
        <p className="text-gray-500 text-sm mt-1">Resumen de tu actividad</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Conversaciones hoy" value={metrics?.conversationsToday ?? '--'} />
        <StatCard label="Mensajes hoy" value={metrics?.messagesToday ?? '--'} />
        <StatCard label="Conv. abiertas" value={metrics?.openConversations ?? '--'} />
        <StatCard label="Contactos totales" value={metrics?.contactsTotal ?? '--'} />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
        <div className="w-16 h-16 bg-primary-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Conectá tu WhatsApp</h3>
        <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
          Para empezar a recibir y responder mensajes automáticamente, vinculá tu cuenta de WhatsApp Business.
        </p>
        <button className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white font-medium py-2.5 px-6 rounded-lg hover:from-primary-700 hover:to-secondary-700 transition-all">
          Conectar WhatsApp
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
