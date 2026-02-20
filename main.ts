import { App, Plugin, PluginSettingTab, Setting, MarkdownRenderer, Component, Editor, Notice, MarkdownView, ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { 
    EditorView, 
    Decoration, 
    DecorationSet, 
    ViewPlugin, 
    ViewUpdate, 
    WidgetType
} from '@codemirror/view';

// --- ESTRUCTURAS ---
interface CornellTag {
    prefix: string; 
    color: string;  
}

interface CornellSettings {
    ignoredFolders: string;
    alignment: 'left' | 'right'; 
    marginWidth: number;
    fontSize: string;
    fontFamily: string;
    tags: CornellTag[];
    enableReadingView: boolean; // <- NUEVO: modo lectura
    outgoingLinks: string[]; // <-- NUEVO: hilos
}
// barra lateral item
interface MarginaliaItem {
    text: string;
    color: string;
    file: TFile;
    line: number;
    blockId: string | null; // <- para luego arrastrar
}

const DEFAULT_SETTINGS: CornellSettings = {
    ignoredFolders: 'Templates',
    alignment: 'left', 
    marginWidth: 25,
    fontSize: '0.85em',
    fontFamily: 'inherit',
    enableReadingView: true, // <- NUEVO (activado por defecto para que los nuevos usuarios lo vean)
    tags: [
        { prefix: '!', color: '#ffea00' }, 
        { prefix: '?', color: '#ff9900' }, 
        { prefix: 'X-', color: '#ff4d4d' }, 
        { prefix: 'V-', color: '#00cc66' }  
    ]
}

// --- WIDGET DE MARGEN (ACTUALIZADO PARA HILOS 🧵) ---
class MarginNoteWidget extends WidgetType {
    constructor(
        readonly text: string, 
        readonly app: App, 
        readonly customColor: string | null,
        readonly sourcePath: string = "" // Necesario para que Obsidian sepa de dónde saltamos
    ) { super(); }

    toDOM(view: EditorView): HTMLElement {
        const div = document.createElement("div");
        div.className = "cm-cornell-margin";
        
        if (this.customColor) {
            div.style.borderColor = this.customColor;
            div.style.color = this.customColor;       
        }

        // 1. CAZADOR DE ENLACES: Buscamos cualquier [[Enlace]] en el texto
        const linkRegex = /\[\[(.*?)\]\]/g;
        let finalRenderText = this.text;
        const threadLinks: string[] = [];
        
        let match;
        while ((match = linkRegex.exec(this.text)) !== null) {
            threadLinks.push(match[1]); // Guardamos el destino (ej. "Glaucoma#^123")
            finalRenderText = finalRenderText.replace(match[0], '').trim(); // Borramos el [[...]] del texto visible
        }

        // 2. Renderizamos el texto limpio (sin los corchetes feos)
        MarkdownRenderer.render(this.app, finalRenderText, div, this.sourcePath, new Component());
        
        // 3. Si encontramos enlaces, creamos los botones del "Hilo"
        if (threadLinks.length > 0) {
            const threadContainer = div.createDiv({ cls: 'cornell-thread-container' });
            
            threadLinks.forEach(linkTarget => {
                const btn = threadContainer.createEl('button', { 
                    cls: 'cornell-thread-btn', 
                    title: `Follow thread: ${linkTarget}` 
                });
                
                // Usamos un emoji de hilo o eslabón como ícono
                btn.innerHTML = '🔗'; 
                
                // Lógica de teletransporte nativo de Obsidian
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation(); 
                    // true = abre la nota en una pestaña nueva al lado (ideal para estudiar dos cosas a la vez)
                    this.app.workspace.openLinkText(linkTarget, this.sourcePath, true); 
                };
            });
        }

        div.onclick = (e) => {
            const target = e.target as HTMLElement;
            // Evitamos bloquear el clic si tocamos nuestro nuevo botón
            if (target.tagName !== 'A' && !target.hasClass('cornell-thread-btn')) e.preventDefault();
        };
        return div;
    }

    ignoreEvent() { return false; } 
}

/// --- EXTENSIÓN DE VISTA ---
const createCornellExtension = (app: App, settings: CornellSettings, getActiveRecallMode: () => boolean) => ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view);
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = this.buildDecorations(update.view);
        }
    }

    buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>();
        const file = app.workspace.getActiveFile();
        
        if (file) {
            const ignoredPaths = settings.ignoredFolders.split(',').map(s => s.trim()).filter(s => s.length > 0);
            for (const path of ignoredPaths) {
                if (file.path.startsWith(path)) return builder.finish();
            }
        }

        const { state } = view;
        const cursorRanges = state.selection.ranges;

        for (const { from, to } of view.visibleRanges) {
            const text = state.doc.sliceString(from, to);
            const regex = /%%>(.*?)%%/g;
            let match;

            while ((match = regex.exec(text))) {
                const matchStart = from + match.index;
                const matchEnd = matchStart + match[0].length;
                const noteContent = match[1];

                const tree = syntaxTree(state);
                const node = tree.resolve(matchStart, 1);
                const isCode = node.name.includes("code") || node.name.includes("Code") || node.name.includes("math");
                if (isCode) continue;

                // Check de Cursor
                let isCursorInside = false;
                const line = state.doc.lineAt(matchStart);
                for (const range of cursorRanges) {
                    if (range.from >= line.from && range.to <= line.to) {
                        isCursorInside = true;
                        break;
                    }
                }

                if (isCursorInside) continue;

                // --- LÓGICA DE ACTIVE RECALL (BLUR) UNIFICADA ---
                if (noteContent.trim().endsWith(";;")) {
                    builder.add(line.from, line.from, Decoration.line({
                        class: "cornell-flashcard-target"
                    }));
                }

                // --- LÓGICA DE MARGINALIA ---
                let matchedColor = null;
                let finalNoteText = noteContent.trim(); 
                
                for (const tag of settings.tags) {
                    if (finalNoteText.startsWith(tag.prefix)) {
                        matchedColor = tag.color;
                        finalNoteText = finalNoteText.substring(tag.prefix.length).trim();
                        break;
                    }
                }

                // Si el texto quedó completamente vacío (ej. solo pusieron "%%> ! %%"), ignoramos la nota
                if (finalNoteText.length === 0) continue;

                builder.add(matchStart, matchEnd, Decoration.replace({
                    widget: new MarginNoteWidget(finalNoteText, app, matchedColor, file?.path || "")
                }));
            }
        }
        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});

// --- CONSTANTE DE LA VISTA ---
export const CORNELL_VIEW_TYPE = "cornell-marginalia-view";

// --- VISTA LATERAL (SIDEBAR EXPLORER) ACTUALIZADA 🧵 ---
// --- VISTA LATERAL (SIDEBAR EXPLORER) CON ÁRBOLES DE HILOS 🌳🧵 ---
// --- VISTA LATERAL (EXPLORER) CON BUSCADOR INTELIGENTE Y CACHÉ 🔍🧠 ---
class CornellNotesView extends ItemView {
    plugin: CornellMarginalia;
    currentTab: 'current' | 'vault' | 'threads' = 'current';
    
    isStitchingMode: boolean = false;
    sourceStitchItem: MarginaliaItem | null = null;

    // NUEVO: Variables de Memoria para el Buscador Instantáneo
    searchQuery: string = '';
    activeColorFilters: Set<string> = new Set();
    cachedItems: MarginaliaItem[] = []; 

    constructor(leaf: WorkspaceLeaf, plugin: CornellMarginalia) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return CORNELL_VIEW_TYPE; }
    getDisplayText() { return "Marginalia Explorer"; }
    getIcon() { return "list"; }

    async onOpen() {
        this.renderUI();
        await this.scanNotes();
    }

    renderUI() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('cornell-sidebar-container');

        container.createEl("h4", { text: "Marginalia Explorer", cls: "cornell-sidebar-title" });

        const controlsDiv = container.createDiv({ cls: 'cornell-sidebar-controls' });
        
        const tabCurrent = controlsDiv.createEl("button", { text: "Current", cls: this.currentTab === 'current' ? 'cornell-tab-active' : '' });
        const tabVault = controlsDiv.createEl("button", { text: "Vault", cls: this.currentTab === 'vault' ? 'cornell-tab-active' : '' });
        const tabThreads = controlsDiv.createEl("button", { text: "🧵 Threads", cls: this.currentTab === 'threads' ? 'cornell-tab-active' : '' });
        
        const btnStitch = controlsDiv.createEl("button", { text: "🔗 Stitch", title: "Connect two notes" });
        const btnRefresh = controlsDiv.createEl("button", { text: "🔄", title: "Refresh data" });

        // --- NUEVO: PANEL DE FILTROS Y BÚSQUEDA ---
        const filterContainer = container.createDiv({ cls: 'cornell-sidebar-filters' });
        
        // 1. Barra de búsqueda
        const searchInput = filterContainer.createEl('input', { 
            type: 'text', 
            placeholder: '🔍 Search notes...', 
            cls: 'cornell-search-bar' 
        });
        searchInput.value = this.searchQuery;
        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            this.applyFiltersAndRender(); // Filtra al instante usando el caché
        };

        // 2. Píldoras de colores (Generadas a partir de tus Settings)
        const pillsContainer = filterContainer.createDiv({ cls: 'cornell-color-pills' });
        this.plugin.settings.tags.forEach(tag => {
            const pill = pillsContainer.createEl('span', { cls: 'cornell-color-pill' });
            pill.style.backgroundColor = tag.color;
            pill.title = `Filter ${tag.prefix}`;
            
            if (this.activeColorFilters.has(tag.color)) pill.addClass('is-active');

            pill.onclick = () => {
                if (this.activeColorFilters.has(tag.color)) {
                    this.activeColorFilters.delete(tag.color);
                    pill.removeClass('is-active');
                } else {
                    this.activeColorFilters.add(tag.color);
                    pill.addClass('is-active');
                }
                this.applyFiltersAndRender();
            };
        });
        // ----------------------------------------

        container.createDiv({ cls: 'cornell-stitch-banner', text: '' }).style.display = 'none';
        container.createDiv({ cls: 'cornell-sidebar-content' });

        tabCurrent.onclick = async () => { this.currentTab = 'current'; this.renderUI(); await this.scanNotes(); };
        tabVault.onclick = async () => { this.currentTab = 'vault'; this.renderUI(); await this.scanNotes(); };
        tabThreads.onclick = async () => { this.currentTab = 'threads'; this.renderUI(); await this.scanNotes(); };
        
        btnRefresh.onclick = async () => { new Notice("Scanning..."); await this.scanNotes(); };

        btnStitch.onclick = () => {
            this.isStitchingMode = !this.isStitchingMode;
            this.sourceStitchItem = null; 
            btnStitch.classList.toggle('cornell-tab-active', this.isStitchingMode);
            this.updateStitchBanner();
        };
    }

    updateStitchBanner() {
        const banner = this.containerEl.querySelector('.cornell-stitch-banner') as HTMLElement;
        if (!this.isStitchingMode) { banner.style.display = 'none'; return; }
        banner.style.display = 'block';
        if (!this.sourceStitchItem) {
            banner.innerText = "🔗 Step 1: Click the ORIGIN note...";
            banner.style.backgroundColor = "var(--interactive-accent)";
        } else {
            banner.innerText = "🔗 Step 2: Click the DESTINATION note...";
            banner.style.backgroundColor = "var(--color-green)";
        }
    }

    async scanNotes() {
        const contentDiv = this.containerEl.querySelector('.cornell-sidebar-content') as HTMLElement;
        if (!contentDiv) return;
        contentDiv.empty();
        contentDiv.createEl('p', { text: 'Scanning vault...', cls: 'cornell-sidebar-empty' });

        const allItemsFlat: MarginaliaItem[] = []; 
        const defaultColor = 'var(--text-accent)'; 

        let filesToScan: TFile[] = [];
        if (this.currentTab === 'current') {
            const activeFile = this.plugin.app.workspace.getActiveFile();
            if (activeFile) filesToScan.push(activeFile);
        } else {
            filesToScan = this.plugin.app.vault.getMarkdownFiles();
            const ignoredPaths = this.plugin.settings.ignoredFolders.split(',').map(s => s.trim()).filter(s => s.length > 0);
            filesToScan = filesToScan.filter(f => !ignoredPaths.some(p => f.path.startsWith(p)));
        }

        for (const file of filesToScan) {
            const content = await this.plugin.app.vault.cachedRead(file);
            const lines = content.split('\n');
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineRegex = /%%>(.*?)%%/g;
                let match;

                while ((match = lineRegex.exec(line)) !== null) {
                    let noteContent = match[1].trim();
                    if (noteContent.endsWith(';;')) noteContent = noteContent.slice(0, -2).trim();

                    const linkRegex = /\[\[(.*?)\]\]/g;
                    const outgoingLinks: string[] = [];
                    let cleanText = noteContent;
                    let matchLink;
                    
                    while ((matchLink = linkRegex.exec(noteContent)) !== null) {
                        outgoingLinks.push(matchLink[1]);
                        cleanText = cleanText.replace(matchLink[0], '').trim();
                    }

                    let matchedColor = defaultColor;
                    for (const tag of this.plugin.settings.tags) {
                        if (cleanText.startsWith(tag.prefix)) {
                            matchedColor = tag.color;
                            cleanText = cleanText.substring(tag.prefix.length).trim();
                            break;
                        }
                    }

                    if (cleanText.length === 0) continue;

                    const blockIdMatch = line.match(/\^([a-zA-Z0-9]+)\s*$/);
                    const existingBlockId = blockIdMatch ? blockIdMatch[1] : null;

                    allItemsFlat.push({
                        text: cleanText,
                        color: matchedColor,
                        file: file,
                        line: i,
                        blockId: existingBlockId,
                        outgoingLinks: outgoingLinks
                    });
                }
            }
        }
        
        // Guardamos todo en memoria para búsquedas instantáneas
        this.cachedItems = allItemsFlat;
        this.applyFiltersAndRender();
    }

// --- NUEVO: MOTOR INTELIGENTE DE FILTRADO (LÓGICA INVERTIDA) ---
    applyFiltersAndRender() {
        const contentDiv = this.containerEl.querySelector('.cornell-sidebar-content') as HTMLElement;
        if (!contentDiv) return;

        const isFilterActive = this.searchQuery.length > 0 || this.activeColorFilters.size > 0;

        const matchesFilter = (item: MarginaliaItem) => {
            const matchesSearch = item.text.toLowerCase().includes(this.searchQuery) || item.file.basename.toLowerCase().includes(this.searchQuery);
            const matchesColor = this.activeColorFilters.size === 0 || this.activeColorFilters.has(item.color);
            return matchesSearch && matchesColor;
        };

        if (this.currentTab === 'threads') {
            if (!isFilterActive) {
                // SIN FILTROS: Lógica normal (Buscamos Raíces Absolutas)
                const allTargetIds = new Set<string>();
                this.cachedItems.forEach(item => {
                    item.outgoingLinks.forEach(l => {
                        const parts = l.split('#^');
                        if (parts.length === 2) allTargetIds.add(parts[1]);
                    });
                });

                const rootItems = this.cachedItems.filter(item => 
                    item.outgoingLinks.length > 0 && (!item.blockId || !allTargetIds.has(item.blockId))
                );
                this.renderThreads(rootItems, contentDiv, false);

            } else {
                // CON FILTROS: Las notas que coinciden se convierten en las NUEVAS raíces
                const matchingItems = this.cachedItems.filter(matchesFilter);
                
                // Evitamos dibujar sub-árboles repetidos (Si A y B coinciden, y A apunta a B, solo dibujamos A)
                const topLevelMatches = matchingItems.filter(item => {
                    const isChildOfAnotherMatch = matchingItems.some(parent => 
                        item.blockId && parent.outgoingLinks.some(link => link.includes(`#^${item.blockId}`))
                    );
                    return !isChildOfAnotherMatch;
                });

                // Le avisamos al renderizador que estamos en "Modo Filtro"
                this.renderThreads(topLevelMatches, contentDiv, true);
            }

        } else {
            // Lógica para Current y Vault
            const filtered = this.cachedItems.filter(matchesFilter);
            const results: Record<string, MarginaliaItem[]> = {};
            
            filtered.forEach(item => {
                if (!results[item.color]) results[item.color] = [];
                results[item.color].push(item);
            });
            
            this.renderResults(results, contentDiv);
        }
    }

    // --- RENDERIZADOR PRINCIPAL ---
    renderThreads(rootItems: MarginaliaItem[], container: HTMLElement, isFilteredMode: boolean = false) {
        container.empty();
        if (rootItems.length === 0) {
            container.createEl('p', { text: 'No matching threads found.', cls: 'cornell-sidebar-empty' });
            return;
        }

        for (const root of rootItems) {
            const threadGroup = container.createDiv({ cls: 'cornell-thread-parent' });
            // Pasamos isFilteredMode y le decimos que ESTA nota es la primera (isRootCall = true)
            this.renderThreadNode(root, threadGroup, this.cachedItems, new Set<string>(), isFilteredMode, true);
        }
    }

    // --- MOTOR RECURSIVO (CON BOTÓN "UP" ⬆️) ---
    renderThreadNode(item: MarginaliaItem, container: HTMLElement, allItems: MarginaliaItem[], visitedIds: Set<string>, isFilteredMode: boolean = false, isRootCall: boolean = false) {
        if (item.blockId && visitedIds.has(item.blockId)) {
            const brokenDiv = container.createDiv({ cls: 'cornell-sidebar-item' });
            brokenDiv.style.borderLeftColor = 'red';
            brokenDiv.createDiv({ cls: 'cornell-sidebar-item-text', text: `🔁 Loop detected! (${item.file.basename})` });
            return;
        }

        const newVisited = new Set(visitedIds);
        if (item.blockId) newVisited.add(item.blockId);

        const nodeWrapper = container.createDiv({ cls: 'cornell-node-wrapper' });

        // --- NUEVO: BOTÓN "PROVIENE DE..." (Solo se muestra si filtramos y es la nota superior) ---
        if (isFilteredMode && isRootCall && item.blockId) {
            // Buscamos quién lo conectó
            const parentNode = allItems.find(p => p.outgoingLinks.some(link => link.includes(`#^${item.blockId}`)));
            if (parentNode) {
                const upBtn = nodeWrapper.createDiv({ cls: 'cornell-thread-up-btn', title: 'Go to parent note' });
                upBtn.innerHTML = `↑ Child of: <b>${parentNode.file.basename}</b>`;
                
                // Al tocarlo, te teletransporta al Padre
                upBtn.onclick = async () => {
                    const leaf = this.plugin.app.workspace.getLeaf(false);
                    await leaf.openFile(parentNode.file, { eState: { line: parentNode.line } });
                };
            }
        }

        const itemDiv = this.createItemDiv(item, nodeWrapper);
        itemDiv.style.position = 'relative';

        if (item.outgoingLinks.length > 0) {
            const toggleBtn = itemDiv.createDiv({ cls: 'cornell-collapse-toggle' });
            toggleBtn.innerHTML = '▼';
            itemDiv.prepend(toggleBtn); 

            const childrenContainer = nodeWrapper.createDiv({ cls: 'cornell-thread-tree' });

            toggleBtn.onclick = (e) => {
                e.stopPropagation(); 
                const isCollapsed = childrenContainer.hasClass('is-collapsed');
                if (isCollapsed) {
                    childrenContainer.removeClass('is-collapsed');
                    toggleBtn.removeClass('is-collapsed');
                } else {
                    childrenContainer.addClass('is-collapsed');
                    toggleBtn.addClass('is-collapsed');
                }
            };

            for (const linkStr of item.outgoingLinks) {
                const parts = linkStr.split('#^');
                if (parts.length === 2) {
                    const targetId = parts[1];
                    const childItem = allItems.find(i => i.blockId === targetId);
                    
                    if (childItem) {
                        // isRootCall se vuelve false porque estos son los hijos
                        this.renderThreadNode(childItem, childrenContainer, allItems, newVisited, isFilteredMode, false);
                    } else {
                        const brokenDiv = childrenContainer.createDiv({ cls: 'cornell-sidebar-item' });
                        brokenDiv.style.borderLeftColor = 'gray';
                        brokenDiv.createDiv({ cls: 'cornell-sidebar-item-text', text: `⚠️ Broken link: ${linkStr}` });
                    }
                }
            }
        }
    }

    renderResults(results: Record<string, MarginaliaItem[]>, container: HTMLElement) {
        container.empty();
        let totalFound = 0;

        for (const [color, items] of Object.entries(results)) {
            if (items.length === 0) continue;
            totalFound += items.length;

            const groupHeader = container.createDiv({ cls: 'cornell-sidebar-group' });
            const colorDot = groupHeader.createSpan({ cls: 'cornell-sidebar-color-dot' });
            colorDot.style.backgroundColor = color;
            groupHeader.createSpan({ text: `${items.length} notes` });

            for (const item of items) {
                this.createItemDiv(item, container);
            }
        }
        if (totalFound === 0) container.createEl('p', { text: 'No notes match your search.', cls: 'cornell-sidebar-empty' });
    }

    createItemDiv(item: MarginaliaItem, parentContainer: HTMLElement): HTMLElement {
        const itemDiv = parentContainer.createDiv({ cls: 'cornell-sidebar-item' });
        itemDiv.style.borderLeftColor = item.color;

        itemDiv.createDiv({ cls: 'cornell-sidebar-item-text', text: item.text });
        itemDiv.createDiv({ cls: 'cornell-sidebar-item-meta', text: `${item.file.basename} (L${item.line + 1})` });

        itemDiv.onclick = async () => {
            if (this.isStitchingMode) {
                if (!this.sourceStitchItem) {
                    this.sourceStitchItem = item;
                    itemDiv.style.backgroundColor = "var(--background-modifier-hover)";
                    this.updateStitchBanner();
                } else {
                    if (this.sourceStitchItem === item) {
                        new Notice("Cannot connect a note to itself.");
                        return;
                    }
                    await this.executeStitch(this.sourceStitchItem, item);
                    this.isStitchingMode = false;
                    this.sourceStitchItem = null;
                    this.updateStitchBanner();
                    await this.scanNotes();
                }
                return;
            }
            const leaf = this.plugin.app.workspace.getLeaf(false);
            await leaf.openFile(item.file, { eState: { line: item.line } });
        };

        itemDiv.setAttr('draggable', 'true');
        itemDiv.addEventListener('dragstart', (event: DragEvent) => {
            if (!event.dataTransfer) return;
            event.dataTransfer.effectAllowed = 'copy';
            let targetId = item.blockId;
            if (!targetId) {
                targetId = Math.random().toString(36).substring(2, 8);
                item.blockId = targetId; 
                this.injectBackgroundBlockId(item.file, item.line, targetId);
            }
            const dragPayload = `[[${item.file.basename}#^${targetId}|${item.text}]]`;
            event.dataTransfer.setData('text/plain', dragPayload);
        });

        return itemDiv;
    }

    async executeStitch(source: MarginaliaItem, target: MarginaliaItem) {
        new Notice("Cosiendo hilo...");
        let targetId = target.blockId;
        if (!targetId) {
            targetId = Math.random().toString(36).substring(2, 8);
            await this.injectBackgroundBlockId(target.file, target.line, targetId);
        }
        const linkToInject = ` [[${target.file.basename}#^${targetId}]]`;

        await this.plugin.app.vault.process(source.file, (data) => {
            const lines = data.split('\n');
            if (source.line >= 0 && source.line < lines.length) {
                lines[source.line] = lines[source.line].replace(source.text, source.text + linkToInject);
            }
            return lines.join('\n');
        });
        new Notice("¡Hilo conectado con éxito! 🔗");
    }

    async injectBackgroundBlockId(file: TFile, lineIndex: number, newId: string) {
        await this.plugin.app.vault.process(file, (data) => {
            const lines = data.split('\n');
            if (lineIndex >= 0 && lineIndex < lines.length) {
                if (!lines[lineIndex].match(/\^([a-zA-Z0-9]+)\s*$/)) {
                    lines[lineIndex] = lines[lineIndex] + ` ^${newId}`;
                }
            }
            return lines.join('\n');
        });
    }
}

// --- SETTINGS TAB ---
class CornellSettingTab extends PluginSettingTab {
    plugin: CornellMarginalia;
    constructor(app: App, plugin: CornellMarginalia) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Cornell Marginalia Settings' });

        containerEl.createEl('h3', { text: 'General Appearance' });
        
        new Setting(containerEl)
            .setName('Enable in Reading View')
            .setDesc('Shows marginalia in reading mode. Turn this off if you prefer a clean view.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableReadingView)
                .onChange(async (value) => {
                    this.plugin.settings.enableReadingView = value;
                    await this.plugin.saveSettings();
                    new Notice('Reload the note to see changes in Reading View');
                }));
        
        new Setting(containerEl).setName('Margin Alignment').addDropdown(d => d.addOption('left', 'Left').addOption('right', 'Right').setValue(this.plugin.settings.alignment).onChange(async v => { this.plugin.settings.alignment = v as any; await this.plugin.saveSettings(); this.plugin.updateStyles(); }));
        new Setting(containerEl).setName('Margin Width (%)').addSlider(s => s.setLimits(15, 60, 1).setValue(this.plugin.settings.marginWidth).setDynamicTooltip().onChange(async v => { this.plugin.settings.marginWidth = v; await this.plugin.saveSettings(); this.plugin.updateStyles(); }));
        new Setting(containerEl).setName('Font Size').addText(t => t.setValue(this.plugin.settings.fontSize).onChange(async v => { this.plugin.settings.fontSize = v; await this.plugin.saveSettings(); this.plugin.updateStyles(); }));
        new Setting(containerEl).setName('Font Family').addText(t => t.setValue(this.plugin.settings.fontFamily).onChange(async v => { this.plugin.settings.fontFamily = v; await this.plugin.saveSettings(); this.plugin.updateStyles(); }));

        containerEl.createEl('h3', { text: 'Color Tags' });
        this.plugin.settings.tags.forEach((tag, index) => {
            new Setting(containerEl).setName(`Tag ${index + 1}`).addText(t => t.setValue(tag.prefix).onChange(async v => { this.plugin.settings.tags[index].prefix = v; await this.plugin.saveSettings(); this.plugin.app.workspace.updateOptions(); })).addColorPicker(c => c.setValue(tag.color).onChange(async v => { this.plugin.settings.tags[index].color = v; await this.plugin.saveSettings(); this.plugin.app.workspace.updateOptions(); })).addButton(b => b.setIcon('trash').onClick(async () => { this.plugin.settings.tags.splice(index, 1); await this.plugin.saveSettings(); this.display(); this.plugin.app.workspace.updateOptions(); }));
        });
        new Setting(containerEl).addButton(b => b.setButtonText('Add Tag').onClick(async () => { this.plugin.settings.tags.push({ prefix: 'New', color: '#888' }); await this.plugin.saveSettings(); this.display(); }));
        
        containerEl.createEl('h3', { text: 'Advanced' });
        new Setting(containerEl).setName('Ignored Folders').addTextArea(t => t.setValue(this.plugin.settings.ignoredFolders).onChange(async v => { this.plugin.settings.ignoredFolders = v; await this.plugin.saveSettings(); this.plugin.app.workspace.updateOptions(); }));
    }
}

// --- PLUGIN PRINCIPAL ---
export default class CornellMarginalia extends Plugin {
    settings: CornellSettings;
    activeRecallMode: boolean = false; 
    ribbonIcon: HTMLElement;

    async onload() {
        await this.loadSettings();
        this.updateStyles(); 
// Registrar la nueva vista lateral
        this.registerView(
            CORNELL_VIEW_TYPE,
            (leaf) => new CornellNotesView(leaf, this)
        );

        // Añadir el comando para abrir el explorador
        this.addCommand({
            id: 'open-cornell-explorer',
            name: 'Open Marginalia Explorer',
            callback: () => {
                this.activateView();
            }
        });
        this.addSettingTab(new CornellSettingTab(this.app, this));
        
        this.registerEditorExtension(createCornellExtension(this.app, this.settings, () => this.activeRecallMode));

        this.ribbonIcon = this.addRibbonIcon('eye', 'Toggle Active Recall Mode', (evt: MouseEvent) => {
            this.toggleActiveRecall();
        });

        this.addCommand({
            id: 'insert-cornell-note',
            name: 'Insert Margin Note',
            editorCallback: (editor: Editor) => {
                const selection = editor.getSelection();
                if (selection) editor.replaceSelection(`%%> ${selection} %%`);
                else {
                    editor.replaceSelection(`%%>  %%`);
                    const cursor = editor.getCursor();
                    editor.setCursor({ line: cursor.line, ch: cursor.ch - 3 });
                }
            }
        });

        this.addCommand({
            id: 'generate-flashcards-sr',
            name: 'Flashcards Generation (Spaced Repetition)',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.generateFlashcards(editor);
            }
        });

        this.addCommand({
            id: 'toggle-reading-view-marginalia',
            name: 'Toggle Marginalia in Reading View',
            callback: async () => {
                this.settings.enableReadingView = !this.settings.enableReadingView;
                await this.saveSettings();
                const statusMessage = this.settings.enableReadingView ? 'ON 📖' : 'OFF 🚫';
                new Notice(`Reading View Marginalia: ${statusMessage}\n(Switch tabs or refresh to see the changes)`);
            }
        });

        this.addCommand({
            id: 'prepare-pdf-print',
            name: 'Prepare Marginalia for PDF Print',
            editorCallback: (editor: Editor) => {
                this.prepareForPrint(editor);
            }
        });

        this.addCommand({
            id: 'restore-pdf-print',
            name: 'Restore Marginalia after PDF Print',
            editorCallback: (editor: Editor) => {
                this.restoreFromPrint(editor);
            }
        });

        this.registerMarkdownPostProcessor((el, ctx) => {
            if (!this.settings.enableReadingView) return;
            
            const sectionInfo = ctx.getSectionInfo(el);
            if (!sectionInfo) return;

            const lines = sectionInfo.text.split('\n');
            const sectionLines = lines.slice(sectionInfo.lineStart, sectionInfo.lineEnd + 1);

            const listItems = el.querySelectorAll('li');
            let liIndex = 0;
            let currentTarget: HTMLElement = el;

            sectionLines.forEach((line) => {
                const isListItemLine = /^[\s]*[-*+]\s/.test(line) || /^[\s]*\d+\.\s/.test(line);

                if (isListItemLine) {
                    if (listItems[liIndex]) {
                        currentTarget = listItems[liIndex];
                    }
                    liIndex++;
                }

                const regex = /%%>(.*?)%%/g;
                let match;
                
                while ((match = regex.exec(line)) !== null) {
                    const noteContent = match[1].trim();
                    const isFlashcard = noteContent.endsWith(";;");

                    let matchedColor = null;
                    let finalNoteText = noteContent;

                    for (const tag of this.settings.tags) {
                        if (finalNoteText.startsWith(tag.prefix)) {
                            matchedColor = tag.color;
                            finalNoteText = finalNoteText.substring(tag.prefix.length).trim();
                            break;
                        }
                    }

// Prevenir cajas vacías
                    if (finalNoteText.length === 0) continue;

                    // 1. CAZADOR DE ENLACES PARA MODO LECTURA
                    const linkRegex = /\[\[(.*?)\]\]/g;
                    let finalRenderText = finalNoteText;
                    const threadLinks: string[] = [];
                    
                    let matchLink;
                    while ((matchLink = linkRegex.exec(finalNoteText)) !== null) {
                        threadLinks.push(matchLink[1]);
                        finalRenderText = finalRenderText.replace(matchLink[0], '').trim();
                    }

                    const marginDiv = document.createElement("div");
                    marginDiv.className = "cm-cornell-margin reading-mode-margin"; 
                    
                    if (matchedColor) {
                        marginDiv.style.setProperty('border-color', matchedColor, 'important');
                        marginDiv.style.setProperty('color', matchedColor, 'important');
                    }

                    // 2. Renderizamos el texto limpio
                    MarkdownRenderer.render(this.app, finalRenderText, marginDiv, ctx.sourcePath, this);

                    // 3. Inyectamos los botones del hilo si existen
                    if (threadLinks.length > 0) {
                        const threadContainer = marginDiv.createDiv({ cls: 'cornell-thread-container' });
                        threadLinks.forEach(linkTarget => {
                            const btn = threadContainer.createEl('button', { 
                                cls: 'cornell-thread-btn', 
                                title: `Follow thread: ${linkTarget}` 
                            });
                            btn.innerHTML = '🔗'; 
                            btn.onclick = (e) => {
                                e.preventDefault();
                                e.stopPropagation(); 
                                this.app.workspace.openLinkText(linkTarget, ctx.sourcePath, true); 
                            };
                        });
                    }

                    currentTarget.classList.add('cornell-reading-block');
                    currentTarget.appendChild(marginDiv);

                    if (isFlashcard) {
                        currentTarget.classList.add('cornell-flashcard-target');
                    }
                }
            });
        });
    }


    toggleActiveRecall() {
        this.activeRecallMode = !this.activeRecallMode;
        new Notice(this.activeRecallMode ? 'Active Recall Mode: ON 🙈' : 'Active Recall Mode: OFF 👁️');
        
        if (this.activeRecallMode) {
            this.ribbonIcon.setAttribute('aria-label', 'Disable Active Recall');
            document.body.classList.add('cornell-active-recall-on'); 
        } else {
            this.ribbonIcon.setAttribute('aria-label', 'Enable Active Recall');
            document.body.classList.remove('cornell-active-recall-on');
        }
        
        this.app.workspace.updateOptions();
    }
async activateView() {
        const { workspace } = this.app;
        
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(CORNELL_VIEW_TYPE);

        if (leaves.length > 0) {
            // Si ya está abierta, la seleccionamos
            leaf = leaves[0];
        } else {
            // Si no está abierta, creamos una nueva pestaña a la derecha
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: CORNELL_VIEW_TYPE, active: true });
            }
        }

        // Revelar la pestaña al usuario
        if (leaf) workspace.revealLeaf(leaf);
    }
    // --- LÓGICA DE FLASHCARDS INTELIGENTE ---
    generateFlashcards(editor: Editor) {
        const content = editor.getValue();
        const headerText = "### Flashcards";
        const lines = content.split('\n');
        
        const foundFlashcards: Set<string> = new Set();
        const regex = /^(.*?)\s*%%>\s*(.*?);;\s*%%/; 

        lines.forEach(line => {
            const match = line.match(regex);
            if (match) {
                const answer = match[1].trim();   
                const question = match[2].trim(); 
                if (answer && question) {
                    foundFlashcards.add(`${question} :: ${answer}`);
                }
            }
        });

        if (foundFlashcards.size === 0) {
            new Notice('No active recall notes (ending in ;;) found.');
            return;
        }

        let headerLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === headerText) {
                headerLineIndex = i;
                break;
            }
        }

        let newFlashcards: string[] = [];

        if (headerLineIndex !== -1) {
            const existingContent = lines.slice(headerLineIndex + 1).join('\n');
            
            foundFlashcards.forEach(card => {
                if (!existingContent.includes(card)) {
                    newFlashcards.push(card);
                }
            });

            if (newFlashcards.length > 0) {
                const textToAppend = '\n' + newFlashcards.join('\n');
                const lastLine = editor.lineCount();
                editor.replaceRange(textToAppend, { line: lastLine, ch: 0 });
                new Notice(`Added ${newFlashcards.length} new flashcards.`);
            } else {
                new Notice('All flashcards are already up to date!');
            }

        } else {
            newFlashcards = Array.from(foundFlashcards);
            const textToAppend = `\n\n${headerText}\n${newFlashcards.join('\n')}`;
            const lastLine = editor.lineCount();
            editor.replaceRange(textToAppend, { line: lastLine, ch: 0 });
            new Notice(`Generated section with ${newFlashcards.length} flashcards.`);
        }
    }

    updateStyles() {
        document.body.style.setProperty('--cornell-width', `${this.settings.marginWidth}%`);
        document.body.style.setProperty('--cornell-font-size', this.settings.fontSize);
        document.body.style.setProperty('--cornell-font-family', this.settings.fontFamily);
        
        if (this.settings.alignment === 'left') {
            document.body.style.setProperty('--cornell-left', 'auto');
            document.body.style.setProperty('--cornell-right', '100%');
            document.body.style.setProperty('--cornell-margin-right', '15px');
            document.body.style.setProperty('--cornell-margin-left', '0');
            document.body.style.setProperty('--cornell-border-r', '2px solid var(--text-accent)');
            document.body.style.setProperty('--cornell-border-l', 'none');
            document.body.style.setProperty('--cornell-text-align', 'right');
        } else {
            document.body.style.setProperty('--cornell-left', '100%');
            document.body.style.setProperty('--cornell-right', 'auto');
            document.body.style.setProperty('--cornell-margin-left', '15px');
            document.body.style.setProperty('--cornell-margin-right', '0');
            document.body.style.setProperty('--cornell-border-l', '2px solid var(--text-accent)');
            document.body.style.setProperty('--cornell-border-r', 'none');
            document.body.style.setProperty('--cornell-text-align', 'left');
        }
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }
// --- LÓGICA DE IMPRESIÓN (PDF EXPORT) ULTRA SEGURA ---
    async prepareForPrint(editor: Editor) {
        let content = editor.getValue();
        let modified = false;

        // Reemplazo puramente en línea. No movemos el texto de su lugar original.
        const newContent = content.replace(/%%>(.*?)%%/g, (match, noteContent) => {
            modified = true;
            let finalText = noteContent.trim();
            
            if (finalText.endsWith(';;')) {
                finalText = finalText.slice(0, -2).trim();
            }

            let matchedColor = 'var(--text-accent)';
            for (const tag of this.settings.tags) {
                if (finalText.startsWith(tag.prefix)) {
                    matchedColor = tag.color;
                    finalText = finalText.substring(tag.prefix.length).trim();
                    break;
                }
            }

            // Guardamos tu texto original codificado para que sea imposible perderlo
            const safeOriginal = encodeURIComponent(match);
            return `<span class="cornell-print-margin" data-original="${safeOriginal}" style="border-right: 3px solid ${matchedColor}; color: ${matchedColor};">${finalText}</span>`;
        });

        if (modified) {
            editor.setValue(newContent);
            new Notice("¡Nota preparada para imprimir! Exporta a PDF ahora.");
        } else {
            new Notice("No se encontraron marginalias para convertir.");
        }
    }

    async restoreFromPrint(editor: Editor) {
        let content = editor.getValue();
        let modified = false;

        // Buscamos exactamente el span que creamos y devolvemos su contenido original
        const newContent = content.replace(/<span class="cornell-print-margin" data-original="(.*?)".*?<\/span>/gs, (match, safeOriginal) => {
            modified = true;
            return decodeURIComponent(safeOriginal);
        });

        if (modified) {
            editor.setValue(newContent);
            new Notice("¡Nota restaurada a formato Markdown original!");
        } else {
            new Notice("No hay marginalias preparadas para restaurar.");
        }
    }
}
