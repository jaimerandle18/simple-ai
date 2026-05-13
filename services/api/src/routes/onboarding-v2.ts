/**
 * Onboarding v2 — Formulario estructurado con IA constrained.
 * Reemplaza el chat conversacional con un wizard de 8 pasos.
 */
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { keys, getItem, putItem } from '../lib/dynamo';
import { json, error } from '../lib/response';
import {
  FIELDS_CATALOG, SECTIONS, getField, getFieldsForSection,
  validateFieldValue,
} from '../lib/onboarding/fields-catalog';
import { validateAndImproveField } from '../lib/onboarding/validate-field';
import { generateSystemPrompt, syncConfigToAgent, type BusinessConfig } from '../lib/onboarding/generate-prompt';

// ============================================================
// HANDLER
// ============================================================
export async function handleOnboardingV2(event: APIGatewayProxyEventV2) {
  const path = event.requestContext.http.path;
  const method = event.requestContext.http.method;
  const tenantId = event.headers['x-tenant-id'];
  if (!tenantId) return error('x-tenant-id required', 401);

  // ──────────────────────────────────────────────
  // GET /onboarding/v2/state — estado completo
  // ──────────────────────────────────────────────
  if (method === 'GET' && path === '/onboarding/v2/state') {
    const agent = await getItem(keys.agent(tenantId, 'main'));
    const config: Record<string, any> = agent?.onboardingV2 || {};
    const completedSections = getCompletedSections(config);
    const currentSection = getNextSection(completedSections);

    return json({
      config,
      completedSections,
      currentSection,
      sections: SECTIONS,
      fields: FIELDS_CATALOG,
      isComplete: completedSections.length === SECTIONS.length,
    });
  }

  // ──────────────────────────────────────────────
  // GET /onboarding/v2/section/:id — campos de una seccion
  // ──────────────────────────────────────────────
  const sectionMatch = path.match(/^\/onboarding\/v2\/section\/([^/]+)$/);
  if (method === 'GET' && sectionMatch) {
    const sectionId = sectionMatch[1];
    const section = SECTIONS.find(s => s.id === sectionId);
    if (!section) return error('Section not found', 404);

    const agent = await getItem(keys.agent(tenantId, 'main'));
    const config: Record<string, any> = agent?.onboardingV2 || {};
    const fields = getFieldsForSection(sectionId);

    // Incluir valores actuales
    const fieldsWithValues = fields.map(f => ({
      ...f,
      value: config[f.id] ?? null,
    }));

    return json({ section, fields: fieldsWithValues });
  }

  // ──────────────────────────────────────────────
  // POST /onboarding/v2/save-field — guardar un campo
  // ──────────────────────────────────────────────
  if (method === 'POST' && path === '/onboarding/v2/save-field') {
    const body = JSON.parse(event.body || '{}');
    const { fieldId, value } = body;

    if (!fieldId) return error('fieldId is required', 400);

    const field = getField(fieldId);
    if (!field) return error(`Field "${fieldId}" not found`, 404);

    // Validacion estructural
    const validation = validateFieldValue(field, value);
    if (!validation.valid) {
      return json({ saved: false, error: validation.error }, 400);
    }

    // Guardar
    const agent = await getItem(keys.agent(tenantId, 'main'));
    if (!agent) return error('Agent not found. Create tenant first.', 404);

    const config: Record<string, any> = { ...(agent.onboardingV2 || {}) };
    config[fieldId] = value;

    await putItem({
      ...agent,
      onboardingV2: config,
      updatedAt: new Date().toISOString(),
    });

    return json({ saved: true, fieldId, value });
  }

  // ──────────────────────────────────────────────
  // POST /onboarding/v2/save-section — guardar seccion completa
  // ──────────────────────────────────────────────
  if (method === 'POST' && path === '/onboarding/v2/save-section') {
    const body = JSON.parse(event.body || '{}');
    const { sectionId, fields: fieldValues } = body;

    if (!sectionId || !fieldValues || typeof fieldValues !== 'object') {
      return error('sectionId and fields object are required', 400);
    }

    const section = SECTIONS.find(s => s.id === sectionId);
    if (!section) return error('Section not found', 404);

    const sectionFields = getFieldsForSection(sectionId);
    const errors: Record<string, string> = {};

    // Validar cada campo
    for (const field of sectionFields) {
      const value = fieldValues[field.id];

      // Skip si depende de otro campo que no esta activo
      if (field.dependsOn) {
        const depValue = fieldValues[field.dependsOn.fieldId];
        if (depValue !== field.dependsOn.value) continue;
      }

      const validation = validateFieldValue(field, value);
      if (!validation.valid) {
        errors[field.id] = validation.error!;
      }
    }

    if (Object.keys(errors).length > 0) {
      return json({ saved: false, errors }, 400);
    }

    // Guardar todo
    const agent = await getItem(keys.agent(tenantId, 'main'));
    if (!agent) return error('Agent not found', 404);

    const config: Record<string, any> = { ...(agent.onboardingV2 || {}) };
    for (const [fieldId, value] of Object.entries(fieldValues)) {
      config[fieldId] = value;
    }

    const completedSections = getCompletedSections(config);
    const nextSection = getNextSection(completedSections);

    await putItem({
      ...agent,
      onboardingV2: config,
      updatedAt: new Date().toISOString(),
    });

    return json({ saved: true, completedSections, nextSection });
  }

  // ──────────────────────────────────────────────
  // POST /onboarding/v2/improve-field — mejorar campo IA
  // ──────────────────────────────────────────────
  if (method === 'POST' && path === '/onboarding/v2/improve-field') {
    const body = JSON.parse(event.body || '{}');
    const { fieldId, userInput } = body;

    if (!fieldId || !userInput) {
      return error('fieldId and userInput are required', 400);
    }

    const field = getField(fieldId);
    if (!field) return error(`Field "${fieldId}" not found`, 404);

    if (field.type !== 'ai_text') {
      return error(`Field "${fieldId}" does not support AI improvement`, 400);
    }

    // Cargar contexto del negocio
    const agent = await getItem(keys.agent(tenantId, 'main'));
    const config: Record<string, any> = agent?.onboardingV2 || {};

    const result = await validateAndImproveField({
      field,
      userInput,
      businessContext: {
        name: config.business_name,
        rubro: config.business_rubro,
      },
    });

    return json(result);
  }

  // ──────────────────────────────────────────────
  // POST /onboarding/v2/complete — finalizar onboarding
  // ──────────────────────────────────────────────
  if (method === 'POST' && path === '/onboarding/v2/complete') {
    const agent = await getItem(keys.agent(tenantId, 'main'));
    if (!agent) return error('Agent not found', 404);

    const config: Record<string, any> = agent.onboardingV2 || {};
    const completedSections = getCompletedSections(config);

    // Verificar minimo: business + agent deben estar completos
    if (!completedSections.includes('business') || !completedSections.includes('agent')) {
      return error('Las secciones Negocio y Agente IA son obligatorias', 400);
    }

    // Convertir flat config a BusinessConfig estructurado
    const structured = flatToStructured(config);

    // Generar system prompt
    const systemPrompt = generateSystemPrompt(structured);

    // Sincronizar a agentConfig
    const agentSync = syncConfigToAgent(structured);
    const agentConfig = { ...(agent.agentConfig || {}), ...agentSync, active: true };

    // Guardar todo
    const now = new Date().toISOString();
    await putItem({
      ...agent,
      agentConfig,
      businessConfig: structured, // structured version para compatibilidad
      onboardingV2: { ...config, _completedAt: now },
      updatedAt: now,
    });

    return json({
      ok: true,
      systemPrompt,
      completedSections,
      agentConfig: { assistantName: agentConfig.assistantName, tone: agentConfig.tone },
    });
  }

  // ──────────────────────────────────────────────
  // POST /onboarding/v2/preview-prompt — preview del prompt
  // ──────────────────────────────────────────────
  if (method === 'POST' && path === '/onboarding/v2/preview-prompt') {
    const agent = await getItem(keys.agent(tenantId, 'main'));
    const config: Record<string, any> = agent?.onboardingV2 || {};
    const structured = flatToStructured(config);
    const prompt = generateSystemPrompt(structured);
    return json({ prompt });
  }

  return error('Not found', 404);
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Determina que secciones estan completas mirando los campos required.
 */
function getCompletedSections(config: Record<string, any>): string[] {
  const completed: string[] = [];

  for (const section of SECTIONS) {
    const fields = getFieldsForSection(section.id);
    const requiredFields = fields.filter(f => {
      if (!f.required) return false;
      // Si depende de otro campo, solo es required si ese campo tiene el valor correcto
      if (f.dependsOn) {
        return config[f.dependsOn.fieldId] === f.dependsOn.value;
      }
      return true;
    });

    if (requiredFields.length === 0) {
      // Secciones sin required fields: completa si tiene al menos un campo con valor
      const sectionFields = fields.filter(f => f.section === section.id);
      const hasAnyValue = sectionFields.some(f => config[f.id] !== undefined && config[f.id] !== null && config[f.id] !== '');
      if (hasAnyValue) completed.push(section.id);
      continue;
    }

    const allFilled = requiredFields.every(f => {
      const v = config[f.id];
      return v !== undefined && v !== null && v !== '';
    });

    if (allFilled) completed.push(section.id);
  }

  return completed;
}

function getNextSection(completed: string[]): string | null {
  for (const section of SECTIONS) {
    if (!completed.includes(section.id)) return section.id;
  }
  return null;
}

/**
 * Convierte el config plano (fieldId → value) a BusinessConfig estructurado.
 */
function flatToStructured(config: Record<string, any>): BusinessConfig {
  return {
    business: {
      name: config.business_name,
      rubro: config.business_rubro,
      address: config.business_address,
      website: config.business_website,
      instagram: config.business_instagram,
      facebook: config.business_facebook,
      target: config.business_target,
    },
    agent: {
      name: config.agent_name,
      tone: config.agent_tone,
      useEmojis: config.agent_use_emojis,
      greeting: config.agent_greeting,
      maxLines: config.agent_max_lines ? parseInt(config.agent_max_lines) : undefined,
    },
    hours: {
      weekdaysFrom: config.hours_weekdays_from,
      weekdaysTo: config.hours_weekdays_to,
      saturdayActive: config.hours_saturday_active,
      saturdayFrom: config.hours_saturday_from,
      saturdayTo: config.hours_saturday_to,
      sundayActive: config.hours_sunday_active,
      sundayFrom: config.hours_sunday_from,
      sundayTo: config.hours_sunday_to,
      bot24x7: config.hours_bot_24_7,
      outOfHoursMessage: config.hours_out_of_hours_message,
    },
    payment: {
      methods: config.payment_methods,
      hasDiscounts: config.payment_has_discounts,
      discountDetail: config.payment_discount_detail,
      installments: config.payment_installments,
      installmentsCount: config.payment_installments_count,
      paymentLink: config.payment_link,
    },
    shipping: {
      active: config.shipping_active,
      zones: config.shipping_zones,
      service: config.shipping_service,
      costType: config.shipping_cost_type,
      freeFrom: config.shipping_free_from,
      time: config.shipping_time,
      pickup: config.shipping_pickup,
      pickupDetail: config.shipping_pickup_detail,
    },
    policies: {
      exchanges: config.policies_exchanges,
      exchangeDays: config.policies_exchange_days,
      exchangeConditions: config.policies_exchange_conditions,
      returns: config.policies_returns,
      returnDays: config.policies_return_days,
      warranty: config.policies_warranty,
    },
    promotions: {
      active: config.promotions_active,
      description: config.promotions_description,
    },
    escalation: {
      active: config.escalation_active,
      cases: config.escalation_cases,
      contact: config.escalation_contact,
      hours: config.escalation_hours,
    },
  };
}
