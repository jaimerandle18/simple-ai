import type { VerticalPackage } from './types';

export const INDUMENTARIA_PACKAGE: VerticalPackage = {
  id: 'indumentaria',
  name: 'Indumentaria',

  glossary: {
    productTypes: [
      'remera', 'musculosa', 'top', 'chomba', 'camisa',
      'buzo', 'hoodie', 'canguro', 'sweater', 'cardigan',
      'pantalon', 'jean', 'bermuda', 'jogging', 'cargo', 'short',
      'campera', 'parka', 'anorak', 'rompevientos', 'chaleco',
      'vestido', 'falda', 'mono', 'enterito',
      'medias', 'calzas', 'leggings',
      'gorra', 'gorro', 'sombrero', 'piluso',
    ],
    attributes: ['talle', 'color', 'material', 'corte', 'estampado', 'tela', 'composicion'],
    commonQuestions: [
      'calza grande o chico?',
      'se encoge al lavar?',
      'que tela es?',
      'que talle me queda?',
      'es oversize?',
      'tienen otros colores?',
    ],
  },

  filterSchema: {
    size: {
      type: 'enum',
      values: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40', '42', '44'],
      description: 'Talle. Letras para parte superior, numeros para pantalones.',
    },
    color: {
      type: 'text',
      description: 'Color. Ej: negro, blanco, azul, rojo, gris.',
    },
    fit: {
      type: 'enum',
      values: ['regular', 'oversize', 'slim', 'baggy', 'relaxed'],
      description: 'Corte del producto.',
    },
    category: {
      type: 'text',
      description: 'Categoria. Ej: remera, pantalon, buzo, campera.',
    },
  },

  promptContext: `# RUBRO: INDUMENTARIA

Vendes ropa. Tu conocimiento contextual:

TALLES:
- Letras (XS/S/M/L/XL/XXL) para remeras, buzos, camperas.
- Numeros (28-44) para pantalones, jeans.
- Si el cliente dice solo "talle" sin especificar, pregunta cual.

MATERIALES:
- Algodon 100%: respira bien, encoge un poco al primer lavado.
- Jersey: suave, elastico, para remeras.
- Friza: para clima frio, interior aterciopelado.
- Denim/jean: corte recto, slim, baggy, cargo.
- Gabardina: rigida, para pantalones formales y workwear.

CORTES:
- Regular: corte estandar.
- Oversize: queda 1-2 talles mas grande, look amplio.
- Slim/skinny: ajustado al cuerpo.
- Baggy: muy amplio, look streetwear.

REGLA DE STOCK:
Antes de confirmar talle, verifica que este disponible. Si esta en outOfStockSizes, NO digas que esta disponible.`,
};
