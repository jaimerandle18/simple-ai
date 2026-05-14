import type { VerticalPackage } from './types';

export const INDUMENTARIA_PACKAGE: VerticalPackage = {
  id: 'indumentaria',
  name: 'Indumentaria',
  contextualKnowledge: {
    specsThatMatter: ['talle', 'color', 'material/tela', 'corte (regular/oversize/slim/baggy)', 'composicion'],
    commonCustomerNeeds: ['que talle me queda', 'como calza', 'que tela/material', 'se encoge al lavar', 'colores disponibles'],
    safetyConsiderations: ['no afirmar talles sin verificar stock por variante', 'no inventar materiales si no estan en descripcion'],
  },
  filterSchema: {
    size: { type: 'enum', values: ['XS','S','M','L','XL','XXL','28','30','32','34','36','38','40','42','44'], description: 'Talle. Letras para parte superior, numeros para pantalones.' },
    color: { type: 'text', description: 'Color. Ej: negro, blanco, azul.' },
    fit: { type: 'enum', values: ['regular','oversize','slim','baggy','relaxed'], description: 'Corte.' },
    category: { type: 'text', description: 'Categoria general. Los nombres reales vienen del catalogo.' },
  },
  promptContext: `# RUBRO: INDUMENTARIA
Vendes ropa. Conocimiento contextual:
TALLES: Letras (XS-XXL) para remeras/buzos/camperas. Numeros (28-44) para pantalones/jeans.
MATERIALES: Algodon 100% (respira, encoge un poco). Jersey (suave, elastico). Friza (clima frio). Denim (corte recto/slim/baggy). Gabardina (rigida, workwear).
CORTES: Regular (estandar). Oversize (1-2 talles mas grande). Slim (ajustado). Baggy (amplio, streetwear).
REGLAS: Los productos son SOLO los de PRODUCTOS_DISPONIBLES. Verifica stock por talle antes de confirmar. No inventes materiales que no estan en la descripcion.`,
};
