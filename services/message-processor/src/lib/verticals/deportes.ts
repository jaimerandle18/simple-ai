import type { VerticalPackage } from './types';

export const DEPORTES_PACKAGE: VerticalPackage = {
  id: 'deportes',
  name: 'Deportes y outdoor',
  contextualKnowledge: {
    specsThatMatter: ['talle', 'deporte/actividad', 'nivel (principiante/intermedio/pro)', 'material', 'impermeabilidad'],
    commonCustomerNeeds: ['que deporte practica', 'nivel de experiencia', 'condiciones de uso (interior/exterior)', 'talle del cliente'],
    safetyConsiderations: ['derivar a experto para equipo tecnico avanzado'],
  },
  filterSchema: {
    sport: { type: 'text', description: 'Deporte o actividad.' },
    size: { type: 'enum', values: ['XS','S','M','L','XL','XXL','37','38','39','40','41','42','43','44'] },
    category: { type: 'text', description: 'Tipo: indumentaria, equipamiento, accesorios.' },
  },
  promptContext: `# RUBRO: DEPORTES Y OUTDOOR
Vendes articulos deportivos y de aire libre. Categorias: Running (amortiguacion, ropa liviana). Trekking (traccion, mochilas, impermeable). Gym (entrenamiento, ropa tecnica). Equipos (pelotas, indumentaria).
REGLAS: Productos son SOLO los del catalogo. Para impermeabilidad, mira descripcion. Pregunta talle. Para equipo tecnico (escalada, montana), deriva a humano.`,
};
