/**
 * Estado de conversación encapsulado.
 * El LLM nunca modifica el estado directamente — el código aplica mutaciones explícitas.
 */
import { getItem, putItem, keys } from './dynamo-helpers';

export interface CollectedData {
  name?: string;
  address?: string;
  city?: string;
  payment_method?: string;
  shipping_method?: string;
  phone?: string;
}

export interface RecentProduct {
  name: string;
  price?: string;
  description?: string;
  category?: string;
  brand?: string;
  pageUrl?: string;
}

export interface ConvStateData {
  currentProduct?: string;
  currentProductData?: Record<string, any>;
  currentVariant?: { color?: string; talle?: string };
  funnelStage: 'exploring' | 'evaluating' | 'buying' | 'closed';
  collectedData: CollectedData;
  lastNode: string;
  reboundCount: number;
  needsHuman: boolean;
  escalationReason?: string;
  memory?: string;
  shownProducts?: string[];
  recentProductsData?: RecentProduct[];
  activeCategory?: string | null;
}

const DEFAULT_STATE: ConvStateData = {
  funnelStage: 'exploring',
  collectedData: {},
  lastNode: 'saludo_inicial',
  reboundCount: 0,
  needsHuman: false,
  shownProducts: [],
};

export class ConversationState {
  private tenantId: string;
  private conversationId: string;
  private data: ConvStateData;
  private mutations: string[] = [];

  constructor(tenantId: string, conversationId: string, rawState?: any) {
    this.tenantId = tenantId;
    this.conversationId = conversationId;
    this.data = { ...DEFAULT_STATE, ...(rawState || {}) };
  }

  // === Lectura ===
  getCurrentProduct(): string | undefined { return this.data.currentProduct; }
  getCurrentVariant(): { color?: string; talle?: string } | undefined { return this.data.currentVariant; }
  getFunnelStage(): string { return this.data.funnelStage; }
  getCollectedData(): CollectedData { return this.data.collectedData; }
  getLastNode(): string { return this.data.lastNode; }
  getReboundCount(): number { return this.data.reboundCount; }
  isNeedsHuman(): boolean { return this.data.needsHuman; }
  getMemory(): string | undefined { return this.data.memory; }
  getShownProducts(): string[] { return this.data.shownProducts || []; }
  getRecentProductsData(): RecentProduct[] { return this.data.recentProductsData || []; }
  getActiveCategory(): string | null { return this.data.activeCategory || null; }
  getLastIntent(): string | null { return this.data.lastNode || null; }
  getEscalationReason(): string | undefined { return this.data.escalationReason; }

  // Para pasar al router
  toRouterState(): Record<string, any> {
    return {
      producto_actual: this.data.currentProduct || null,
      variante_elegida: this.data.currentVariant || null,
      etapa_funnel: this.data.funnelStage,
      primera_interaccion: this.data.lastNode === 'saludo_inicial' && !this.data.memory,
      memoria: this.data.memory || null,
      datos_recolectados: this.data.collectedData,
      productos_mostrados_recientemente: (this.data.recentProductsData || []).map(p => p.name),
    };
  }

  // Para el prompt
  toPromptState(): { currentProducts?: string[]; lastIntent?: string; memory?: string; recentProductsData?: RecentProduct[] } {
    return {
      currentProducts: this.data.shownProducts,
      lastIntent: this.data.lastNode,
      memory: this.data.memory,
      recentProductsData: this.data.recentProductsData,
    };
  }

  // === Escritura (mutaciones explícitas) ===
  setProduct(name: string, productData?: Record<string, any>) {
    this.data.currentProduct = name;
    this.data.currentProductData = productData;
    this.data.currentVariant = undefined; // limpiar variante al cambiar producto
    this.mutations.push(`setProduct: ${name}`);
  }

  setVariant(variant: { color?: string; talle?: string }) {
    this.data.currentVariant = { ...this.data.currentVariant, ...variant };
    this.mutations.push(`setVariant: ${JSON.stringify(variant)}`);
  }

  setShownProducts(products: string[]) {
    this.data.shownProducts = products;
    this.mutations.push(`setShownProducts: ${products.length}`);
  }

  setRecentProductsData(products: RecentProduct[]) {
    this.data.recentProductsData = products.slice(0, 5);
    this.mutations.push(`setRecentProductsData: ${products.length}`);
  }

  setActiveCategory(category: string) {
    this.data.activeCategory = category;
    this.mutations.push(`setActiveCategory: ${category}`);
  }

  clearActiveCategory() {
    this.data.activeCategory = null;
    this.mutations.push('clearActiveCategory');
  }

  advanceFunnel(stage: 'exploring' | 'evaluating' | 'buying' | 'closed') {
    this.data.funnelStage = stage;
    this.mutations.push(`advanceFunnel: ${stage}`);
  }

  resetFunnel() {
    this.data.funnelStage = 'exploring';
    this.data.currentProduct = undefined;
    this.data.currentVariant = undefined;
    this.data.collectedData = {};
    this.mutations.push('resetFunnel');
  }

  collectData(field: keyof CollectedData, value: string) {
    this.data.collectedData[field] = value;
    this.mutations.push(`collectData: ${field}=${value}`);
  }

  setNode(nodeId: string) {
    this.data.lastNode = nodeId;
  }

  setLastIntent(intent: string) {
    this.data.lastNode = intent;
    this.mutations.push(`setLastIntent: ${intent}`);
  }

  incrementRebound() {
    this.data.reboundCount++;
    this.mutations.push(`rebound: ${this.data.reboundCount}`);
  }

  resetRebound() {
    if (this.data.reboundCount > 0) {
      this.data.reboundCount = 0;
      this.mutations.push('resetRebound');
    }
  }

  markEscalated(reason: string) {
    this.data.needsHuman = true;
    this.data.escalationReason = reason;
    this.mutations.push(`escalated: ${reason}`);
  }

  clearEscalation() {
    this.data.needsHuman = false;
    this.data.escalationReason = undefined;
  }

  setMemory(memory: string) {
    this.data.memory = memory;
  }

  // === Mutaciones automáticas según nodo ===
  applyNodeTransition(nodeId: string, routerEntities: Record<string, any>) {
    this.setNode(nodeId);

    // Actualizar producto si el router lo detectó
    if (routerEntities.producto && routerEntities.producto !== this.data.currentProduct) {
      this.setProduct(routerEntities.producto);
    }

    // Actualizar variante
    if (routerEntities.color || routerEntities.talle) {
      this.setVariant({
        ...(routerEntities.color && { color: routerEntities.color }),
        ...(routerEntities.talle && { talle: routerEntities.talle }),
      });
    }

    // Avanzar funnel según nodo
    const evaluatingNodes = ['consulta_producto_especifico', 'consulta_variante', 'consulta_disponibilidad_combinada', 'consulta_precio', 'comparacion_productos'];
    const buyingNodes = ['intencion_compra', 'confirmacion_datos', 'reserva_apartado'];

    if (buyingNodes.includes(nodeId)) this.advanceFunnel('buying');
    else if (evaluatingNodes.includes(nodeId)) this.advanceFunnel('evaluating');

    // Reset rebound si confidence alta
    if (nodeId !== 'mensaje_ambiguo') this.resetRebound();
    else this.incrementRebound();
  }

  // === Persistencia ===
  toJSON(): ConvStateData {
    return { ...this.data };
  }

  getMutations(): string[] {
    return this.mutations;
  }

  static fromConversation(tenantId: string, conversationId: string, conversation: any): ConversationState {
    return new ConversationState(tenantId, conversationId, conversation?.convState);
  }
}
