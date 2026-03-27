// /addons/ThreadCollectionsAddon.ts
import { App, Notice, TFile, EventRef } from "obsidian";
import CornellMarginalia from "../main";
import { CornellAddon } from "./CornellAddon";

// ==========================================
// 1. INTERFACES DE DATOS
// ==========================================
export interface MarginaliaData {
    id: string;         // ID único (esencial para el Drag & Drop posterior)
    text: string;       // El texto de la nota (sin los tags, para una UI limpia)
    originalTag: string;// El tag original, ej: "#anatomia/corazon"
    file: TFile;        // Referencia al archivo de origen
    line: number;       // Número de línea (para ubicarlo rápido al inyectar cambios)
}

export interface CollectionNode {
    name: string;                           // ej: "corazon"
    fullTag: string;                        // ej: "#anatomia/corazon"
    children: Map<string, CollectionNode>;  // Sub-colecciones anidadas (usamos Map por rendimiento)
    items: MarginaliaData[];                // Las marginalias que viven exactamente en este nivel
}

// ==========================================
// 2. CLASE PRINCIPAL DEL ADDON
// ==========================================
export class ThreadCollectionsAddon extends CornellAddon {
    id = "thread-collections";
    name = "Thread Collections 🗂️";
    description = "Agrupa marginalias usando etiquetas nativas anidadas para reducir la sobrecarga cognitiva.";

    // Guardamos las referencias de los eventos para poder limpiarlos al descargar el addon
    private eventRefs: EventRef[] = [];

    // Nuestro estado en memoria
    public collectionsTree: Map<string, CollectionNode> = new Map();
    public orphanMarginalias: MarginaliaData[] = [];

    constructor(plugin: CornellMarginalia) {
        super(plugin);
    }

    load(): void {
        console.log(`Cargando addon: ${this.name}`);

        // 1. Escuchar cuando Obsidian termine de indexar todo el vault (Carga inicial)
        const readyEvent = this.plugin.app.metadataCache.on("resolved", () => {
            console.log("ThreadCollections: Vault indexado. Construyendo árbol inicial...");
            this.buildInitialTree();
        });
        this.eventRefs.push(readyEvent);

        // 2. Escuchar cambios en archivos individuales para actualizar nuestro árbol en tiempo real
        const changedEvent = this.plugin.app.metadataCache.on("changed", (file: TFile) => {
            console.log(`ThreadCollections: Archivo modificado -> ${file.path}`);
            this.updateTreeForFile(file);
        });
        this.eventRefs.push(changedEvent);

        // Registramos los eventos en el plugin para que Obsidian los maneje de forma segura
        this.plugin.registerEvent(readyEvent);
        this.plugin.registerEvent(changedEvent);
    }

    unload(): void {
        console.log(`Descargando addon: ${this.name}`);
        
        // Limpiamos los eventos para evitar fugas de memoria (memory leaks)
        this.eventRefs.forEach(ref => this.plugin.app.metadataCache.offref(ref));
        this.eventRefs = [];
    }

    /**
     * Se encarga de la lectura inicial usando el caché.
     */
    private async buildInitialTree(): Promise<void> {
        this.collectionsTree.clear();
        this.orphanMarginalias = [];

        const files = this.plugin.app.vault.getMarkdownFiles();
        
        for (const file of files) {
            await this.processFile(file);
        }
        
        console.log("ThreadCollections: Árbol construido exitosamente 🌳", this.collectionsTree);
        // TODO: En el Paso 3, aquí llamaremos a la función que dibuja la UI.
    }

    /**
     * Actualiza el estado en memoria de un solo archivo modificado.
     */
    private updateTreeForFile(file: TFile): void {
        // Ejecutamos el parseo sobre este archivo específico.
        // Nota: En una versión final, aquí deberíamos borrar primero las referencias viejas de este archivo.
        this.processFile(file);
    }

    /**
     * Extrae bloques y construye las ramas a partir del contenido de un archivo.
     */
    public async processFile(file: TFile): Promise<void> {
        const content = await this.plugin.app.vault.cachedRead(file);
        
        // Regex para capturar todo dentro de %%> y %%
        const blockRegex = /%%>([\s\S]*?)%%/g;
        let match;

        while ((match = blockRegex.exec(content)) !== null) {
            const rawText = match[1].trim();
            
            // Regex para capturar tags anidados nativos de Obsidian
            const tagRegex = /#([a-zA-Z0-9_/-]+)/g;
            const tags: string[] = [];
            let tagMatch;
            
            while ((tagMatch = tagRegex.exec(rawText)) !== null) {
                tags.push(tagMatch[1]);
            }

            // Limpiamos el texto para que la UI no muestre el tag redundante
            const cleanText = rawText.replace(tagRegex, '').trim();

            const marginalia: MarginaliaData = {
                id: `${file.path}-${match.index}`, // ID temporal seguro basado en ruta y posición
                text: cleanText,
                originalTag: tags.length > 0 ? `#${tags[0]}` : "", // Tomamos el primer tag como padre
                file: file,
                // Calculamos la línea contando los saltos de línea hasta donde encontramos el bloque
                line: content.substring(0, match.index).split('\n').length - 1 
            };

            this.insertIntoTree(marginalia);
        }
    }

    /**
     * Ensambla la estructura del árbol a partir de un tag anidado.
     */
    private insertIntoTree(marginalia: MarginaliaData): void {
        if (!marginalia.originalTag) {
            this.orphanMarginalias.push(marginalia);
            return;
        }

        // Rompemos el tag: "#anatomia/corazon/ventriculo" -> ["anatomia", "corazon", "ventriculo"]
        const parts = marginalia.originalTag.replace('#', '').split('/');
        
        let currentLevel = this.collectionsTree;
        let currentPath = "";

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            currentPath += (i === 0 ? `#${part}` : `/${part}`);

            // Si la "carpeta" no existe en este nivel, la creamos
            if (!currentLevel.has(part)) {
                currentLevel.set(part, {
                    name: part,
                    fullTag: currentPath,
                    children: new Map(),
                    items: []
                });
            }

            const node = currentLevel.get(part)!;

            // Si llegamos a la última parte del tag, guardamos la marginalia aquí
            if (i === parts.length - 1) {
                node.items.push(marginalia);
            }

            // Bajamos al siguiente nivel para la próxima iteración
            currentLevel = node.children;
        }
    }
    // ==========================================
    // 3. RENDERIZADO UI (DOM)
    // ==========================================

    /**
     * Punto de entrada para dibujar la UI. 
     * Se llama desde tu vista (Thread Explorer) pasándole el contenedor principal.
     */
    public render(containerEl: HTMLElement): void {
        // 1. Limpiamos el contenedor para evitar duplicados
        //containerEl.empty();
        
        const wrapper = containerEl.createDiv({ cls: 'thread-collections-wrapper' });

        // 2. Dibujamos las marginalias "huérfanas" (las que no tienen tags) en la raíz
        if (this.orphanMarginalias.length > 0) {
            const orphansContainer = wrapper.createDiv({ cls: 'orphan-marginalias' });
            this.orphanMarginalias.forEach(marginalia => {
                this.renderMarginaliaCard(marginalia, orphansContainer);
            });
        }

        // 3. Iniciamos la magia recursiva para dibujar las colecciones anidadas
        this.collectionsTree.forEach((node) => {
            this.renderCollectionNode(node, wrapper, 0);
        });
    }

    
    /**
     * Dibuja la tarjeta y la hace ARRASTRABLE.
     */
    private renderMarginaliaCard(marginalia: MarginaliaData, parentEl: HTMLElement): void {
        const cardEl = parentEl.createDiv({ 
            cls: 'marginalia-card',
            attr: { 
                'data-id': marginalia.id,
                'data-file': marginalia.file.path
            }
        });

        cardEl.createSpan({ text: marginalia.text });

        // --- MAGIA DRAG & DROP: INICIO ---
        cardEl.setAttr('draggable', 'true');
        
        cardEl.addEventListener('dragstart', (e: DragEvent) => {
            if (!e.dataTransfer) return;
            // Guardamos un JSON temporal en el evento con los datos que necesitamos mover
            const payload = JSON.stringify({
                filePath: marginalia.file.path,
                text: marginalia.text, // Usaremos el texto limpio para encontrarlo en el archivo
                currentTag: marginalia.originalTag
            });
            e.dataTransfer.setData('application/json', payload);
            e.dataTransfer.effectAllowed = 'move';
            
            // Efecto visual opcional: hacer la tarjeta semitransparente mientras vuela
            setTimeout(() => cardEl.style.opacity = '0.5', 0);
        });

        cardEl.addEventListener('dragend', () => {
            cardEl.style.opacity = '1'; // Restaurar opacidad al soltar
        });
    }

    /**
     * Dibuja la colección y la convierte en una ZONA PARA SOLTAR (Drop Zone).
     */
    private renderCollectionNode(node: CollectionNode, parentEl: HTMLElement, level: number): void {
        const boxEl = parentEl.createDiv({ 
            cls: `collection-box level-${level}`,
            attr: { 'data-full-tag': node.fullTag } 
        });

        const headerEl = boxEl.createDiv({ cls: 'collection-header' });
        const toggleIcon = headerEl.createSpan({ cls: 'collapse-icon', text: '▼ ' });
        headerEl.createSpan({ cls: 'collection-name', text: node.name });
        headerEl.createSpan({ cls: 'collection-meta', text: ` (${node.items.length} notas)` });

        const bodyEl = boxEl.createDiv({ cls: 'collection-body' });

        headerEl.onclick = () => {
            const isCollapsed = bodyEl.style.display === 'none';
            bodyEl.style.display = isCollapsed ? 'block' : 'none';
            toggleIcon.innerText = isCollapsed ? '▼ ' : '▶ ';
            boxEl.classList.toggle('is-collapsed', !isCollapsed); 
        };

        // --- MAGIA DRAG & DROP: ZONA DE RECEPCIÓN ---
        // Necesitamos prevenir el comportamiento por defecto para que HTML permita soltar aquí
        boxEl.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault(); 
            e.dataTransfer!.dropEffect = 'move';
            boxEl.classList.add('drag-over'); // Añade una clase CSS temporal para que brille más
        });

        boxEl.addEventListener('dragleave', () => {
            boxEl.classList.remove('drag-over');
        });

        boxEl.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation(); // Evita que el evento "suba" a las carpetas padre
            boxEl.classList.remove('drag-over');

            const payloadStr = e.dataTransfer?.getData('application/json');
            if (!payloadStr) return;

            const payload = JSON.parse(payloadStr);
            const targetTag = node.fullTag;

            // Si lo estamos soltando en la misma carpeta que ya estaba, no hacemos nada
            if (payload.currentTag === targetTag) return;

            // ¡Llamamos al motor de mutación!
            await this.mutateFileBlock(payload.filePath, payload.text, targetTag);
        });

        // Dibujar hijos recursivamente...
        node.items.forEach(m => this.renderMarginaliaCard(m, bodyEl));
        node.children.forEach(child => this.renderCollectionNode(child, bodyEl, level + 1));
    }
    // ==========================================
    // 4. MUTACIÓN SEGURA DE ARCHIVOS
    // ==========================================

    /**
     * Modifica el archivo .md añadiendo o reemplazando el tag de la marginalia.
     */
    private async mutateFileBlock(filePath: string, itemText: string, newTag: string): Promise<void> {
        const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
        
        if (!(file instanceof TFile)) {
            new Notice("Error: No se encontró el archivo original.");
            return;
        }

        console.log(`ThreadCollections: Moviendo marginalia a ${newTag} en ${file.name}`);

        // app.vault.process es la forma recomendada en Obsidian API.
        // Nos da el texto actual (data) y nosotros debemos devolver el texto modificado.
        await this.plugin.app.vault.process(file, (data) => {
            // Buscamos todos los bloques de marginalias
            const blockRegex = /%%>([\s\S]*?)%%/g;
            
            return data.replace(blockRegex, (match, innerText) => {
                // Para asegurarnos de que modificamos el correcto, verificamos que contenga nuestro texto
                if (innerText.includes(itemText)) {
                    
                    // 1. Limpiamos cualquier tag existente (ej. borramos #anatomia si lo vamos a mover)
                    const oldTagsRegex = /#[a-zA-Z0-9_/-]+/g;
                    const cleanInner = innerText.replace(oldTagsRegex, '').trim();
                    
                    // 2. Ensamblamos el nuevo bloque con el tag deseado al principio
                    // Se verá así: %%> #nuevo/tag mi texto limpio %%
                    return `%%> ${newTag} ${cleanInner} %%`;
                }
                
                // Si no es el bloque que buscamos, lo dejamos intacto
                return match;
            });
        });

        new Notice(`Marginalia movida a ${newTag} 🗂️`);
        
        // ¡Magia Reactiva! Como ya enlazamos el evento 'changed' en el Paso 1, 
        // Obsidian detectará este process(), llamará a updateTreeForFile(), 
        // y nuestra UI se actualizará casi al instante.
    }
}
