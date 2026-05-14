export interface VerticalContextualKnowledge {
  specsThatMatter: string[];
  commonCustomerNeeds: string[];
  safetyConsiderations: string[];
}

export interface FilterFieldDef {
  type: 'enum' | 'number' | 'text';
  values?: string[];
  description?: string;
}

export interface VerticalPackage {
  id: string;
  name: string;
  contextualKnowledge: VerticalContextualKnowledge;
  filterSchema: Record<string, FilterFieldDef>;
  promptContext: string;
  captionBuilder?: (product: any) => string;
  attributePresenter?: (attributes: Record<string, any>) => string;
}
