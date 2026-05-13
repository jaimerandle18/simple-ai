// ============================================================
// Onboarding v2 — Catalogo de campos
// Cada campo tiene tipo, validacion, opciones, y contexto IA.
// ============================================================

export type FieldType =
  | 'simple_text'
  | 'ai_text'
  | 'select'
  | 'multi_select'
  | 'toggle'
  | 'number'
  | 'url'
  | 'time';

export interface FieldDefinition {
  id: string;
  section: string;
  label: string;
  type: FieldType;
  required: boolean;

  // Selectores
  options?: Array<{ value: string; label: string }>;

  // IA text
  aiContext?: {
    description: string;
    examples: string[];
    maxLength: number;
  };

  // Inputs simples
  validation?: {
    minLength?: number;
    maxLength?: number;
    pattern?: string; // regex as string for JSON compat
  };

  // Logica condicional: solo mostrar si otro campo tiene cierto valor
  dependsOn?: {
    fieldId: string;
    value: any;
  };
}

export const SECTIONS = [
  { id: 'business', label: 'Negocio', order: 1 },
  { id: 'agent', label: 'Agente IA', order: 2 },
  { id: 'hours', label: 'Horarios', order: 3 },
  { id: 'payment', label: 'Medios de pago', order: 4 },
  { id: 'shipping', label: 'Envios', order: 5 },
  { id: 'policies', label: 'Politicas', order: 6 },
  { id: 'promotions', label: 'Promociones', order: 7 },
  { id: 'escalation', label: 'Escalamiento', order: 8 },
] as const;

export type SectionId = typeof SECTIONS[number]['id'];

// ============================================================
// SECCION 1: NEGOCIO
// ============================================================
const BUSINESS_FIELDS: FieldDefinition[] = [
  {
    id: 'business_name',
    section: 'business',
    label: 'Nombre del negocio',
    type: 'simple_text',
    required: true,
    validation: { minLength: 2, maxLength: 50 },
  },
  {
    id: 'business_rubro',
    section: 'business',
    label: 'Rubro',
    type: 'select',
    required: true,
    options: [
      { value: 'ferreteria', label: 'Ferreteria' },
      { value: 'indumentaria', label: 'Indumentaria' },
      { value: 'cosmetica', label: 'Cosmetica y belleza' },
      { value: 'gastronomia', label: 'Gastronomia' },
      { value: 'electronica', label: 'Electronica' },
      { value: 'libreria', label: 'Libreria' },
      { value: 'deportes', label: 'Deportes y outdoor' },
      { value: 'hogar', label: 'Hogar y deco' },
      { value: 'mascotas', label: 'Mascotas' },
      { value: 'salud', label: 'Salud y bienestar' },
      { value: 'automotor', label: 'Automotor' },
      { value: 'construccion', label: 'Construccion' },
      { value: 'otros', label: 'Otros' },
    ],
  },
  {
    id: 'business_address',
    section: 'business',
    label: 'Ubicacion / direccion',
    type: 'ai_text',
    required: false,
    aiContext: {
      description: 'Direccion fisica del negocio o ubicacion general',
      examples: [
        'Av. del Libertador 14056, Martinez, Buenos Aires',
        'Calle Falsa 123, CABA',
        'Solo venta online, sin local fisico',
      ],
      maxLength: 200,
    },
  },
  {
    id: 'business_website',
    section: 'business',
    label: 'Sitio web',
    type: 'url',
    required: false,
  },
  {
    id: 'business_instagram',
    section: 'business',
    label: 'Instagram',
    type: 'simple_text',
    required: false,
    validation: { maxLength: 50, pattern: '^@?[a-zA-Z0-9._]+$' },
  },
  {
    id: 'business_facebook',
    section: 'business',
    label: 'Facebook',
    type: 'simple_text',
    required: false,
    validation: { maxLength: 100 },
  },
  {
    id: 'business_target',
    section: 'business',
    label: 'Publico objetivo',
    type: 'ai_text',
    required: false,
    aiContext: {
      description: 'Descripcion del tipo de cliente al que apunta el negocio',
      examples: [
        'Jovenes de 18-35 que buscan ropa urbana con onda',
        'Familias del barrio que necesitan herramientas para el hogar',
        'Profesionales que buscan productos de cosmetica premium',
      ],
      maxLength: 300,
    },
  },
];

// ============================================================
// SECCION 2: AGENTE IA
// ============================================================
const AGENT_FIELDS: FieldDefinition[] = [
  {
    id: 'agent_name',
    section: 'agent',
    label: 'Nombre del agente',
    type: 'simple_text',
    required: true,
    validation: { minLength: 2, maxLength: 30 },
  },
  {
    id: 'agent_tone',
    section: 'agent',
    label: 'Tono',
    type: 'select',
    required: true,
    options: [
      { value: 'casual_amigable', label: 'Casual y amigable' },
      { value: 'formal', label: 'Formal y profesional' },
      { value: 'vendedor_directo', label: 'Vendedor directo' },
      { value: 'cercano', label: 'Cercano y empatico' },
    ],
  },
  {
    id: 'agent_use_emojis',
    section: 'agent',
    label: 'Usar emojis',
    type: 'toggle',
    required: true,
  },
  {
    id: 'agent_greeting',
    section: 'agent',
    label: 'Saludo inicial',
    type: 'ai_text',
    required: true,
    aiContext: {
      description: 'Mensaje de bienvenida que el agente envia cuando un cliente escribe por primera vez',
      examples: [
        'Hola! Soy Alex de Underwave, en que te ayudo?',
        'Buenas! Bienvenido a la Ferreteria, que buscas?',
        'Hola! Te atiendo por WhatsApp, contame que necesitas.',
      ],
      maxLength: 200,
    },
  },
  {
    id: 'agent_max_lines',
    section: 'agent',
    label: 'Maximo de lineas por respuesta',
    type: 'select',
    required: true,
    options: [
      { value: '3', label: '3 lineas (muy conciso)' },
      { value: '4', label: '4 lineas (balanceado)' },
      { value: '5', label: '5 lineas (mas detalle)' },
      { value: '6', label: '6 lineas (extenso)' },
    ],
  },
];

// ============================================================
// SECCION 3: HORARIOS
// ============================================================
const HOURS_FIELDS: FieldDefinition[] = [
  {
    id: 'hours_weekdays_from',
    section: 'hours',
    label: 'Lunes a Viernes - Apertura',
    type: 'time',
    required: true,
  },
  {
    id: 'hours_weekdays_to',
    section: 'hours',
    label: 'Lunes a Viernes - Cierre',
    type: 'time',
    required: true,
  },
  {
    id: 'hours_saturday_active',
    section: 'hours',
    label: 'Atienden sabados?',
    type: 'toggle',
    required: true,
  },
  {
    id: 'hours_saturday_from',
    section: 'hours',
    label: 'Sabado - Apertura',
    type: 'time',
    required: false,
    dependsOn: { fieldId: 'hours_saturday_active', value: true },
  },
  {
    id: 'hours_saturday_to',
    section: 'hours',
    label: 'Sabado - Cierre',
    type: 'time',
    required: false,
    dependsOn: { fieldId: 'hours_saturday_active', value: true },
  },
  {
    id: 'hours_sunday_active',
    section: 'hours',
    label: 'Atienden domingos?',
    type: 'toggle',
    required: true,
  },
  {
    id: 'hours_sunday_from',
    section: 'hours',
    label: 'Domingo - Apertura',
    type: 'time',
    required: false,
    dependsOn: { fieldId: 'hours_sunday_active', value: true },
  },
  {
    id: 'hours_sunday_to',
    section: 'hours',
    label: 'Domingo - Cierre',
    type: 'time',
    required: false,
    dependsOn: { fieldId: 'hours_sunday_active', value: true },
  },
  {
    id: 'hours_bot_24_7',
    section: 'hours',
    label: 'El agente responde 24/7?',
    type: 'toggle',
    required: true,
  },
  {
    id: 'hours_out_of_hours_message',
    section: 'hours',
    label: 'Mensaje fuera de horario',
    type: 'ai_text',
    required: false,
    dependsOn: { fieldId: 'hours_bot_24_7', value: false },
    aiContext: {
      description: 'Mensaje que el agente envia a clientes que escriben fuera del horario de atencion',
      examples: [
        'Estamos cerrados, te respondemos manana a las 9hs.',
        'Por ahora cerrado, deja tu consulta y te escribimos cuando abramos.',
      ],
      maxLength: 200,
    },
  },
];

// ============================================================
// SECCION 4: PAGOS
// ============================================================
const PAYMENT_FIELDS: FieldDefinition[] = [
  {
    id: 'payment_methods',
    section: 'payment',
    label: 'Metodos de pago aceptados',
    type: 'multi_select',
    required: true,
    options: [
      { value: 'tarjeta_debito', label: 'Tarjeta de debito' },
      { value: 'tarjeta_credito', label: 'Tarjeta de credito' },
      { value: 'transferencia', label: 'Transferencia bancaria' },
      { value: 'efectivo', label: 'Efectivo (solo en local)' },
      { value: 'mercadopago', label: 'MercadoPago' },
      { value: 'modo', label: 'MODO' },
      { value: 'cuenta_dni', label: 'Cuenta DNI' },
    ],
  },
  {
    id: 'payment_has_discounts',
    section: 'payment',
    label: 'Tiene descuentos por metodo de pago?',
    type: 'toggle',
    required: true,
  },
  {
    id: 'payment_discount_detail',
    section: 'payment',
    label: 'Detalle de descuentos',
    type: 'ai_text',
    required: false,
    dependsOn: { fieldId: 'payment_has_discounts', value: true },
    aiContext: {
      description: 'Descripcion de los descuentos por metodo de pago que ofrece el negocio',
      examples: [
        '10% off con transferencia bancaria',
        '15% con efectivo en local, 5% con MercadoPago',
      ],
      maxLength: 300,
    },
  },
  {
    id: 'payment_installments',
    section: 'payment',
    label: 'Ofrece cuotas sin interes?',
    type: 'toggle',
    required: true,
  },
  {
    id: 'payment_installments_count',
    section: 'payment',
    label: 'Cantidad de cuotas',
    type: 'select',
    required: false,
    dependsOn: { fieldId: 'payment_installments', value: true },
    options: [
      { value: '3', label: '3 cuotas' },
      { value: '6', label: '6 cuotas' },
      { value: '9', label: '9 cuotas' },
      { value: '12', label: '12 cuotas' },
      { value: '18', label: '18 cuotas' },
    ],
  },
  {
    id: 'payment_link',
    section: 'payment',
    label: 'Link de pago (opcional)',
    type: 'url',
    required: false,
  },
];

// ============================================================
// SECCION 5: ENVIOS
// ============================================================
const SHIPPING_FIELDS: FieldDefinition[] = [
  {
    id: 'shipping_active',
    section: 'shipping',
    label: 'Hacen envios?',
    type: 'toggle',
    required: true,
  },
  {
    id: 'shipping_zones',
    section: 'shipping',
    label: 'Zonas de envio',
    type: 'multi_select',
    required: false,
    dependsOn: { fieldId: 'shipping_active', value: true },
    options: [
      { value: 'todo_pais', label: 'Todo el pais' },
      { value: 'caba', label: 'CABA' },
      { value: 'gba', label: 'GBA' },
      { value: 'buenos_aires', label: 'Provincia de Buenos Aires' },
      { value: 'region_especifica', label: 'Region especifica' },
    ],
  },
  {
    id: 'shipping_service',
    section: 'shipping',
    label: 'Servicio de envio',
    type: 'multi_select',
    required: false,
    dependsOn: { fieldId: 'shipping_active', value: true },
    options: [
      { value: 'correo_argentino', label: 'Correo Argentino' },
      { value: 'andreani', label: 'Andreani' },
      { value: 'oca', label: 'OCA' },
      { value: 'moto', label: 'Moto / Cadete' },
      { value: 'flex', label: 'Mercado Envios Flex' },
      { value: 'otro', label: 'Otro' },
    ],
  },
  {
    id: 'shipping_cost_type',
    section: 'shipping',
    label: 'Costo de envio',
    type: 'select',
    required: false,
    dependsOn: { fieldId: 'shipping_active', value: true },
    options: [
      { value: 'fijo', label: 'Costo fijo' },
      { value: 'variable', label: 'Variable segun zona' },
      { value: 'gratis', label: 'Siempre gratis' },
      { value: 'gratis_desde', label: 'Gratis desde cierto monto' },
    ],
  },
  {
    id: 'shipping_free_from',
    section: 'shipping',
    label: 'Envio gratis desde ($)',
    type: 'number',
    required: false,
    dependsOn: { fieldId: 'shipping_cost_type', value: 'gratis_desde' },
  },
  {
    id: 'shipping_time',
    section: 'shipping',
    label: 'Tiempo de entrega',
    type: 'select',
    required: false,
    dependsOn: { fieldId: 'shipping_active', value: true },
    options: [
      { value: '24h', label: '24 horas' },
      { value: '1_3_dias', label: '1-3 dias' },
      { value: '3_5_dias', label: '3-5 dias' },
      { value: '5_7_dias', label: '5-7 dias' },
      { value: '7_plus', label: 'Mas de 7 dias' },
    ],
  },
  {
    id: 'shipping_pickup',
    section: 'shipping',
    label: 'Retiro en local?',
    type: 'toggle',
    required: false,
    dependsOn: { fieldId: 'shipping_active', value: true },
  },
  {
    id: 'shipping_pickup_detail',
    section: 'shipping',
    label: 'Detalle retiro en local',
    type: 'ai_text',
    required: false,
    dependsOn: { fieldId: 'shipping_pickup', value: true },
    aiContext: {
      description: 'Informacion sobre como funciona el retiro en local (direccion, horario, etc.)',
      examples: [
        'Retiro en Martinez, Av. del Libertador 14056, de 9 a 18hs.',
        'Se retira en el deposito con turno previo.',
      ],
      maxLength: 200,
    },
  },
];

// ============================================================
// SECCION 6: POLITICAS
// ============================================================
const POLICIES_FIELDS: FieldDefinition[] = [
  {
    id: 'policies_exchanges',
    section: 'policies',
    label: 'Acepta cambios?',
    type: 'toggle',
    required: true,
  },
  {
    id: 'policies_exchange_days',
    section: 'policies',
    label: 'Plazo para cambios',
    type: 'select',
    required: false,
    dependsOn: { fieldId: 'policies_exchanges', value: true },
    options: [
      { value: '7', label: '7 dias' },
      { value: '15', label: '15 dias' },
      { value: '30', label: '30 dias' },
      { value: '60', label: '60 dias' },
    ],
  },
  {
    id: 'policies_exchange_conditions',
    section: 'policies',
    label: 'Condiciones de cambio',
    type: 'ai_text',
    required: false,
    dependsOn: { fieldId: 'policies_exchanges', value: true },
    aiContext: {
      description: 'Condiciones que deben cumplirse para hacer un cambio de producto',
      examples: [
        'Sin uso, con etiqueta original y embalaje',
        'Producto en buen estado, no mas de 30 dias desde la compra',
      ],
      maxLength: 300,
    },
  },
  {
    id: 'policies_returns',
    section: 'policies',
    label: 'Acepta devoluciones de dinero?',
    type: 'toggle',
    required: true,
  },
  {
    id: 'policies_return_days',
    section: 'policies',
    label: 'Plazo para devoluciones',
    type: 'select',
    required: false,
    dependsOn: { fieldId: 'policies_returns', value: true },
    options: [
      { value: '7', label: '7 dias' },
      { value: '15', label: '15 dias' },
      { value: '30', label: '30 dias' },
    ],
  },
  {
    id: 'policies_warranty',
    section: 'policies',
    label: 'Politica de garantia',
    type: 'ai_text',
    required: false,
    aiContext: {
      description: 'Descripcion de la politica de garantia del negocio',
      examples: [
        'Garantia de fabrica por 6 meses. Si tiene defecto, se cambia.',
        'Sin garantia, productos se venden tal cual.',
        '30 dias de garantia en productos electronicos.',
      ],
      maxLength: 300,
    },
  },
];

// ============================================================
// SECCION 7: PROMOCIONES
// ============================================================
const PROMOTIONS_FIELDS: FieldDefinition[] = [
  {
    id: 'promotions_active',
    section: 'promotions',
    label: 'Tiene promos activas?',
    type: 'toggle',
    required: true,
  },
  {
    id: 'promotions_description',
    section: 'promotions',
    label: 'Descripcion de las promos',
    type: 'ai_text',
    required: false,
    dependsOn: { fieldId: 'promotions_active', value: true },
    aiContext: {
      description: 'Descripcion de las promociones vigentes del negocio',
      examples: [
        '15% off en herramientas electricas durante todo octubre',
        '2x1 en remeras estampadas hasta agotar stock',
        'Envio gratis en compras de mas de $50.000 hasta fin de mes',
      ],
      maxLength: 500,
    },
  },
];

// ============================================================
// SECCION 8: ESCALAMIENTO
// ============================================================
const ESCALATION_FIELDS: FieldDefinition[] = [
  {
    id: 'escalation_active',
    section: 'escalation',
    label: 'Quiere que el agente pase a un humano en ciertos casos?',
    type: 'toggle',
    required: true,
  },
  {
    id: 'escalation_cases',
    section: 'escalation',
    label: 'Casos en que escala a humano',
    type: 'multi_select',
    required: false,
    dependsOn: { fieldId: 'escalation_active', value: true },
    options: [
      { value: 'insultos', label: 'Insultos o agresividad' },
      { value: 'quejas', label: 'Quejas formales' },
      { value: 'devoluciones', label: 'Devoluciones complejas' },
      { value: 'tecnico', label: 'Problemas tecnicos' },
      { value: 'ventas_grandes', label: 'Ventas grandes o mayoristas' },
      { value: 'pide_humano', label: 'El cliente pide hablar con alguien' },
      { value: 'otro', label: 'Otro' },
    ],
  },
  {
    id: 'escalation_contact',
    section: 'escalation',
    label: 'Quien atiende (nombre o numero)',
    type: 'simple_text',
    required: false,
    dependsOn: { fieldId: 'escalation_active', value: true },
    validation: { maxLength: 100 },
  },
  {
    id: 'escalation_hours',
    section: 'escalation',
    label: 'Horario de escalamiento',
    type: 'select',
    required: false,
    dependsOn: { fieldId: 'escalation_active', value: true },
    options: [
      { value: 'same_as_business', label: 'Mismo horario del negocio' },
      { value: '24_7', label: '24/7' },
      { value: 'custom', label: 'Horario especifico' },
    ],
  },
];

// ============================================================
// EXPORT COMPLETO
// ============================================================
export const FIELDS_CATALOG: FieldDefinition[] = [
  ...BUSINESS_FIELDS,
  ...AGENT_FIELDS,
  ...HOURS_FIELDS,
  ...PAYMENT_FIELDS,
  ...SHIPPING_FIELDS,
  ...POLICIES_FIELDS,
  ...PROMOTIONS_FIELDS,
  ...ESCALATION_FIELDS,
];

export function getFieldsForSection(sectionId: string): FieldDefinition[] {
  return FIELDS_CATALOG.filter(f => f.section === sectionId);
}

export function getField(fieldId: string): FieldDefinition | undefined {
  return FIELDS_CATALOG.find(f => f.id === fieldId);
}

/**
 * Valida un valor contra la definicion del campo (sin IA).
 * Para validacion estructural: tipo, required, pattern, min/max.
 */
export function validateFieldValue(
  field: FieldDefinition,
  value: any,
): { valid: boolean; error?: string } {
  // Required check
  if (field.required && (value === undefined || value === null || value === '')) {
    return { valid: false, error: `${field.label} es requerido` };
  }

  // Skip validation if empty and not required
  if (value === undefined || value === null || value === '') {
    return { valid: true };
  }

  switch (field.type) {
    case 'simple_text':
    case 'ai_text': {
      if (typeof value !== 'string') return { valid: false, error: 'Debe ser texto' };
      const v = field.validation;
      if (v?.minLength && value.length < v.minLength) {
        return { valid: false, error: `Minimo ${v.minLength} caracteres` };
      }
      if (v?.maxLength && value.length > v.maxLength) {
        return { valid: false, error: `Maximo ${v.maxLength} caracteres` };
      }
      if (field.aiContext?.maxLength && value.length > field.aiContext.maxLength) {
        return { valid: false, error: `Maximo ${field.aiContext.maxLength} caracteres` };
      }
      if (v?.pattern && !new RegExp(v.pattern).test(value)) {
        return { valid: false, error: `Formato invalido` };
      }
      return { valid: true };
    }

    case 'select': {
      if (!field.options) return { valid: true };
      const validValues = field.options.map(o => o.value);
      if (!validValues.includes(value)) {
        return { valid: false, error: `Valor "${value}" no es una opcion valida` };
      }
      return { valid: true };
    }

    case 'multi_select': {
      if (!Array.isArray(value)) return { valid: false, error: 'Debe ser un array' };
      if (field.options) {
        const validValues = field.options.map(o => o.value);
        for (const v of value) {
          if (!validValues.includes(v)) {
            return { valid: false, error: `"${v}" no es una opcion valida` };
          }
        }
      }
      return { valid: true };
    }

    case 'toggle': {
      if (typeof value !== 'boolean') return { valid: false, error: 'Debe ser true o false' };
      return { valid: true };
    }

    case 'number': {
      if (typeof value !== 'number' || isNaN(value)) return { valid: false, error: 'Debe ser un numero' };
      return { valid: true };
    }

    case 'url': {
      if (typeof value !== 'string') return { valid: false, error: 'Debe ser texto' };
      if (value && !value.match(/^https?:\/\/.+/)) {
        return { valid: false, error: 'Debe ser una URL valida (https://...)' };
      }
      return { valid: true };
    }

    case 'time': {
      if (typeof value !== 'string') return { valid: false, error: 'Debe ser texto' };
      if (!value.match(/^\d{1,2}:\d{2}$/)) {
        return { valid: false, error: 'Formato de hora invalido (HH:MM)' };
      }
      return { valid: true };
    }

    default:
      return { valid: true };
  }
}
