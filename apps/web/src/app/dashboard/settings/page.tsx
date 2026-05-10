'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';

type WahaStatus = 'NOT_CONFIGURED' | 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED';

export default function SettingsPage() {
  const { data: session } = useSession();

  // WAHA state
  const [wahaUrl, setWahaUrl] = useState('');
  const [wahaApiKey, setWahaApiKey] = useState('');
  const [wahaStatus, setWahaStatus] = useState<WahaStatus>('NOT_CONFIGURED');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [wahaLoading, setWahaLoading] = useState(false);
  const [wahaError, setWahaError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tenantId = (session?.user as any)?.tenantId;

  const apiHeaders = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId || '' };

  // Load saved WAHA config on mount
  useEffect(() => {
    if (!tenantId) return;
    fetch('/api/proxy/channels/waha', { headers: apiHeaders })
      .then(r => r.json())
      .then(data => {
        if (data?.wahaUrl) {
          setWahaUrl(data.wahaUrl);
          setWahaApiKey(data.apiKey || '');
          if (data.active) pollStatus();
        }
      })
      .catch(() => {});
  }, [tenantId]);

  // Poll WAHA status
  function pollStatus() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/proxy/channels/waha/status', { headers: apiHeaders });
        const data = await res.json();
        const status: WahaStatus = data.status || 'STOPPED';
        setWahaStatus(status);

        if (status === 'SCAN_QR_CODE') {
          const qrRes = await fetch('/api/proxy/channels/waha/qr', { headers: apiHeaders });
          if (qrRes.ok) {
            const qrData = await qrRes.json();
            if (qrData.qr) setQrCode(qrData.qr);
          }
        } else if (status === 'WORKING') {
          setQrCode(null);
          if (pollRef.current) clearInterval(pollRef.current);
        } else if (status === 'STOPPED' || status === 'FAILED') {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {}
    }, 4000);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!wahaUrl) return;
    setWahaLoading(true);
    setWahaError('');
    setQrCode(null);
    setWahaStatus('STARTING');

    try {
      const res = await fetch('/api/proxy/channels/waha', {
        method: 'PUT',
        headers: apiHeaders,
        body: JSON.stringify({ wahaUrl, apiKey: wahaApiKey }),
      });
      if (!res.ok) {
        const d = await res.json();
        setWahaError(d.error || 'Error conectando con WAHA');
        setWahaStatus('NOT_CONFIGURED');
        return;
      }
      pollStatus();
    } catch (err: any) {
      setWahaError(err.message || 'Error de red');
      setWahaStatus('NOT_CONFIGURED');
    } finally {
      setWahaLoading(false);
    }
  }

  async function handleDisconnect() {
    if (pollRef.current) clearInterval(pollRef.current);
    await fetch('/api/proxy/channels/waha', { method: 'DELETE', headers: apiHeaders }).catch(() => {});
    setWahaStatus('NOT_CONFIGURED');
    setQrCode(null);
  }

  const statusLabel: Record<WahaStatus, string> = {
    NOT_CONFIGURED: '',
    STOPPED: 'Detenido',
    STARTING: 'Iniciando...',
    SCAN_QR_CODE: 'Esperando escaneo del QR',
    WORKING: 'Conectado',
    FAILED: 'Falló la conexión',
  };

  return (
    <div className="p-4 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
        <p className="text-gray-500 text-sm mt-1">Ajustes de tu cuenta y negocio</p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Perfil */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Perfil</h2>
          <div className="flex items-center gap-4">
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

        {/* WhatsApp via WAHA */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">WhatsApp (WAHA)</h2>
              <p className="text-gray-500 text-xs">Conectá tu WhatsApp usando tu servidor WAHA self-hosted</p>
            </div>
          </div>

          {/* Status badge */}
          {wahaStatus !== 'NOT_CONFIGURED' && (
            <div className="mt-4 mb-4 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                wahaStatus === 'WORKING' ? 'bg-green-100 text-green-700' :
                wahaStatus === 'SCAN_QR_CODE' ? 'bg-yellow-100 text-yellow-700' :
                wahaStatus === 'STARTING' ? 'bg-blue-100 text-blue-700' :
                'bg-red-100 text-red-700'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  wahaStatus === 'WORKING' ? 'bg-green-500' :
                  wahaStatus === 'SCAN_QR_CODE' || wahaStatus === 'STARTING' ? 'bg-yellow-500 animate-pulse' :
                  'bg-red-500'
                }`} />
                {statusLabel[wahaStatus]}
              </span>
              {wahaStatus === 'WORKING' && (
                <button onClick={handleDisconnect} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                  Desconectar
                </button>
              )}
            </div>
          )}

          {/* QR Code */}
          {wahaStatus === 'SCAN_QR_CODE' && qrCode && (
            <div className="mb-4 flex flex-col items-center gap-2 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-sm font-medium text-gray-700">Escaneá con WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
              <img src={qrCode} alt="QR WhatsApp" className="w-48 h-48 rounded-lg border border-gray-200" />
            </div>
          )}

          {wahaStatus === 'STARTING' && !qrCode && (
            <div className="mb-4 flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Iniciando sesión en WAHA...
            </div>
          )}

          {/* Form */}
          {(wahaStatus === 'NOT_CONFIGURED' || wahaStatus === 'STOPPED' || wahaStatus === 'FAILED') && (
            <form onSubmit={handleConnect} className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL del servidor WAHA</label>
                <input
                  type="url"
                  value={wahaUrl}
                  onChange={e => setWahaUrl(e.target.value)}
                  placeholder="http://tu-servidor:3000"
                  required
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Key <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input
                  type="text"
                  value={wahaApiKey}
                  onChange={e => setWahaApiKey(e.target.value)}
                  placeholder="tu-api-key"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
              {wahaError && <p className="text-red-500 text-xs">{wahaError}</p>}
              <button
                type="submit"
                disabled={wahaLoading || !wahaUrl}
                className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-medium py-2 px-4 rounded-lg hover:from-green-600 hover:to-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {wahaLoading ? 'Conectando...' : 'Conectar WhatsApp'}
              </button>
              <p className="text-xs text-gray-400">
                Necesitás tener WAHA corriendo en tu servidor.{' '}
                <a href="https://waha.devlike.pro/docs/overview/introduction/" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">
                  Ver documentación
                </a>
              </p>
            </form>
          )}
        </div>

        {/* WhatsApp Business (Meta - legacy) */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">WhatsApp Business API (Meta)</h2>
          <p className="text-gray-500 text-sm mb-4">Conectá tu cuenta oficial de WhatsApp Business.</p>
          <div className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-gray-900 text-sm font-medium">No conectado</p>
              <p className="text-gray-400 text-xs">Requiere cuenta de Meta Business</p>
            </div>
            <button className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white text-sm font-medium py-2 px-4 rounded-lg hover:from-primary-700 hover:to-secondary-700 transition-all">
              Conectar
            </button>
          </div>
        </div>

        {/* Suscripción */}
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
