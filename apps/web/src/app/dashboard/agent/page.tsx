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
  websiteUrl: string;
  websiteScraped: boolean;
  productsCount: number;
  attachedFiles?: AttachedFile[];
}

export default function ScraperPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [config, setConfig] = useState<AgentConfig>({
    websiteUrl: '',
    websiteScraped: false,
    productsCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    api('/agents/main', { tenantId })
      .then((data) => {
        if (data.agentConfig) setConfig(data.agentConfig);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantId]);

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
      setScrapeResult(`Se encontraron ${result.productsCount} productos`);
    } catch (err: any) {
      setScrapeResult('Error al escanear: ' + err.message);
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
      const { uploadUrl, fileKey, fileName } = await api('/files/upload-url', {
        method: 'POST', tenantId,
        body: { fileName: file.name, contentType: file.type },
      });

      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      const result = await api('/files/process', {
        method: 'POST', tenantId,
        body: { fileKey, fileName },
      });

      const newFile: AttachedFile = {
        fileKey, extractedKey: result.extractedKey, fileName,
        textLength: result.textLength, uploadedAt: new Date().toISOString(),
      };
      setConfig(prev => ({
        ...prev,
        attachedFiles: [...(prev.attachedFiles || []), newFile],
      }));
      setUploadMsg(`"${fileName}" procesado (${Math.round(result.textLength / 1000)}k caracteres)`);
    } catch (err: any) {
      setUploadMsg('Error: ' + err.message);
    }
    setUploading(false);
    e.target.value = '';
  };

  const handleFileDelete = async (fileKey: string) => {
    if (!tenantId) return;
    try {
      await api('/files/detach', { method: 'DELETE', tenantId, body: { fileKey } });
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
    <div className="p-4 md:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 md:mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catalogo de productos</h1>
          <p className="text-gray-500 text-sm mt-1">Escanea tu web para cargar productos, o subi archivos con info de tu negocio</p>
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
        {/* Scraper */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-2">Escanear tu web</h2>
          <p className="text-xs text-gray-500 mb-4">
            Ingresa la URL de tu tienda y extraemos los productos automaticamente. El agente los usa para responder cuando un cliente pregunta.
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
              <span className="text-sm text-emerald-700">Web escaneada — {config.productsCount} productos encontrados</span>
            </div>
          )}

          {scrapeResult && !config.websiteScraped && (
            <p className="mt-3 text-sm text-red-600">{scrapeResult}</p>
          )}
        </div>

        {/* Archivos */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 mb-2">Archivos de referencia</h2>
          <p className="text-xs text-gray-500 mb-4">
            Subi archivos con info de tu negocio (FAQ, politicas, catalogos). El agente los usa para responder mejor.
          </p>

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
                      <p className="text-xs text-gray-400">{Math.round(file.textLength / 1000)}k caracteres</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleFileDelete(file.fileKey)}
                    className="text-red-400 hover:text-red-600 p-1"
                    title="Eliminar"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

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
      </div>
    </div>
  );
}
