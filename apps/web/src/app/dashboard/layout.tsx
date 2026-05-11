'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { redirect } from 'next/navigation';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { VerificationBanner } from '@/components/dashboard/VerificationBanner';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    redirect('/login');
  }

  return (
    <div className="h-screen bg-gray-50">
      {/* Overlay mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Header mobile */}
      <div className="md:hidden fixed top-0 left-0 right-0 bg-gray-900 z-20 flex items-center gap-3 px-4 py-3">
        <button onClick={() => setSidebarOpen(true)} className="text-white">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
        <img src="/assets/simpleLogo1.png" alt="Simple AI" className="h-6 w-auto" />
      </div>

      <div className="md:ml-64 h-full flex flex-col pt-14 md:pt-0">
        <VerificationBanner />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
