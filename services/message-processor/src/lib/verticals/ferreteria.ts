import type { VerticalPackage } from './types';

export const FERRETERIA_PACKAGE: VerticalPackage = {
  id: 'ferreteria',
  name: 'Ferreteria',
  contextualKnowledge: {
    specsThatMatter: ['potencia (W)', 'voltaje (V)', 'RPM', 'capacidad (litros/cm)', 'material'],
    commonCustomerNeeds: ['uso domestico vs profesional', 'electrica con cable vs bateria', 'para que material (madera/metal/concreto)', 'viene con accesorios'],
    safetyConsiderations: ['derivar a profesional para uso peligroso', 'no dar instrucciones tecnicas de uso detalladas'],
  },
  filterSchema: {
    power: { type: 'text', description: 'Potencia en watts. Ej: 850W, 1200W.' },
    voltage: { type: 'enum', values: ['12V','18V','20V','220V'], description: 'Voltaje. Bajo=bateria, 220V=red.' },
    category: { type: 'text', description: 'Categoria general.' },
  },
  promptContext: `# RUBRO: FERRETERIA
Vendes productos de ferreteria. Conocimiento: Electricas con cable (mas potencia, requieren enchufe). A bateria 12V/18V/20V (movilidad, autonomia limitada). Manuales (sin energia). Specs: Watts=potencia, Voltios=energia, RPM=velocidad.
REGLAS: Productos son SOLO los del catalogo. Para uso peligroso, deriva a profesional. NO inventes specs que no esten en la descripcion.`,
};
