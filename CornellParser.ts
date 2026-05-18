// CornellParser.ts

/**
 * Expresión Regular Maestra e Inmune a ZoteroFlow y PDF++
 * Captura: %%> text %%, %%\> text %%, %%/> text %%
 */
export const UNIVERSAL_MARGINALIA_REGEX = /%%\s*[\\\/]?([><])([\s\S]*?)%%/g;

export interface CleanMarginalia {
    direction: '>' | '<';
    rawContent: string;
    cleanText: string;
    isFlashcard: boolean;
}

/**
 * Procesa una línea o bloque de texto y extrae las marginalias de forma limpia
 */
export function parseLineMarginalias(line: string): CleanMarginalia[] {
    const results: CleanMarginalia[] = [];
    
    // Reiniciamos el índice de la regex global por seguridad
    UNIVERSAL_MARGINALIA_REGEX.lastIndex = 0;
    
    let match;
    while ((match = UNIVERSAL_MARGINALIA_REGEX.exec(line)) !== null) {
        const direction = match[1] as '>' | '<';
        const rawContent = match[2];
        
        // Limpiamos IDs de bloque de Obsidian (^12345) y espacios
        let cleanText = rawContent.replace(/\s*\^([a-zA-Z0-9]+)\s*$/, '').trim();
        const isFlashcard = cleanText.includes(";;");
        
        results.push({
            direction,
            rawContent,
            cleanText,
            isFlashcard
        });
    }
    
    return results;
}