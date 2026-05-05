const steps = [
  {
    number: '01',
    title: 'Conectá tu WhatsApp',
    description: 'Vinculá tu cuenta de WhatsApp Business en 3 clicks con el proceso oficial de Meta.',
  },
  {
    number: '02',
    title: 'Configurá tu agente',
    description: 'Describí tu negocio, subí tus archivos y nuestro asistente de IA te ayuda a crear el prompt perfecto.',
  },
  {
    number: '03',
    title: 'Dejá que la IA trabaje',
    description: 'El agente responde automáticamente a tus clientes. Vos solo supervisás desde el panel.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-4">
            Empezá en minutos
          </h2>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            No necesitás conocimientos técnicos. Configurá tu agente de IA en 3 simples pasos.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {steps.map((step, i) => (
            <div key={i} className="relative text-center">
              <div className="text-6xl font-bold text-primary-100 mb-4">{step.number}</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">{step.title}</h3>
              <p className="text-gray-600">{step.description}</p>
              {i < steps.length - 1 && (
                <div className="hidden md:block absolute top-10 -right-4 w-8">
                  <svg className="w-8 h-8 text-primary-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
