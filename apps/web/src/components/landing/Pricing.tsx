import Link from 'next/link';

const plans = [
  {
    name: 'Básico',
    price: '14.990',
    period: '/mes',
    description: 'Para negocios que están empezando a automatizar su atención.',
    features: [
      '1 canal conectado',
      '500 conversaciones/mes',
      'Agente de IA básico',
      'Panel de conversaciones',
      'Soporte por email',
    ],
    cta: 'Empezar ahora',
    highlighted: false,
  },
  {
    name: 'Profesional',
    price: '29.990',
    period: '/mes',
    description: 'Para negocios que quieren escalar su atención al cliente.',
    features: [
      'Múltiples canales (WhatsApp, Instagram, Facebook)',
      'Conversaciones ilimitadas',
      'Agente de IA avanzado',
      'Subida de archivos como contexto',
      'Catalogación y tags',
      'Métricas y reportes',
      'Soporte prioritario',
    ],
    cta: 'Empezar ahora',
    highlighted: true,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Planes simples, sin sorpresas
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Empezá con 14 días de prueba gratis y escalá cuando lo necesites.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {plans.map((plan, i) => (
            <div
              key={i}
              className={`rounded-2xl p-8 ${
                plan.highlighted
                  ? 'bg-gray-900 text-white ring-2 ring-primary-500 shadow-xl'
                  : 'bg-white border border-gray-200 shadow-sm'
              }`}
            >
              {plan.highlighted && (
                <div className="inline-block bg-gradient-to-r from-primary-600 to-secondary-600 text-white text-xs font-semibold px-3 py-1 rounded-full mb-4">
                  Más popular
                </div>
              )}
              <h3 className={`text-xl font-bold mb-2 ${plan.highlighted ? 'text-white' : 'text-gray-900'}`}>
                {plan.name}
              </h3>
              <p className={`text-sm mb-6 ${plan.highlighted ? 'text-gray-400' : 'text-gray-600'}`}>
                {plan.description}
              </p>
              <div className="mb-6">
                <span className={`text-4xl font-bold ${plan.highlighted ? 'text-white' : 'text-gray-900'}`}>
                  ${plan.price}
                </span>
                <span className={`text-sm ${plan.highlighted ? 'text-gray-400' : 'text-gray-500'}`}>
                  {plan.period}
                </span>
              </div>
              <Link
                href="/login"
                className={`block text-center py-3 rounded-lg font-medium mb-8 transition-all ${
                  plan.highlighted
                    ? 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white hover:from-primary-600 hover:to-secondary-600'
                    : 'bg-primary-600 text-white hover:bg-primary-700'
                }`}
              >
                {plan.cta}
              </Link>
              <ul className="space-y-3">
                {plan.features.map((feature, j) => (
                  <li key={j} className="flex items-start gap-3">
                    <svg
                      className={`w-5 h-5 mt-0.5 flex-shrink-0 ${plan.highlighted ? 'text-primary-400' : 'text-primary-500'}`}
                      fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                    <span className={`text-sm ${plan.highlighted ? 'text-gray-300' : 'text-gray-600'}`}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
