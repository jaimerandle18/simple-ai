import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Política de Privacidad — Simple AI',
  description: 'Política de privacidad de Simple AI.',
};

const sections = [
  {
    title: 'Recopilación de información',
    body: 'Solo recopilamos la información mínima necesaria para brindar nuestros servicios de manera eficiente. Esta información puede incluir datos básicos como nombres, direcciones de correo electrónico y otros detalles estrictamente requeridos para cumplir con nuestras funciones.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    ),
  },
  {
    title: 'Uso de la información',
    body: 'La información que recopilamos es utilizada exclusivamente para proporcionar y mejorar nuestros servicios. No compartimos información personal identificable (como nombres, direcciones, correos electrónicos u otros datos similares) con terceros, excepto cuando sea necesario para cumplir con requisitos legales o regulatorios.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    ),
  },
  {
    title: 'No venta de información',
    body: 'Bajo ninguna circunstancia vendemos información personal identificable a terceros.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
  },
  {
    title: 'Protección de datos',
    body: 'Implementamos medidas de seguridad adecuadas para garantizar la protección de los datos recopilados contra accesos no autorizados, pérdida o alteración.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
      </svg>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-950">
      {/* Navbar */}
      <nav className="fixed top-0 w-full bg-gray-950/90 backdrop-blur-md z-50 border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/">
            <Image src="/assets/simpleLogo1.png" alt="Simple AI" width={140} height={36} className="h-8 w-auto" />
          </Link>
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Volver al inicio
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="pt-32 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="inline-flex items-center gap-2 bg-primary-950/60 border border-primary-800/50 text-primary-400 text-xs font-medium px-3 py-1.5 rounded-full mb-6">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
          </svg>
          Tu privacidad importa
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          Política de{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary-400 to-secondary-400">
            Privacidad
          </span>
        </h1>
        <p className="text-gray-400 max-w-xl mx-auto">
          En Simple AI respetamos y valoramos la privacidad de nuestros clientes y sus usuarios.
          Nos comprometemos a proteger la información que nos confían y a manejarla de manera responsable.
        </p>
      </div>

      {/* Sections */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-24">
        <div className="space-y-4">
          {sections.map((section, i) => (
            <div
              key={i}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 bg-primary-900/50 border border-primary-800/50 rounded-xl flex items-center justify-center text-primary-400 flex-shrink-0 mt-0.5">
                  {section.icon}
                </div>
                <div>
                  <h2 className="text-white font-semibold mb-2">{section.title}</h2>
                  <p className="text-gray-400 text-sm leading-relaxed">{section.body}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Contact */}
        <div className="mt-8 bg-gradient-to-r from-primary-900/30 to-secondary-900/30 border border-primary-800/30 rounded-2xl p-6 text-center">
          <p className="text-gray-300 text-sm">
            ¿Tenés preguntas sobre nuestra política de privacidad?{' '}
            <a
              href="mailto:ventas@simple-ai.co"
              className="text-primary-400 hover:text-primary-300 font-medium transition-colors"
            >
              ventas@simple-ai.co
            </a>
          </p>
        </div>

        {/* Footer note */}
        <p className="text-center text-gray-600 text-xs mt-8">
          © {new Date().getFullYear()} Simple AI. Todos los derechos reservados.
        </p>
      </div>
    </div>
  );
}
