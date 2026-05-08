export interface EnrichedProduct {
  PK: string;
  SK: string;
  productId: string;
  name: string;
  description: string;
  price: string;
  priceNum: number;
  category: string;
  brand: string | null;
  categoryNormalized: string;
  categoryParent: string;
  attributes: Record<string, any>;
  usosRecomendados: string[];
  publico: string[];
  searchableText: string;
  imageUrl: string;
  pageUrl: string;
}

export type IntentType =
  | 'product_query' | 'product_use_search'
  | 'list_compare' | 'list_extend' | 'list_select'
  | 'price_question'
  | 'shipping' | 'payment' | 'hours' | 'location'
  | 'returns' | 'warranty'
  | 'greeting' | 'farewell' | 'thanks'
  | 'complaint' | 'human_request'
  | 'off_topic' | 'ambiguous';

export interface ExtractedIntent {
  intent: IntentType;
  confidence: number;
  entities: {
    producto?: string;
    marca?: string;
    color?: string;
    talle?: string;
    cantidad?: number;
    precio_max?: number;
    precio_min?: number;
    uso?: string;
    atributo_comparacion?: string;
    direccion_comparacion?: 'min' | 'max';
    referencia_ordinal?: number;
    referencia_atributo?: string;
    categoria_mencionada?: string;
    motivo?: string;
    topCategories?: string[];
  };
  needs_human: boolean;
  raw: string;
}

export interface SearchResult {
  primary: EnrichedProduct[];
  alternatives: EnrichedProduct[];
  totalMatches: number;
}

export type ResponseStrategy =
  | { mode: 'canned'; template: string; context?: any }
  | { mode: 'llm'; primary: EnrichedProduct[]; alternatives: EnrichedProduct[] }
  | { mode: 'clarify'; reason: string };
