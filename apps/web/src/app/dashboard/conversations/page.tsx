'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';

interface Conversation {
  conversationId: string;
  contactPhone: string;
  contactName?: string;
  status: string;
  tags: string[];
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
}

export default function ConversationsPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tenantId) return;
    api('/conversations', { tenantId })
      .then(setConversations)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(() => {
    if (!selectedConv || !tenantId) return;
    setLoadingMsgs(true);
    api(`/conversations/${selectedConv.conversationId}/messages`, { tenantId })
      .then(setMessages)
      .catch(console.error)
      .finally(() => setLoadingMsgs(false));
  }, [selectedConv, tenantId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Polling for new messages
  useEffect(() => {
    if (!selectedConv || !tenantId) return;
    const interval = setInterval(() => {
      api(`/conversations/${selectedConv.conversationId}/messages`, { tenantId })
        .then(setMessages)
        .catch(console.error);
      api('/conversations', { tenantId })
        .then(setConversations)
        .catch(console.error);
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedConv, tenantId]);

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
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Conversaciones</h2>
          <p className="text-xs text-gray-500 mt-0.5">{conversations.length} conversaciones</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conv) => (
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
                  <p className="text-xs text-gray-500 truncate">{conv.lastMessagePreview || 'Sin mensajes'}</p>
                  {conv.unreadCount > 0 && (
                    <span className="bg-primary-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col bg-gray-50">
        {!selectedConv ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
              </svg>
              <p className="text-gray-400">Seleccioná una conversación</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <div className="bg-white border-b border-gray-200 p-4 flex items-center gap-3">
              <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-semibold text-sm">
                {(selectedConv.contactName?.[0] || selectedConv.contactPhone?.[0] || '?').toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {selectedConv.contactName || selectedConv.contactPhone}
                </p>
                <p className="text-xs text-gray-500">{selectedConv.contactPhone}</p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {selectedConv.tags?.map((tag) => (
                  <span key={tag} className="bg-primary-50 text-primary-600 text-xs px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
                <span className={`text-xs px-2 py-0.5 rounded-full ${
                  selectedConv.status === 'open' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-500'
                }`}>
                  {selectedConv.status === 'open' ? 'Abierta' : 'Cerrada'}
                </span>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loadingMsgs ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                messages.map((msg) => (
                  <div key={msg.messageId} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] px-4 py-2 rounded-2xl text-sm ${
                      msg.direction === 'outbound'
                        ? msg.sender === 'bot'
                          ? 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white rounded-br-md'
                          : 'bg-primary-600 text-white rounded-br-md'
                        : 'bg-white border border-gray-200 text-gray-900 rounded-bl-md shadow-sm'
                    }`}>
                      {msg.sender === 'bot' && msg.direction === 'outbound' && (
                        <p className="text-[10px] opacity-70 mb-1">Bot IA</p>
                      )}
                      <p>{msg.content}</p>
                      <p className={`text-[10px] mt-1 text-right ${
                        msg.direction === 'outbound' ? 'opacity-70' : 'text-gray-400'
                      }`}>
                        {new Date(msg.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))
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
    </div>
  );
}
