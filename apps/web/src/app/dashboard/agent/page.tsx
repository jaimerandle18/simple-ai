'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';

interface AttachedFile {
  fileKey: string;
  extractedKey: string;
  fileName: string;
  textLength: number;
  uploadedAt: string;
}

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
  attachedFiles?: AttachedFile[];
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
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId) return;

    const allowed = ['application/pdf', 'text/plain', 'text/csv', 'text/markdown'];
    if (!allowed.includes(file.type) && !file.name.endsWith('.txt') && !file.name.endsWith('.md') && !file.name.endsWith('.csv')) {
      setUploadMsg('Solo se permiten archivos PDF, TXT, CSV o MD');
      return;
    }

    setUploading(true);
    setUploadMsg('');
    try {
      // 1. Pedir presigned URL
      const { uploadUrl, fileKey, fileName } = await api('/files/upload-url', {
        method: 'POST',
        tenantId,
        body: { fileName: file.name, contentType: file.type },
      });

      // 2. Subir a S3
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      // 3. Procesar (extraer texto y asociar al agente)
      const result = await api('/files/process', {
        method: 'POST',
        tenantId,
        body: { fileKey, fileName },
      });

      // 4. Actualizar estado local
      const newFile: AttachedFile = {
        fileKey,
        extractedKey: result.extractedKey,
        fileName,
        textLength: result.textLength,
        uploadedAt: new Date().toISOString(),
      };
      setConfig(prev => ({
        ...prev,
        attachedFiles: [...(prev.attachedFiles || []), newFile],
      }));
      setUploadMsg(`"${fileName}" procesado (${Math.round(result.textLength / 1000)}k caracteres extraídos)`);
    } catch (err: any) {
      setUploadMsg('Error: ' + err.message);
    }
    setUploading(false);
    e.target.value = '';
  };

  const handleFileDelete = async (fileKey: string) => {
    if (!tenantId) return;
    try {
      await api('/files/detach', {
        method: 'DELETE',
        tenantId,
        body: { fileKey },
      });
      setConfig(prev => ({
        ...prev,
        attachedFiles: (prev.attachedFiles || []).filter(f => f.fileKey !== fileKey),
      }));
    } catch (err: any) {
      console.error('Error eliminando archivo:', err);
    }
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
              <p className="text-xs text-gray-400 mb-1">El primer mensaje que envía el agente cuando un cliente nuevo escribe.</p>
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
              <p className="text-xs text-gray-400 mb-1">El agente las mencionará cuando sea relevante.</p>
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
              <p className="text-xs text-gray-400 mb-1">Reglas o información extra que el agente debe saber.</p>
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
            Ingresá la URL de tu web y nosotros extraemos los productos automáticamente. El agente los usa como referencia cuando un cliente pregunta.
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
                  Escaneando {config.websiteUrl}...
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

        {/* Archivos de referencia */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-2">Archivos de referencia</h2>
          <p className="text-xs text-gray-500 mb-4">
            Subí archivos con info de tu negocio (FAQ, políticas, catálogos). El agente los usa para responder mejor.
          </p>

          {/* Lista de archivos */}
          {(config.attachedFiles || []).length > 0 && (
            <div className="space-y-2 mb-4">
              {(config.attachedFiles || []).map((file) => (
                <div key={file.fileKey} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-3">
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{file.fileName}</p>
                      <p className="text-xs text-gray-400">{Math.round(file.textLength / 1000)}k caracteres extraídos</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleFileDelete(file.fileKey)}
                    className="text-red-400 hover:text-red-600 p-1"
                    title="Eliminar archivo"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Upload button */}
          <label className={`inline-flex items-center gap-2 border border-gray-300 text-gray-700 text-sm font-medium py-2 px-4 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
            {uploading ? (
              <>
                <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                Subir archivo
              </>
            )}
            <input
              type="file"
              accept=".pdf,.txt,.csv,.md"
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>

          <p className="text-xs text-gray-400 mt-2">Formatos: PDF, TXT, CSV, MD</p>

          {uploadMsg && (
            <p className={`mt-2 text-sm ${uploadMsg.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>
              {uploadMsg}
            </p>
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
