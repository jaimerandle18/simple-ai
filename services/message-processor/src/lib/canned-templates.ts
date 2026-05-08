export function renderTemplate(template: string, context: any, config: any): string {
  const name = config.assistantName || 'el equipo';
  const web = config.websiteUrl || 'la web';

  switch (template) {
    case 'GREETING':
      return config.welcomeMessage || `¡Hola! Soy ${name}, contame qué buscás`;
    case 'FAREWELL':
      return `¡Dale! Cualquier cosa volvé cuando quieras`;
    case 'THANKS':
      return `¡A vos! Si necesitás algo más, acá estoy`;
    case 'SHIPPING':
      if (config.extraInstructions?.includes('envío') || config.extraInstructions?.includes('envio'))
        return ''; // vacío = dejar que el LLM use la data de reglas del negocio
      return `Hacemos envíos a todo el país. Los costos y tiempos los ves al finalizar la compra en ${web}. ¿A qué zona sería?`;
    case 'PAYMENT':
      if (config.extraInstructions?.includes('pago')) return '';
      return `Los medios de pago los ves al momento de la compra en ${web}. ¿Necesitás algo más?`;
    case 'HOURS':
      return config.businessHours ? `Nuestro horario: ${config.businessHours}` : `Consultá el horario en ${web}`;
    case 'LOCATION':
      return config.extraInstructions?.includes('dirección') ? '' : `Para ver nuestra ubicación entrá a ${web}`;
    case 'RETURNS':
      return config.extraInstructions?.includes('cambio') ? '' : `Aceptamos cambios. Para más info consultá en ${web}`;
    case 'WARRANTY':
      return config.extraInstructions?.includes('garantía') ? '' : `Para info de garantía consultá en ${web}`;
    case 'OFF_TOPIC':
      return `Jaja, soy más de hablar de productos. ¿Buscás algo en particular?`;
    case 'ESCALATE':
      return `Te paso con alguien del equipo. Te van a contactar a la brevedad por este mismo chat`;
    case 'NO_RESULTS': {
      const what = context?.producto || context?.uso || 'eso';
      return `Justo no tengo ${what} cargado. ¿Querés que te muestre alternativas o buscás otra cosa?`;
    }
    case 'TOO_MANY_RESULTS': {
      const sample = (context?.sample || []).slice(0, 3).map((p: any) => p.name).join(', ');
      return `Tengo varias opciones. Para acertar, ¿buscás alguna marca, rango de precio o uso en particular?\n\nEjemplos: ${sample}`;
    }
    case 'BROAD_QUERY': {
      const cats = (context?.topCategories || []) as string[];
      if (cats.length === 0) return `Tengo varias categorías. ¿Qué tipo de producto buscás?`;
      return `Manejo varias categorías:\n${cats.map((c: string) => `• ${c}`).join('\n')}\n\n¿Cuál te interesa?`;
    }
    case 'CLARIFY':
      return `No llegué a entenderte. ¿Me lo decís de otra forma?`;
    default:
      return `Disculpá, tuve un problema. ¿Podés repetirme?`;
  }
}
