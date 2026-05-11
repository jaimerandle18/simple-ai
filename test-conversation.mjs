// Simular conversación completa contra la API
const API = 'https://ps3mrselrg.execute-api.sa-east-1.amazonaws.com';
const TENANT = '2d34bcf6-a336-426d-893c-005189da0b65';

// Conversación a simular
const messages = [
  'Hola',
  'Necesito una herramienta para cortar ramas gruesas',
  'Dale mostrame',
  'Cuál me recomendás?',
  'Cuánto sale la sable de 950w?',
  'Tienen envío gratis?',
  'Dale la quiero, cómo compro?',
  'Gracias, chau!',
];

const convId = `test_conv_${Date.now()}`;
const history = [];

for (const msg of messages) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`👤 CLIENTE: ${msg}`);
  console.log(`${'='.repeat(60)}`);

  // Mandar mensaje via test endpoint
  try {
    const res = await fetch(`${API}/test/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT },
      body: JSON.stringify({
        tenantId: TENANT,
        message: msg,
        contactPhone: '+5491100000001',
        contactName: 'Test Client',
        conversationId: convId,
      }),
    });
    const data = await res.json();
    console.log(`📤 Enviado: ${data.status || 'ok'}`);
  } catch (err) {
    console.error(`❌ Error enviando: ${err.message}`);
  }

  // Esperar que procese (el message-processor es async via SQS)
  console.log('⏳ Esperando respuesta...');
  await new Promise(r => setTimeout(r, 8000));

  // Leer mensajes de la conversación
  try {
    const res = await fetch(`${API}/conversations/${convId}/messages`, {
      headers: { 'x-tenant-id': TENANT },
    });
    const msgs = await res.json();

    // Mostrar el último mensaje del bot
    const botMsgs = msgs.filter(m => m.sender === 'bot');
    if (botMsgs.length > history.length) {
      const lastBot = botMsgs[botMsgs.length - 1];
      console.log(`\n🤖 AGENTE: ${lastBot.content}`);
      history.push(lastBot);
    } else {
      console.log('⚠️  No hubo respuesta del agente');
    }
  } catch (err) {
    console.error(`❌ Error leyendo: ${err.message}`);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log('✅ Conversación completa');
console.log(`Total mensajes del agente: ${history.length}`);
