'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';

interface AgentConfig {
  assistantName: string;
  tone: string;
  welcomeMessage: string;
  promotions: string;
  businessHours: string;
  extraInstructions: string;
  websiteUrl: string;
  websiteScraped: boolean;
  productsCount: number;
}

const toneOptions = [
  { value: 'formal', label: 'Formal — profesional y respetuoso' },
  { value: 'friendly', label: 'Amigable — cercano y cálido' },
  { value: 'casual', label: 'Casual — relajado, usa emojis' },
  { value: 'sales', label: 'Vendedor — persuasivo y proactivo' },
];

export default function AgentPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [config, setConfig] = useState<AgentConfig>({
    assistantName: '',
    tone: 'friendly',
    welcomeMessage: '',
    promotions: '',
    businessHours: '',
    extraInstructions: '',
    websiteUrl: '',
    websiteScraped: false,
    productsCount: 0,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    api('/agents/main', { tenantId })
      .then((data) => {
        if (data.agentConfig) {
          setConfig(data.agentConfig);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantId]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    setSaved(false);
    try {
      await api('/agents/main', {
        method: 'PUT',
        tenantId,
        body: { agentConfig: config },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  };

  const handleScrape = async () => {
    if (!tenantId || !config.websiteUrl) return;
    setScraping(true);
    setScrapeResult('');
    try {
      const result = await api('/agents/scrape', {
        method: 'POST',
        tenantId,
        body: { url: config.websiteUrl },
      });
      setConfig((prev) => ({
        ...prev,
        websiteScraped: true,
        productsCount: result.productsCount,
      }));
      setScrapeResult(`Se encontraron ${result.productsCount} productos/servicios`);
    } catch (err: any) {
      setScrapeResult('Error al scrapear: ' + err.message);
    }
    setScraping(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Agente IA</h1>
          <p className="text-gray-500 text-sm mt-1">Configurá cómo responde tu asistente a los clientes</p>
        </div>
        <a
          href="/dashboard/agent/test"
          className="flex items-center gap-2 border border-primary-500 text-primary-600 text-sm font-medium py-2 px-4 rounded-lg hover:bg-primary-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
          </svg>
          Probar chat
        </a>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Identity */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Identidad del asistente</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del asistente</label>
              <input
                type="text"
                value={config.assistantName}
                onChange={(e) => setConfig({ ...config, assistantName: e.target.value })}
                placeholder="Ej: Luna, Sofi, Asistente de Tu Negocio"
                className="w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tono de comunicación</label>
              <select
                value={config.tone}
                onChange={(e) => setConfig({ ...config, tone: e.target.value })}
                className="w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500"
              >
                {toneOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mensaje de bienvenida</label>
              <p className="text-xs text-gray-400 mb-1">El primer mensaje que envía el bot cuando un cliente nuevo escribe.</p>
              <textarea
                value={config.welcomeMessage}
                onChange={(e) => setConfig({ ...config, welcomeMessage: e.target.value })}
                rows={2}
                placeholder="Ej: ¡Hola! Soy Luna, la asistente de Tu Negocio. ¿En qué puedo ayudarte?"
                className="w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-y"
              />
            </div>
          </div>
        </div>

        {/* Business Info */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Información del negocio</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Promociones activas</label>
              <p className="text-xs text-gray-400 mb-1">El bot las mencionará cuando sea relevante.</p>
              <textarea
                value={config.promotions}
                onChange={(e) => setConfig({ ...config, promotions: e.target.value })}
                rows={3}
                placeholder="Ej: 20% de descuento en la segunda unidad. Envío gratis en compras mayores a $50.000."
                className="w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Horario de atención</label>
              <input
                type="text"
                value={config.businessHours}
                onChange={(e) => setConfig({ ...config, businessHours: e.target.value })}
                placeholder="Ej: Lunes a viernes de 9 a 18hs, sábados de 10 a 14hs"
                className="w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Instrucciones adicionales</label>
              <p className="text-xs text-gray-400 mb-1">Reglas o información extra que el bot debe saber.</p>
              <textarea
                value={config.extraInstructions}
                onChange={(e) => setConfig({ ...config, extraInstructions: e.target.value })}
                rows={3}
                placeholder="Ej: No ofrecer descuentos adicionales. Siempre sugerir agendar una llamada para consultas complejas."
                className="w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 resize-y"
              />
            </div>
          </div>
        </div>

        {/* Website Scraping */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-2">Productos y servicios</h2>
          <p className="text-xs text-gray-500 mb-4">
            Ingresá la URL de tu web y nosotros extraemos los productos automáticamente. El bot los usa como referencia cuando un cliente pregunta.
          </p>

          <div className="flex gap-3">
            <input
              type="url"
              value={config.websiteUrl}
              onChange={(e) => setConfig({ ...config, websiteUrl: e.target.value })}
              placeholder="https://www.tunegocio.com"
              className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
            />
            <button
              onClick={handleScrape}
              disabled={scraping || !config.websiteUrl}
              className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white text-sm font-medium py-2.5 px-5 rounded-lg hover:from-primary-700 hover:to-secondary-700 transition-all disabled:opacity-50 flex items-center gap-2"
            >
              {scraping ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Escaneando...
                </>
              ) : (
                'Escanear web'
              )}
            </button>
          </div>

          {config.websiteScraped && (
            <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
              <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              <span className="text-sm text-emerald-700">Web escaneada — {config.productsCount} productos/servicios encontrados</span>
            </div>
          )}

          {scrapeResult && !config.websiteScraped && (
            <p className="mt-3 text-sm text-red-600">{scrapeResult}</p>
          )}
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white font-medium py-2.5 px-6 rounded-lg hover:from-primary-700 hover:to-secondary-700 transition-all disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </button>
          {saved && (
            <span className="text-sm text-emerald-600 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Guardado
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
