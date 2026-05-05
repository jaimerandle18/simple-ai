'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 w-full bg-gray-950/90 backdrop-blur-md z-50 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <Image src="/assets/simpleLogo1.png" alt="Simple AI" width={140} height={36} className="h-8 w-auto" />
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-gray-300 hover:text-white transition-colors">Funcionalidades</a>
            <a href="#how-it-works" className="text-sm text-gray-300 hover:text-white transition-colors">Cómo funciona</a>
            <a href="#pricing" className="text-sm text-gray-300 hover:text-white transition-colors">Precios</a>
          </div>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/login" className="text-sm text-gray-300 hover:text-white transition-colors px-4 py-2">
              Iniciar sesión
            </Link>
            <Link href="/login" className="text-sm bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 transition-colors font-medium">
              Empezar gratis
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              {mobileOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && (
          <div className="md:hidden pb-4 border-t border-gray-800 pt-4">
            <div className="flex flex-col gap-3">
              <a href="#features" className="text-sm text-gray-300 px-2 py-1" onClick={() => setMobileOpen(false)}>Funcionalidades</a>
              <a href="#how-it-works" className="text-sm text-gray-300 px-2 py-1" onClick={() => setMobileOpen(false)}>Cómo funciona</a>
              <a href="#pricing" className="text-sm text-gray-300 px-2 py-1" onClick={() => setMobileOpen(false)}>Precios</a>
              <Link href="/login" className="text-sm text-center bg-primary-600 text-white px-4 py-2 rounded-lg font-medium">
                Empezar gratis
              </Link>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
