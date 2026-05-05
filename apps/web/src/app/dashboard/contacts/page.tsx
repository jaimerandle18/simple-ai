'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';

interface Contact {
  phone: string;
  name?: string;
  tags: string[];
  totalConversations: number;
  lastConversationAt?: string;
  createdAt: string;
}

export default function ContactsPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    api('/contacts', { tenantId })
      .then(setContacts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Contactos</h1>
        <p className="text-gray-500 text-sm mt-1">
          {contacts.length} contacto{contacts.length !== 1 ? 's' : ''} registrado{contacts.length !== 1 ? 's' : ''}
        </p>
      </div>

      {contacts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Sin contactos aún</h3>
          <p className="text-gray-500 text-sm max-w-md mx-auto">
            Los contactos se crean automáticamente cuando alguien te escribe por WhatsApp.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Contacto</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Teléfono</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Tags</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Conversaciones</th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase px-6 py-3">Último contacto</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.phone} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-semibold text-sm">
                        {(contact.name?.[0] || contact.phone?.[0] || '?').toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-gray-900">{contact.name || contact.phone}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{contact.phone}</td>
                  <td className="px-6 py-4">
                    <div className="flex gap-1">
                      {contact.tags?.map((tag) => (
                        <span key={tag} className="bg-primary-50 text-primary-600 text-xs px-2 py-0.5 rounded-full">
                          {tag}
                        </span>
                      ))}
                      {(!contact.tags || contact.tags.length === 0) && (
                        <span className="text-xs text-gray-400">Sin tags</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{contact.totalConversations || 0}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {contact.lastConversationAt
                      ? new Date(contact.lastConversationAt).toLocaleDateString('es-AR')
                      : '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
