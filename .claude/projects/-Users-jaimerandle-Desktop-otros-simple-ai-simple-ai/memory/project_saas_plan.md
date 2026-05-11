---
name: Plan SaaS bots conversacionales
description: Plan completo del proyecto SaaS multi-tenant de bots para WhatsApp con stack AWS Lambda + Next.js + DynamoDB
type: project
---

SaaS de bots conversacionales para WhatsApp (MVP), luego Instagram/FB Messenger.

**Stack decidido:**
- Frontend: Next.js 14 + TypeScript + Tailwind (referencia visual: wespeak.pro)
- Backend: Node.js (TypeScript) en AWS Lambda
- DB: DynamoDB single-table
- Infra: AWS CDK (TypeScript), región sa-east-1
- Auth: Auth.js (NextAuth) con Google + Facebook + magic link
- LLM: OpenAI API
- Pagos: MercadoPago
- Hosting front: Vercel o AWS Amplify

**Modelo de datos:** single-table DynamoDB con PK/SK (TENANT#, CONV#, MSG#, AGENT#, SUB#, etc.)

**Sprints planeados:** 0 (setup) → 1 (auth) → 2 (webhooks/conversaciones) → 3 (agente Claude) → 4 (asistente prompt) → 5 (catalogación) → 6 (pagos) → 7 (admin) → 8 (hardening/beta)

**Why:** Producto propio para mercado argentino/LATAM, target 50-200 clientes en 6 meses.

**How to apply:** Todo el desarrollo sigue este plan. Sprint 0 es el punto de partida: monorepo, CDK base, CI/CD, dominios, OAuth básico.
