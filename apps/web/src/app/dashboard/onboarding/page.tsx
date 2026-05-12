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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allSections = ['business', 'bot_persona', 'horarios', 'pago', 'envio', 'politicas', 'promos', 'escalamiento'];
  const progress = Math.round((completedSections.length / allSections.length) * 100);
  const isComplete = completedSections.length === allSections.length;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cargar config + historial existente
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

  // Mantener foco en el input
  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading, messages]);

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
      window.dispatchEvent(new Event('config-changed'));

      // Regression si hay goldens
      try {
        const regResult = await api('/regression/start', {
          method: 'POST', tenantId,
          body: { oldPrompt: '', newPrompt: 'onboarding_change' },
        });
        if (!regResult.skipped && regResult.runId) {
          window.dispatchEvent(new CustomEvent('regression-started', { detail: { runId: regResult.runId } }));
        }
      } catch {}
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + err.message }]);
    }

    setLoading(false);
    // Refocus input después de enviar
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const sectionLabels: Record<string, string> = {
    business: 'Negocio', bot_persona: 'Agente IA', horarios: 'Horarios',
    pago: 'Pagos', envio: 'Envios', politicas: 'Politicas',
    promos: 'Promos', escalamiento: 'Escalamiento',
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-primary-600 p-4 flex items-center gap-3">
        <Link href="/dashboard" className="text-white/70 hover:text-white">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-white font-bold text-sm">
          AI
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">Configurar mi agente</p>
          <p className="text-xs text-white/60">
            {isComplete ? 'Configuracion completa' : 'Te voy a ir preguntando todo'}
          </p>
        </div>
        {/* Progress */}
        <div className="flex items-center gap-2">
          <div className="w-20 h-2 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-white/80">{progress}%</span>
        </div>
        {/* Botones header */}
        <div className="flex items-center gap-2">
          <a
            href="/dashboard/agent/test"
            className="text-xs bg-white/20 text-white px-3 py-1.5 rounded-lg hover:bg-white/30 transition"
          >
            Probar chat
          </a>
          {(isComplete || document) && (
            <button
              onClick={() => setDrawerOpen(true)}
              className="text-xs bg-white/20 text-white px-3 py-1.5 rounded-lg hover:bg-white/30 transition"
            >
              Ver configuracion
            </button>
          )}
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
            <div className={`max-w-[70%] rounded-lg px-3 py-2 shadow-sm text-sm whitespace-pre-wrap ${
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
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2 max-w-3xl mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Contame sobre tu negocio..."
            className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
            disabled={loading}
            autoFocus
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

      {/* Drawer de configuración */}
      {drawerOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setDrawerOpen(false)}>
          <div className="bg-white w-full max-w-lg h-full overflow-y-auto shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-gray-200 p-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">Configuracion de tu agente</h2>
              <button onClick={() => setDrawerOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="p-5 space-y-6">
              {/* Section badges */}
              <div className="flex flex-wrap gap-1.5">
                {allSections.map(s => (
                  <span
                    key={s}
                    className={`text-xs px-2.5 py-1 rounded-full ${
                      completedSections.includes(s)
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {completedSections.includes(s) ? '✓ ' : ''}{sectionLabels[s] || s}
                  </span>
                ))}
              </div>

              {/* Documento legible */}
              {document ? (
                <div className="space-y-4">
                  {document.split('\n\n').map((section, i) => {
                    const lines = section.split('\n');
                    const title = lines[0];
                    const fields = lines.slice(1);
                    return (
                      <div key={i} className="bg-gray-50 rounded-xl p-4">
                        <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
                        <div className="space-y-1.5">
                          {fields.map((line, j) => {
                            const [label, ...rest] = line.split(':');
                            const value = rest.join(':').trim();
                            if (!value) return <p key={j} className="text-sm text-gray-600">{line}</p>;
                            return (
                              <div key={j} className="flex gap-2 text-sm">
                                <span className="text-gray-400 shrink-0">{label.trim()}:</span>
                                <span className="text-gray-700">{value}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-gray-400 text-sm text-center py-8">
                  Todavia no hay datos configurados
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
