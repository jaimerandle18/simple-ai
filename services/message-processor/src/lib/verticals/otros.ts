import type { VerticalPackage } from './types';

export const OTROS_PACKAGE: VerticalPackage = {
  id: 'otros',
  name: 'Generico',

  glossary: {
    productTypes: [],
    attributes: ['precio', 'descripcion', 'marca', 'caracteristicas'],
    commonQuestions: [
      'que tenes?',
      'cuanto sale?',
      'tenes stock?',
      'como funciona?',
    ],
  },

  filterSchema: {
    category: { type: 'text', description: 'Categoria del producto si el cliente la menciona.' },
    priceRange: { type: 'enum', values: ['cheap', 'mid', 'expensive'] },
  },

  promptContext: `# RUBRO: GENERICO

Vendes productos varios. No conoces specs tecnicas especificas de tu rubro.

REGLAS:
- Si preguntan por specs, mira la descripcion del producto en el catalogo.
- Si no tenes la info, deci "te confirmo en un toque" o deriva a humano.
- Nunca inventes specs que no esten en el catalogo.`,
};
