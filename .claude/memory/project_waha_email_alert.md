---
name: Alerta email desconexión WhatsApp
description: Pendiente implementar notificación por email cuando WAHA se desconecta
type: project
---

Implementar alerta por email cuando WhatsApp se desconecta.

**Why:** El usuario lo pidió explícitamente pero decidió dejarlo para más adelante. Por ahora solo está el polling del frontend (banner rojo cada 30s).

**How to apply:** Cuando el usuario lo pida, la solución es:
1. Agregar `session.status` a los eventos del webhook de WAHA en `channels.ts` (PUT /channels/waha)
2. Manejar el evento en el webhook receiver Lambda — cuando status es STOPPED/FAILED, enviar email via AWS SES
3. Configurar SES con el dominio del proyecto
