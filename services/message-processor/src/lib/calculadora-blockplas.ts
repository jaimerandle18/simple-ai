/**
 * Calculadora de materiales BlockPlas.
 * Replica exacta de https://blockplas.com.ar/calculadora-de-materiales-v5/
 *
 * Constantes del ladrillo BlockPlas:
 * - Dimensiones: 10cm x 8cm x 10cm
 * - Pack doble: 60 unidades
 * - Pack simple: 30 unidades
 * - Rendimiento: 61.23 ladrillos dobles por m²
 * - Altura ladrillo: 0.08m (para cálculo de simples)
 * - Perfiles cada 0.6m
 */
import Anthropic from '@anthropic-ai/sdk';

// Constantes de la calculadora BlockPlas
const BRICK = { length: 0.1, height: 0.08, width: 0.1 };
const DOUBLE_PACK = 60;
const SINGLE_PACK = 30;
const BRICKS_PER_M2 = 61.23;
const PROFILE_SPACING = 0.6; // metros entre perfiles

export const CALCULADORA_TOOL: Anthropic.Tool = {
  name: 'calcular_materiales',
  description: `Calcula cuántos ladrillos BlockPlas, perfiles y escuadras se necesitan para una construcción.
Usala cuando el cliente pregunte:
- "cuántos ladrillos necesito para una pared de XxY metros"
- "qué materiales necesito para un ambiente de X m²"
- "cuántos packs necesito"
- cualquier cálculo de cantidades de materiales

Pide al cliente: alto y ancho de cada pared, y si tiene aberturas (puertas/ventanas).
Si da solo metros cuadrados, usá eso directamente.
El tipo de layout puede ser: "simple" (una pared), "L" (dos paredes en L), "U" (tres paredes en U), "closed" (ambiente cerrado).`,
  input_schema: {
    type: 'object' as const,
    properties: {
      paredes: {
        type: 'array',
        description: 'Lista de paredes. Cada pared tiene alto, ancho y aberturas.',
        items: {
          type: 'object',
          properties: {
            alto: { type: 'number', description: 'Alto de la pared en metros' },
            ancho: { type: 'number', description: 'Ancho de la pared en metros' },
            tipo: { type: 'string', description: '"perimetral" o "divisoria"' },
            aberturas: {
              type: 'array',
              description: 'Puertas/ventanas a descontar',
              items: {
                type: 'object',
                properties: {
                  alto: { type: 'number' },
                  ancho: { type: 'number' },
                },
              },
            },
          },
          required: ['alto', 'ancho'],
        },
      },
      metros_cuadrados: {
        type: 'number',
        description: 'Superficie total en m² (alternativa a paredes). Si el cliente da m² directo.',
      },
      layout: {
        type: 'string',
        description: 'Tipo de layout: "simple", "L", "U", "closed". Default: "simple"',
      },
    },
    required: [],
  },
};

export interface CalculadoraResult {
  superficie_m2: number;
  ladrillos_dobles: number;
  packs_dobles: number;
  ladrillos_simples: number;
  packs_simples: number;
  perfiles_pgc70: number;
  perfiles_pgu100: number;
  escuadras: number;
  resumen: string;
}

export function calcularMateriales(input: {
  paredes?: Array<{
    alto: number;
    ancho: number;
    tipo?: string;
    aberturas?: Array<{ alto: number; ancho: number }>;
  }>;
  metros_cuadrados?: number;
  layout?: string;
}): CalculadoraResult {
  let totalArea = 0;
  let totalAncho = 0;
  let maxAlto = 0;
  let singleBricksRaw = 0;

  const layout = input.layout || 'simple';

  if (input.metros_cuadrados && (!input.paredes || input.paredes.length === 0)) {
    // Modo simple: solo m²
    totalArea = input.metros_cuadrados;
    // Estimar ancho y alto para perfiles
    const lado = Math.sqrt(totalArea);
    totalAncho = lado;
    maxAlto = lado;
  } else if (input.paredes && input.paredes.length > 0) {
    for (const pared of input.paredes) {
      const alto = pared.alto || 0;
      const ancho = pared.ancho || 0;
      const areaPared = alto * ancho;

      // Descontar aberturas
      const areaAberturas = (pared.aberturas || []).reduce(
        (sum, ab) => sum + (ab.alto || 0) * (ab.ancho || 0), 0
      );

      totalArea += Math.max(0, areaPared - areaAberturas);
      totalAncho += ancho;
      maxAlto = Math.max(maxAlto, alto);

      // Ladrillos simples para divisorias
      if (pared.tipo === 'divisoria') {
        singleBricksRaw += alto / BRICK.height;
      }

      // Simples para aberturas (remates)
      for (const ab of (pared.aberturas || [])) {
        singleBricksRaw += (ab.alto || 0) / BRICK.height;
      }
    }

    // Simples para layouts especiales
    if (['simple', 'L', 'U'].includes(layout)) {
      singleBricksRaw += maxAlto / BRICK.height;
    }
  }

  // Cálculos (misma fórmula que la web)
  const totalDoubleBricksRaw = BRICKS_PER_M2 * totalArea;
  const packs_dobles = Math.ceil(totalDoubleBricksRaw / DOUBLE_PACK);
  const ladrillos_dobles = packs_dobles * DOUBLE_PACK;

  const packs_simples = Math.ceil(singleBricksRaw / SINGLE_PACK);
  const ladrillos_simples = packs_simples * SINGLE_PACK;

  // Perfiles
  const perfiles_pgc70 = Math.ceil((totalAncho / PROFILE_SPACING) * maxAlto / 6);
  const perfiles_pgu100 = Math.ceil((2 * totalAncho) / 6);
  const escuadras = 2 * Math.ceil(totalAncho / PROFILE_SPACING);

  // Resumen legible
  const resumen = `Para ${totalArea.toFixed(1)} m² necesitas:
- ${packs_dobles} pack${packs_dobles !== 1 ? 's' : ''} de Ladrillos Dobles (${ladrillos_dobles} ladrillos)
${packs_simples > 0 ? `- ${packs_simples} pack${packs_simples !== 1 ? 's' : ''} de Ladrillos Simples (${ladrillos_simples} ladrillos)\n` : ''}- ${perfiles_pgc70} perfil${perfiles_pgc70 !== 1 ? 'es' : ''} PGC70
- ${perfiles_pgu100} perfil${perfiles_pgu100 !== 1 ? 'es' : ''} PGU100
- ${escuadras} escuadra${escuadras !== 1 ? 's' : ''}

Cada pack de dobles tiene ${DOUBLE_PACK} ladrillos.${packs_simples > 0 ? ` Cada pack de simples tiene ${SINGLE_PACK}.` : ''}
Rendimiento: ${BRICKS_PER_M2} ladrillos dobles por m².`;

  return {
    superficie_m2: Math.round(totalArea * 100) / 100,
    ladrillos_dobles,
    packs_dobles,
    ladrillos_simples,
    packs_simples,
    perfiles_pgc70,
    perfiles_pgu100,
    escuadras,
    resumen,
  };
}
