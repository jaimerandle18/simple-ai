---
name: Progreso del proyecto - Mayo 2026
description: Estado actual del desarrollo, qué funciona, qué falta, y próximos pasos pendientes
type: project
---

## Completado
- Monorepo Next.js + TypeScript + Tailwind + AWS CDK
- Landing page con branding Simple AI (violeta #6a11cb + azul #2575fc, logo con círculo brush)
- Login con Google OAuth (NextAuth)
- Dashboard con sidebar oscuro + contenido blanco
- Backend en AWS: API Gateway, Lambda, DynamoDB (single-table), SQS, S3
- Endpoints CRUD: auth, tenants, conversations, agents, contacts, metrics, files, test
- OpenAI integrado respondiendo mensajes
- Crawling de websites con Firecrawl (crawl completo del sitio)
- Extracción de productos con GPT-4o-mini
- Búsqueda de productos por keywords con stemming
- Chat de prueba del agente con markdown rendering
- Config estructurada del agente (nombre, tono, promociones, horarios, etc.)
- Proxy Next.js para evitar CORS (todas las llamadas van por /api/proxy/)
- Lambda Function URL para requests lentos (scraping) sin el límite de 30s de API Gateway
- Tenant ID: 2d34bcf6-a336-426d-893c-005189da0b65 (Jaime)
- API URL: https://ps3mrselrg.execute-api.sa-east-1.amazonaws.com/
- Lambda URL: https://n3nleydsrvwgfexg5u2ws3yuy40ujwyw.lambda-url.sa-east-1.on.aws/

## Implementado en sesión 2
- Pipeline de micro-agentes: clasificador de intent → keyword extractor → buscador → respondedor
- AI keyword extraction (OpenAI extrae keywords inteligentes de la consulta)
- Smart product match fallback (si keywords no encuentran nada, OpenAI elige del catálogo completo)
- Mini-prompts por intent (greeting, product_search, price_concern, complaint, etc.)
- Búsqueda con stemming mejorado
- Limpieza de duplicados en DynamoDB

## Pendiente (próxima sesión)
1. **Búsqueda en vivo de precios** — combinar productos guardados (crawl) + búsqueda live con Firecrawl para precios actualizados cuando los guardados están vacíos
2. **Re-crawl automático** — EventBridge Scheduler para re-crawlear diariamente y actualizar productos/precios
3. **Google Custom Search API** — sigue dando 403. Verificar si se desbloqueó. Alternativa: Brave Search API o SerpAPI
4. **Imágenes de productos** — Tiendanube usa lazy loading, las imágenes salen como placeholder. Investigar metadata de Firecrawl
5. **CSV upload de productos** — alternativa al scraping para negocios sin web
6. **Mini-prompts custom por tenant** — que el usuario pueda crear sus propios flows desde la UI
7. **WhatsApp webhook parsing** — para cuando Meta apruebe la app
8. **MercadoPago** — planes y cobro
9. **Calidad de datos del crawl** — las descripciones son pobres (no tienen talles, colores, materiales). Hacer un segundo paso scrapeando cada página individual de producto

## Credenciales en AWS Secrets Manager (sa-east-1)
- simple-ai/dev/openai
- simple-ai/dev/whatsapp
- simple-ai/dev/google-search
- simple-ai/dev/firecrawl

## Notas técnicas
- API Gateway HTTP API tiene timeout hardcodeado de 30s, no se puede cambiar
- Se usa Lambda Function URL (sin timeout) para /agents/test-chat y /agents/scrape
- El proxy de Next.js (/api/proxy/) rutea a Lambda URL para rutas lentas
- Firecrawl crawl tarda ~25s para 50 páginas, después OpenAI extrae productos (~2 min total)
- Lambda timeout configurado en 300s (5 min) para el API Lambda

**Why:** Estas notas evitan re-descubrir los mismos problemas en la próxima sesión.
**How to apply:** Continuar desde los pendientes listados arriba.
