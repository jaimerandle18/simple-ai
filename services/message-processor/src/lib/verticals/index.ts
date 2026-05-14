import type { VerticalPackage } from './types';
import { INDUMENTARIA_PACKAGE } from './indumentaria';
import { OTROS_PACKAGE } from './otros';

const VERTICAL_REGISTRY: Record<string, VerticalPackage> = {
  indumentaria: INDUMENTARIA_PACKAGE,
  otros: OTROS_PACKAGE,
};

const RUBRO_ALIASES: Record<string, string> = {
  ropa: 'indumentaria',
  vestimenta: 'indumentaria',
  textil: 'indumentaria',
};

export function loadVerticalPackage(rubro?: string): VerticalPackage {
  if (!rubro) return OTROS_PACKAGE;

  const normalized = rubro.toLowerCase().trim();
  const mapped = RUBRO_ALIASES[normalized] || normalized;
  const pkg = VERTICAL_REGISTRY[mapped];

  if (!pkg) {
    console.warn(`[VERTICAL] Rubro "${rubro}" sin paquete especifico, usando "otros"`);
    return OTROS_PACKAGE;
  }

  console.log(`[VERTICAL] Loaded package "${pkg.id}" for rubro "${rubro}"`);
  return pkg;
}

export type { VerticalPackage } from './types';
export { INDUMENTARIA_PACKAGE } from './indumentaria';
export { OTROS_PACKAGE } from './otros';
