'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import { RegressionModal } from '@/components/dashboard/RegressionModal';

interface FeedbackTarget {
  messageId: string;
  content: string;
}

interface FeedbackPreview {
  proposedRules: string;
  previewResponse: string;
}

interface Conversation {
  conversationId: string;
  contactPhone: string;
  contactName?: string;
  status: string;
  tags: string[];
  assignedTo: string;
  lastMessageAt: string;
  lastMessagePreview?: string;
  unreadCount: number;
}

interface Message {
  messageId: string;
  direction: 'inbound' | 'outbound';
  sender: string;
  type: string;
  content: string;
  timestamp: string;
  status?: string;
  imageUrl?: string;
  imageBase64?: string;
  imageMimeType?: string;
}

export default function ConversationsPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [allTags, setAllTags] = useState<string[]>([]);
  const [feedbackTarget, setFeedbackTarget] = useState<FeedbackTarget | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackStep, setFeedbackStep] = useState<'write' | 'loading' | 'preview' | 'done'>('write');
  const [feedbackPreview, setFeedbackPreview] = useState<FeedbackPreview | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const selectedConv = conversations.find(c => c.conversationId === selectedId) || null;
  const setSelectedConv = (conv: Conversation | null) => setSelectedId(conv?.conversationId || null);

  useEffect(() => {
    if (!tenantId) return;
    api('/conversations', { tenantId })
      .then(setConversations)
      .catch(console.error)
      .finally(() => setLoading(false));

    // Chequear si hay un run pendiente de decision
    api('/regression/pending', { tenantId })
      .then(data => {
        if (data.run?.runId && !data.run.decision) {
          setRegressionRunId(data.run.runId);
        }
      })
      .catch(() => {});
  }, [tenantId]);

  useEffect(() => {
    if (!selectedId || !tenantId) return;
    setLoadingMsgs(true);
    api(`/conversations/${selectedId}/messages`, { tenantId })
      .then(setMessages)
      .catch(console.error)
      .finally(() => setLoadingMsgs(false));
  }, [selectedId, tenantId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Polling for new messages
  useEffect(() => {
    if (!selectedId || !tenantId) return;
    const interval = setInterval(() => {
      api(`/conversations/${selectedId}/messages`, { tenantId })
        .then(setMessages)
        .catch(console.error);
      api('/conversations', { tenantId })
        .then(setConversations)
        .catch(console.error);
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedId, tenantId]);

  // Cargar tags disponibles
  useEffect(() => {
    if (!tenantId) return;
    api('/conversations/tags', { tenantId }).then(setAllTags).catch(console.error);
  }, [tenantId]);

  const closeFeedback = () => {
    setFeedbackTarget(null);
    setFeedbackText('');
    setFeedbackStep('write');
    setFeedbackPreview(null);
    setFeedbackError(null);
  };

  const requestPreview = async () => {
    if (!feedbackTarget || !feedbackText.trim() || !tenantId) return;
    setFeedbackStep('loading');
    try {
      const result = await api('/agents/feedback', {
        method: 'POST',
        tenantId,
        body: {
          messageId: feedbackTarget.messageId,
          originalResponse: feedbackTarget.content,
          correction: feedbackText.trim(),
          conversationId: selectedId,
        },
      });
      setFeedbackPreview(result);
      setFeedbackStep('preview');
    } catch (err) {
      console.error(err);
      setFeedbackStep('write');
      setFeedbackError('No se pudo generar el preview. Intentá de nuevo.');
    }
  };

  const [regressionRunId, setRegressionRunId] = useState<string | null>(null);

  const confirmFeedback = async () => {
    if (!feedbackPreview || !tenantId) return;
    setFeedbackStep('loading');
    try {
      // Lanzar regression en vez de guardar directo
      const agent = await api('/agents/main', { tenantId });
      const oldPrompt = agent?.agentConfig?.extraInstructions || '';

      const regResult = await api('/regression/start', {
        method: 'POST', tenantId,
        body: { oldPrompt, newPrompt: feedbackPreview.proposedRules },
      });

      if (regResult.skipped) {
        // Sin goldens o cambio chico: guardar directo como antes
        await api('/agents/feedback/confirm', {
          method: 'POST', tenantId,
          body: { proposedRules: feedbackPreview.proposedRules },
        });
        setFeedbackStep('done');
        window.dispatchEvent(new Event('config-changed'));
        setTimeout(closeFeedback, 1800);
      } else {
        // Tiene goldens: mostrar modal bloqueante
        closeFeedback();
        setRegressionRunId(regResult.runId);
      }
    } catch (err) {
      console.error(err);
      setFeedbackStep('preview');
      setFeedbackError('No se pudo iniciar la verificacion. Intenta de nuevo.');
    }
  };

  const handleRegressionDone = (decision: 'apply' | 'revert') => {
    setRegressionRunId(null);
    if (decision === 'apply') {
      window.dispatchEvent(new Event('config-changed'));
    }
  };

  const updateConv = (convId: string, updates: Partial<Conversation>) => {
    setConversations(prev => prev.map(c =>
      c.conversationId === convId ? { ...c, ...updates } : c
    ));
  };

  const addTag = async (tag: string) => {
    if (!selectedConv || !tenantId || !tag.trim()) return;
    const newTags = [...new Set([...(selectedConv.tags || []), tag.trim().toLowerCase()])];
    try {
      await api(`/conversations/${selectedConv.conversationId}`, {
        method: 'PATCH', tenantId, body: { tags: newTags },
      });
      updateConv(selectedConv.conversationId, { tags: newTags });
      if (!allTags.includes(tag.trim().toLowerCase())) {
        setAllTags(prev => [...prev, tag.trim().toLowerCase()].sort());
      }
    } catch (err) { console.error(err); }
  };

  const removeTag = async (tag: string) => {
    if (!selectedConv || !tenantId) return;
    const newTags = (selectedConv.tags || []).filter(t => t !== tag);
    try {
      await api(`/conversations/${selectedConv.conversationId}`, {
        method: 'PATCH', tenantId, body: { tags: newTags },
      });
      updateConv(selectedConv.conversationId, { tags: newTags });
    } catch (err) { console.error(err); }
  };

  const toggleAssignment = async () => {
    if (!selectedConv || !tenantId) return;
    const newAssignment = selectedConv.assignedTo === 'bot' ? 'user' : 'bot';
    try {
      await api(`/conversations/${selectedConv.conversationId}`, {
        method: 'PATCH', tenantId, body: { assignedTo: newAssignment },
      });
      updateConv(selectedConv.conversationId, { assignedTo: newAssignment });
    } catch (err) { console.error(err); }
  };

  const [showVerifyPrompt, setShowVerifyPrompt] = useState(false);
  const [goldenSaving, setGoldenSaving] = useState(false);
  const [goldenSaved, setGoldenSaved] = useState(false);
  const markAsGolden = async () => {
    if (!selectedConv || !tenantId) return;
    setGoldenSaving(true);
    try {
      await api('/golden/mark', {
        method: 'POST', tenantId,
        body: { conversationId: selectedConv.conversationId },
      });
      setGoldenSaved(true);
      setTimeout(() => setGoldenSaved(false), 3000);
    } catch (err) { console.error(err); }
    setGoldenSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Conversaciones</h1>
          <p className="text-gray-500 text-sm mt-1">Gestiona todas tus conversaciones de WhatsApp</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Sin conversaciones aún</h3>
          <p className="text-gray-500 text-sm max-w-md mx-auto">
            Las conversaciones aparecerán acá cuando tus clientes te escriban por WhatsApp.
          </p>
        </div>
      </>
    );
  }

  return (
    <div className="flex h-full">
      {/* Conversation List */}
      <div className={`${selectedConv ? 'hidden md:flex' : 'flex'} w-full md:w-80 bg-white border-r border-gray-200 flex-col`}>
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Conversaciones</h2>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-gray-500">{conversations.length} conversaciones</p>
            {allTags.length > 0 && (
              <select
                value={filterTag}
                onChange={(e) => setFilterTag(e.target.value)}
                className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-0.5 text-gray-600"
              >
                <option value="">Todos los tags</option>
                {allTags.map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.filter(c => !filterTag || (c.tags || []).includes(filterTag)).map((conv) => (
            <button
              key={conv.conversationId}
              onClick={() => setSelectedConv(conv)}
              className={`w-full flex items-center gap-3 p-4 text-left border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                selectedConv?.conversationId === conv.conversationId ? 'bg-primary-50' : ''
              }`}
            >
              <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-semibold text-sm flex-shrink-0">
                {(conv.contactName?.[0] || conv.contactPhone?.[0] || '?').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {conv.contactName || conv.contactPhone}
                  </p>
                  <span className="text-xs text-gray-400">
                    {new Date(conv.lastMessageAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <p className="text-xs text-gray-500 truncate flex-1">{conv.lastMessagePreview || 'Sin mensajes'}</p>
                  <div className="flex items-center gap-1 ml-1">
                    {conv.assignedTo === 'bot' ? (
                      <span className="w-2 h-2 bg-emerald-400 rounded-full" title="Automático" />
                    ) : (
                      <span className="w-2 h-2 bg-amber-400 rounded-full" title="Manual" />
                    )}
                    {conv.unreadCount > 0 && (
                      <span className="bg-primary-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Modal de feedback */}
      {feedbackTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-6">

              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Corregir respuesta del agente</h3>
                  <div className="flex items-center gap-1.5 mt-1">
                    {(['write', 'preview'] as const).map((s, i) => (
                      <div key={s} className="flex items-center gap-1.5">
                        <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                          feedbackStep === s || (feedbackStep === 'loading' && i === 0 && !feedbackPreview) || (feedbackStep === 'done')
                            ? 'bg-primary-600 text-white'
                            : feedbackStep === 'preview' && i === 0
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-200 text-gray-500'
                        }`}>{i + 1}</span>
                        <span className="text-[10px] text-gray-400">{i === 0 ? 'Corrección' : 'Preview'}</span>
                        {i === 0 && <span className="text-gray-300 text-xs">→</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={closeFeedback} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Error */}
              {feedbackError && (
                <div className="mb-3 flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm">
                  <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                  {feedbackError}
                </div>
              )}

              {/* Respuesta original — siempre visible */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4">
                <p className="text-[10px] text-primary-600 font-medium mb-1">Respuesta incorrecta del agente</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-3">{feedbackTarget.content}</p>
              </div>

              {/* PASO 1: escribir corrección */}
              {(feedbackStep === 'write' || (feedbackStep === 'loading' && !feedbackPreview)) && (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    ¿Cuál fue el error? ¿Cómo debería haber respondido?
                  </label>
                  <textarea
                    value={feedbackText}
                    onChange={e => { setFeedbackText(e.target.value); setFeedbackError(null); }}
                    placeholder="Ej: El agente dijo que no había stock pero sí había. Debería haber consultado antes de responder."
                    rows={4}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                    autoFocus
                    disabled={feedbackStep === 'loading'}
                  />
                  <div className="flex gap-3 mt-4">
                    <button onClick={closeFeedback} className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 px-4 rounded-lg hover:bg-gray-50 transition-colors">
                      Cancelar
                    </button>
                    <button
                      onClick={requestPreview}
                      disabled={!feedbackText.trim() || feedbackStep === 'loading'}
                      className="flex-1 bg-gradient-to-r from-primary-600 to-secondary-600 text-white text-sm font-medium py-2 px-4 rounded-lg hover:from-primary-700 hover:to-secondary-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {feedbackStep === 'loading' ? (
                        <>
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Generando preview...
                        </>
                      ) : 'Ver preview →'}
                    </button>
                  </div>
                </>
              )}

              {/* PASO 2: preview */}
              {(feedbackStep === 'preview' || feedbackStep === 'done' || (feedbackStep === 'loading' && feedbackPreview)) && feedbackPreview && (
                <>
                  <div className="mb-4">
                    <p className="text-xs font-medium text-gray-500 mb-2">Así respondería el agente con la corrección aplicada:</p>
                    <div className="bg-[#dcf8c6] rounded-lg rounded-tr-none px-3 py-2.5 shadow-sm">
                      <p className="text-[10px] text-primary-600 font-medium mb-0.5">Agente IA</p>
                      <p className="text-sm text-gray-900 whitespace-pre-wrap">{feedbackPreview.previewResponse}</p>
                    </div>
                  </div>

                  {feedbackStep === 'done' ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-center gap-2 py-2 text-green-600 font-medium text-sm">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                        Correccion aplicada
                      </div>
                      <a
                        href="/dashboard/golden"
                        className="flex items-center justify-center gap-2 py-2 px-4 bg-amber-50 text-amber-700 text-xs font-medium rounded-lg border border-amber-200 hover:bg-amber-100 transition"
                      >
                        &#9888; Verificar que no se rompio nada
                      </a>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <button
                        onClick={() => { setFeedbackStep('write'); setFeedbackPreview(null); }}
                        disabled={feedbackStep === 'loading'}
                        className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium py-2 px-4 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        ← Ajustar
                      </button>
                      <button
                        onClick={confirmFeedback}
                        disabled={feedbackStep === 'loading'}
                        className="flex-1 bg-gradient-to-r from-primary-600 to-secondary-600 text-white text-sm font-medium py-2 px-4 rounded-lg hover:from-primary-700 hover:to-secondary-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {feedbackStep === 'loading' ? (
                          <>
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Guardando...
                          </>
                        ) : 'Confirmar y aplicar ✓'}
                      </button>
                    </div>
                  )}
                </>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div className={`${selectedConv ? 'flex' : 'hidden md:flex'} flex-1 flex-col bg-gray-50`}>
        {!selectedConv ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
              </svg>
              <p className="text-gray-400">Selecciona una conversacion</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="bg-white border-b border-gray-200 p-3 md:p-4 flex items-center gap-3">
              {/* Back button mobile */}
              <button onClick={() => setSelectedConv(null)} className="md:hidden text-gray-500 hover:text-gray-700">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
              </button>
              <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-semibold text-sm">
                {(selectedConv.contactName?.[0] || selectedConv.contactPhone?.[0] || '?').toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {selectedConv.contactName || selectedConv.contactPhone}
                </p>
                <p className="text-xs text-gray-500">{selectedConv.contactPhone}</p>
              </div>
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                {selectedConv.tags?.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => removeTag(tag)}
                    className="bg-primary-50 text-primary-600 text-xs px-2 py-0.5 rounded-full hover:bg-red-50 hover:text-red-600 transition-colors"
                    title="Click para quitar"
                  >
                    {tag} x
                  </button>
                ))}
                <form onSubmit={(e) => { e.preventDefault(); if (tagInput.trim()) { addTag(tagInput); setTagInput(''); } }} className="inline-flex">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="+ tag"
                    className="w-16 text-xs bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5 focus:outline-none focus:border-primary-400 focus:w-24 transition-all"
                  />
                </form>
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  selectedConv.status === 'open' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
                }`}>
                  {selectedConv.status === 'open' ? 'Abierta' : 'Cerrada'}
                </span>
                <button
                  onClick={toggleAssignment}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                    selectedConv.assignedTo === 'bot'
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  {selectedConv.assignedTo === 'bot' ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                      </svg>
                      Automático
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0" />
                      </svg>
                      Manual
                    </>
                  )}
                </button>
                <button
                  onClick={markAsGolden}
                  disabled={goldenSaving || goldenSaved}
                  className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                    goldenSaved
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100'
                  }`}
                >
                  {goldenSaved ? (
                    <>&#10003; Guardada</>
                  ) : goldenSaving ? (
                    <>Guardando...</>
                  ) : (
                    <>&#9733; Guardar como referencia</>
                  )}
                </button>
              </div>
            </div>

            {/* Messages — estilo WhatsApp */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1" style={{ backgroundColor: '#e5ddd5' }}>
              {loadingMsgs ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                messages.map((msg) => {
                  const isOutbound = msg.direction === 'outbound';
                  const isImage = msg.type === 'image';
                  const imgSrc = msg.imageUrl || (msg.imageBase64 ? `data:${msg.imageMimeType || 'image/jpeg'};base64,${msg.imageBase64}` : null);

                  const isBotMessage = isOutbound && msg.sender === 'bot';

                  return (
                    <div key={msg.messageId} className={`flex ${isOutbound ? 'justify-end' : 'justify-start'} group`}>
                      {/* Botón feedback — solo en mensajes del bot */}
                      {isBotMessage && (
                        <button
                          onClick={() => setFeedbackTarget({ messageId: msg.messageId, content: msg.content })}
                          className="self-end mb-2 mr-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 shadow-sm text-xs font-medium"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 15h2.25m8.024-9.75c.011.05.028.1.052.148.591 1.2.924 2.55.924 3.977a8.96 8.96 0 0 1-.999 4.125m.023-8.25c-.076-.365.183-.75.575-.75h.908c.889 0 1.713.518 1.972 1.368.339 1.11.521 2.287.521 3.507 0 1.553-.295 3.036-.831 4.398-.306.774-1.086 1.227-1.918 1.227h-1.053c-.472 0-.745-.556-.5-.96a8.95 8.95 0 0 0 .303-.54m.023-8.25H3.75l4.125 9m6.75-9L9.75 15" />
                          </svg>
                          Corregir
                        </button>
                      )}

                      <div className={`max-w-[75%] rounded-lg shadow-sm overflow-hidden ${
                        isOutbound
                          ? 'bg-[#dcf8c6] rounded-tr-none'
                          : 'bg-white rounded-tl-none'
                      }`}>
                        {/* Imagen */}
                        {isImage && imgSrc && (
                          <img
                            src={imgSrc}
                            alt=""
                            className="w-full max-w-[300px] h-auto object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        )}

                        {/* Texto */}
                        <div className="px-3 py-1.5">
                          {isBotMessage && !isImage && (
                            <p className="text-[10px] text-primary-600 font-medium mb-0.5">Agente IA</p>
                          )}
                          {msg.content && msg.content !== '[El cliente envio una imagen]' && (
                            <p className="text-sm text-gray-900 whitespace-pre-wrap">{msg.content}</p>
                          )}
                          <p className="text-[10px] text-gray-400 text-right mt-0.5">
                            {new Date(msg.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                            {isOutbound && msg.status === 'read' && ' ✓✓'}
                            {isOutbound && msg.status === 'delivered' && ' ✓✓'}
                            {isOutbound && msg.status === 'sent' && ' ✓'}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply Input */}
            <div className="bg-white border-t border-gray-200 p-4">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!replyText.trim() || sending || !tenantId || !selectedConv) return;
                  setSending(true);
                  try {
                    const newMsg = await api(`/conversations/${selectedConv.conversationId}/messages`, {
                      method: 'POST',
                      tenantId,
                      body: { content: replyText },
                    });
                    setMessages((prev) => [...prev, newMsg]);
                    setReplyText('');
                  } catch (err) {
                    console.error(err);
                  }
                  setSending(false);
                }}
                className="flex items-center gap-3"
              >
                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Escribí un mensaje..."
                  className="flex-1 bg-gray-50 border border-gray-300 text-gray-900 rounded-lg px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={!replyText.trim() || sending}
                  className="bg-gradient-to-r from-primary-600 to-secondary-600 text-white p-2.5 rounded-lg hover:from-primary-700 hover:to-secondary-700 transition-all disabled:opacity-50"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                  </svg>
                </button>
              </form>
            </div>
          </>
        )}
      </div>

      {/* Modal bloqueante de regression testing */}
      {regressionRunId && (
        <RegressionModal runId={regressionRunId} onDone={handleRegressionDone} />
      )}
    </div>
  );
}
