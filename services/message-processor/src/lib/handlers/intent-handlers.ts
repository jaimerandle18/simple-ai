/**
 * Intent handlers — preparan contexto para generateResponse según el intent.
 * Cada handler decide: qué productos mostrar, cuántos, qué instrucciones darle al redactor.
 * La IA NUNCA decide qué productos mostrar. El código decide. La IA solo redacta.
 */
import type { ClassifierResult, Intent } from '../classifier/intent-classifier';

const COLOR_ALIASES: Record<string, string[]> = {
  negro: ['negro', 'black'], blanco: ['blanco', 'white', 'bone', 'crudo', 'ecru'],
  marron: ['marron', 'brown', 'camel', 'coffee'], azul: ['azul', 'blue', 'sky', 'celeste', 'navy'],
  gris: ['gris', 'grey', 'gray'], verde: ['verde', 'green'],
  rojo: ['rojo', 'red', 'bordo', 'merlot'], rosa: ['rosa', 'pink'],
  beige: ['beige', 'arena', 'nude'], amarillo: ['amarillo', 'yellow', 'mustard'],
  naranja: ['naranja', 'orange', 'oxide'],
  oscuro: ['negro', 'black', 'marron', 'brown', 'gris', 'grey', 'navy', 'dark', 'coffee', 'oxide'],
  claro: ['blanco', 'white', 'bone', 'crudo', 'ecru', 'beige', 'sky', 'celeste', 'mustard'],
};

function normalizeColorAliases(color: string): string[] {
  const c = color.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [key, aliases] of Object.entries(COLOR_ALIASES)) {
    if (aliases.includes(c) || key === c) return aliases;
  }
  return [c];
}

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
  searchCatalogFn: (query: string, catalog: any[], filters?: any) => any[];
}): HandlerContext {
  const { classification, catalog, recentProducts, cart, searchCatalogFn } = args;
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
      let sorted = catalog.filter((p: any) => p.priceNum > 0);

      // Apply category filter — fuzzy plural/singular
      if (filters.category) {
        const catLower = filters.category.toLowerCase();
        const catVariants = [catLower];
        if (catLower.endsWith('s')) catVariants.push(catLower.slice(0, -1));
        if (catLower.endsWith('es')) catVariants.push(catLower.slice(0, -2));
        const filtered = sorted.filter((p: any) => {
          const name = (p.name || '').toLowerCase();
          const cat = (p.category || '').toLowerCase();
          return catVariants.some(v => name.includes(v) || cat.includes(v));
        });
        console.log(`[HANDLER price_check] category="${catLower}" pool: ${sorted.length} → ${filtered.length}`);
        if (filtered.length > 0) sorted = filtered;
      }

      // Apply color filter (from merged conversation filters)
      if (filters.color) {
        const colorAliases = normalizeColorAliases(filters.color);
        const filtered = sorted.filter((p: any) => {
          const name = (p.name || '').toLowerCase();
          const variants = (p.variants || []) as any[];
          if (colorAliases.some(c => name.includes(c))) return true;
          return variants.some((v: any) => colorAliases.some(c => (v.option0 || '').toLowerCase().includes(c)));
        });
        console.log(`[HANDLER price_check] color="${filters.color}" pool: ${sorted.length} → ${filtered.length}`);
        if (filtered.length > 0) sorted = filtered;
      }

      // Apply size filter — only products with this size in stock
      if (filters.size) {
        const sizeUpper = filters.size.toUpperCase();
        const filtered = sorted.filter((p: any) => {
          const sizes: string[] = (p.sizes || []).map((s: string) => s.toUpperCase());
          const oos: string[] = (p.outOfStockSizes || []).map((s: string) => s.toUpperCase());
          return sizes.includes(sizeUpper) && !oos.includes(sizeUpper);
        });
        console.log(`[HANDLER price_check] size="${filters.size}" pool: ${sorted.length} → ${filtered.length}`);
        if (filtered.length > 0) sorted = filtered;
      }

      if (range === 'cheap' || range === 'lowest') {
        sorted.sort((a, b) => a.priceNum - b.priceNum);
      } else if (range === 'expensive' || range === 'max') {
        sorted.sort((a, b) => b.priceNum - a.priceNum);
      }

      const winner = sorted[0];
      const activeFilterDesc = [filters.color, filters.size, filters.category].filter(Boolean).join(', ');
      if (winner) console.log(`[HANDLER price_check] filters=[${activeFilterDesc}] winner="${winner.name}" price=$${winner.priceNum}`);
      return {
        productsToShow: winner ? [winner] : [],
        maxPhotos: 1,
        redactorInstruction: winner
          ? `Mostra SOLO este producto: "${winner.name}". Es el ${range === 'cheap' || range === 'lowest' ? 'mas barato' : 'mas caro'}${filters.category ? ' de ' + filters.category : ''}. Da detalles (material, talles). NO muestres otros. NO digas "solo tengo este". El cliente pidio UNO, devuelve UNO naturalmente. El caption ya tiene nombre+precio.`
          : `No se encontro un producto${filters.category ? ' en ' + filters.category : ''} que matchee. Deci honestamente que no tenes y ofrece alternativas.`,
        complexity: 'followup',
        needsToolSearch: false,
      };
    }

    case 'product_search': {
      // Search with extracted filters — CODE decides what to show, not AI
      // Query: use hints or category. If only color filter, use empty query to get all colored products.
      const hints = (filters.productNameHints || []).filter(Boolean);
      const query = hints.length > 0 ? hints.join(' ') : (filters.category || '');
      const searchResults = searchCatalogFn(query, catalog, {
        categoria: filters.category || undefined,
        color: filters.color || undefined,
        talle: filters.size || undefined,
      });
      const topResults = searchResults.slice(0, 3);
      console.log(`[HANDLER] product_search: query="${query}" filters=${JSON.stringify({color: filters.color, size: filters.size, category: filters.category})} → ${searchResults.length} results, showing ${topResults.length}`);

      if (topResults.length === 0) {
        return {
          productsToShow: [],
          maxPhotos: 0,
          redactorInstruction: `No hay productos con los filtros pedidos (${JSON.stringify(filters)}). Deci honestamente que no tenes eso y ofrece alternativas (otro color, otro talle, otra categoria).`,
          complexity: 'followup',
          needsToolSearch: false,
        };
      }

      const names = topResults.map((p: any) => p.name);
      return {
        productsToShow: topResults,
        maxPhotos: 3,
        redactorInstruction: `Mostra estos ${topResults.length} productos. NOMBRA cada uno EXACTO: ${names.map(n => `"${n}"`).join(', ')}. NO repitas precio ni descripcion (van en el caption). Usa formato INTRO/CIERRE.`,
        complexity: 'followup',
        needsToolSearch: false,
      };
    }

    case 'product_specific': {
      // Search for the specific product
      const hints = filters.productNameHints || [];
      const specificQuery = hints.join(' ') || args.userMessage;
      const specificResults = searchCatalogFn(specificQuery, catalog, {
        categoria: filters.category || undefined,
      });
      const match = specificResults[0] || recentProducts.find((p: any) =>
        hints.some(h => p.name.toLowerCase().includes(h.toLowerCase()))
      );

      if (!match) {
        return {
          productsToShow: [],
          maxPhotos: 0,
          redactorInstruction: 'No encontre el producto que pidio. Deci honestamente y ofrece buscar otra cosa.',
          complexity: 'followup',
          needsToolSearch: false,
        };
      }

      // Stock check if client mentioned a size
      const specSize = (filters.size || '').toUpperCase();
      let stockNote = '';
      if (specSize) {
        const pSizes: string[] = (match.sizes || []).map((s: string) => s.toUpperCase());
        const pOos: string[] = (match.outOfStockSizes || []).map((s: string) => s.toUpperCase());
        const availSizes = pSizes.filter((s: string) => !pOos.includes(s));
        const isOos = pOos.includes(specSize);

        console.log(`[STOCK_CHECK] product="${match.name}" size=${specSize} outOfStock=${isOos} available=[${availSizes.join(',')}]`);

        if (isOos) {
          stockNote = `\n\nIMPORTANTE: El talle ${specSize} esta AGOTADO en "${match.name}". NO digas que esta disponible. Talles con stock: ${availSizes.join(', ') || 'ninguno'}. Ofrece alternativas.`;
        } else if (pSizes.includes(specSize)) {
          stockNote = `\n\nTalle ${specSize} DISPONIBLE en "${match.name}".`;
        }
      }

      return {
        productsToShow: [match],
        maxPhotos: 1,
        redactorInstruction: `Da detalles de "${match.name}" (material, talles disponibles, por que lo recomendas). El caption ya tiene nombre+precio, complementa con info nueva.${stockNote}`,
        complexity: 'followup',
        needsToolSearch: false,
      };
    }

    case 'product_followup': {
      // If client mentions a size, check stock for the most likely product
      const followupSize = (filters.size || '').toUpperCase();
      let followupInstruction = 'Responde sobre los productos que ya se mostraron.';

      if (followupSize && recentProducts.length > 0) {
        // Check stock for each recent product
        const stockInfo = recentProducts.map((p: any) => {
          const pSizes: string[] = (p.sizes || []).map((s: string) => s.toUpperCase());
          const pOos: string[] = (p.outOfStockSizes || []).map((s: string) => s.toUpperCase());
          const isOos = pOos.includes(followupSize);
          const exists = pSizes.includes(followupSize);
          const available = pSizes.filter((s: string) => !pOos.includes(s));
          return { name: p.name, isOos, exists, available };
        });

        const stockSummary = stockInfo.map(s => {
          if (s.isOos) return `"${s.name}": talle ${followupSize} AGOTADO. Disponibles: ${s.available.join(', ') || 'ninguno'}`;
          if (s.exists) return `"${s.name}": talle ${followupSize} DISPONIBLE`;
          return `"${s.name}": talle ${followupSize} no existe. Talles: ${s.available.join(', ')}`;
        }).join('\n');

        console.log(`[STOCK_CHECK] followup size=${followupSize} products=${stockInfo.map(s => `${s.name}:${s.isOos ? 'OOS' : 'OK'}`).join(', ')}`);
        followupInstruction = `STOCK del talle ${followupSize} en productos recientes:\n${stockSummary}\n\nSI esta agotado, NO digas que esta disponible. Ofrece alternativas.`;
      }

      return {
        productsToShow: recentProducts,
        maxPhotos: 0,
        redactorInstruction: followupInstruction,
        complexity: 'followup',
        needsToolSearch: false,
      };
    }

    case 'size_check': {
      const askedSize = (filters.size || '').toUpperCase();
      const product = recentProducts[0]; // last shown product

      if (!product || !askedSize) {
        return {
          productsToShow: recentProducts,
          maxPhotos: 0,
          redactorInstruction: `El cliente pregunta por talle ${askedSize || '?'}. No hay producto reciente en contexto. Pregunta que producto le interesa.`,
          complexity: 'followup',
          needsToolSearch: false,
        };
      }

      const sizes: string[] = (product.sizes || []).map((s: string) => s.toUpperCase());
      const outOfStock: string[] = (product.outOfStockSizes || []).map((s: string) => s.toUpperCase());
      const availableSizes = sizes.filter((s: string) => !outOfStock.includes(s));
      const isOutOfStock = outOfStock.includes(askedSize);
      const existsInLine = sizes.includes(askedSize);

      console.log(`[STOCK_CHECK] product="${product.name}" size=${askedSize} exists=${existsInLine} outOfStock=${isOutOfStock} available=[${availableSizes.join(',')}]`);

      if (isOutOfStock) {
        return {
          productsToShow: [product],
          maxPhotos: 0,
          redactorInstruction: `IMPORTANTE: El talle ${askedSize} esta AGOTADO en "${product.name}". NO digas que esta disponible. Talles disponibles: ${availableSizes.join(', ') || 'ninguno'}. Ofrece alternativas amablemente.`,
          complexity: 'followup',
          needsToolSearch: false,
        };
      }

      if (!existsInLine) {
        return {
          productsToShow: [product],
          maxPhotos: 0,
          redactorInstruction: `El talle ${askedSize} NO existe en "${product.name}". Talles de este producto: ${sizes.join(', ')}. Informa y ofrece los disponibles.`,
          complexity: 'followup',
          needsToolSearch: false,
        };
      }

      // Size available
      return {
        productsToShow: [product],
        maxPhotos: 0,
        redactorInstruction: `Talle ${askedSize} DISPONIBLE en "${product.name}". Confirma y pregunta si quiere proceder con la compra.`,
        complexity: 'followup',
        needsToolSearch: false,
      };
    }

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
