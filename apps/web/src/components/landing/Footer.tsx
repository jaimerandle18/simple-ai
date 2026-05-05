import Link from 'next/link';
import Image from 'next/image';

export function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-400 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid md:grid-cols-4 gap-8 mb-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <Image src="/assets/simpleLogo1.png" alt="Simple AI" width={140} height={36} className="h-8 w-auto" />
            </div>
            <p className="text-sm max-w-sm">
              Automatiza tus conversaciones de WhatsApp con inteligencia artificial.
              Más ventas, menos esfuerzo.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4">Producto</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#features" className="hover:text-white transition-colors">Funcionalidades</a></li>
              <li><a href="#pricing" className="hover:text-white transition-colors">Precios</a></li>
              <li><a href="#how-it-works" className="hover:text-white transition-colors">Cómo funciona</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-semibold text-sm mb-4">Soporte</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="mailto:soporte@simpleai.com" className="hover:text-white transition-colors">Contacto</a></li>
              <li><Link href="/terms" className="hover:text-white transition-colors">Términos y condiciones</Link></li>
              <li><Link href="/privacy" className="hover:text-white transition-colors">Política de privacidad</Link></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-8 text-sm text-center">
          <p>&copy; {new Date().getFullYear()} Simple AI. Todos los derechos reservados.</p>
        </div>
      </div>
    </footer>
  );
}
