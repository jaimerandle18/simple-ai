import type { VerticalPackage } from './types';

export const ELECTRONICA_PACKAGE: VerticalPackage = {
  id: 'electronica',
  name: 'Electronica',
  contextualKnowledge: {
    specsThatMatter: ['memoria RAM', 'almacenamiento', 'pantalla (tamanio/resolucion)', 'bateria', 'conectividad', 'marca/modelo'],
    commonCustomerNeeds: ['compatibilidad con otros dispositivos', 'garantia', 'original vs no original', 'comparativa de modelos'],
    safetyConsiderations: ['no afirmar compatibilidad sin verificar', 'no inventar specs tecnicas'],
  },
  filterSchema: {
    brand: { type: 'text', description: 'Marca del producto.' },
    storage: { type: 'text', description: 'Almacenamiento. Ej: 128GB, 256GB.' },
    category: { type: 'text', description: 'Tipo de producto.' },
  },
  promptContext: `# RUBRO: ELECTRONICA
Vendes productos tecnologicos. Specs: RAM (4GB basico, 8GB normal, 16GB+ exigente). Almacenamiento (64GB basico, 128GB normal, 256GB+ alto). Pantalla (pulgadas + resolucion). Bateria (mAh celulares, horas notebooks).
REGLAS: Productos son SOLO los del catalogo. NO afirmes compatibilidad sin verificar. Para garantia, responde segun politica del negocio. NO inventes specs.`,
};
