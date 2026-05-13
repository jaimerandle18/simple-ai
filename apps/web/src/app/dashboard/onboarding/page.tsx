'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/useAuth';
import { api } from '@/lib/api';
import Link from 'next/link';

// ============================================================
// TYPES
// ============================================================
type FieldType = 'simple_text' | 'ai_text' | 'select' | 'multi_select' | 'toggle' | 'number' | 'url' | 'time';
type SectionStatus = 'not_visited' | 'in_progress' | 'completed';

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

interface Section { id: string; label: string; order: number }
interface Toast { id: string; type: 'success' | 'error'; message: string }

// ============================================================
// SECTIONS & FIELDS
// ============================================================
const SECTIONS: Section[] = [
  { id: 'business', label: 'Negocio', order: 1 },
  { id: 'agent', label: 'Agente IA', order: 2 },
  { id: 'hours', label: 'Horarios', order: 3 },
  { id: 'payment', label: 'Medios de pago', order: 4 },
  { id: 'shipping', label: 'Envios', order: 5 },
  { id: 'policies', label: 'Politicas', order: 6 },
  { id: 'promotions', label: 'Promociones', order: 7 },
  { id: 'escalation', label: 'Escalamiento', order: 8 },
  { id: 'caption', label: 'Epigrafe de productos', order: 9 },
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
  { id: 'agent_use_emojis', section: 'agent', label: 'Usar emojis', type: 'toggle', required: false },
  { id: 'agent_greeting', section: 'agent', label: 'Saludo inicial', type: 'ai_text', required: true, aiContext: { description: 'Mensaje de bienvenida cuando un cliente escribe por primera vez', examples: ['Hola! Soy Alex de Underwave, en que te ayudo?', 'Buenas! Bienvenido, que buscas?'], maxLength: 200 } },
  { id: 'agent_max_lines', section: 'agent', label: 'Max lineas por respuesta', type: 'select', required: true, options: [
    { value: '3', label: '3 lineas (conciso)' }, { value: '4', label: '4 lineas (balanceado)' },
    { value: '5', label: '5 lineas (mas detalle)' }, { value: '6', label: '6 lineas (extenso)' },
  ] },
  // HOURS
  { id: 'hours_weekdays_from', section: 'hours', label: 'Lunes a Viernes - Apertura', type: 'time', required: true },
  { id: 'hours_weekdays_to', section: 'hours', label: 'Lunes a Viernes - Cierre', type: 'time', required: true },
  { id: 'hours_saturday_active', section: 'hours', label: 'Atienden sabados?', type: 'toggle', required: false },
  { id: 'hours_saturday_from', section: 'hours', label: 'Sabado - Apertura', type: 'time', required: false, dependsOn: { fieldId: 'hours_saturday_active', value: true } },
  { id: 'hours_saturday_to', section: 'hours', label: 'Sabado - Cierre', type: 'time', required: false, dependsOn: { fieldId: 'hours_saturday_active', value: true } },
  { id: 'hours_sunday_active', section: 'hours', label: 'Atienden domingos?', type: 'toggle', required: false },
  { id: 'hours_sunday_from', section: 'hours', label: 'Domingo - Apertura', type: 'time', required: false, dependsOn: { fieldId: 'hours_sunday_active', value: true } },
  { id: 'hours_sunday_to', section: 'hours', label: 'Domingo - Cierre', type: 'time', required: false, dependsOn: { fieldId: 'hours_sunday_active', value: true } },
  { id: 'hours_bot_24_7', section: 'hours', label: 'El agente responde 24/7?', type: 'toggle', required: false },
  { id: 'hours_out_of_hours_message', section: 'hours', label: 'Mensaje fuera de horario', type: 'ai_text', required: false, dependsOn: { fieldId: 'hours_bot_24_7', value: false }, aiContext: { description: 'Mensaje que el agente envia fuera de horario', examples: ['Estamos cerrados, te respondemos manana a las 9hs.'], maxLength: 200 } },
  // PAYMENT
  { id: 'payment_methods', section: 'payment', label: 'Metodos de pago', type: 'multi_select', required: true, options: [
    { value: 'tarjeta_debito', label: 'Tarjeta de debito' }, { value: 'tarjeta_credito', label: 'Tarjeta de credito' },
    { value: 'transferencia', label: 'Transferencia bancaria' }, { value: 'efectivo', label: 'Efectivo' },
    { value: 'mercadopago', label: 'MercadoPago' }, { value: 'modo', label: 'MODO' }, { value: 'cuenta_dni', label: 'Cuenta DNI' },
  ] },
  { id: 'payment_has_discounts', section: 'payment', label: 'Descuentos por metodo de pago?', type: 'toggle', required: false },
  { id: 'payment_discount_detail', section: 'payment', label: 'Detalle de descuentos', type: 'ai_text', required: false, dependsOn: { fieldId: 'payment_has_discounts', value: true }, aiContext: { description: 'Descuentos por metodo de pago', examples: ['10% off con transferencia', '15% efectivo en local'], maxLength: 300 } },
  { id: 'payment_installments', section: 'payment', label: 'Cuotas sin interes?', type: 'toggle', required: false },
  { id: 'payment_installments_count', section: 'payment', label: 'Cantidad de cuotas', type: 'select', required: false, dependsOn: { fieldId: 'payment_installments', value: true }, options: [
    { value: '3', label: '3 cuotas' }, { value: '6', label: '6 cuotas' }, { value: '12', label: '12 cuotas' },
  ] },
  // SHIPPING
  { id: 'shipping_active', section: 'shipping', label: 'Hacen envios?', type: 'toggle', required: false },
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
  { id: 'policies_exchanges', section: 'policies', label: 'Acepta cambios?', type: 'toggle', required: false },
  { id: 'policies_exchange_days', section: 'policies', label: 'Plazo para cambios', type: 'select', required: false, dependsOn: { fieldId: 'policies_exchanges', value: true }, options: [
    { value: '7', label: '7 dias' }, { value: '15', label: '15 dias' }, { value: '30', label: '30 dias' },
  ] },
  { id: 'policies_exchange_conditions', section: 'policies', label: 'Condiciones de cambio', type: 'ai_text', required: false, dependsOn: { fieldId: 'policies_exchanges', value: true }, aiContext: { description: 'Condiciones para hacer un cambio', examples: ['Sin uso, con etiqueta original'], maxLength: 300 } },
  { id: 'policies_returns', section: 'policies', label: 'Devoluciones de dinero?', type: 'toggle', required: false },
  { id: 'policies_warranty', section: 'policies', label: 'Politica de garantia', type: 'ai_text', required: false, aiContext: { description: 'Politica de garantia del negocio', examples: ['Garantia de fabrica 6 meses', 'Sin garantia'], maxLength: 300 } },
  // PROMOTIONS
  { id: 'promotions_active', section: 'promotions', label: 'Tiene promos activas?', type: 'toggle', required: false },
  { id: 'promotions_description', section: 'promotions', label: 'Descripcion de las promos', type: 'ai_text', required: false, dependsOn: { fieldId: 'promotions_active', value: true }, aiContext: { description: 'Promociones vigentes', examples: ['15% off en herramientas electricas todo octubre', '2x1 en remeras'], maxLength: 500 } },
  // ESCALATION
  { id: 'escalation_active', section: 'escalation', label: 'Pasar a humano en ciertos casos?', type: 'toggle', required: false },
  { id: 'escalation_cases', section: 'escalation', label: 'Casos de escalamiento', type: 'multi_select', required: false, dependsOn: { fieldId: 'escalation_active', value: true }, options: [
    { value: 'insultos', label: 'Insultos' }, { value: 'quejas', label: 'Quejas formales' },
    { value: 'devoluciones', label: 'Devoluciones' }, { value: 'tecnico', label: 'Problemas tecnicos' },
    { value: 'ventas_grandes', label: 'Ventas grandes' }, { value: 'pide_humano', label: 'Pide hablar con alguien' },
  ] },
  { id: 'escalation_contact', section: 'escalation', label: 'Quien atiende (nombre o numero)', type: 'simple_text', required: false, dependsOn: { fieldId: 'escalation_active', value: true }, validation: { maxLength: 100 } },
  // CAPTION (epigrafe de productos)
  { id: 'caption_show_price', section: 'caption', label: 'Mostrar precio', type: 'toggle', required: false },
  { id: 'caption_show_brand', section: 'caption', label: 'Mostrar marca', type: 'toggle', required: false },
  { id: 'caption_show_category', section: 'caption', label: 'Mostrar categoria', type: 'toggle', required: false },
  { id: 'caption_show_description', section: 'caption', label: 'Mostrar descripcion (primeras 2 lineas)', type: 'toggle', required: false },
  { id: 'caption_show_sizes', section: 'caption', label: 'Mostrar talles disponibles', type: 'toggle', required: false },
  { id: 'caption_show_link', section: 'caption', label: 'Mostrar link al producto', type: 'toggle', required: false },
  { id: 'caption_extra_text', section: 'caption', label: 'Texto fijo adicional', type: 'ai_text', required: false, aiContext: { description: 'Texto que se agrega siempre al final del epigrafe de cada producto (ej: promo, envio gratis, etc.)', examples: ['10% off con transferencia!', 'Envio gratis a todo el pais', '3 cuotas sin interes'], maxLength: 150 } },
];

const STORAGE_KEY = 'onboarding_v2';

function initSectionStates(): Record<string, SectionStatus> {
  const s: Record<string, SectionStatus> = {};
  for (const sec of SECTIONS) s[sec.id] = 'not_visited';
  return s;
}

function initDefaults(): Record<string, any> {
  const c: Record<string, any> = {};
  for (const f of FIELDS) {
    if (f.type === 'toggle') c[f.id] = false;
    if (f.type === 'multi_select') c[f.id] = [];
  }
  return c;
}

// ============================================================
// PAGE
// ============================================================
export default function OnboardingPage() {
  const { auth } = useAuth();
  const tenantId = auth?.tenantId;

  const [config, setConfig] = useState<Record<string, any>>(initDefaults);
  const [sectionStates, setSectionStates] = useState<Record<string, SectionStatus>>(initSectionStates);
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<Record<string, { improved?: string; rejectReason?: string } | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sampleProducts, setSampleProducts] = useState<Record<string, any>[]>([]);
  const [availableCaptionFields, setAvailableCaptionFields] = useState<Set<string>>(new Set());
  const [wasCompleted, setWasCompleted] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<{ fieldId: string; fieldLabel: string; value: any; oldValue: any } | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  };

  // Persist to localStorage
  useEffect(() => {
    if (!tenantId || loading) return;
    try {
      localStorage.setItem(`${STORAGE_KEY}_${tenantId}`, JSON.stringify({ config, sectionStates }));
    } catch {}
  }, [config, sectionStates, tenantId, loading]);

  // Load from localStorage + backend
  useEffect(() => {
    if (!tenantId) return;
    try {
      const saved = localStorage.getItem(`${STORAGE_KEY}_${tenantId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.config) setConfig(prev => ({ ...prev, ...parsed.config }));
        if (parsed.sectionStates) {
          setSectionStates(prev => ({ ...prev, ...parsed.sectionStates }));
          const allDone = Object.values(parsed.sectionStates).every((s: any) => s === 'completed');
          if (allDone) setWasCompleted(true);
        }
      }
    } catch {}

    api('/onboarding/v2/state', { tenantId })
      .then(data => {
        if (data.config && Object.keys(data.config).length > 0) {
          setConfig(prev => ({ ...prev, ...data.config }));
        }
        if (data.sectionsState) {
          setSectionStates(prev => ({ ...prev, ...data.sectionsState }));
          const allDone = Object.values(data.sectionsState).length > 0 &&
            Object.values(data.sectionsState).every((s: any) => s === 'completed');
          if (allDone) setWasCompleted(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // Load products to detect available caption fields
    api('/agents/products', { tenantId })
      .then(data => {
        const products = data.products || [];
        if (products.length === 0) return;

        // Detect which fields have data across products
        const available = new Set<string>();
        available.add('price');

        // Score products by how many fields they have filled
        const scored = products.map((p: any) => {
          let score = 0;
          if (p.brand) { available.add('brand'); score++; }
          if (p.category) { available.add('category'); score++; }
          if (p.description) { available.add('description'); score++; }
          if (p.sizes?.length > 0) { available.add('sizes'); score++; }
          if (p.priceNum > 0) score++;
          if (p.imageUrl) score++;
          return { ...p, _score: score };
        });
        available.add('link');

        // Pick 2 different products with best scores
        scored.sort((a: any, b: any) => b._score - a._score);
        const picks: any[] = [scored[0]];
        for (const p of scored.slice(1)) {
          if (p.name !== picks[0].name) { picks.push(p); break; }
        }

        setAvailableCaptionFields(available);
        setSampleProducts(picks);
      })
      .catch(() => {});
  }, [tenantId]);

  // Mark section as in_progress when navigating to it
  const goToSection = (idx: number) => {
    setCurrentSectionIdx(idx);
    const sectionId = SECTIONS[idx].id;
    setSectionStates(prev => {
      if (prev[sectionId] === 'completed') return prev;
      return { ...prev, [sectionId]: 'in_progress' };
    });
    setErrors({});
    window.scrollTo(0, 0);
  };

  // Mark first section on load
  useEffect(() => {
    if (!loading) {
      setSectionStates(prev => {
        if (prev[SECTIONS[0].id] === 'completed') return prev;
        return { ...prev, [SECTIONS[0].id]: 'in_progress' };
      });
    }
  }, [loading]);

  const currentSection = SECTIONS[currentSectionIdx];
  const sectionFields = FIELDS.filter(f => f.section === currentSection?.id);
  const completedCount = Object.values(sectionStates).filter(s => s === 'completed').length;
  const progress = Math.round((completedCount / SECTIONS.length) * 100);
  const allComplete = completedCount === SECTIONS.length;

  const isFieldVisible = useCallback((field: FieldDef) => {
    if (!field.dependsOn) return true;
    return config[field.dependsOn.fieldId] === field.dependsOn.value;
  }, [config]);

  const isCurrentSectionCompleted = currentSection ? sectionStates[currentSection.id] === 'completed' : false;

  const setValue = (fieldId: string, value: any) => {
    // If section already completed, ask for confirmation first
    if (isCurrentSectionCompleted) {
      const field = FIELDS.find(f => f.id === fieldId);
      setPendingEdit({ fieldId, fieldLabel: field?.label || fieldId, value, oldValue: config[fieldId] });
      return;
    }
    applyValue(fieldId, value);
  };

  const applyValue = (fieldId: string, value: any) => {
    setConfig(prev => ({ ...prev, [fieldId]: value }));
    setErrors(prev => { const n = { ...prev }; delete n[fieldId]; return n; });
    setAiResult(prev => { const n = { ...prev }; delete n[fieldId]; return n; });
  };

  const confirmEdit = async () => {
    if (!pendingEdit || !tenantId || !currentSection) return;
    // Apply the change
    applyValue(pendingEdit.fieldId, pendingEdit.value);
    setPendingEdit(null);

    // Auto-save the section
    setSaving(true);
    const fieldValues: Record<string, any> = {};
    for (const f of sectionFields) {
      if (isFieldVisible(f)) {
        fieldValues[f.id] = f.id === pendingEdit.fieldId
          ? pendingEdit.value
          : (config[f.id] ?? (f.type === 'toggle' ? false : f.type === 'multi_select' ? [] : ''));
      }
    }
    // Also include caption_order if it exists in config (it's an array, not in catalog)
    if (config.caption_order) fieldValues.caption_order = config.caption_order;

    try {
      await api('/onboarding/v2/save-section', {
        method: 'POST', tenantId,
        body: { sectionId: currentSection.id, fields: fieldValues },
      });
      showToast('success', `${currentSection.label} actualizado`);
    } catch (err: any) {
      showToast('error', err.message || 'Error al guardar');
    }
    setSaving(false);
  };

  const cancelEdit = () => setPendingEdit(null);

  const improveField = async (fieldId: string) => {
    const value = config[fieldId];
    if (!value || !tenantId) return;
    setAiLoading(fieldId);
    try {
      const result = await api('/onboarding/v2/improve-field', {
        method: 'POST', tenantId, body: { fieldId, userInput: value },
      });
      if (result.accepted && result.improved) {
        // Always show the improvement so the user sees what changed
        setAiResult(prev => ({ ...prev, [fieldId]: result }));
      } else if (!result.accepted) {
        setAiResult(prev => ({ ...prev, [fieldId]: result }));
      }
    } catch (err) {
      console.error('[IMPROVE-FIELD] Error:', err);
    }
    setAiLoading(null);
  };

  const acceptImprovement = (fieldId: string) => {
    const r = aiResult[fieldId];
    if (r?.improved) setConfig(prev => ({ ...prev, [fieldId]: r.improved }));
    setAiResult(prev => { const n = { ...prev }; delete n[fieldId]; return n; });
  };

  const dismissAi = (fieldId: string) => {
    setAiResult(prev => { const n = { ...prev }; delete n[fieldId]; return n; });
  };

  // Save & continue
  const saveSection = async () => {
    if (!tenantId || !currentSection) return;
    setSaving(true);
    setErrors({});

    // Validate required fields (only non-toggle, non-hidden)
    const newErrors: Record<string, string> = {};
    for (const f of sectionFields) {
      if (!isFieldVisible(f) || !f.required || f.type === 'toggle') continue;
      const v = config[f.id];
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) {
        newErrors[f.id] = `${f.label} es requerido`;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      showToast('error', `Faltan datos: ${Object.values(newErrors).join(', ')}`);
      setSaving(false);
      return;
    }

    // Build values
    const fieldValues: Record<string, any> = {};
    for (const f of sectionFields) {
      if (isFieldVisible(f)) {
        fieldValues[f.id] = config[f.id] ?? (f.type === 'toggle' ? false : f.type === 'multi_select' ? [] : '');
      }
    }

    // Save to backend
    try {
      const res = await api('/onboarding/v2/save-section', {
        method: 'POST', tenantId,
        body: { sectionId: currentSection.id, fields: fieldValues },
      });
      if (!res.saved && res.errors) {
        setErrors(res.errors);
        showToast('error', 'Error al guardar');
        setSaving(false);
        return;
      }
    } catch (err: any) {
      showToast('error', err.message || 'Error al guardar');
      setSaving(false);
      return;
    }

    // Mark completed
    setSectionStates(prev => ({ ...prev, [currentSection.id]: 'completed' }));
    showToast('success', `${currentSection.label} guardado`);
    setHasPendingChanges(true);

    // Advance
    if (currentSectionIdx < SECTIONS.length - 1) {
      setTimeout(() => goToSection(currentSectionIdx + 1), 300);
    }
    setSaving(false);
  };

  const completeOnboarding = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      await api('/onboarding/v2/complete', { method: 'POST', tenantId });
      showToast('success', 'Agente activado!');
      window.dispatchEvent(new Event('config-changed'));
    } catch (err: any) {
      showToast('error', err.message || 'Error al activar');
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
        <div className="max-w-4xl mx-auto px-6 py-6">
          {/* Steps nav — 3 states */}
          <div className="flex flex-wrap gap-1.5 mb-8">
            {SECTIONS.map((s, i) => {
              const status = sectionStates[s.id] || 'not_visited';
              const isActive = i === currentSectionIdx;
              return (
                <button
                  key={s.id}
                  onClick={() => goToSection(i)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition border ${
                    isActive
                      ? 'bg-primary-600 text-white border-primary-600'
                      : status === 'completed'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : status === 'in_progress'
                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                      : 'bg-gray-100 text-gray-400 border-gray-200'
                  }`}
                >
                  {status === 'completed' && !isActive ? (
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : status === 'in_progress' && !isActive ? (
                    <span className="text-xs">&#9684;</span>
                  ) : null}
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Caption section: custom render with preview */}
          {currentSection?.id === 'caption' && (
            <CaptionSection
              config={config}
              setValue={setValue}
              applyValue={applyValue}
              sampleProducts={sampleProducts}
              availableFields={availableCaptionFields}
              aiLoading={aiLoading}
              aiResult={aiResult}
              improveField={improveField}
              acceptImprovement={acceptImprovement}
              dismissAi={dismissAi}
              errors={errors}
              tenantId={tenantId}
            />
          )}

          {/* Fields (generic — skip for caption section) */}
          {currentSection?.id !== 'caption' && <div className="space-y-5">
            {sectionFields.map(field => {
              if (!isFieldVisible(field)) return null;
              return (
                <div key={field.id}>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {field.label}
                    {field.required && <span className="text-red-400 ml-0.5">*</span>}
                  </label>

                  {field.type === 'simple_text' && (
                    <input type="text" value={config[field.id] || ''} onChange={e => setValue(field.id, e.target.value)}
                      maxLength={field.validation?.maxLength}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder={field.aiContext?.examples?.[0] || ''} />
                  )}

                  {field.type === 'ai_text' && (
                    <div>
                      <textarea value={config[field.id] || ''} onChange={e => setValue(field.id, e.target.value)}
                        maxLength={field.aiContext?.maxLength} rows={3}
                        className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                        placeholder={field.aiContext?.examples?.[0] || ''} />
                      {config[field.id] && !aiResult[field.id] && (
                        <button onClick={() => improveField(field.id)} disabled={aiLoading === field.id}
                          className="mt-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
                          {aiLoading === field.id
                            ? <><div className="w-3 h-3 border border-primary-600 border-t-transparent rounded-full animate-spin" /> Mejorando...</>
                            : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" /></svg> Mejorar con IA</>}
                        </button>
                      )}
                      {aiResult[field.id] && (
                        <div className={`mt-2 rounded-lg p-3 text-sm ${aiResult[field.id]!.improved ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                          {aiResult[field.id]!.improved ? (<>
                            <p className="text-emerald-700 text-xs font-medium mb-1">Mejorado por IA:</p>
                            <p className="text-emerald-900">&ldquo;{aiResult[field.id]!.improved}&rdquo;</p>
                            <div className="flex gap-2 mt-2">
                              <button onClick={() => acceptImprovement(field.id)} className="text-xs bg-emerald-600 text-white px-3 py-1 rounded-md hover:bg-emerald-700">Aceptar</button>
                              <button onClick={() => dismissAi(field.id)} className="text-xs text-gray-500 hover:text-gray-700">Mantener original</button>
                            </div>
                          </>) : (<>
                            <p className="text-red-600 text-xs">{aiResult[field.id]!.rejectReason}</p>
                            <button onClick={() => dismissAi(field.id)} className="mt-1 text-xs text-gray-500 hover:text-gray-700">Cerrar</button>
                          </>)}
                        </div>
                      )}
                    </div>
                  )}

                  {field.type === 'select' && (
                    <select value={config[field.id] || ''} onChange={e => setValue(field.id, e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                      <option value="">Seleccionar...</option>
                      {field.options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  )}

                  {field.type === 'multi_select' && (
                    <div className="flex flex-wrap gap-2">
                      {field.options?.map(opt => {
                        const sel = (config[field.id] || []).includes(opt.value);
                        return (
                          <button key={opt.value} type="button"
                            onClick={() => { const cur: string[] = config[field.id] || []; setValue(field.id, sel ? cur.filter(v => v !== opt.value) : [...cur, opt.value]); }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition border ${sel ? 'bg-primary-100 border-primary-300 text-primary-700' : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'}`}>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {field.type === 'toggle' && (
                    <button type="button" onClick={() => setValue(field.id, !config[field.id])}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${config[field.id] ? 'bg-primary-600' : 'bg-gray-300'}`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${config[field.id] ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  )}

                  {field.type === 'number' && (
                    <input type="number" value={config[field.id] || ''} onChange={e => setValue(field.id, e.target.value ? Number(e.target.value) : '')}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  )}

                  {field.type === 'url' && (
                    <input type="url" value={config[field.id] || ''} onChange={e => setValue(field.id, e.target.value)} placeholder="https://..."
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  )}

                  {field.type === 'time' && (
                    <input type="time" value={config[field.id] || ''} onChange={e => setValue(field.id, e.target.value)}
                      className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  )}

                  {errors[field.id] && <p className="text-xs text-red-500 mt-1">{errors[field.id]}</p>}
                </div>
              );
            })}
          </div>}

          {/* Actions */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-200">
            <button onClick={() => goToSection(Math.max(0, currentSectionIdx - 1))} disabled={currentSectionIdx === 0}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-30 flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
              </svg>
              Atras
            </button>

            {isCurrentSectionCompleted ? (
              <span className="text-xs text-gray-400">Seccion guardada. Edita un campo para modificar.</span>
            ) : (
            <button onClick={saveSection} disabled={saving}
              className="bg-primary-600 text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2">
              {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
              {saving ? 'Guardando...' : 'Guardar y continuar'}
              {!saving && <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>}
            </button>
            )}
          </div>
        </div>
      </div>

      {/* Edit confirmation modal */}
      {pendingEdit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" onClick={cancelEdit}>
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm mx-4" onClick={e => e.stopPropagation()}>
            <p className="text-sm font-medium text-gray-900 mb-1">Editar {pendingEdit.fieldLabel}?</p>
            <p className="text-xs text-gray-500 mb-4">El cambio se guarda automaticamente.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={cancelEdit} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
              <button onClick={confirmEdit} disabled={saving}
                className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1.5">
                {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                Si, editar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white flex items-center gap-2 animate-[slideUp_0.3s_ease-out] ${
            t.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
          }`}>
            {t.type === 'success' ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            )}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// CAPTION SECTION — Drag-and-drop reorder + live preview
// ============================================================
const CAPTION_ITEMS = [
  { key: 'price', label: 'Precio', configId: 'caption_show_price' },
  { key: 'brand', label: 'Marca', configId: 'caption_show_brand' },
  { key: 'category', label: 'Categoria', configId: 'caption_show_category' },
  { key: 'description', label: 'Descripcion', configId: 'caption_show_description' },
  { key: 'sizes', label: 'Talles disponibles', configId: 'caption_show_sizes' },
  { key: 'link', label: 'Link al producto', configId: 'caption_show_link' },
];

function CaptionSection({ config, setValue, applyValue, sampleProducts, availableFields, aiLoading, aiResult, improveField, acceptImprovement, dismissAi, errors, tenantId }: {
  config: Record<string, any>;
  setValue: (id: string, v: any) => void;
  applyValue: (id: string, v: any) => void;
  sampleProducts: Record<string, any>[];
  availableFields: Set<string>;
  aiLoading: string | null;
  aiResult: Record<string, any>;
  improveField: (id: string) => void;
  acceptImprovement: (id: string) => void;
  dismissAi: (id: string) => void;
  errors: Record<string, string>;
  tenantId?: string;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Only items with available data
  const visibleItems = CAPTION_ITEMS.filter(t => availableFields.has(t.key));

  // Order: stored in config.caption_order as array of keys, fallback to default
  const defaultOrder = visibleItems.map(t => t.key);
  const order: string[] = config.caption_order && Array.isArray(config.caption_order)
    ? config.caption_order.filter((k: string) => visibleItems.some(v => v.key === k))
    : defaultOrder;
  // Add any new items not in saved order
  for (const item of visibleItems) {
    if (!order.includes(item.key)) order.push(item.key);
  }

  const orderedItems = order.map(k => visibleItems.find(v => v.key === k)!).filter(Boolean);

  // Drag handlers — reorder locally during drag, save on drop (skip confirmation modal)
  const handleDragStart = (idx: number) => setDragIdx(idx);
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const newOrder = [...order];
    const [moved] = newOrder.splice(dragIdx, 1);
    newOrder.splice(idx, 0, moved);
    // Use applyValue to skip confirmation modal for drag reorder
    applyValue('caption_order', newOrder);
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  // Truncate description to first sentence (first ".")
  function shortDescription(desc: string): string {
    if (!desc) return '';
    const dotIdx = desc.indexOf('.');
    if (dotIdx > 0 && dotIdx < desc.length - 1) return desc.slice(0, dotIdx + 1);
    return desc;
  }

  // Build preview lines for a given product
  const buildPreviewLines = (product: Record<string, any>): string[] => {
    if (!product) return ['Cargando productos...'];
    const lines: string[] = [];
    lines.push(`*${product.name}*`);

    for (const key of order) {
      const item = visibleItems.find(v => v.key === key);
      if (!item || !config[item.configId]) continue;

      switch (key) {
        case 'price':
          if (product.priceNum) lines.push(`$${Number(product.priceNum).toLocaleString('es-AR')}`);
          break;
        case 'brand':
          if (product.brand) lines.push(product.brand);
          break;
        case 'category':
          if (product.category) lines.push(product.category);
          break;
        case 'description':
          if (product.description) {
            lines.push(shortDescription(product.description));
          }
          break;
        case 'sizes':
          if (product.sizes?.length > 0) lines.push(`Talles: ${product.sizes.join(', ')}`);
          break;
        case 'link':
          if (product.pageUrl) lines.push(product.pageUrl);
          break;
      }
    }

    if (config.caption_extra_text) {
      lines.push('');
      lines.push(config.caption_extra_text);
    }
    return lines;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <p className="text-sm text-gray-600 mb-1">
          Cuando el agente envia una foto de un producto, se agrega un epigrafe debajo.
        </p>
        <p className="text-xs text-gray-400 mb-4">
          Activa los campos que quieras mostrar y arrastralos para cambiar el orden.
        </p>

        {/* Draggable toggles */}
        <div className="space-y-1">
          {orderedItems.map((item, idx) => (
            <div
              key={item.key}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`flex items-center justify-between py-2 px-3 rounded-lg cursor-grab active:cursor-grabbing transition ${
                dragIdx === idx ? 'bg-primary-50 border border-primary-200' : 'hover:bg-gray-50'
              } ${config[item.configId] ? '' : 'opacity-50'}`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-gray-300 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
                </svg>
                <span className="text-sm text-gray-700">{item.label}</span>
                {item.key === 'description' && config[item.configId] && (
                  <span className="text-xs text-gray-400">(hasta el primer punto)</span>
                )}
              </div>
              <button type="button" onClick={() => setValue(item.configId, !config[item.configId])}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0 ${config[item.configId] ? 'bg-primary-600' : 'bg-gray-300'}`}>
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${config[item.configId] ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          ))}

          {visibleItems.length === 0 && (
            <p className="text-sm text-gray-400 py-2">Primero escaneá tus productos para ver los campos disponibles.</p>
          )}
        </div>
      </div>

      {/* Extra text */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Texto fijo adicional <span className="text-gray-400 font-normal">(se agrega siempre al final)</span>
        </label>
        <textarea value={config.caption_extra_text || ''} onChange={e => setValue('caption_extra_text', e.target.value)}
          maxLength={150} rows={2}
          className="w-full bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
          placeholder="Ej: 10% off con transferencia! / Envio gratis a todo el pais" />
        {config.caption_extra_text && !aiResult.caption_extra_text && (
          <button onClick={() => improveField('caption_extra_text')} disabled={aiLoading === 'caption_extra_text'}
            className="mt-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
            {aiLoading === 'caption_extra_text'
              ? <><div className="w-3 h-3 border border-primary-600 border-t-transparent rounded-full animate-spin" /> Mejorando...</>
              : <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" /></svg> Mejorar con IA</>}
          </button>
        )}
        {aiResult.caption_extra_text && (
          <div className={`mt-2 rounded-lg p-3 text-sm ${aiResult.caption_extra_text.improved ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            {aiResult.caption_extra_text.improved ? (<>
              <p className="text-emerald-700 text-xs font-medium mb-1">Mejorado por IA:</p>
              <p className="text-emerald-900">&ldquo;{aiResult.caption_extra_text.improved}&rdquo;</p>
              <div className="flex gap-2 mt-2">
                <button onClick={() => acceptImprovement('caption_extra_text')} className="text-xs bg-emerald-600 text-white px-3 py-1 rounded-md hover:bg-emerald-700">Aceptar</button>
                <button onClick={() => dismissAi('caption_extra_text')} className="text-xs text-gray-500 hover:text-gray-700">Mantener original</button>
              </div>
            </>) : (<>
              <p className="text-red-600 text-xs">{aiResult.caption_extra_text.rejectReason}</p>
              <button onClick={() => dismissAi('caption_extra_text')} className="mt-1 text-xs text-gray-500 hover:text-gray-700">Cerrar</button>
            </>)}
          </div>
        )}
      </div>

      {/* Live preview */}
      {sampleProducts.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Preview del epigrafe</p>
          <div className="flex gap-4 justify-center">
            {sampleProducts.map((product, idx) => (
              <CaptionPreview
                key={idx}
                sampleProduct={product}
                previewLines={buildPreviewLines(product)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// CAPTION PREVIEW — product card
// ============================================================
function CaptionPreview({ sampleProduct, previewLines }: {
  sampleProduct: Record<string, any>;
  previewLines: string[];
}) {
  return (
    <div className="w-64">
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        {sampleProduct.imageUrl && (
          <img src={sampleProduct.imageUrl} alt={sampleProduct.name} className="w-full h-52 object-cover" />
        )}
        <div className="p-3">
          {previewLines.map((line, i) => (
            <p key={i} className={`text-sm leading-relaxed ${
              line.startsWith('*') ? 'text-white font-semibold' :
              line.startsWith('http') ? 'text-blue-400 underline break-all text-xs' :
              line === '' ? 'h-2' :
              'text-gray-300'
            }`}>
              {line.startsWith('*') && line.endsWith('*') ? line.slice(1, -1) : line}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
