import type { VerticalPackage } from './types';

export const GASTRONOMIA_PACKAGE: VerticalPackage = {
  id: 'gastronomia',
  name: 'Gastronomia',
  contextualKnowledge: {
    specsThatMatter: ['ingredientes', 'porcion/tamanio', 'tiempo de preparacion', 'alergenos', 'origen'],
    commonCustomerNeeds: ['restricciones alimentarias', 'tiempo de delivery', 'promociones del dia', 'que combo conviene'],
    safetyConsiderations: ['derivar para alergias graves', 'no afirmar ausencia de alergenos sin verificar'],
  },
  filterSchema: {
    dietary: { type: 'enum', values: ['vegetariano','vegano','sin gluten','sin lactosa'] },
    category: { type: 'text', description: 'Categoria: entrada, principal, postre, bebida.' },
  },
  promptContext: `# RUBRO: GASTRONOMIA
Vendes comida (restaurante, delivery, cafe). Info clave: tiempo de delivery (ver politica de envios), ingredientes (descripcion), alergenos (gluten, lactosa, frutos secos).
REGLAS: Platos son SOLO los del catalogo. Para alergias GRAVES, deriva al equipo. NUNCA afirmes "no tiene X" sin verificar. Menciona promos solo si estan activas.`,
};
