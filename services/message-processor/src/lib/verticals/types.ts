export interface VerticalGlossary {
  productTypes: string[];
  attributes: string[];
  commonQuestions: string[];
}

export interface FilterFieldDef {
  type: 'enum' | 'number' | 'text';
  values?: string[];
  description?: string;
}

export interface VerticalPackage {
  id: string;
  name: string;
  glossary: VerticalGlossary;
  filterSchema: Record<string, FilterFieldDef>;
  promptContext: string;
  captionBuilder?: (product: any) => string;
  attributeExtractor?: (rawProduct: any) => Record<string, any>;
}
