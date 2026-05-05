'use client';

import ReactMarkdown from 'react-markdown';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
  senderLabel?: string;
}

export function ChatMessage({ role, content, senderLabel }: ChatMessageProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] bg-primary-600 text-white px-4 py-3 rounded-2xl rounded-br-md text-sm">
          <p>{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] bg-white border border-gray-200 text-gray-900 px-4 py-3 rounded-2xl rounded-bl-md shadow-sm text-sm">
        {senderLabel && (
          <p className="text-[10px] text-primary-500 font-medium mb-1">{senderLabel}</p>
        )}
        <div className="prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-strong:text-gray-900 prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline prose-img:rounded-lg prose-img:my-2">
          <ReactMarkdown
            components={{
              a: ({ href, children }) => (
                <a href={href || '#'} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-600 font-medium hover:underline">
                  {children}
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                  </svg>
                </a>
              ),
              img: ({ src, alt }) => (
                <img src={src || ''} alt={alt || ''} className="rounded-lg max-h-48 object-cover" />
              ),
              ul: ({ children }) => (
                <div className="space-y-2 my-2">{children}</div>
              ),
              li: ({ children }) => (
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  {children}
                </div>
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
