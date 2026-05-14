/**
 * Intent handlers — preparan contexto para generateResponse según el intent.
 * Cada handler decide: qué productos mostrar, cuántos, qué instrucciones darle al redactor.
 * La IA NUNCA decide qué productos mostrar. El código decide. La IA solo redacta.
 */
import type { ClassifierResult, Intent } from '../classifier/intent-classifier';

export interface HandlerContext {
  // Productos que el redactor debe mencionar (ya filtrados y ordenados por código)
  productsToShow: any[];
  // Máximo de fotos a enviar
  maxPhotos: number;
  // Instrucción extra para el redactor (se inyecta en el prompt)
  redactorInstruction: string;
  // Complejidad para elegir modelo
  complexity: 'trivial' | 'followup' | 'new_query';
  // Si debe buscar con buscar_productos (tool call) o ya tiene los productos
  needsToolSearch: boolean;
  // Filtros extraídos para pasar a searchCatalog
  searchFilters?: { color?: string; talle?: string; categoria?: string };
}

export function handleIntent(args: {
  classification: ClassifierResult;
  catalog: any[];
  recentProducts: any[];
  cart: any[];
  userMessage: string;
}): HandlerContext {
  const { classification, catalog, recentProducts, cart } = args;
  const intent = classification.primary_intent;
  const filters = classification.extracted_filters || {};

  switch (intent) {
    case 'greeting':
      return {
        productsToShow: [],
        maxPhotos: 0,
        redactorInstruction: 'Saluda al cliente, presentate con tu nombre, y pregunta qué busca. Max 2 lineas.',
        complexity: 'trivial',
        needsToolSearch: false,
      };

    case 'small_talk':
      return {
        productsToShow: [],
        maxPhotos: 0,
        redactorInstruction: 'Responde CORTO sin volver a presentarte. "De nada", "Dale", "Cuando quieras", "Genial". Max 1 linea. NO re-saludes.',
        complexity: 'trivial',
        needsToolSearch: false,
      };

    case 'price_check': {
      const range = filters.priceRange;
      let sorted = catalog.filter(p => p.priceNum > 0);

      // Apply category filter if extracted
      if (filters.category) {
        const catLower = filters.category.toLowerCase();
        const filtered = sorted.filter(p =>
          (p.category || '').toLowerCase().includes(catLower) ||
          (p.name || '').toLowerCase().includes(catLower)
        );
        if (filtered.length > 0) sorted = filtered;
      }

      if (range === 'cheap' || range === 'lowest') {
        sorted.sort((a, b) => a.priceNum - b.priceNum);
      } else if (range === 'expensive' || range === 'max') {
        sorted.sort((a, b) => b.priceNum - a.priceNum);
      }

      const winner = sorted[0];
      return {
        productsToShow: winner ? [winner] : [],
        maxPhotos: 1,
        redactorInstruction: winner
          ? `Mostra SOLO este producto: "${winner.name}". Da detalles (material, talles). NO muestres otros. El caption de la foto ya tiene nombre+precio, no los repitas en el texto. Usa formato INTRO/CIERRE.`
          : 'No se encontro un producto que matchee. Deci honestamente que no tenes y ofrece alternativas.',
        complexity: 'followup',
        needsToolSearch: false,
      };
    }

    case 'product_search':
      return {
        productsToShow: [], // se cargan via tool call
        maxPhotos: 3,
        redactorInstruction: 'Mostra MAXIMO 3 productos. NOMBRA cada uno en el texto para que se envien las fotos. NO repitas precio ni descripcion (van en el caption). Usa formato INTRO/CIERRE.',
        complexity: 'new_query',
        needsToolSearch: true,
        searchFilters: {
          color: filters.color || undefined,
          talle: filters.size || undefined,
          categoria: filters.category || undefined,
        },
      };

    case 'product_specific':
      return {
        productsToShow: [], // se busca via tool
        maxPhotos: 1,
        redactorInstruction: 'Da detalles del producto especifico que pidio (material, talles, por que lo recomendas). El caption ya tiene nombre+precio, complementa con info nueva.',
        complexity: 'new_query',
        needsToolSearch: true,
        searchFilters: {
          categoria: filters.category || undefined,
        },
      };

    case 'product_followup':
      return {
        productsToShow: recentProducts,
        maxPhotos: 3,
        redactorInstruction: 'Responde sobre los productos que ya se mostraron. Si pide otro color/talle, busca con la tool.',
        complexity: 'followup',
        needsToolSearch: false,
      };

    case 'size_check':
      return {
        productsToShow: recentProducts,
        maxPhotos: 0,
        redactorInstruction: `El cliente pregunta por talle ${filters.size || ''}. Verifica disponibilidad en PRODUCTOS_DISPONIBLES y responde con los que tienen ese talle.`,
        complexity: 'followup',
        needsToolSearch: false,
      };

    case 'purchase_intent':
      return {
        productsToShow: recentProducts,
        maxPhotos: 0,
        redactorInstruction: 'El cliente quiere comprar. Usa agregar_al_carrito (pedi talle/color si falta) y despues generar_link_compra. NUNCA pidas nombre/direccion/telefono.',
        complexity: 'new_query',
        needsToolSearch: false,
      };

    case 'purchase_confirm':
      return {
        productsToShow: recentProducts,
        maxPhotos: 0,
        redactorInstruction: 'El cliente confirmo la compra. Usa agregar_al_carrito si no se agrego todavia, y despues generar_link_compra. NUNCA pidas datos personales. NUNCA inventes URLs.',
        complexity: 'followup',
        needsToolSearch: false,
      };

    case 'business_info':
      return {
        productsToShow: [],
        maxPhotos: 0,
        redactorInstruction: 'Responde con la info del negocio que tengas (horarios, direccion, contacto). Si no tenes el dato, deci que no lo sabes.',
        complexity: 'followup',
        needsToolSearch: false,
      };

    case 'shipping_info':
      return {
        productsToShow: [],
        maxPhotos: 0,
        redactorInstruction: 'Responde sobre envios con la info disponible.',
        complexity: 'followup',
        needsToolSearch: false,
      };

    case 'payment_info':
      return {
        productsToShow: [],
        maxPhotos: 0,
        redactorInstruction: 'Responde sobre metodos de pago y cuotas con la info disponible.',
        complexity: 'followup',
        needsToolSearch: false,
      };

    case 'returns_info':
      return {
        productsToShow: [],
        maxPhotos: 0,
        redactorInstruction: 'Responde sobre cambios, devoluciones y garantia con la info disponible.',
        complexity: 'followup',
        needsToolSearch: false,
      };

    case 'human_escalation':
      return {
        productsToShow: [],
        maxPhotos: 0,
        redactorInstruction: 'El cliente quiere hablar con un humano o esta enojado. Responde: "Te paso con alguien del equipo."',
        complexity: 'followup',
        needsToolSearch: false,
      };

    case 'off_topic':
      return {
        productsToShow: [],
        maxPhotos: 0,
        redactorInstruction: 'La pregunta no esta relacionada con el negocio. Responde amablemente que solo podes ayudar con temas del negocio.',
        complexity: 'trivial',
        needsToolSearch: false,
      };

    default: // unclear
      return {
        productsToShow: [],
        maxPhotos: 3,
        redactorInstruction: 'No quedo claro que necesita. Pregunta amablemente que busca.',
        complexity: 'new_query',
        needsToolSearch: true,
      };
  }
}
