import Link from 'next/link';

export function Hero() {
  return (
    <section className="pt-32 pb-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left - Text */}
          <div>
            <div className="inline-flex items-center gap-2 bg-primary-50 text-primary-700 text-sm font-medium px-3 py-1 rounded-full mb-6">
              <span className="w-2 h-2 bg-primary-500 rounded-full animate-pulse"></span>
              Potenciado por Inteligencia Artificial
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight mb-6">
              Automatiza tu{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-600 to-secondary-600">WhatsApp</span>{' '}
              con IA
            </h1>
            <p className="text-lg text-gray-600 mb-8 max-w-lg">
              Responde a tus clientes 24/7 con un agente inteligente que conoce tu negocio.
              Más ventas, menos esfuerzo.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                href="/login"
                className="inline-flex items-center justify-center bg-gradient-to-r from-primary-600 to-secondary-600 text-white px-6 py-3 rounded-lg text-base font-medium hover:from-primary-700 hover:to-secondary-700 transition-all"
              >
                Empezar gratis
                <svg className="w-4 h-4 ml-2" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center border border-gray-300 text-gray-700 px-6 py-3 rounded-lg text-base font-medium hover:bg-gray-50 transition-colors"
              >
                Ver cómo funciona
              </a>
            </div>
            <div className="flex items-center gap-6 mt-8 text-sm text-gray-500">
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                Sin tarjeta de crédito
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                Configuración en 5 minutos
              </div>
            </div>
          </div>

          {/* Right - Chat Preview */}
          <div className="relative">
            <div className="bg-gray-950 rounded-2xl p-6 shadow-2xl">
              {/* Chat Header */}
              <div className="flex items-center gap-3 pb-4 border-b border-gray-800">
                <div className="w-10 h-10 bg-gradient-to-br from-primary-600 to-secondary-600 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  AI
                </div>
                <div>
                  <div className="text-white font-medium text-sm">Simple AI Bot</div>
                  <div className="text-primary-400 text-xs">En línea</div>
                </div>
              </div>

              {/* Messages */}
              <div className="py-4 space-y-3">
                <div className="flex justify-start">
                  <div className="bg-gray-800 text-gray-200 px-4 py-2 rounded-2xl rounded-bl-md text-sm max-w-[80%]">
                    Hola! Quiero saber el precio del plan premium
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white px-4 py-2 rounded-2xl rounded-br-md text-sm max-w-[80%]">
                    ¡Hola! El plan Premium tiene un costo de $9.990/mes e incluye respuestas ilimitadas, soporte prioritario y acceso a métricas avanzadas. ¿Te gustaría activarlo?
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="bg-gray-800 text-gray-200 px-4 py-2 rounded-2xl rounded-bl-md text-sm max-w-[80%]">
                    Sí, quiero activarlo!
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white px-4 py-2 rounded-2xl rounded-br-md text-sm max-w-[80%]">
                    Perfecto! Te envío el link de pago 🔗
                  </div>
                </div>
              </div>

              {/* Typing indicator */}
              <div className="flex items-center gap-1.5 px-4 py-2">
                <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>

            {/* Decorative element */}
            <div className="absolute -z-10 top-8 -right-4 w-full h-full bg-primary-100 rounded-2xl"></div>
          </div>
        </div>
      </div>
    </section>
  );
}
