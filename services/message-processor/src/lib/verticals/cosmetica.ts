import type { VerticalPackage } from './types';

export const COSMETICA_PACKAGE: VerticalPackage = {
  id: 'cosmetica',
  name: 'Cosmetica y belleza',
  contextualKnowledge: {
    specsThatMatter: ['tipo de piel', 'ingredientes activos', 'tamanio/contenido', 'aroma', 'tono/color'],
    commonCustomerNeeds: ['tipo de piel del cliente', 'ingredientes a evitar (parabenos, sulfatos)', 'cruelty-free/vegano', 'tono que combine'],
    safetyConsiderations: ['derivar a dermatologo para problemas serios', 'no afirmar resultados medicos', 'no inventar ingredientes'],
  },
  filterSchema: {
    skinType: { type: 'enum', values: ['seca','grasa','mixta','sensible','normal'] },
    category: { type: 'text', description: 'Categoria de producto.' },
  },
  promptContext: `# RUBRO: COSMETICA Y BELLEZA
Vendes productos de cuidado de piel, maquillaje y belleza. Tipos de piel: Seca (hidratacion intensa), Grasa (oil-free), Mixta (zona T grasa), Sensible (ingredientes suaves). Ingredientes comunes: Acido hialuronico (hidratacion), Vitamina C (ilumina), Retinol (anti-edad nocturno), Niacinamida (poros).
REGLAS: Productos son SOLO los del catalogo. Para problemas dermatologicos, sugeri consultar profesional. NO afirmes resultados medicos. NO inventes ingredientes.`,
};
