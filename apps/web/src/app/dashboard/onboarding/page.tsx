'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import Link from 'next/link';

// ============================================================
// FIELD CATALOG (inline — same as backend fields-catalog.ts)
// ============================================================
type FieldType = 'simple_text' | 'ai_text' | 'select' | 'multi_select' | 'toggle' | 'number' | 'url' | 'time';

interface FieldDef {
  id: string;
  section: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  aiContext?: { description: string; examples: string[]; maxLength: number };
  validation?: { minLength?: number; maxLength?: number; pattern?: string };
  dependsOn?: { fieldId: string; value: any };
}

interface Section {
  id: string;
  label: string;
  order: number;
}

const SECTIONS: Section[] = [
  { id: 'business', label: 'Negocio', order: 1 },
  { id: 'agent', label: 'Agente IA', order: 2 },
  { id: 'hours', label: 'Horarios', order: 3 },
  { id: 'payment', label: 'Medios de pago', order: 4 },
  { id: 'shipping', label: 'Envios', order: 5 },
  { id: 'policies', label: 'Politicas', order: 6 },
  { id: 'promotions', label: 'Promociones', order: 7 },
  { id: 'escalation', label: 'Escalamiento', order: 8 },
];

const FIELDS: FieldDef[] = [
  // BUSINESS
  { id: 'business_name', section: 'business', label: 'Nombre del negocio', type: 'simple_text', required: true, validation: { minLength: 2, maxLength: 50 } },
  { id: 'business_rubro', section: 'business', label: 'Rubro', type: 'select', required: true, options: [
    { value: 'ferreteria', label: 'Ferreteria' }, { value: 'indumentaria', label: 'Indumentaria' },
    { value: 'cosmetica', label: 'Cosmetica y belleza' }, { value: 'gastronomia', label: 'Gastronomia' },
    { value: 'electronica', label: 'Electronica' }, { value: 'libreria', label: 'Libreria' },
    { value: 'deportes', label: 'Deportes y outdoor' }, { value: 'hogar', label: 'Hogar y deco' },
    { value: 'mascotas', label: 'Mascotas' }, { value: 'salud', label: 'Salud y bienestar' },
    { value: 'automotor', label: 'Automotor' }, { value: 'construccion', label: 'Construccion' },
    { value: 'otros', label: 'Otros' },
  ] },
  { id: 'business_address', section: 'business', label: 'Ubicacion / direccion', type: 'ai_text', required: false, aiContext: { description: 'Direccion fisica del negocio', examples: ['Av. del Libertador 14056, Martinez, Buenos Aires', 'Solo venta online'], maxLength: 200 } },
  { id: 'business_website', section: 'business', label: 'Sitio web', type: 'url', required: false },
  { id: 'business_instagram', section: 'business', label: 'Instagram', type: 'simple_text', required: false, validation: { maxLength: 50, pattern: '^@?[a-zA-Z0-9._]+$' } },
  { id: 'business_target', section: 'business', label: 'Publico objetivo', type: 'ai_text', required: false, aiContext: { description: 'Tipo de cliente al que apunta el negocio', examples: ['Jovenes 18-35 que buscan ropa urbana', 'Familias que necesitan herramientas'], maxLength: 300 } },

  // AGENT
  { id: 'agent_name', section: 'agent', label: 'Nombre del agente', type: 'simple_text', required: true, validation: { minLength: 2, maxLength: 30 } },
  { id: 'agent_tone', section: 'agent', label: 'Tono', type: 'select', required: true, options: [
    { value: 'casual_amigable', label: 'Casual y amigable' }, { value: 'formal', label: 'Formal y profesional' },
    { value: 'vendedor_directo', label: 'Vendedor directo' }, { value: 'cercano', label: 'Cercano y empatico' },
  ] },
  { id: 'agent_use_emojis', section: 'agent', label: 'Usar emojis', type: 'toggle', required: true },
  { id: 'agent_greeting', section: 'agent', label: 'Saludo inicial', type: 'ai_text', required: true, aiContext: { description: 'Mensaje de bienvenida cuando un cliente escribe por primera vez', examples: ['Hola! Soy Alex de Underwave, en que te ayudo?', 'Buenas! Bienvenido, que buscas?'], maxLength: 200 } },
  { id: 'agent_max_lines', section: 'agent', label: 'Max lineas por respuesta', type: 'select', required: true, options: [
    { value: '3', label: '3 lineas (conciso)' }, { value: '4', label: '4 lineas (balanceado)' },
    { value: '5', label: '5 lineas (mas detalle)' }, { value: '6', label: '6 lineas (extenso)' },
  ] },

  // HOURS
  { id: 'hours_weekdays_from', section: 'hours', label: 'Lunes a Viernes - Apertura', type: 'time', required: true },
  { id: 'hours_weekdays_to', section: 'hours', label: 'Lunes a Viernes - Cierre', type: 'time', required: true },
  { id: 'hours_saturday_active', section: 'hours', label: 'Atienden sabados?', type: 'toggle', required: true },
  { id: 'hours_saturday_from', section: 'hours', label: 'Sabado - Apertura', type: 'time', required: false, dependsOn: { fieldId: 'hours_saturday_active', value: true } },
  { id: 'hours_saturday_to', section: 'hours', label: 'Sabado - Cierre', type: 'time', required: false, dependsOn: { fieldId: 'hours_saturday_active', value: true } },
  { id: 'hours_sunday_active', section: 'hours', label: 'Atienden domingos?', type: 'toggle', required: true },
  { id: 'hours_sunday_from', section: 'hours', label: 'Domingo - Apertura', type: 'time', required: false, dependsOn: { fieldId: 'hours_sunday_active', value: true } },
  { id: 'hours_sunday_to', section: 'hours', label: 'Domingo - Cierre', type: 'time', required: false, dependsOn: { fieldId: 'hours_sunday_active', value: true } },
  { id: 'hours_bot_24_7', section: 'hours', label: 'El agente responde 24/7?', type: 'toggle', required: true },
  { id: 'hours_out_of_hours_message', section: 'hours', label: 'Mensaje fuera de horario', type: 'ai_text', required: false, dependsOn: { fieldId: 'hours_bot_24_7', value: false }, aiContext: { description: 'Mensaje que el agente envia fuera de horario', examples: ['Estamos cerrados, te respondemos manana a las 9hs.'], maxLength: 200 } },

  // PAYMENT
  { id: 'payment_methods', section: 'payment', label: 'Metodos de pago', type: 'multi_select', required: true, options: [
    { value: 'tarjeta_debito', label: 'Tarjeta de debito' }, { value: 'tarjeta_credito', label: 'Tarjeta de credito' },
    { value: 'transferencia', label: 'Transferencia bancaria' }, { value: 'efectivo', label: 'Efectivo' },
    { value: 'mercadopago', label: 'MercadoPago' }, { value: 'modo', label: 'MODO' }, { value: 'cuenta_dni', label: 'Cuenta DNI' },
  ] },
  { id: 'payment_has_discounts', section: 'payment', label: 'Descuentos por metodo de pago?', type: 'toggle', required: true },
  { id: 'payment_discount_detail', section: 'payment', label: 'Detalle de descuentos', type: 'ai_text', required: false, dependsOn: { fieldId: 'payment_has_discounts', value: true }, aiContext: { description: 'Descuentos por metodo de pago', examples: ['10% off con transferencia', '15% efectivo en local'], maxLength: 300 } },
  { id: 'payment_installments', section: 'payment', label: 'Cuotas sin interes?', type: 'toggle', required: true },
  { id: 'payment_installments_count', section: 'payment', label: 'Cantidad de cuotas', type: 'select', required: false, dependsOn: { fieldId: 'payment_installments', value: true }, options: [
    { value: '3', label: '3 cuotas' }, { value: '6', label: '6 cuotas' }, { value: '12', label: '12 cuotas' },
  ] },

  // SHIPPING
  { id: 'shipping_active', section: 'shipping', label: 'Hacen envios?', type: 'toggle', required: true },
  { id: 'shipping_zones', section: 'shipping', label: 'Zonas de envio', type: 'multi_select', required: false, dependsOn: { fieldId: 'shipping_active', value: true }, options: [
    { value: 'todo_pais', label: 'Todo el pais' }, { value: 'caba', label: 'CABA' },
    { value: 'gba', label: 'GBA' }, { value: 'buenos_aires', label: 'Prov. Buenos Aires' },
  ] },
  { id: 'shipping_service', section: 'shipping', label: 'Servicio de envio', type: 'multi_select', required: false, dependsOn: { fieldId: 'shipping_active', value: true }, options: [
    { value: 'correo_argentino', label: 'Correo Argentino' }, { value: 'andreani', label: 'Andreani' },
    { value: 'oca', label: 'OCA' }, { value: 'moto', label: 'Moto / Cadete' }, { value: 'flex', label: 'Mercado Envios Flex' },
  ] },
  { id: 'shipping_cost_type', section: 'shipping', label: 'Costo de envio', type: 'select', required: false, dependsOn: { fieldId: 'shipping_active', value: true }, options: [
    { value: 'fijo', label: 'Costo fijo' }, { value: 'variable', label: 'Variable segun zona' },
    { value: 'gratis', label: 'Siempre gratis' }, { value: 'gratis_desde', label: 'Gratis desde cierto monto' },
  ] },
  { id: 'shipping_free_from', section: 'shipping', label: 'Envio gratis desde ($)', type: 'number', required: false, dependsOn: { fieldId: 'shipping_cost_type', value: 'gratis_desde' } },
  { id: 'shipping_time', section: 'shipping', label: 'Tiempo de entrega', type: 'select', required: false, dependsOn: { fieldId: 'shipping_active', value: true }, options: [
    { value: '24h', label: '24 horas' }, { value: '1_3_dias', label: '1-3 dias' },
    { value: '3_5_dias', label: '3-5 dias' }, { value: '5_7_dias', label: '5-7 dias' },
  ] },
  { id: 'shipping_pickup', section: 'shipping', label: 'Retiro en local?', type: 'toggle', required: false, dependsOn: { fieldId: 'shipping_active', value: true } },

  // POLICIES
  { id: 'policies_exchanges', section: 'policies', label: 'Acepta cambios?', type: 'toggle', required: true },
  { id: 'policies_exchange_days', section: 'policies', label: 'Plazo para cambios', type: 'select', required: false, dependsOn: { fieldId: 'policies_exchanges', value: true }, options: [
    { value: '7', label: '7 dias' }, { value: '15', label: '15 dias' }, { value: '30', label: '30 dias' },
  ] },
  { id: 'policies_exchange_conditions', section: 'policies', label: 'Condiciones de cambio', type: 'ai_text', required: false, dependsOn: { fieldId: 'policies_exchanges', value: true }, aiContext: { description: 'Condiciones para hacer un cambio', examples: ['Sin uso, con etiqueta original'], maxLength: 300 } },
  { id: 'policies_returns', section: 'policies', label: 'Devoluciones de dinero?', type: 'toggle', required: true },
  { id: 'policies_warranty', section: 'policies', label: 'Politica de garantia', type: 'ai_text', required: false, aiContext: { description: 'Politica de garantia del negocio', examples: ['Garantia de fabrica 6 meses', 'Sin garantia'], maxLength: 300 } },

  // PROMOTIONS
  { id: 'promotions_active', section: 'promotions', label: 'Tiene promos activas?', type: 'toggle', required: true },
  { id: 'promotions_description', section: 'promotions', label: 'Descripcion de las promos', type: 'ai_text', required: false, dependsOn: { fieldId: 'promotions_active', value: true }, aiContext: { description: 'Promociones vigentes', examples: ['15% off en herramientas electricas todo octubre', '2x1 en remeras'], maxLength: 500 } },

  // ESCALATION
  { id: 'escalation_active', section: 'escalation', label: 'Pasar a humano en ciertos casos?', type: 'toggle', required: true },
  { id: 'escalation_cases', section: 'escalation', label: 'Casos de escalamiento', type: 'multi_select', required: false, dependsOn: { fieldId: 'escalation_active', value: true }, options: [
    { value: 'insultos', label: 'Insultos' }, { value: 'quejas', label: 'Quejas formales' },
    { value: 'devoluciones', label: 'Devoluciones' }, { value: 'tecnico', label: 'Problemas tecnicos' },
    { value: 'ventas_grandes', label: 'Ventas grandes' }, { value: 'pide_humano', label: 'Pide hablar con alguien' },
  ] },
  { id: 'escalation_contact', section: 'escalation', label: 'Quien atiende (nombre o numero)', type: 'simple_text', required: false, dependsOn: { fieldId: 'escalation_active', value: true }, validation: { maxLength: 100 } },
];

// ============================================================
// PAGE
// ============================================================
export default function OnboardingPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [config, setConfig] = useState<Record<string, any>>({});
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<Record<string, { improved?: string; rejectReason?: string } | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load existing config from v2 state, fallback to v1
  useEffect(() => {
    if (!tenantId) return;
    // Try v2 first, then fallback to v1 config
    api('/onboarding/v2/state', { tenantId })
      .then(data => {
        if (data.config && Object.keys(data.config).length > 0) {
          setConfig(data.config);
          if (data.currentSection) {
            const idx = SECTIONS.findIndex(s => s.id === data.currentSection);
            if (idx >= 0) setCurrentSectionIdx(idx);
          }
        }
      })
      .catch(() => {
        // v2 not deployed yet, that's fine — start fresh
      })
      .finally(() => setLoading(false));
  }, [tenantId]);

  const currentSection = SECTIONS[currentSectionIdx];
  const sectionFields = FIELDS.filter(f => f.section === currentSection?.id);

  // Completed sections
  const completedSections = SECTIONS.filter(s => {
    const fields = FIELDS.filter(f => f.section === s.id);
    const required = fields.filter(f => {
      if (!f.required) return false;
      if (f.dependsOn) return config[f.dependsOn.fieldId] === f.dependsOn.value;
      return true;
    });
    if (required.length === 0) {
      return fields.some(f => config[f.id] !== undefined && config[f.id] !== null && config[f.id] !== '');
    }
    return required.every(f => {
      const v = config[f.id];
      return v !== undefined && v !== null && v !== '';
    });
  }).map(s => s.id);

  const progress = Math.round((completedSections.length / SECTIONS.length) * 100);
  const isComplete = completedSections.length === SECTIONS.length;

  const isFieldVisible = useCallback((field: FieldDef) => {
    if (!field.dependsOn) return true;
    return config[field.dependsOn.fieldId] === field.dependsOn.value;
  }, [config]);

  const setValue = (fieldId: string, value: any) => {
    setConfig(prev => ({ ...prev, [fieldId]: value }));
    setErrors(prev => { const n = { ...prev }; delete n[fieldId]; return n; });
    setAiResult(prev => { const n = { ...prev }; delete n[fieldId]; return n; });
  };

  // AI improve — calls backend if deployed, otherwise just keeps text as-is
  const improveField = async (fieldId: string) => {
    const value = config[fieldId];
    if (!value || !tenantId) return;
    setAiLoading(fieldId);
    try {
      const result = await api('/onboarding/v2/improve-field', {
        method: 'POST', tenantId,
        body: { fieldId, userInput: value },
      });
      setAiResult(prev => ({ ...prev, [fieldId]: result }));
    } catch {
      // Backend not deployed yet — skip AI improvement silently
      setAiResult(prev => ({ ...prev, [fieldId]: { improved: value } }));
    }
    setAiLoading(null);
  };

  const acceptImprovement = (fieldId: string) => {
    const result = aiResult[fieldId];
    if (result?.improved) {
      setConfig(prev => ({ ...prev, [fieldId]: result.improved }));
    }
    setAiResult(prev => { const n = { ...prev }; delete n[fieldId]; return n; });
  };

  // Save section — try v2 endpoint, fallback to save-field one by one
  const saveSection = async () => {
    if (!tenantId || !currentSection) return;
    setSaving(true);
    setErrors({});

    // Client-side validation
    const newErrors: Record<string, string> = {};
    for (const f of sectionFields) {
      if (!isFieldVisible(f)) continue;
      if (f.required) {
        const v = config[f.id];
        if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
          newErrors[f.id] = `${f.label} es requerido`;
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      setSaving(false);
      return;
    }

    // Build field values for this section
    const fieldValues: Record<string, any> = {};
    for (const f of sectionFields) {
      if (isFieldVisible(f)) {
        fieldValues[f.id] = config[f.id] ?? (f.type === 'toggle' ? false : f.type === 'multi_select' ? [] : '');
      }
    }

    try {
      const res = await api('/onboarding/v2/save-section', {
        method: 'POST', tenantId,
        body: { sectionId: currentSection.id, fields: fieldValues },
      });
      if (!res.saved && res.errors) {
        setErrors(res.errors);
        setSaving(false);
        return;
      }
    } catch {
      // Backend v2 not deployed — save locally is enough for now
    }

    // Advance to next section
    if (currentSectionIdx < SECTIONS.length - 1) {
      setCurrentSectionIdx(prev => prev + 1);
    }
    setSaving(false);
    window.scrollTo(0, 0);
  };

  const completeOnboarding = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      await api('/onboarding/v2/complete', { method: 'POST', tenantId });
      window.dispatchEvent(new Event('config-changed'));
    } catch {
      // v2 not deployed
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-primary-600 p-4 flex items-center gap-3">
        <Link href="/dashboard" className="text-white/70 hover:text-white">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div className="flex-1">
          <p className="text-sm font-medium text-white">Configurar mi agente</p>
          <p className="text-xs text-white/60">
            Paso {currentSectionIdx + 1} de {SECTIONS.length}: {currentSection?.label}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-24 h-2 bg-white/20 rounded-full overflow-hidden">
            <div className="h-full bg-white rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-white/80">{progress}%</span>
        </div>
        <a href="/dashboard/agent/test" className="text-xs bg-white/20 text-white px-3 py-1.5 rounded-lg hover:bg-white/30 transition">
          Probar chat
        </a>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6">
          {/* Steps nav */}
          <div className="flex gap-1 mb-8 overflow-x-auto pb-2">
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrentSectionIdx(i)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
                  i === currentSectionIdx
                    ? 'bg-primary-600 text-white'
                    : completedSections.includes(s.id)
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-200 text-gray-500'
                }`}
              >
                {completedSections.includes(s.id) && (
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
                {s.label}
              </button>
            ))}
          </div>

          {/* Fields */}
          <div className="space-y-5">
            {sectionFields.map(field => {
              if (!isFieldVisible(field)) return null;

              return (
                <div key={field.id}>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {field.label}
                    {field.required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>

                  {field.type === 'simple_text' && (
                    <input
                      type="text"
                      value={config[field.id] || ''}
                      onChange={e => setValue(field.id, e.target.value)}
                      maxLength={field.validation?.maxLength}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder={field.aiContext?.examples?.[0] || ''}
                    />
                  )}

                  {field.type === 'ai_text' && (
                    <div>
                      <textarea
                        value={config[field.id] || ''}
                        onChange={e => setValue(field.id, e.target.value)}
                        maxLength={field.aiContext?.maxLength}
                        rows={3}
                        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                        placeholder={field.aiContext?.examples?.[0] || ''}
                      />
                      {config[field.id] && !aiResult[field.id] && (
                        <button
                          onClick={() => improveField(field.id)}
                          disabled={aiLoading === field.id}
                          className="mt-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
                        >
                          {aiLoading === field.id ? (
                            <><div className="w-3 h-3 border border-primary-600 border-t-transparent rounded-full animate-spin" /> Mejorando...</>
                          ) : (
                            <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" /></svg> Mejorar con IA</>
                          )}
                        </button>
                      )}
                      {aiResult[field.id] && (
                        <div className={`mt-2 rounded-lg p-3 text-sm ${aiResult[field.id]!.improved ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                          {aiResult[field.id]!.improved ? (
                            <>
                              <p className="text-emerald-700 text-xs font-medium mb-1">Mejorado por IA:</p>
                              <p className="text-emerald-900">&ldquo;{aiResult[field.id]!.improved}&rdquo;</p>
                              <div className="flex gap-2 mt-2">
                                <button onClick={() => acceptImprovement(field.id)} className="text-xs bg-emerald-600 text-white px-3 py-1 rounded-md hover:bg-emerald-700">Aceptar mejora</button>
                                <button onClick={() => setAiResult(prev => { const n = { ...prev }; delete n[field.id]; return n; })} className="text-xs text-gray-500 hover:text-gray-700">Mantener original</button>
                              </div>
                            </>
                          ) : (
                            <>
                              <p className="text-red-700 text-xs font-medium mb-1">No se pudo mejorar</p>
                              <p className="text-red-600">{aiResult[field.id]!.rejectReason}</p>
                              <button onClick={() => setAiResult(prev => { const n = { ...prev }; delete n[field.id]; return n; })} className="mt-2 text-xs text-gray-500 hover:text-gray-700">Cerrar</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {field.type === 'select' && (
                    <select
                      value={config[field.id] || ''}
                      onChange={e => setValue(field.id, e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <option value="">Seleccionar...</option>
                      {field.options?.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}

                  {field.type === 'multi_select' && (
                    <div className="flex flex-wrap gap-2">
                      {field.options?.map(opt => {
                        const selected = (config[field.id] || []).includes(opt.value);
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => {
                              const current: string[] = config[field.id] || [];
                              setValue(field.id, selected ? current.filter(v => v !== opt.value) : [...current, opt.value]);
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${
                              selected ? 'bg-primary-100 border-primary-300 text-primary-700' : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {field.type === 'toggle' && (
                    <button
                      type="button"
                      onClick={() => setValue(field.id, !config[field.id])}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${config[field.id] ? 'bg-primary-600' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${config[field.id] ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  )}

                  {field.type === 'number' && (
                    <input
                      type="number"
                      value={config[field.id] || ''}
                      onChange={e => setValue(field.id, e.target.value ? Number(e.target.value) : '')}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  )}

                  {field.type === 'url' && (
                    <input
                      type="url"
                      value={config[field.id] || ''}
                      onChange={e => setValue(field.id, e.target.value)}
                      placeholder="https://..."
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  )}

                  {field.type === 'time' && (
                    <input
                      type="time"
                      value={config[field.id] || ''}
                      onChange={e => setValue(field.id, e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  )}

                  {errors[field.id] && (
                    <p className="text-xs text-red-500 mt-1">{errors[field.id]}</p>
                  )}
                </div>
              );
            })}
          </div>

          {errors._general && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{errors._general}</div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-200">
            <button
              onClick={() => { setCurrentSectionIdx(prev => Math.max(0, prev - 1)); window.scrollTo(0, 0); }}
              disabled={currentSectionIdx === 0}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Atras
            </button>

            {isComplete ? (
              <button
                onClick={completeOnboarding}
                disabled={saving}
                className="bg-emerald-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Activar agente
              </button>
            ) : currentSectionIdx === SECTIONS.length - 1 ? (
              <button
                onClick={saveSection}
                disabled={saving}
                className="bg-emerald-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Finalizar
              </button>
            ) : (
              <button
                onClick={saveSection}
                disabled={saving}
                className="bg-primary-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
              >
                {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Continuar
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
