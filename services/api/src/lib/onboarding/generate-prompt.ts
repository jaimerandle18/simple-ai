/**
 * Generador deterministico de system prompt.
 * Toma el businessConfig estructurado y produce el prompt del agente.
 * Sin IA — puro template.
 */

export interface BusinessConfig {
  business?: {
    name?: string;
    rubro?: string;
    address?: string;
    website?: string;
    instagram?: string;
    facebook?: string;
    target?: string;
  };
  agent?: {
    name?: string;
    tone?: string;
    useEmojis?: boolean;
    greeting?: string;
    maxLines?: number;
  };
  hours?: {
    weekdaysFrom?: string;
    weekdaysTo?: string;
    saturdayActive?: boolean;
    saturdayFrom?: string;
    saturdayTo?: string;
    sundayActive?: boolean;
    sundayFrom?: string;
    sundayTo?: string;
    bot24x7?: boolean;
    outOfHoursMessage?: string;
  };
  payment?: {
    methods?: string[];
    hasDiscounts?: boolean;
    discountDetail?: string;
    installments?: boolean;
    installmentsCount?: string;
    paymentLink?: string;
  };
  shipping?: {
    active?: boolean;
    zones?: string[];
    service?: string[];
    costType?: string;
    freeFrom?: number;
    time?: string;
    pickup?: boolean;
    pickupDetail?: string;
  };
  policies?: {
    exchanges?: boolean;
    exchangeDays?: string;
    exchangeConditions?: string;
    returns?: boolean;
    returnDays?: string;
    warranty?: string;
  };
  promotions?: {
    active?: boolean;
    description?: string;
  };
  escalation?: {
    active?: boolean;
    cases?: string[];
    contact?: string;
    hours?: string;
  };
}

const TONE_MAP: Record<string, string> = {
  casual_amigable: 'Argentino casual y amigable. Tuteas con "vos". Conciso y natural, como un WhatsApp real.',
  formal: 'Profesional pero cercano. Sin jerga excesiva. Respetuoso.',
  vendedor_directo: 'Directo al grano, enfocado en cerrar la venta. Sin rodeos pero amable.',
  cercano: 'Empatico y personal. Te interesa el cliente como persona, no solo la venta.',
};

const METHOD_LABELS: Record<string, string> = {
  tarjeta_debito: 'Tarjeta de debito',
  tarjeta_credito: 'Tarjeta de credito',
  transferencia: 'Transferencia bancaria',
  efectivo: 'Efectivo',
  mercadopago: 'MercadoPago',
  modo: 'MODO',
  cuenta_dni: 'Cuenta DNI',
};

const ZONE_LABELS: Record<string, string> = {
  todo_pais: 'Todo el pais',
  caba: 'CABA',
  gba: 'GBA',
  buenos_aires: 'Provincia de Buenos Aires',
  region_especifica: 'Region especifica',
};

const SERVICE_LABELS: Record<string, string> = {
  correo_argentino: 'Correo Argentino',
  andreani: 'Andreani',
  oca: 'OCA',
  moto: 'Moto / Cadete',
  flex: 'Mercado Envios Flex',
  otro: 'Otro',
};

const TIME_LABELS: Record<string, string> = {
  '24h': '24 horas',
  '1_3_dias': '1-3 dias',
  '3_5_dias': '3-5 dias',
  '5_7_dias': '5-7 dias',
  '7_plus': 'Mas de 7 dias',
};

const ESCALATION_LABELS: Record<string, string> = {
  insultos: 'insultos o agresividad',
  quejas: 'quejas formales',
  devoluciones: 'devoluciones complejas',
  tecnico: 'problemas tecnicos',
  ventas_grandes: 'ventas grandes o mayoristas',
  pide_humano: 'el cliente pide hablar con alguien',
  otro: 'otros casos especiales',
};

export function generateSystemPrompt(config: BusinessConfig): string {
  const parts: string[] = [];
  const b = config.business || {};
  const a = config.agent || {};
  const h = config.hours || {};
  const pay = config.payment || {};
  const ship = config.shipping || {};
  const pol = config.policies || {};
  const promo = config.promotions || {};
  const esc = config.escalation || {};

  // === IDENTIDAD ===
  const agentName = a.name || 'el vendedor';
  const businessName = b.name || 'el negocio';
  let identity = `Sos ${agentName}, vendedor virtual por WhatsApp de ${businessName}`;
  if (b.rubro) identity += `, especializado en ${b.rubro}`;
  identity += '.';
  parts.push(identity);

  // === TONO ===
  const toneDesc = TONE_MAP[a.tone || 'casual_amigable'] || TONE_MAP.casual_amigable;
  let toneBlock = `# TONO\n${toneDesc}`;
  if (a.useEmojis === true) {
    toneBlock += '\nUsa maximo 1 emoji por mensaje.';
  } else if (a.useEmojis === false) {
    toneBlock += '\nNO uses emojis.';
  }
  toneBlock += `\nMaximo ${a.maxLines || 5} lineas por respuesta.`;
  toneBlock += '\nNUNCA uses signos de apertura. Solo cierre (! ?).';
  parts.push(toneBlock);

  // === SALUDO ===
  if (a.greeting) {
    parts.push(`# SALUDO INICIAL\nCuando un cliente te escribe por primera vez, responde: "${a.greeting}"`);
  }

  // === INFO DEL NEGOCIO ===
  const infoLines: string[] = [];
  if (b.address) infoLines.push(`Ubicacion: ${b.address}`);
  if (b.website) infoLines.push(`Web: ${b.website}`);
  if (b.instagram) infoLines.push(`Instagram: ${b.instagram}`);
  if (b.facebook) infoLines.push(`Facebook: ${b.facebook}`);
  if (b.target) infoLines.push(`Publico: ${b.target}`);
  if (infoLines.length > 0) {
    parts.push(`# INFORMACION DEL NEGOCIO\n${infoLines.join('\n')}`);
  }

  // === HORARIOS ===
  const hoursLines: string[] = [];
  if (h.weekdaysFrom && h.weekdaysTo) {
    hoursLines.push(`Lunes a Viernes: ${h.weekdaysFrom} a ${h.weekdaysTo}`);
  }
  if (h.saturdayActive && h.saturdayFrom && h.saturdayTo) {
    hoursLines.push(`Sabados: ${h.saturdayFrom} a ${h.saturdayTo}`);
  } else if (h.saturdayActive === false) {
    hoursLines.push('Sabados: cerrado');
  }
  if (h.sundayActive && h.sundayFrom && h.sundayTo) {
    hoursLines.push(`Domingos: ${h.sundayFrom} a ${h.sundayTo}`);
  } else if (h.sundayActive === false) {
    hoursLines.push('Domingos: cerrado');
  }
  if (h.bot24x7) {
    hoursLines.push('El agente responde 24/7.');
  } else if (h.outOfHoursMessage) {
    hoursLines.push(`Fuera de horario responder: "${h.outOfHoursMessage}"`);
  }
  if (hoursLines.length > 0) {
    parts.push(`# HORARIOS\n${hoursLines.join('\n')}`);
  }

  // === PAGOS ===
  const payLines: string[] = [];
  if (pay.methods && pay.methods.length > 0) {
    payLines.push(`Metodos: ${pay.methods.map(m => METHOD_LABELS[m] || m).join(', ')}`);
  }
  if (pay.hasDiscounts && pay.discountDetail) {
    payLines.push(`Descuentos: ${pay.discountDetail}`);
  }
  if (pay.installments) {
    payLines.push(`Cuotas sin interes: ${pay.installmentsCount || 'si'} cuotas`);
  }
  if (pay.paymentLink) {
    payLines.push(`Link de pago: ${pay.paymentLink}`);
  }
  if (payLines.length > 0) {
    parts.push(`# MEDIOS DE PAGO\n${payLines.join('\n')}`);
  }

  // === ENVIOS ===
  if (ship.active) {
    const shipLines: string[] = [];
    if (ship.zones && ship.zones.length > 0) {
      shipLines.push(`Zonas: ${ship.zones.map(z => ZONE_LABELS[z] || z).join(', ')}`);
    }
    if (ship.service && ship.service.length > 0) {
      shipLines.push(`Servicio: ${ship.service.map(s => SERVICE_LABELS[s] || s).join(', ')}`);
    }
    if (ship.costType === 'gratis') {
      shipLines.push('Envio gratis siempre');
    } else if (ship.costType === 'gratis_desde' && ship.freeFrom) {
      shipLines.push(`Envio gratis desde $${ship.freeFrom.toLocaleString('es-AR')}`);
    } else if (ship.costType === 'fijo') {
      shipLines.push('Costo de envio fijo');
    } else if (ship.costType === 'variable') {
      shipLines.push('Costo de envio variable segun zona');
    }
    if (ship.time) {
      shipLines.push(`Tiempo de entrega: ${TIME_LABELS[ship.time] || ship.time}`);
    }
    if (ship.pickup && ship.pickupDetail) {
      shipLines.push(`Retiro en local: ${ship.pickupDetail}`);
    } else if (ship.pickup) {
      shipLines.push('Se puede retirar en local');
    }
    if (shipLines.length > 0) {
      parts.push(`# ENVIOS\n${shipLines.join('\n')}`);
    }
  } else if (ship.active === false) {
    parts.push('# ENVIOS\nNo hacemos envios. Solo venta en local / retiro.');
  }

  // === POLITICAS ===
  const polLines: string[] = [];
  if (pol.exchanges) {
    let line = 'Aceptamos cambios';
    if (pol.exchangeDays) line += ` dentro de los ${pol.exchangeDays} dias`;
    polLines.push(line);
    if (pol.exchangeConditions) polLines.push(`Condiciones: ${pol.exchangeConditions}`);
  } else if (pol.exchanges === false) {
    polLines.push('No aceptamos cambios');
  }
  if (pol.returns) {
    let line = 'Aceptamos devoluciones';
    if (pol.returnDays) line += ` dentro de los ${pol.returnDays} dias`;
    polLines.push(line);
  } else if (pol.returns === false) {
    polLines.push('No hacemos devoluciones de dinero');
  }
  if (pol.warranty) polLines.push(`Garantia: ${pol.warranty}`);
  if (polLines.length > 0) {
    parts.push(`# POLITICAS\n${polLines.join('\n')}`);
  }

  // === PROMOS ===
  if (promo.active && promo.description) {
    parts.push(`# PROMOCIONES VIGENTES\n${promo.description}`);
  }

  // === ESCALAMIENTO ===
  if (esc.active && esc.cases && esc.cases.length > 0) {
    const casesStr = esc.cases.map(c => ESCALATION_LABELS[c] || c).join(', ');
    let escBlock = `# ESCALAMIENTO\nPasar a un humano cuando: ${casesStr}`;
    if (esc.contact) escBlock += `\nContacto: ${esc.contact}`;
    parts.push(escBlock);
  }

  // === REGLAS UNIVERSALES ===
  parts.push(`# REGLAS UNIVERSALES
1. SOLO mencionar productos de PRODUCTOS_DISPONIBLES. NUNCA inventar productos ni precios.
2. NUNCA mandes al cliente a la web. Atende todo por WhatsApp.
3. Precio formateado: $XX.XXX (ej: $67.186).
4. Las fotos se envian automaticamente de los productos que nombras con datos concretos.
5. Si el cliente quiere comprar, pedi los datos necesarios para cerrar la venta.
6. Si insulta o pide humano: "Te paso con alguien del equipo."
7. NUNCA cierres con "algo mas?". Hace una pregunta especifica o confirmacion.
8. NUNCA digas "no tengo eso cargado" si hay productos en contexto.`);

  return parts.join('\n\n');
}

/**
 * Genera el extraInstructions y agentConfig a partir del businessConfig estructurado.
 * Se usa para sincronizar al agente real.
 */
export function syncConfigToAgent(config: BusinessConfig): {
  assistantName?: string;
  welcomeMessage?: string;
  websiteUrl?: string;
  businessHours?: string;
  promotions?: string;
  tone?: string;
  extraInstructions: string;
} {
  const result: any = {};
  const a = config.agent || {};
  const b = config.business || {};
  const h = config.hours || {};
  const promo = config.promotions || {};

  if (a.name) result.assistantName = a.name;
  if (a.greeting) result.welcomeMessage = a.greeting;
  if (b.website) result.websiteUrl = b.website;
  if (a.tone) result.tone = a.tone;

  // Horarios como string
  const hoursParts: string[] = [];
  if (h.weekdaysFrom && h.weekdaysTo) hoursParts.push(`Lun-Vie: ${h.weekdaysFrom} a ${h.weekdaysTo}`);
  if (h.saturdayActive && h.saturdayFrom) hoursParts.push(`Sab: ${h.saturdayFrom} a ${h.saturdayTo}`);
  if (h.sundayActive && h.sundayFrom) hoursParts.push(`Dom: ${h.sundayFrom} a ${h.sundayTo}`);
  if (hoursParts.length > 0) result.businessHours = hoursParts.join('. ');

  if (promo.active && promo.description) result.promotions = promo.description;

  // El prompt completo como extraInstructions
  result.extraInstructions = generateSystemPrompt(config);

  return result;
}
