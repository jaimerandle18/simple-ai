'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect, useRef } from 'react';

type WahaStatus = 'NOT_CONFIGURED' | 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED';

export default function SettingsPage() {
  const { data: session } = useSession();

  const [wahaStatus, setWahaStatus] = useState<WahaStatus>('NOT_CONFIGURED');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tenantId = (session?.user as any)?.tenantId;
  const headers = { 'Content-Type': 'application/json', 'x-tenant-id': tenantId || '' };

  // Cargar estado al montar
  useEffect(() => {
    if (!tenantId) return;
    fetchStatus();
  }, [tenantId]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  async function fetchStatus() {
    try {
      const res = await fetch('/api/proxy/channels/waha/status', { headers });
      const data = await res.json();
      const s: WahaStatus = data.status || 'NOT_CONFIGURED';
      setWahaStatus(s);
      if (s === 'SCAN_QR_CODE') fetchQr();
      if (s === 'STARTING' || s === 'SCAN_QR_CODE') startPolling();
    } catch {}
  }

  async function fetchQr() {
    try {
      const res = await fetch('/api/proxy/channels/waha/qr', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.qr) setQrCode(data.qr);
      }
    } catch {}
  }

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/proxy/channels/waha/status', { headers });
        const data = await res.json();
        const s: WahaStatus = data.status || 'STOPPED';
        setWahaStatus(s);

        if (s === 'SCAN_QR_CODE') {
          fetchQr();
        } else if (s === 'WORKING') {
          setQrCode(null);
          clearInterval(pollRef.current!);
          setConnecting(false);
        } else if (s === 'STOPPED' || s === 'FAILED') {
          clearInterval(pollRef.current!);
          setConnecting(false);
        }
      } catch {}
    }, 4000);
  }

  async function handleConnect() {
    setConnecting(true);
    setError('');
    setQrCode(null);
    setWahaStatus('STARTING');

    try {
      const res = await fetch('/api/proxy/channels/waha', {
        method: 'PUT',
        headers,
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'No se pudo iniciar la conexión');
        setWahaStatus('NOT_CONFIGURED');
        setConnecting(false);
        return;
      }
      startPolling();
    } catch {
      setError('Error de red. Intentá de nuevo.');
      setWahaStatus('NOT_CONFIGURED');
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    if (pollRef.current) clearInterval(pollRef.current);
    await fetch('/api/proxy/channels/waha', { method: 'DELETE', headers }).catch(() => {});
    setWahaStatus('NOT_CONFIGURED');
    setQrCode(null);
  }

  const isConnected = wahaStatus === 'WORKING';
  const isScanning = wahaStatus === 'SCAN_QR_CODE';
  const isStarting = wahaStatus === 'STARTING';
  const isIdle = wahaStatus === 'NOT_CONFIGURED' || wahaStatus === 'STOPPED' || wahaStatus === 'FAILED';

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

        {/* WhatsApp */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isConnected ? 'bg-green-100' : 'bg-gray-100'}`}>
                <svg className={`w-5 h-5 ${isConnected ? 'text-green-600' : 'text-gray-500'}`} fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-900">WhatsApp</h2>
                <p className="text-xs text-gray-400">
                  {isConnected ? 'Cuenta vinculada y activa' : 'Vinculá tu número de WhatsApp'}
                </p>
              </div>
            </div>

            {/* Badge de estado */}
            {!isIdle && (
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                isConnected ? 'bg-green-100 text-green-700' :
                isScanning ? 'bg-yellow-100 text-yellow-700' :
                'bg-blue-100 text-blue-700'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  isConnected ? 'bg-green-500' :
                  isScanning ? 'bg-yellow-400 animate-pulse' :
                  'bg-blue-400 animate-pulse'
                }`} />
                {isConnected ? 'Conectado' : isScanning ? 'Esperando escaneo' : 'Iniciando...'}
              </span>
            )}
          </div>

          {/* Conectado */}
          {isConnected && (
            <div className="flex items-center justify-between p-4 bg-green-50 border border-green-100 rounded-xl">
              <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                WhatsApp vinculado correctamente
              </div>
              <button
                onClick={handleDisconnect}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                Desvincular
              </button>
            </div>
          )}

          {/* QR Code */}
          {isScanning && (
            <div className="flex flex-col items-center gap-3 p-5 bg-gray-50 border border-gray-200 rounded-xl">
              {qrCode ? (
                <>
                  <p className="text-sm text-gray-600 text-center">
                    Abrí WhatsApp → <span className="font-medium">Dispositivos vinculados</span> → <span className="font-medium">Vincular dispositivo</span> y escaneá el código
                  </p>
                  <img src={qrCode} alt="Código QR de WhatsApp" className="w-52 h-52 rounded-lg border border-gray-200 shadow-sm" />
                  <p className="text-xs text-gray-400">El código se actualiza automáticamente</p>
                </>
              ) : (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Generando código QR...
                </div>
              )}
            </div>
          )}

          {/* Iniciando */}
          {isStarting && !isScanning && (
            <div className="flex items-center gap-2 p-4 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-600">
              <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Preparando la conexión con WhatsApp...
            </div>
          )}

          {/* Botón conectar */}
          {isIdle && (
            <>
              {error && <p className="mb-3 text-sm text-red-500">{error}</p>}
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20ba5a] active:bg-[#1aa34a] text-white text-sm font-semibold py-3 px-4 rounded-xl transition-colors disabled:opacity-60"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Conectar WhatsApp
              </button>
            </>
          )}
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
