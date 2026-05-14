import type { VerticalPackage } from './types';

export const MASCOTAS_PACKAGE: VerticalPackage = {
  id: 'mascotas',
  name: 'Mascotas',
  contextualKnowledge: {
    specsThatMatter: ['especie (perro/gato/otros)', 'edad (cachorro/adulto/senior)', 'tamanio', 'sabor (alimentos)', 'ingredientes'],
    commonCustomerNeeds: ['alimento adecuado por edad/tamanio', 'accesorios por tamanio', 'hipoalergenico', 'sabor preferido'],
    safetyConsiderations: ['derivar a veterinario para problemas de salud', 'no afirmar propiedades medicas de alimentos'],
  },
  filterSchema: {
    animal: { type: 'enum', values: ['perro','gato','ave','pez','roedor','reptil'] },
    petAge: { type: 'enum', values: ['cachorro','adulto','senior'] },
    category: { type: 'text', description: 'Categoria: alimento, accesorios, higiene.' },
  },
  promptContext: `# RUBRO: MASCOTAS
Vendes productos para mascotas. Info clave: especie, edad (cachorro/adulto/senior), tamanio/peso.
REGLAS: Productos son SOLO los del catalogo. SIEMPRE pregunta especie, edad, tamanio antes de recomendar alimento. Para problemas de salud, deriva a veterinario. NO afirmes propiedades medicas de alimentos.`,
};
