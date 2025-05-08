export const formatText = (text) => {
    if (!text) return '';

    // Limpia texto inicial, elimina saltos de línea duplicados
    text = text?.trim().replace(/[\r\n]+/g, '\n');

    // Eliminar texto entre los caracteres especiales 【 y 】
    text = text.replace(/【.*?】/g, '');

    // Convierte *texto* en negrita
    text = text.replace(/\*(.*?)\*/g, '<span style="font-weight:bold;">$1</span>');

    // Convierte _texto_ en cursiva
    text = text.replace(/_(.*?)_/g, '<span style="font-style:italic;">$1</span>');

    // Maneja listas no ordenadas (- item)
    text = text.replace(/(?:^|\n)- (.*?)(?=\n|$)/g, '<li>$1</li>');
    if (text.includes('<li>') && !text.includes('<ul>')) {
        text = text.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    }

    // Maneja listas ordenadas (1. item)
    text = text.replace(/(?:^|\n)\d+\.\s(.*?)(?=\n|$)/g, '<li>$1</li>');
    if (text.includes('<li>') && !text.includes('<ol>')) {
        text = text.replace(/(<li>.*<\/li>)/gs, '<ol>$1</ol>');
    }

    // Convierte URLs en enlaces
    text = text.replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    // Convierte imágenes en formato Markdown ![Texto Alt](URL)
    text = text.replace(
        /!\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        `<br><img src="$2" alt="$1" style="max-width: 50%; height: auto; margin-left: 10px;" /><br>`
    );

    // Ajusta estilo de imágenes con atributos HTML
    text = text.replace(
        /<img(.*?)>/g,
        '<img$1 style="width: 50%; max-width: 50%; height: auto; margin-left: 10px;" />'
    );

    // Convierte enlaces en formato [Texto](URL) en <a>
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Maneja encabezados dinámicos (líneas terminadas en :)
    text = text.replace(/(?:^|\n)([^\n:]+):(?=\n|$)/g, '<p><strong>$1:</strong></p>');

    // Filtra líneas vacías antes de envolver en párrafos
    text = text.replace(/(?:\n\s*\n)+/g, '\n'); // Reduce múltiples saltos consecutivos a uno

    // Envuelve líneas restantes en párrafos <p>
    text = text.replace(/(?:^|\n)([^\n<]+)(?=\n|$)/g, '<p>$1</p>');

    // Limpia saltos de línea innecesarios en el resultado final
    text = text.replace(/<\/p>\s*<p>/g, '</p><p>');

    return text;
};
