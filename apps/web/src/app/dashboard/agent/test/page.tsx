'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import Link from 'next/link';

interface ChatImage {
  url: string;
  caption: string;
  name: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  images?: ChatImage[];
}

export default function AgentTestPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [recentProductNames, setRecentProductNames] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading || !tenantId) return;

    const userMsg: Message = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = [...messages, userMsg].map(m => ({
        role: m.role,
        content: m.content,
      }));

      const res = await api('/agents/test-chat', {
        method: 'POST',
        tenantId,
        body: {
          message: userMsg.content,
          history,
          recentProductNames,
        },
      });

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: res.reply,
        images: res.images || [],
      }]);

      if (res.productNames?.length > 0) {
        setRecentProductNames(res.productNames);
      }
    } catch (err: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: 'Error: ' + err.message }]);
    }

    setLoading(false);
  };

  const handleReset = () => {
    setMessages([]);
    setRecentProductNames([]);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header — estilo WhatsApp */}
      <div className="bg-[#075e54] p-3 flex items-center gap-3">
        <Link href="/dashboard/agent" className="text-white/70 hover:text-white">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div className="w-10 h-10 bg-[#25d366] rounded-full flex items-center justify-center text-white font-bold text-sm">
          AI
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">Chat de prueba</p>
          <p className="text-xs text-white/60">Simula la conversación de WhatsApp</p>
        </div>
        <button
          onClick={handleReset}
          className="text-white/70 hover:text-white text-xs border border-white/30 rounded px-2 py-1"
        >
          Reset
        </button>
      </div>

      {/* Messages — fondo WhatsApp */}
      <div
        className="flex-1 overflow-y-auto p-4 space-y-2"
        style={{ backgroundColor: '#e5ddd5' }}
      >
        {messages.length === 0 && (
          <div className="text-center py-16">
            <div className="bg-white/80 rounded-lg px-6 py-4 inline-block shadow-sm">
              <p className="text-gray-600 text-sm">Escribí un mensaje para probar tu agente</p>
              <p className="text-gray-400 text-xs mt-1">Funciona igual que por WhatsApp</p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {/* Text bubble */}
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 shadow-sm text-sm whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-[#dcf8c6] text-gray-900 rounded-tr-none'
                    : 'bg-white text-gray-900 rounded-tl-none'
                }`}
              >
                {msg.content}
              </div>
            </div>

            {/* Images — estilo WhatsApp */}
            {msg.images && msg.images.length > 0 && (
              <div className="flex flex-col gap-1 mt-1">
                {msg.images.map((img, j) => (
                  <div key={j} className="flex justify-start">
                    <div className="max-w-[80%] bg-white rounded-lg shadow-sm overflow-hidden">
                      <img
                        src={img.url}
                        alt={img.name || 'Producto'}
                        className="w-full max-w-[300px] h-auto object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      {img.caption && (
                        <div className="px-3 py-2 text-sm text-gray-900 whitespace-pre-wrap">
                          {img.caption.replace(/\*/g, '')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white rounded-lg rounded-tl-none shadow-sm px-4 py-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input — estilo WhatsApp */}
      <div className="bg-[#f0f0f0] p-2">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Escribí un mensaje..."
            className="flex-1 bg-white border-none text-gray-900 rounded-full px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#075e54]"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="bg-[#075e54] text-white p-2.5 rounded-full hover:bg-[#064e46] transition-all disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
