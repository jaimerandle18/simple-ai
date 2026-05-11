'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import Link from 'next/link';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function OnboardingPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [document, setDocument] = useState('');
  const [completedSections, setCompletedSections] = useState<string[]>([]);
  const [view, setView] = useState<'chat' | 'document'>('chat');
  const [docView, setDocView] = useState<'client' | 'prompt'>('client');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [testResults, setTestResults] = useState<Array<{ input: string; output: string }> | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const allSections = ['business', 'bot_persona', 'horarios', 'pago', 'envio', 'politicas', 'promos', 'escalamiento'];
  const progress = Math.round((completedSections.length / allSections.length) * 100);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cargar config + historial existente al montar
  useEffect(() => {
    if (!tenantId) return;
    api('/onboarding/config', { tenantId })
      .then(data => {
        if (data.document) setDocument(data.document);
        if (data.completedSections) setCompletedSections(data.completedSections);
        if (data.chatHistory && data.chatHistory.length > 0) {
          setMessages(data.chatHistory.map((m: any) => ({ role: m.role, content: m.content })));
        }
      })
      .catch(console.error);
  }, [tenantId]);

  const handleSend = async () => {
    if (!input.trim() || loading || !tenantId) return;

    const userMsg: Message = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api('/onboarding/chat', {
        method: 'POST',
        tenantId,
        body: {
          message: userMsg.content,
          history: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
        },
      });

      setMessages(prev => [...prev, { role: 'assistant', content: res.reply }]);
      if (res.document) setDocument(res.document);
      if (res.completedSections) setCompletedSections(res.completedSections);
      // Avisar al banner que hubo cambios
      window.dispatchEvent(new Event('config-changed'));
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + err.message }]);
    }

    setLoading(false);
  };

  const handlePreviewPrompt = async () => {
    if (!tenantId) return;
    setPromptLoading(true);
    setDocView('prompt');
    try {
      const res = await api('/onboarding/preview-prompt', { method: 'POST', tenantId, body: {} });
      setSystemPrompt(res.prompt || '(sin prompt generado)');
    } catch (err: any) {
      console.error('preview-prompt error:', err);
      setSystemPrompt('Error al cargar el prompt: ' + (err.message || 'intenta de nuevo'));
    }
    setPromptLoading(false);
  };

  const handleTestBot = async () => {
    if (!tenantId) return;
    setTestLoading(true);
    setTestResults(null);
    try {
      const res = await api('/onboarding/test-bot', { method: 'POST', tenantId, body: {} });
      setTestResults(res.results || []);
    } catch (err: any) {
      console.error(err);
    }
    setTestLoading(false);
  };

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Toggle mobile */}
      <div className="md:hidden flex bg-white border-b border-gray-200">
        <button
          onClick={() => setView('chat')}
          className={`flex-1 py-3 text-sm font-medium ${view === 'chat' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
        >
          Chat
        </button>
        <button
          onClick={() => setView('document')}
          className={`flex-1 py-3 text-sm font-medium ${view === 'document' ? 'text-primary-600 border-b-2 border-primary-600' : 'text-gray-500'}`}
        >
          Documento
        </button>
      </div>

      {/* Chat */}
      <div className={`${view === 'chat' ? 'flex' : 'hidden'} md:flex flex-1 flex-col`}>
        {/* Header */}
        <div className="bg-primary-600 p-4 flex items-center gap-3">
          <Link href="/dashboard/agent" className="text-white/70 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white font-bold text-sm">
            AI
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Configurar mi agente</p>
            <p className="text-xs text-white/60">Te voy a ir preguntando todo</p>
          </div>
          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="w-20 h-2 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-xs text-white/80">{progress}%</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-gray-50">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="bg-white rounded-lg px-6 py-4 inline-block shadow-sm">
                <p className="text-gray-600 text-sm font-medium mb-1">Hola! Soy tu asistente de configuracion</p>
                <p className="text-gray-400 text-xs">Contame sobre tu negocio y te armo el agente de ventas</p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 shadow-sm text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-primary-600 text-white rounded-tr-none'
                  : 'bg-white text-gray-900 rounded-tl-none'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-white rounded-lg rounded-tl-none shadow-sm px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="bg-white border-t border-gray-200 p-3">
          <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Contame sobre tu negocio..."
              className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="bg-primary-600 text-white p-2.5 rounded-full hover:bg-primary-700 disabled:opacity-50"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
              </svg>
            </button>
          </form>
        </div>
      </div>

      {/* Documento */}
      <div className={`${view === 'document' ? 'flex' : 'hidden'} md:flex w-full md:w-96 flex-col bg-white border-l border-gray-200`}>
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900">Configuracion de tu agente</h2>

          {/* Toggle Vista cliente / Vista IA */}
          <div className="flex mt-2 bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setDocView('client')}
              className={`flex-1 text-xs py-1.5 rounded-md transition ${docView === 'client' ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500'}`}
            >
              Vista cliente
            </button>
            <button
              onClick={() => { setDocView('prompt'); handlePreviewPrompt(); }}
              className={`flex-1 text-xs py-1.5 rounded-md transition ${docView === 'prompt' ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-500'}`}
            >
              Vista IA
            </button>
          </div>

          {/* Section badges */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {allSections.map(s => (
              <span
                key={s}
                className={`text-[10px] px-2 py-0.5 rounded-full ${
                  completedSections.includes(s)
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {completedSections.includes(s) ? '✓ ' : ''}{s.replace('_', ' ')}
              </span>
            ))}
          </div>

          {/* Boton Probar mi bot (visible con 4+ secciones) */}
          {completedSections.length >= 4 && (
            <button
              onClick={handleTestBot}
              disabled={testLoading}
              className="mt-3 w-full text-xs font-medium py-2 px-3 rounded-lg bg-primary-50 text-primary-700 hover:bg-primary-100 border border-primary-200 disabled:opacity-50 transition"
            >
              {testLoading ? 'Probando...' : 'Probar mi agente'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {/* Test results */}
          {testResults && (
            <div className="mb-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase">Prueba del agente</p>
              {testResults.map((r, i) => (
                <div key={i} className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                  <p className="text-xs text-gray-500">Cliente: <span className="text-gray-700">{r.input}</span></p>
                  <p className="text-xs text-gray-900">{r.output}</p>
                </div>
              ))}
              <button onClick={() => setTestResults(null)} className="text-xs text-gray-400 hover:text-gray-600">Cerrar prueba</button>
              <hr className="border-gray-200" />
            </div>
          )}

          {docView === 'client' ? (
            document ? (
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">{document}</pre>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm">El documento se va a ir armando mientras chateamos</p>
              </div>
            )
          ) : (
            promptLoading ? (
              <div className="text-center py-12">
                <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Generando system prompt...</p>
              </div>
            ) : systemPrompt ? (
              <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono leading-relaxed bg-gray-50 p-3 rounded-lg">{systemPrompt}</pre>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-400 text-sm">Hace click en &quot;Vista IA&quot; para ver el system prompt</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
