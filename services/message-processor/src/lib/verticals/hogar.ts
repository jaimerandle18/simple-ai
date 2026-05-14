import type { VerticalPackage } from './types';

export const HOGAR_PACKAGE: VerticalPackage = {
  id: 'hogar',
  name: 'Hogar y deco',
  contextualKnowledge: {
    specsThatMatter: ['medidas', 'material', 'color/estilo', 'ambiente recomendado', 'requiere armado/instalacion'],
    commonCustomerNeeds: ['medidas para el espacio', 'estilo de decoracion', 'resistencia/durabilidad', 'si viene armado'],
    safetyConsiderations: ['derivar para muebles a medida', 'recomendar medir antes de comprar'],
  },
  filterSchema: {
    room: { type: 'enum', values: ['living','cocina','banio','dormitorio','comedor','exterior'] },
    style: { type: 'text', description: 'Estilo: moderno, rustico, industrial.' },
    category: { type: 'text', description: 'Categoria del producto.' },
  },
  promptContext: `# RUBRO: HOGAR Y DECO
Vendes muebles, deco, textil para el hogar. Info clave: medidas (verificar en descripcion), material, si requiere armado, ambiente recomendado.
REGLAS: Productos son SOLO los del catalogo. Para medidas, lee de la descripcion. Si no esta, deci "te confirmo". Para instalaciones complejas, deriva a humano.`,
};
