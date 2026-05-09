'use client';

import { useSession } from 'next-auth/react';

export default function SettingsPage() {
  const { data: session } = useSession();

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
        <p className="text-gray-500 text-sm mt-1">Ajustes de tu cuenta y negocio</p>
      </div>

      <div className="max-w-3xl space-y-6">
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Perfil</h2>
          <div className="flex items-center gap-4 mb-6">
            {session?.user?.image ? (
              <img src={session.user.image} alt="" className="w-16 h-16 rounded-full" />
            ) : (
              <div className="w-16 h-16 bg-primary-600 rounded-full flex items-center justify-center text-white text-xl font-bold">
                {session?.user?.name?.[0] || '?'}
              </div>
            )}
            <div>
              <p className="text-gray-900 font-medium">{session?.user?.name}</p>
              <p className="text-gray-500 text-sm">{session?.user?.email}</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">WhatsApp Business</h2>
          <p className="text-gray-500 text-sm mb-4">Conectá tu cuenta de WhatsApp Business para empezar a recibir mensajes.</p>
          <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-gray-900 text-sm font-medium">No conectado</p>
              <p className="text-gray-400 text-xs">Vinculá tu número de WhatsApp Business</p>
            </div>
            <button className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white text-sm font-medium py-2 px-4 rounded-lg hover:from-primary-700 hover:to-secondary-700 transition-all">
              Conectar
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Suscripción</h2>
          <div className="flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div>
              <p className="text-gray-900 text-sm font-medium">Plan Free</p>
              <p className="text-gray-400 text-xs">Trial de 14 días — 100 mensajes incluidos</p>
            </div>
            <button className="border border-primary-500 text-primary-600 text-sm font-medium py-2 px-4 rounded-lg hover:bg-primary-50 transition-colors">
              Mejorar plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
