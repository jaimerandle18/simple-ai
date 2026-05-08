/**
 * Guardrails: validación post-respuesta + cache FAQ + function calling para datos críticos
 */

// ========== 1. CACHE FAQ: Respuestas fijas sin LLM ==========

interface FaqEntry {
  patterns: RegExp[];
  response: (config: any) => string | null; // null = no cacheable, pasar al LLM
}

const FAQ_CACHE: FaqEntry[] = [
  {
    // "hacen envíos?" "envían?" "mandan a domicilio?"
    patterns: [/hac[eé]n?\s*env[ií]o/i, /env[ií]an/i, /mand[aá]n?\s*(a\s*domicilio)?/i, /llegan?\s*a/i],
    response: (config) => {
      if (config.extraInstructions?.includes('envío') || config.extraInstructions?.includes('envio')) {
        return null; // tiene data custom, que el LLM la use
      }
      const web = config.websiteUrl || 'la web';
      return `Sí, hacemos envíos. Los costos y tiempos los podés ver al finalizar la compra en ${web}. ¿A qué zona sería?`;
    },
  },
  {
    // "medios de pago" "cómo se paga" "aceptan transferencia" "mercadopago"
    patterns: [/c[oó]mo\s*(se\s*)?pag/i, /medios?\s*de\s*pago/i, /aceptan/i, /mercado\s*pago/i, /transferencia/i],
    response: (config) => {
      if (config.extraInstructions?.includes('pago')) return null; // data custom
      const web = config.websiteUrl || 'la web';
      return `Los medios de pago los ves al momento de la compra en ${web}. ¿Necesitás algo más?`;
    },
  },
  {
    // "horario" "a qué hora" "están abiertos"
    patterns: [/horario/i, /a\s*qu[eé]\s*hora/i, /est[aá]n?\s*abierto/i, /atiend/i],
    response: (config) => {
      if (config.businessHours) return `Nuestro horario: ${config.businessHours}`;
      return null;
    },
  },
  {
    // "dónde están" "dirección" "local"
    patterns: [/d[oó]nde\s*(est[aá]n|quedan)/i, /direcci[oó]n/i, /local\s*f[ií]sico/i],
    response: (config) => {
      if (config.extraInstructions?.includes('dirección') || config.extraInstructions?.includes('local')) return null;
      const web = config.websiteUrl || 'la web';
      return `Para ver nuestra ubicación entrá a ${web}. ¿Necesitás algo más?`;
    },
  },
];

export function checkFaqCache(message: string, agentConfig: any): string | null {
  const msg = message.toLowerCase();
  // Solo cachear mensajes cortos y simples (FAQ reales)
  if (msg.length > 80) return null;

  for (const faq of FAQ_CACHE) {
    for (const pattern of faq.patterns) {
      if (pattern.test(msg)) {
        const response = faq.response(agentConfig);
        if (response) {
          console.log('FAQ cache hit');
          return response;
        }
      }
    }
  }
  return null;
}

// ========== 2. GUARDRAILS: Validación post-respuesta ==========

interface GuardrailResult {
  valid: boolean;
  issues: string[];
  cleanedResponse?: string;
}

export function validateResponse(
  response: string,
  products: any[],
  agentConfig: any,
): GuardrailResult {
  const issues: string[] = [];
  let cleaned = response;

  // 2a. Detectar precios inventados
  const priceRegex = /\$[\d.,]+/g;
  const mentionedPrices = response.match(priceRegex) || [];
  const realPrices = products.map(p => p.price).filter(Boolean);

  for (const price of mentionedPrices) {
    const normalized = price.replace(/[$.]/g, '').replace(',', '.');
    const isReal = realPrices.some(rp => {
      const rpNorm = rp.replace(/[$.]/g, '').replace(',', '.');
      return rpNorm === normalized || rp.includes(price.replace('$', ''));
    });
    if (!isReal && products.length > 0) {
      issues.push(`Precio posiblemente inventado: ${price}`);
    }
  }

  // 2b. Detectar productos inventados (nombres que no están en el catálogo)
  // Solo chequear si la respuesta menciona productos con formato *nombre*
  const boldProducts = response.match(/\*\*([^*]+)\*\*/g) || response.match(/\*([^*]+)\*/g) || [];
  for (const bp of boldProducts) {
    const name = bp.replace(/\*/g, '').toLowerCase();
    if (name.length < 5) continue;
    const exists = products.some(p => {
      const pName = (p.name || '').toLowerCase();
      // Match parcial: al menos 2 palabras del nombre coinciden
      const nameWords = name.split(/\s+/).filter((w: string) => w.length > 3);
      const pWords = pName.split(/\s+/);
      const matchCount = nameWords.filter((nw: string) => pWords.some((pw: string) => pw.includes(nw) || nw.includes(pw))).length;
      return matchCount >= 2 || pName.includes(name) || name.includes(pName);
    });
    if (!exists && products.length > 0) {
      issues.push(`Producto posiblemente inventado: ${bp}`);
    }
  }

  // 2c. Limpiar formato markdown que WA no soporta
  cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2'); // [text](url) → url
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '*$1*'); // **bold** → *bold* (WA format)
  cleaned = cleaned.replace(/#{1,3}\s/g, ''); // quitar headers markdown

  // 2d. Detectar deflección (no tengo / andá a la web) cuando SÍ hay productos
  if (products.length > 0) {
    const deflectionPatterns = [
      /no\s*(tengo|tenemos|manejo|cuento\s*con)\s*(ese|eso|est)/i,
      /pod[eé]s\s*(mirar|ver|fijarte)\s*(en\s*)?(la\s*)?(web|p[aá]gina)/i,
      /te\s*(dejo|paso)\s*(el\s*)?link\s*(de\s*)?(la\s*)?(web|p[aá]gina)/i,
      /entr[aá]\s*a\s*(la\s*)?(web|p[aá]gina)/i,
      /fijate\s*en\s*(la\s*)?(web|p[aá]gina)/i,
      /te\s*recomiendo\s*que\s*(veas|mires|entres)/i,
    ];
    for (const pattern of deflectionPatterns) {
      if (pattern.test(cleaned)) {
        issues.push('Deflexión a la web sin mostrar productos');
        break;
      }
    }
  }

  // 2e. Detectar "¿algo más?" prohibido
  if (/algo\s*m[aá]s\s*en\s*lo\s*que|algo\s*m[aá]s\?|te\s*ayudo\s*con\s*algo/i.test(cleaned)) {
    // Solo flag, no bloquea — pero se loguea
    console.log('Guardrails warning: respuesta con "algo más?"');
  }

  if (issues.length > 0) {
    console.log(`Guardrails issues: ${issues.join(', ')}`);
  }

  return {
    valid: issues.length === 0,
    issues,
    cleanedResponse: cleaned,
  };
}

// ========== 3. FUNCTION CALLING: Datos críticos via funciones ==========

export interface ProductLookupResult {
  found: boolean;
  product?: any;
  price?: string;
  alternatives?: any[];
}

export function lookupProduct(
  query: string,
  products: any[],
  entities?: Record<string, any>,
): ProductLookupResult {
  const queryNorm = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Buscar por nombre exacto primero
  let match = products.find(p => {
    const name = (p.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return name.includes(queryNorm) || queryNorm.includes(name);
  });

  // Si hay entities del router, usarlas para refinar
  if (!match && entities?.producto) {
    const entityProd = entities.producto.toLowerCase();
    match = products.find(p => {
      const name = (p.name || '').toLowerCase();
      return name.includes(entityProd) || entityProd.includes(name);
    });
  }

  if (match) {
    return { found: true, product: match, price: match.price };
  }

  // Buscar alternativas parciales
  const words = queryNorm.split(/\s+/).filter(w => w.length > 3);
  const alternatives = products.filter(p => {
    const name = (p.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return words.some(w => name.includes(w));
  }).slice(0, 3);

  return { found: false, alternatives };
}

export function lookupPrice(productName: string, products: any[]): string | null {
  const nameNorm = productName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const match = products.find(p => {
    const n = (p.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return n.includes(nameNorm) || nameNorm.includes(n);
  });
  return match?.price || null;
}
