/**
 * Redactor — genera texto natural a partir de contexto estructurado.
 * NO toma decisiones. Solo redacta sobre lo que el handler le pasa.
 */
import Anthropic from '@anthropic-ai/sdk';
import { buildRedactorPrompt } from './prompt-builder';
import type { HandlerContext } from '../handlers/intent-handlers';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateRedactedResponse(args: {
  userMessage: string;
  history: Anthropic.MessageParam[];
  handlerCtx: HandlerContext;
  agentConfig: any;
  contactMemory?: string;
  historySummary?: string;
  productsContext?: string;
  cartContext?: string;
  imageData?: { base64: string; mimeType: string };
  tools?: Anthropic.Tool[];
  cart?: any[];
}): Promise<{ text: string; productsShown: any[]; freshProducts: any[]; cart?: any[] }> {
  const { handlerCtx } = args;

  // Build system prompt from structured context
  const systemPrompt = buildRedactorPrompt({
    handlerCtx,
    agentConfig: args.agentConfig,
    contactMemory: args.contactMemory,
    historySummary: args.historySummary,
    productsContext: args.productsContext,
    cartContext: args.cartContext,
  });

  // Choose model based on handler complexity
  const model = handlerCtx.complexity === 'trivial'
    ? 'claude-haiku-4-5-20251001'
    : 'claude-sonnet-4-6';

  const maxRounds = handlerCtx.complexity === 'trivial' ? 0
    : handlerCtx.complexity === 'followup' ? 3
    : 5;

  // Build messages
  const messages: Anthropic.MessageParam[] = [...args.history];
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    if (args.imageData) {
      messages.push({
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: args.imageData.mimeType as any, data: args.imageData.base64 } },
          { type: 'text', text: args.userMessage },
        ],
      });
    } else {
      messages.push({ role: 'user', content: args.userMessage });
    }
  }

  console.log(`[REDACTOR] model=${model} intent=${handlerCtx.redactorInstruction.slice(0, 60)} maxRounds=${maxRounds} products=${handlerCtx.productsToShow.length}`);

  // Tools: only if handler says we need them (purchase_intent, purchase_confirm, product_search with needsToolSearch)
  const useTools = maxRounds > 0 && args.tools && args.tools.length > 0;

  const _cart = [...(args.cart || [])];
  let allProductsShown = [...handlerCtx.productsToShow];
  let freshProducts = [...handlerCtx.productsToShow];

  for (let round = 0; round <= maxRounds; round++) {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 500,
      system: [{ type: 'text', text: systemPrompt }],
      messages,
      ...(useTools ? { tools: args.tools } : {}),
    });

    const usage = res.usage as any;
    if (usage) {
      console.log(`[REDACTOR] round=${round} input=${usage.input_tokens} output=${usage.output_tokens} cache_read=${usage.cache_read_input_tokens || 0}`);
    }

    // End turn: extract text
    if (res.stop_reason === 'end_turn') {
      const textBlock = res.content.find(b => b.type === 'text');
      return {
        text: textBlock?.text || 'Disculpa, tuve un problema.',
        productsShown: allProductsShown,
        freshProducts,
        cart: _cart,
      };
    }

    // Tool use: let the caller handle it (pass through)
    if (res.stop_reason === 'tool_use') {
      // Return the raw response for the caller to process tools
      // This is a simplification — for now, return the text + tool results
      const textBlock = res.content.find(b => b.type === 'text');
      if (textBlock) {
        return {
          text: textBlock.text,
          productsShown: allProductsShown,
          freshProducts,
          cart: _cart,
        };
      }
      // If only tool calls and no text, we need to process them
      // For now, return a placeholder — the existing generateResponse handles tools
      break;
    }
  }

  return {
    text: 'Disculpa, tuve un problema procesando tu consulta.',
    productsShown: allProductsShown,
    freshProducts,
    cart: _cart,
  };
}
