import type { VerticalPackage } from './types';
import { INDUMENTARIA_PACKAGE } from './indumentaria';
import { FERRETERIA_PACKAGE } from './ferreteria';
import { COSMETICA_PACKAGE } from './cosmetica';
import { GASTRONOMIA_PACKAGE } from './gastronomia';
import { ELECTRONICA_PACKAGE } from './electronica';
import { LIBRERIA_PACKAGE } from './libreria';
import { DEPORTES_PACKAGE } from './deportes';
import { HOGAR_PACKAGE } from './hogar';
import { MASCOTAS_PACKAGE } from './mascotas';
import { SALUD_PACKAGE } from './salud';
import { OTROS_PACKAGE } from './otros';

const VERTICAL_REGISTRY: Record<string, VerticalPackage> = {
  indumentaria: INDUMENTARIA_PACKAGE,
  ferreteria: FERRETERIA_PACKAGE,
  cosmetica: COSMETICA_PACKAGE,
  gastronomia: GASTRONOMIA_PACKAGE,
  electronica: ELECTRONICA_PACKAGE,
  libreria: LIBRERIA_PACKAGE,
  deportes: DEPORTES_PACKAGE,
  hogar: HOGAR_PACKAGE,
  mascotas: MASCOTAS_PACKAGE,
  salud: SALUD_PACKAGE,
  otros: OTROS_PACKAGE,
};

const RUBRO_ALIASES: Record<string, string> = {
  ropa: 'indumentaria',
  vestimenta: 'indumentaria',
  textil: 'indumentaria',
  belleza: 'cosmetica',
  comida: 'gastronomia',
  restaurante: 'gastronomia',
  tecnologia: 'electronica',
  tech: 'electronica',
  libros: 'libreria',
  deporte: 'deportes',
  outdoor: 'deportes',
  decoracion: 'hogar',
  deco: 'hogar',
  mueble: 'hogar',
  muebles: 'hogar',
  veterinaria: 'mascotas',
  petshop: 'mascotas',
  farmacia: 'salud',
  bienestar: 'salud',
  construccion: 'ferreteria',
  automotor: 'otros',
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
