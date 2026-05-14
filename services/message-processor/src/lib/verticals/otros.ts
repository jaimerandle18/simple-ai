import type { VerticalPackage } from './types';

export const OTROS_PACKAGE: VerticalPackage = {
  id: 'otros',
  name: 'Generico',
  contextualKnowledge: {
    specsThatMatter: ['precio', 'descripcion', 'caracteristicas'],
    commonCustomerNeeds: ['saber que hay', 'precios', 'stock'],
    safetyConsiderations: ['no inventar specs', 'derivar si no se sabe'],
  },
  filterSchema: {
    category: { type: 'text', description: 'Categoria del producto.' },
    priceRange: { type: 'enum', values: ['cheap', 'mid', 'expensive'] },
  },
  promptContext: `# RUBRO: GENERICO
Vendes productos varios. REGLAS: Los productos son SOLO los de PRODUCTOS_DISPONIBLES. Si preguntan specs, mira la descripcion. Si no tenes la info, deci "te confirmo" o deriva a humano. Nunca inventes specs.`,
};
