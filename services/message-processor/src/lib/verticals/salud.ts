import type { VerticalPackage } from './types';

export const SALUD_PACKAGE: VerticalPackage = {
  id: 'salud',
  name: 'Salud y bienestar',
  contextualKnowledge: {
    specsThatMatter: ['tipo de producto', 'contenido/dosis', 'modo de uso', 'ingredientes'],
    commonCustomerNeeds: ['recomendacion para malestar especifico', 'compatibilidad con medicamentos', 'efectos secundarios'],
    safetyConsiderations: ['NUNCA dar recomendaciones medicas', 'siempre derivar a profesional de salud', 'no diagnosticar ni sugerir tratamientos'],
  },
  filterSchema: {
    category: { type: 'text', description: 'Categoria: suplementos, accesorios, higiene.' },
  },
  promptContext: `# RUBRO: SALUD Y BIENESTAR
Vendes productos de salud y bienestar. REGLAS CRITICAS: NUNCA des consejos medicos. Para sintomas, diagnosticos o tratamientos, SIEMPRE deriva a profesional. Para suplementos, recomienda consultar medico. Productos son SOLO los del catalogo. NO afirmes que un producto "cura" o "trata" condiciones medicas. Tu rol: informar disponibilidad, precios y caracteristicas. NO dar consejos medicos.`,
};
