'use client';

import { useState } from 'react';

const plans = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'ARS',
    period: 'mes',
    description: 'Para probar la plataforma',
    features: ['100 mensajes/mes', '1 agente', 'Soporte por email'],
    current: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 29900,
    currency: 'ARS',
    period: 'mes',
    description: 'Para negocios en crecimiento',
    features: ['5.000 mensajes/mes', '3 agentes', 'Transcripción de audio', 'Soporte prioritario'],
    current: false,
    highlight: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 89900,
    currency: 'ARS',
    period: 'mes',
    description: 'Para operaciones grandes',
    features: ['Mensajes ilimitados', 'Agentes ilimitados', 'API access', 'Soporte dedicado'],
    current: false,
  },
];

const invoices = [
  { id: 'INV-001', date: '01/04/2025', plan: 'Free', amount: 0, status: 'pagado' },
];

export default function PaymentsPage() {
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  async function handleUpgrade(planId: string) {
    setLoadingPlan(planId);
    // TODO: llamar al backend para crear checkout de MercadoPago o Stripe
    await new Promise(r => setTimeout(r, 1000));
    setLoadingPlan(null);
  }

  const currentPlan = plans.find(p => p.current)!;

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Pagos y suscripción</h1>
        <p className="text-gray-500 text-sm mt-1">Gestioná tu plan y el historial de pagos</p>
      </div>

      <div className="max-w-4xl space-y-8">

        {/* Estado actual */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Plan actual</h2>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
                </svg>
              </div>
              <div>
                <p className="text-gray-900 font-medium">Plan {currentPlan.name}</p>
                <p className="text-gray-400 text-xs">Trial de 14 días — vence el 23/05/2025</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Activo
              </span>
            </div>
          </div>
        </div>

        {/* Planes */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-4">Planes disponibles</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map(plan => (
              <div
                key={plan.id}
                className={`bg-white border rounded-xl p-5 shadow-sm flex flex-col ${
                  plan.highlight
                    ? 'border-primary-400 ring-1 ring-primary-400'
                    : 'border-gray-200'
                }`}
              >
                {plan.highlight && (
                  <span className="self-start mb-3 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                    Más popular
                  </span>
                )}
                <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                <p className="text-gray-500 text-xs mt-0.5 mb-3">{plan.description}</p>
                <div className="mb-4">
                  {plan.price === 0 ? (
                    <span className="text-2xl font-bold text-gray-900">Gratis</span>
                  ) : (
                    <div className="flex items-end gap-1">
                      <span className="text-2xl font-bold text-gray-900">
                        ${plan.price.toLocaleString('es-AR')}
                      </span>
                      <span className="text-gray-400 text-sm mb-0.5">/{plan.period}</span>
                    </div>
                  )}
                </div>
                <ul className="space-y-2 flex-1 mb-5">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {plan.current ? (
                  <button disabled className="w-full border border-gray-200 text-gray-400 text-sm font-medium py-2 px-4 rounded-lg cursor-not-allowed">
                    Plan actual
                  </button>
                ) : (
                  <button
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={loadingPlan === plan.id}
                    className={`w-full text-sm font-medium py-2 px-4 rounded-lg transition-all flex items-center justify-center gap-2 ${
                      plan.highlight
                        ? 'bg-gradient-to-r from-primary-600 to-secondary-600 text-white hover:from-primary-700 hover:to-secondary-700'
                        : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    {loadingPlan === plan.id ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Procesando...
                      </>
                    ) : 'Elegir plan'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Métodos de pago aceptados */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Métodos de pago aceptados</h2>
          <div className="flex flex-wrap gap-3">
            <PaymentBadge label="MercadoPago" color="bg-[#009EE3]" />
            <PaymentBadge label="Stripe" color="bg-[#635BFF]" />
            <PaymentBadge label="Tarjetas de crédito" color="bg-gray-700" />
            <PaymentBadge label="Transferencia bancaria" color="bg-gray-700" />
          </div>
        </div>

        {/* Historial */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <h2 className="text-base font-semibold text-gray-900">Historial de pagos</h2>
          </div>
          {invoices.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">Sin pagos registrados</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Factura</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Fecha</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Plan</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Monto</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td className="px-6 py-4 text-gray-900 font-medium">{inv.id}</td>
                    <td className="px-6 py-4 text-gray-500">{inv.date}</td>
                    <td className="px-6 py-4 text-gray-500">{inv.plan}</td>
                    <td className="px-6 py-4 text-gray-900">{inv.amount === 0 ? 'Gratis' : `$${inv.amount.toLocaleString('es-AR')}`}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </div>
  );
}

function PaymentBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-white text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}
