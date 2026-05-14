import type { VerticalPackage } from './types';

export const LIBRERIA_PACKAGE: VerticalPackage = {
  id: 'libreria',
  name: 'Libreria',
  contextualKnowledge: {
    specsThatMatter: ['autor', 'editorial', 'genero', 'edad recomendada', 'paginas', 'formato (tapa dura/blanda)'],
    commonCustomerNeeds: ['libros de un autor especifico', 'edad para ninos', 'orden de saga', 'utiles escolares por edad'],
    safetyConsiderations: ['no inventar argumentos de libros', 'no asegurar disponibilidad de autores sin verificar'],
  },
  filterSchema: {
    author: { type: 'text', description: 'Autor del libro.' },
    genre: { type: 'text', description: 'Genero literario.' },
    category: { type: 'text', description: 'Categoria general (libros, utiles, arte).' },
  },
  promptContext: `# RUBRO: LIBRERIA
Vendes libros y articulos de libreria. Productos tipicos: libros (ficcion, no ficcion, infantiles, tecnicos), utiles escolares, articulos de arte.
REGLAS: Productos son SOLO los del catalogo. Para "tenes [autor]?" busca en catalogo, NO inventes. Para sagas verifica orden en descripcion. NO inventes argumentos de libros.`,
};
