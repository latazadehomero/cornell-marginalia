import { App, Plugin, PluginSettingTab, Setting, MarkdownRenderer, Component, Editor, Notice, MarkdownView, ItemView, WorkspaceLeaf, TFile, Modal } from 'obsidian';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';

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
    enableReadingView: boolean;
    outgoingLinks: string[]; 
}

interface MarginaliaItem {
    text: string;
    rawText: string; // 🧠 LA CARA OCULTA: Vital para no corromper enlaces de imágenes
    color: string;
    file: TFile;
    line: number;
    blockId: string | null;
    outgoingLinks: string[];
    isTitle?: boolean;
    indentLevel?: number;
}

const DEFAULT_SETTINGS: CornellSettings = {
    ignoredFolders: 'Templates',
    alignment: 'left', 
    marginWidth: 25,
    fontSize: '0.85em',
    fontFamily: 'inherit',
    enableReadingView: true,
    tags: [
        { prefix: '!', color: '#ffea00' }, 
        { prefix: '?', color: '#ff9900' }, 
        { prefix: 'X-', color: '#ff4d4d' }, 
        { prefix: 'V-', color: '#00cc66' }  
    ],
    outgoingLinks: []
}

// --- WIDGET DE MARGEN ---
class MarginNoteWidget extends WidgetType {
    constructor(
        readonly text: string, 
        readonly app: App, 
        readonly customColor: string | null,
        readonly sourcePath: string = "",
        readonly direction: string = ">"
    ) { super(); }

    toDOM(view: EditorView): HTMLElement {
        const div = document.createElement("div");
        div.className = "cm-cornell-margin";
        
        if (this.customColor) {
            div.style.borderColor = this.customColor;
            div.style.color = this.customColor;       
        }

        let finalRenderText = this.text;
        const imagesToRender: string[] = [];

        // 🛡️ VACUNA REGEX (Cazador de Imágenes blindado)
        const imgRegex = /img:\s*\[\[(.*?)\]\]/gi;
        const imgMatches = Array.from(finalRenderText.matchAll(imgRegex));
        imgMatches.forEach(m => imagesToRender.push(m[1]));
        finalRenderText = finalRenderText.replace(imgRegex, '').trim();

        // 🛡️ CAZADOR DE ENLACES (Blindado contra loops)
        const threadLinks: string[] = [];
        const linkRegex = /(?<!!)\[\[(.*?)\]\]/g;
        const linkMatches = Array.from(finalRenderText.matchAll(linkRegex));
        linkMatches.forEach(m => threadLinks.push(m[1]));
        finalRenderText = finalRenderText.replace(linkRegex, '').trim();

        MarkdownRenderer.render(this.app, finalRenderText, div, this.sourcePath, new Component());
        
        if (imagesToRender.length > 0) {
            imagesToRender.forEach(imgName => {
                const cleanName = imgName.split('|')[0];
                const file = this.app.metadataCache.getFirstLinkpathDest(cleanName, this.sourcePath);
                if (file) {
                    const imgSrc = this.app.vault.getResourcePath(file);
                    div.createEl('img', { attr: { src: imgSrc } });
                } else {
                    div.createDiv({ text: `⚠️ Imagen no encontrada: ${cleanName}`, cls: 'cornell-sidebar-item-text' });
                }
            });
        }

        if (threadLinks.length > 0) {
            const threadContainer = div.createDiv({ cls: 'cornell-thread-container' });
            threadLinks.forEach(linkTarget => {
                const btn = threadContainer.createEl('button', { cls: 'cornell-thread-btn', title: `Follow thread: ${linkTarget}` });
                btn.innerHTML = '🔗'; 
                btn.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation(); 
                    this.app.workspace.openLinkText(linkTarget, this.sourcePath, true); 
                };
                btn.onmouseover = (event) => {
                    this.app.workspace.trigger('hover-link', {
                        event: event, source: 'cornell-marginalia', hoverParent: threadContainer,
                        targetEl: btn, linktext: linkTarget, sourcePath: this.sourcePath
                    });
                };
            });
        }

        div.onclick = (e) => {
            const target = e.target as HTMLElement;
            if (target.tagName !== 'A' && !target.hasClass('cornell-thread-btn')) e.preventDefault();
        };
        return div;
    }

    ignoreEvent() { return false; } 
}

// --- EXTENSIÓN DE VISTA ---
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

        interface DecData { from: number; to: number; dec: Decoration; type: number; }
        const decorationsData: DecData[] = [];

        for (const { from, to } of view.visibleRanges) {
            const text = state.doc.sliceString(from, to);
            const regex = /%%([><])([\s\S]*?)%%/g;
            let match;

            while ((match = regex.exec(text))) {
                const matchStart = from + match.index;
                const matchEnd = matchStart + match[0].length;
                const direction = match[1]; 
                const noteContent = match[2]; 

                const tree = syntaxTree(state);
                const node = tree.resolve(matchStart, 1);
                const isCode = node.name.includes("code") || node.name.includes("Code") || node.name.includes("math");
                if (isCode) continue;

                let isCursorInside = false;
                const line = state.doc.lineAt(matchStart);
                
                for (const range of cursorRanges) {
                    if (range.from >= line.from && range.to <= line.to) {
                        isCursorInside = true;
                        break;
                    }
                }

                if (isCursorInside) continue;

                if (noteContent.trim().endsWith(";;")) {
                    decorationsData.push({
                        from: line.from, to: line.from, type: 0,
                        dec: Decoration.line({ class: "cornell-flashcard-target" })
                    });
                }

                let matchedColor = null;
                let finalNoteText = noteContent.trim(); 
                
                for (const tag of settings.tags) {
                    if (finalNoteText.startsWith(tag.prefix)) {
                        matchedColor = tag.color;
                        finalNoteText = finalNoteText.substring(tag.prefix.length).trim();
                        break;
                    }
                }

                if (finalNoteText.length === 0) continue;

                decorationsData.push({
                    from: line.from, 
                    to: line.from, 
                    type: 1,
                    dec: Decoration.widget({
                        widget: new MarginNoteWidget(finalNoteText, app, matchedColor, file?.path || "", direction),
                        side: -1 
                    })
                });

                decorationsData.push({
                    from: matchStart, 
                    to: matchEnd, 
                    type: 2,
                    dec: Decoration.mark({ class: "cornell-hide-raw" })
                });
            }
        }

        decorationsData.sort((a, b) => {
            if (a.from !== b.from) return a.from - b.from;
            return a.type - b.type; 
        });

        decorationsData.forEach(d => builder.add(d.from, d.to, d.dec));
        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});

export const CORNELL_VIEW_TYPE = "cornell-marginalia-view";

// --- MODAL DE ADVERTENCIA NATIVO (Anti-Congelamientos) ---
class ConfirmStitchModal extends Modal {
    message: string;
    onConfirm: () => void;

    constructor(app: App, message: string, onConfirm: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: "⚠️ Multi-Stitch Warning" });
        
        const p = contentEl.createEl("p", { text: this.message });
        p.style.whiteSpace = "pre-wrap"; // Para que respete los saltos de línea

        const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });
        btnContainer.style.display = "flex";
        btnContainer.style.justifyContent = "flex-end";
        btnContainer.style.gap = "10px";
        btnContainer.style.marginTop = "20px";

        const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => {
            this.close();
            new Notice("Stitching cancelled.");
        };

        const confirmBtn = btnContainer.createEl("button", { text: "Proceed", cls: "mod-cta" });
        confirmBtn.style.backgroundColor = "var(--interactive-accent)";
        confirmBtn.style.color = "var(--text-on-accent)";
        confirmBtn.onclick = () => {
            this.onConfirm();
            this.close();
        };
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// --- VISTA LATERAL (EXPLORER) ESTÉTICA MINIMALISTA Y BLINDADA ●🧠 ---
class CornellNotesView extends ItemView {
    plugin: CornellMarginalia;
    currentTab: 'current' | 'vault' | 'threads' | 'pinboard' = 'current';
    
    isStitchingMode: boolean = false;
    sourceStitchItem: MarginaliaItem | null = null;

    searchQuery: string = '';
    activeColorFilters: Set<string> = new Set();
    cachedItems: MarginaliaItem[] = []; 

    draggedSidebarItems: MarginaliaItem[] | null = null; 
    isGroupedByContent: boolean = false; 

    pinboardItems: MarginaliaItem[] = [];

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
        const tabThreads = controlsDiv.createEl("button", { text: "⌇ Threads", cls: this.currentTab === 'threads' ? 'cornell-tab-active' : '' });
        const tabPinboard = controlsDiv.createEl("button", { text: "● Board", cls: this.currentTab === 'pinboard' ? 'cornell-tab-active' : '', title: "Your Pinboard" });
        
        const actionControlsDiv = container.createDiv({ cls: 'cornell-sidebar-controls' });
        const btnStitch = actionControlsDiv.createEl("button", { text: "⛓︎ Stitch", title: "Connect two notes" });
        
        const btnGroup = actionControlsDiv.createEl("button", { 
            text: "🗁 Group", 
            title: "Group identical notes", 
            cls: this.isGroupedByContent ? 'cornell-tab-active' : '' 
        });
        
        const btnRefresh = actionControlsDiv.createEl("button", { text: "⟳", title: "Refresh data" });

        const filterContainer = container.createDiv({ cls: 'cornell-sidebar-filters' });
        
        const searchInput = filterContainer.createEl('input', { type: 'text', placeholder: 'Search notes...', cls: 'cornell-search-bar' });
        searchInput.value = this.searchQuery;
        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            this.applyFiltersAndRender(); 
        };

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

        container.createDiv({ cls: 'cornell-stitch-banner', text: '' }).style.display = 'none';
        container.createDiv({ cls: 'cornell-sidebar-content' });

        tabCurrent.onclick = async () => { this.currentTab = 'current'; this.renderUI(); await this.scanNotes(); };
        tabVault.onclick = async () => { this.currentTab = 'vault'; this.renderUI(); await this.scanNotes(); };
        tabThreads.onclick = async () => { this.currentTab = 'threads'; this.renderUI(); await this.scanNotes(); };
        tabPinboard.onclick = async () => { this.currentTab = 'pinboard'; this.renderUI(); this.applyFiltersAndRender(); };
        
        btnRefresh.onclick = async () => { new Notice("Scanning..."); await this.scanNotes(); };

        btnStitch.onclick = () => {
            this.isStitchingMode = !this.isStitchingMode;
            this.sourceStitchItem = null; 
            btnStitch.classList.toggle('cornell-tab-active', this.isStitchingMode);
            this.updateStitchBanner();
        };

        btnGroup.onclick = () => {
            this.isGroupedByContent = !this.isGroupedByContent;
            btnGroup.classList.toggle('cornell-tab-active', this.isGroupedByContent);
            this.applyFiltersAndRender();
        };
    }

    updateStitchBanner() {
        const banner = this.containerEl.querySelector('.cornell-stitch-banner') as HTMLElement;
        if (!this.isStitchingMode) { banner.style.display = 'none'; return; }
        banner.style.display = 'block';
        if (!this.sourceStitchItem) {
            banner.innerText = "⛓︎ Step 1: Click the ORIGIN note...";
            banner.style.backgroundColor = "var(--interactive-accent)";
        } else {
            banner.innerText = "⛓︎ Step 2: Click the DESTINATION note...";
            banner.style.backgroundColor = "var(--color-green)";
        }
    }

    async scanNotes() {
        if (this.currentTab === 'pinboard') {
            this.applyFiltersAndRender();
            return;
        }

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
                const lineRegex = /%%[><](.*?)%%/g;
                let match;

                while ((match = lineRegex.exec(line)) !== null) {
                    let noteContent = match[1].trim();
                    if (noteContent.endsWith(';;')) noteContent = noteContent.slice(0, -2).trim();

                    // 🧠 TEXTO CRUDO: Necesario para que el Stitching no corrompa los enlaces
                    const rawTextForStitching = noteContent;

                    // 🛡️ PURGAR IMÁGENES
                    const imgRegex = /img:\s*\[\[(.*?)\]\]/gi;
                    const hasImage = imgRegex.test(noteContent);
                    let cleanText = noteContent.replace(imgRegex, '').trim();

                    // 🛡️ CAZADOR DE ENLACES (Sin loops infinitos)
                    const linkRegex = /(?<!!)\[\[(.*?)\]\]/g;
                    const outgoingLinks: string[] = [];
                    const linkMatches = Array.from(cleanText.matchAll(linkRegex));
                    linkMatches.forEach(m => outgoingLinks.push(m[1]));
                    cleanText = cleanText.replace(linkRegex, '').trim();

                    let matchedColor = defaultColor;
                    for (const tag of this.plugin.settings.tags) {
                        if (cleanText.startsWith(tag.prefix)) {
                            matchedColor = tag.color;
                            cleanText = cleanText.substring(tag.prefix.length).trim();
                            break;
                        }
                    }

                    if (cleanText.length === 0) {
                        if (hasImage) {
                            cleanText = "🖼️ [Image]";
                        } else {
                            continue;
                        }
                    }

                    const blockIdMatch = line.match(/\^([a-zA-Z0-9]+)\s*$/);
                    const existingBlockId = blockIdMatch ? blockIdMatch[1] : null;

                    allItemsFlat.push({
                        text: cleanText,
                        rawText: rawTextForStitching,
                        color: matchedColor,
                        file: file,
                        line: i,
                        blockId: existingBlockId,
                        outgoingLinks: outgoingLinks
                    });
                }
            }
        }
        this.cachedItems = allItemsFlat;
        this.applyFiltersAndRender();
    }

    applyFiltersAndRender() {
        const contentDiv = this.containerEl.querySelector('.cornell-sidebar-content') as HTMLElement;
        if (!contentDiv) return;

        if (this.currentTab === 'pinboard') {
            this.renderPinboardTab(contentDiv);
            return;
        }

        const isFilterActive = this.searchQuery.length > 0 || this.activeColorFilters.size > 0;

        const matchesFilter = (item: MarginaliaItem) => {
            const matchesSearch = item.text.toLowerCase().includes(this.searchQuery) || item.file.basename.toLowerCase().includes(this.searchQuery);
            const matchesColor = this.activeColorFilters.size === 0 || this.activeColorFilters.has(item.color);
            return matchesSearch && matchesColor;
        };

        if (this.currentTab === 'threads') {
            if (!isFilterActive) {
                const allTargetIds = new Set<string>();
                this.cachedItems.forEach(item => {
                    item.outgoingLinks.forEach(l => {
                        const parts = l.split('#^');
                        if (parts.length === 2) allTargetIds.add(parts[1]);
                    });
                });
                const rootItems = this.cachedItems.filter(item => item.outgoingLinks.length > 0 && (!item.blockId || !allTargetIds.has(item.blockId)));
                this.renderThreads(rootItems, contentDiv, false);
            } else {
                const matchingItems = this.cachedItems.filter(matchesFilter);
                const topLevelMatches = matchingItems.filter(item => {
                    const isChildOfAnotherMatch = matchingItems.some(parent => item.blockId && parent.outgoingLinks.some(link => link.includes(`#^${item.blockId}`)));
                    return !isChildOfAnotherMatch;
                });
                this.renderThreads(topLevelMatches, contentDiv, true);
            }
        } else {
            const filtered = this.cachedItems.filter(matchesFilter);
            
            if (this.isGroupedByContent) {
                const groupedResults: Record<string, MarginaliaItem[]> = {};
                filtered.forEach(item => {
                    const normalizedText = item.text.trim().toLowerCase();
                    if (!groupedResults[normalizedText]) groupedResults[normalizedText] = [];
                    groupedResults[normalizedText].push(item);
                });
                this.renderGroupedByContent(groupedResults, contentDiv);
            } else {
                const results: Record<string, MarginaliaItem[]> = {};
                filtered.forEach(item => {
                    if (!results[item.color]) results[item.color] = [];
                    results[item.color].push(item);
                });
                this.renderResults(results, contentDiv);
            }
        }
    }

    renderPinboardTab(container: HTMLElement) {
        container.empty();

        // 1. SIEMPRE DIBUJAR LOS CONTROLES PRIMERO (Incluso si está vacío)
        const topControls = container.createDiv({ cls: 'cornell-pinboard-controls' });
        topControls.style.display = 'flex';
        topControls.style.flexDirection = 'column';
        topControls.style.gap = '10px';
        topControls.style.marginBottom = '20px';

        const exportRow = topControls.createDiv();
        exportRow.style.display = 'flex';
        exportRow.style.gap = '5px';

        const exportBtn = exportRow.createEl('button', { text: '📝 Note' });
        exportBtn.style.flex = '1';
        exportBtn.style.backgroundColor = 'var(--interactive-accent)';
        exportBtn.style.color = 'var(--text-on-accent)';
        exportBtn.style.fontWeight = 'bold';
        exportBtn.style.border = 'none';
        exportBtn.style.cursor = 'pointer';
        exportBtn.onclick = () => this.exportPinboard();

        const exportMindmapBtn = exportRow.createEl('button', { text: '📋 Clip' });
        exportMindmapBtn.style.flex = '1';
        exportMindmapBtn.style.backgroundColor = 'var(--color-green)';
        exportMindmapBtn.style.color = '#fff';
        exportMindmapBtn.style.fontWeight = 'bold';
        exportMindmapBtn.style.border = 'none';
        exportMindmapBtn.style.cursor = 'pointer';
        exportMindmapBtn.onclick = () => this.exportMindmap();

        // 🎨 NUEVO: BOTÓN DE EXPORTAR A CANVAS
        const exportCanvasBtn = exportRow.createEl('button', { text: '🎨 Canvas' });
        exportCanvasBtn.style.flex = '1';
        exportCanvasBtn.style.backgroundColor = 'var(--color-purple)'; 
        exportCanvasBtn.style.color = '#fff';
        exportCanvasBtn.style.fontWeight = 'bold';
        exportCanvasBtn.style.border = 'none';
        exportCanvasBtn.style.cursor = 'pointer';
        exportCanvasBtn.onclick = () => this.exportCanvas();

        const titleRow = topControls.createDiv();
        titleRow.style.display = 'flex';
        titleRow.style.gap = '5px';

        const titleInput = titleRow.createEl('input', { type: 'text', placeholder: 'Add title (Ej: ## My amazing title)' });
        titleInput.style.flexGrow = '1';
        titleInput.style.backgroundColor = 'var(--background-modifier-form-field)';
        titleInput.style.border = '1px solid var(--background-modifier-border)';

        const addTitleBtn = titleRow.createEl('button', { text: '➕' });
        addTitleBtn.onclick = () => {
            const val = titleInput.value.trim();
            if (val) {
                this.pinboardItems.push({ 
                    text: val, rawText: val, color: 'transparent', 
                    file: null as any, line: -1, blockId: null, outgoingLinks: [], isTitle: true 
                });
                this.applyFiltersAndRender(); 
            }
        };

        // 2.  NO DIBUJAR LISTA FANTASMA
        if (this.pinboardItems.length === 0) {
            container.createEl('p', { text: 'Your Board is empty. Start by adding a title or pinning notes!', cls: 'cornell-sidebar-empty' });
            return;
        }

        // 3. MOTOR DE RENDERIZADO Y REORDENAMIENTO
        let draggedIndex: number | null = null;
        const listContainer = container.createDiv();

        this.pinboardItems.forEach((item, index) => {
            let itemWrapper = listContainer.createDiv();
            itemWrapper.setAttr('draggable', 'true');
            itemWrapper.style.cursor = 'grab';
            itemWrapper.style.marginBottom = '5px';
            
            const indent = item.indentLevel || 0;
            itemWrapper.style.marginLeft = `${indent * 20}px`;
            itemWrapper.style.transition = 'margin-left 0.2s ease';

            if (item.isTitle) {
                itemWrapper.style.padding = '10px 5px';
                itemWrapper.style.marginTop = '15px';
                itemWrapper.style.borderBottom = '2px solid var(--interactive-accent)';
                itemWrapper.style.color = 'var(--text-accent)';
                itemWrapper.style.fontWeight = 'bold';
                itemWrapper.style.display = 'flex';
                itemWrapper.style.justifyContent = 'space-between';

                const match = item.text.match(/^(#+)\s(.*)/);
                itemWrapper.style.fontSize = match ? (match[1].length === 1 ? '1.4em' : '1.25em') : '1.1em';
                itemWrapper.createSpan({ text: match ? match[2] : item.text });
                
                const delBtn = itemWrapper.createSpan({ text: '×', title: 'Borrar título' });
                delBtn.style.cursor = 'pointer';
                delBtn.onclick = () => { this.pinboardItems.splice(index, 1); this.applyFiltersAndRender(); };
            } else {
                const marginaliaDOM = this.createItemDiv(item, itemWrapper, true, index);
                marginaliaDOM.setAttr('draggable', 'false'); 
            }

            // LÓGICA DE DRAG & DROP INTERNO BLINDADA
            itemWrapper.addEventListener('dragstart', (e) => { draggedIndex = index; itemWrapper.style.opacity = '0.4'; e.stopPropagation(); });
            itemWrapper.addEventListener('dragover', (e) => { e.preventDefault(); itemWrapper.style.borderTop = '3px solid var(--interactive-accent)'; });
            itemWrapper.addEventListener('dragleave', () => { itemWrapper.style.borderTop = ''; });
            itemWrapper.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation(); itemWrapper.style.borderTop = '';
                if (draggedIndex !== null && draggedIndex !== index) {
                    // Magia de reordenamiento matemático preciso
                    const itemToMove = this.pinboardItems[draggedIndex];
                    this.pinboardItems.splice(draggedIndex, 1);
                    // Como el array se encogió, si movimos de arriba hacia abajo, el índice de destino se redujo
                    const targetIndex = draggedIndex < index ? index - 1 : index;
                    this.pinboardItems.splice(targetIndex, 0, itemToMove);
                    this.applyFiltersAndRender();
                }
            });
            itemWrapper.addEventListener('dragend', () => { itemWrapper.style.opacity = '1'; draggedIndex = null; });
        });
    }

    async exportPinboard() {
        if (this.pinboardItems.length === 0) return;
        // @ts-ignore
        const dateStr = window.moment().format('YYYY-MM-DD_HH-mm-ss');
        const fileName = `Pinboard_${dateStr}.md`;
        // @ts-ignore
        let content = `# ● Pinboard Session\n*Exported on: ${window.moment().format('YYYY-MM-DD HH:mm')}*\n\n---\n\n`;

        for (const item of this.pinboardItems) {
            // 🧠 3. SI ES UN TÍTULO, SE IMPRIME DIRECTO Y SALTAMOS A LA SIGUIENTE NOTA
            if (item.isTitle) {
                const text = item.text.startsWith('#') ? item.text : `## ${item.text}`;
                content += `${text}\n\n`;
                continue; 
            }
            let targetId = item.blockId;
            if (!targetId) {
                targetId = Math.random().toString(36).substring(2, 8);
                item.blockId = targetId;
                await this.injectBackgroundBlockId(item.file, item.line, targetId);
            }

            const fileContent = await this.plugin.app.vault.cachedRead(item.file);
            const lines = fileContent.split('\n');
            let contextText = lines[item.line] || '';
            contextText = contextText.replace(/%%[><](.*?)%%/g, '').trim();
            
            if (contextText.length > 0 && !contextText.includes(`^${targetId}`)) {
                contextText += ` ^${targetId}`;
            }

            content += `Margin Note: ${item.text}\n\n`;
            if (contextText.length > 0) {
                content += `${contextText}\n\n`;
            }
            content += `From: [[${item.file.basename}#^${targetId}|${item.file.basename}]]\n\n---\n\n`;
        }

        try {
            const newFile = await this.plugin.app.vault.create(fileName, content);
            await this.plugin.app.workspace.getLeaf(true).openFile(newFile);
            new Notice('Pinboard compiled successfully!');
            this.pinboardItems = [];
            this.applyFiltersAndRender();
        } catch (error) {
            new Notice('Error creating Pinboard file. Check console.');
        }
    }
// 🌳 NUEVA FUNCIÓN: Exportador al Portapapeles para Mindmaps (Excalidraw)
    async exportMindmap() {
        if (this.pinboardItems.length === 0) {
            new Notice('Empty Board ');
            return;
        }

        let content = "";

        for (const item of this.pinboardItems) {
            if (item.isTitle) {
                // Títulos principales
                const text = item.text.startsWith('#') ? item.text : `# ${item.text}`;
                content += `${text}\n`;
            } else {
                // Creamos los espacios de sangría según el nivel
                const indentSpaces = "\t".repeat(item.indentLevel || 0); // Excalidraw prefiere tabulaciones, pero puedes usar "  " si falla
                
                let targetId = item.blockId;
                if (!targetId) {
                    targetId = Math.random().toString(36).substring(2, 8);
                    item.blockId = targetId;
                    await this.injectBackgroundBlockId(item.file, item.line, targetId);
                }

                // Imprimimos la viñeta con el enlace a la nota original
                content += `${indentSpaces}- [[${item.file.basename}#^${targetId}|${item.text}]]\n`;
            }
        }

        try {
            // 🧠 LA MAGIA: Inyectar directamente en el portapapeles del sistema operativo
            await navigator.clipboard.writeText(content);
            new Notice('📋 Mindmap copied to clipboard! Go to Excalidraw and press Alt+V');
        } catch (error) {
            new Notice('Error al copiar al portapapeles. Revisa la consola.');
            console.error(error);
        }
    }
    // 🎨 NUEVO MOTOR: Generador Automático de Canvas (Tablero de Evidencia)
    async exportCanvas() {
        if (this.pinboardItems.length === 0) return;

        // @ts-ignore
        const dateStr = window.moment().format('YYYY-MM-DD_HH-mm-ss');
        const fileName = `EvidenceBoard_${dateStr}.canvas`;

        const nodes: any[] = [];
        const edges: any[] = [];
        
        // Generador de IDs hexadecimales de 16 caracteres (requerido por Canvas)
        const genId = () => [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');

        let currentY = 0; // Controla la altura vertical
        let lastTitleId: string | null = null;
        let parentAtLevel: Record<number, string> = {};

        for (const item of this.pinboardItems) {
            const nodeId = genId();

            if (item.isTitle) {
                // 🏷️ NODO TÍTULO (Grande, a la izquierda)
                const titleText = item.text.startsWith('#') ? item.text : `# ${item.text}`;
                nodes.push({ id: nodeId, type: "text", text: titleText, x: 0, y: currentY, width: 350, height: 100, color: "1" }); // Color 1 = Rojo/Naranja
                
                lastTitleId = nodeId;
                parentAtLevel = {}; // Reiniciamos el árbol de herencia
                parentAtLevel[-1] = nodeId; 
                currentY += 150; // Bajamos el cursor
            } else {
                const indent = item.indentLevel || 0;
                const baseX = (indent + 1) * 450; // Calculamos la posición X (Sangría)

                let targetId = item.blockId;
                if (!targetId) {
                    targetId = Math.random().toString(36).substring(2, 8);
                    item.blockId = targetId;
                    await this.injectBackgroundBlockId(item.file, item.line, targetId);
                }

                // 📌 1. NODO MARGINALIA
                const noteText = `**Marginalia:**\n${item.text}\n\n[[${item.file.basename}#^${targetId}|🔗 Origin]]`;
                nodes.push({ id: nodeId, type: "text", text: noteText, x: baseX, y: currentY, width: 300, height: 140, color: "4" }); // Color 4 = Verde

                // 🧵 2. CONECTAR CON SU PADRE (Título o Marginalia anterior)
                const parentId = parentAtLevel[indent - 1] || lastTitleId;
                if (parentId) {
                    edges.push({ id: genId(), fromNode: parentId, fromSide: "right", toNode: nodeId, toSide: "left" });
                }
                parentAtLevel[indent] = nodeId;

                // 📚 3. EXTRAER EL TEXTO DEL HOVER (El Párrafo Real)
                const fileContent = await this.plugin.app.vault.cachedRead(item.file);
                const lines = fileContent.split('\n');
                
                // Leemos la línea exacta, la anterior y la posterior (Como hace tu Rayos X visual)
                const startLine = Math.max(0, item.line - 1);
                const endLine = Math.min(lines.length - 1, item.line + 1);
                
                let contextText = '';
                for (let i = startLine; i <= endLine; i++) {
                    let cleanLine = lines[i].replace(/%%[><](.*?)%%/g, '').trim();
                    if (cleanLine) contextText += cleanLine + '\n';
                }
                contextText = contextText.trim();

                // 📄 4. NODO CONTEXTO (Despliega la rama a la derecha)
                if (contextText) {
                    const contextNodeId = genId();
                    // Lo dibujamos 400px a la derecha de la marginalia
                    nodes.push({ id: contextNodeId, type: "text", text: `> ${contextText}`, x: baseX + 400, y: currentY - 20, width: 450, height: 180 });
                    // Trazamos la flecha
                    edges.push({ id: genId(), fromNode: nodeId, fromSide: "right", toNode: contextNodeId, toSide: "left" });
                }

                currentY += 220; // Bajamos el cursor verticalmente para la siguiente carta
            }
        }

        // Ensamblamos el JSON del Canvas
        const canvasData = JSON.stringify({ nodes, edges }, null, 2);

        try {
            const newFile = await this.plugin.app.vault.create(fileName, canvasData);
            await this.plugin.app.workspace.getLeaf(true).openFile(newFile);
            new Notice('🎨 Evidence Board created successfully!');
            // Opcional: Vaciar corcho -> this.pinboardItems = []; this.applyFiltersAndRender();
        } catch (error) {
            new Notice('Error creating Canvas file. Check console.');
            console.error(error);
        }
    }


    renderGroupedByContent(groupedResults: Record<string, MarginaliaItem[]>, container: HTMLElement) {
        container.empty();
        let totalFound = 0;

        for (const [normalizedText, items] of Object.entries(groupedResults)) {
            if (items.length === 0) continue;
            totalFound += items.length;

            if (items.length === 1) {
                this.createItemDiv(items[0], container);
                continue;
            }

            const groupParent = container.createDiv({ cls: 'cornell-thread-parent' });
            groupParent.style.position = 'relative';
            const representativeItem = items[0]; 

            const headerDiv = groupParent.createDiv({ cls: 'cornell-sidebar-item' });
            headerDiv.style.borderLeftColor = representativeItem.color;

            const textRow = headerDiv.createDiv({ cls: 'cornell-sidebar-item-text' });
            textRow.style.display = 'flex';
            textRow.style.justifyContent = 'space-between';
            textRow.style.alignItems = 'flex-start';

            const textSpan = textRow.createSpan({ text: representativeItem.text });
            textSpan.style.flexGrow = '1';

            const allPinned = items.every(item => this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path));
            
            const groupPinBtn = textRow.createEl('span', { 
                text: allPinned ? '●' : '○', 
                title: allPinned ? 'Unpin Group' : 'Pin Group to Board' 
            });
            groupPinBtn.style.cursor = 'pointer';
            groupPinBtn.style.marginLeft = '10px';
            groupPinBtn.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            groupPinBtn.style.opacity = allPinned ? '1' : '0';

            headerDiv.addEventListener('mouseenter', () => {
                const currentlyAllPinned = items.every(item => this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path));
                if (!currentlyAllPinned) groupPinBtn.style.opacity = '0.5';
            });

            headerDiv.addEventListener('mouseleave', () => {
                const currentlyAllPinned = items.every(item => this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path));
                if (!currentlyAllPinned) groupPinBtn.style.opacity = '0';
            });

            groupPinBtn.onmouseenter = () => { groupPinBtn.style.opacity = '1'; groupPinBtn.style.transform = 'scale(1.2)'; };
            groupPinBtn.onmouseleave = () => { 
                groupPinBtn.style.transform = 'scale(1)'; 
                const currentlyAllPinned = items.every(item => this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path));
                if (!currentlyAllPinned) groupPinBtn.style.opacity = '0.5';
            };

            groupPinBtn.onclick = (e) => {
                e.stopPropagation(); 
                const currentlyAllPinned = items.every(item => this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path));
                if (currentlyAllPinned) {
                    this.pinboardItems = this.pinboardItems.filter(p => !items.some(i => i.rawText === p.rawText && i.file.path === p.file.path));
                    groupPinBtn.innerText = '○';
                    groupPinBtn.style.opacity = '0.5'; 
                } else {
                    items.forEach(item => {
                        const alreadyPinned = this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path);
                        if (!alreadyPinned) this.pinboardItems.push(item);
                    });
                    groupPinBtn.innerText = '●';
                    groupPinBtn.style.opacity = '1';
                }
            };

            headerDiv.createDiv({ cls: 'cornell-sidebar-item-meta', text: `🗁 ${items.length} occurrences` });

            headerDiv.setAttr('draggable', 'true');
            headerDiv.addEventListener('dragstart', (event: DragEvent) => {
                if (!event.dataTransfer) return;
                event.dataTransfer.effectAllowed = 'copy'; 
                let targetId = representativeItem.blockId;
                if (!targetId) {
                    targetId = Math.random().toString(36).substring(2, 8);
                    representativeItem.blockId = targetId; 
                    this.injectBackgroundBlockId(representativeItem.file, representativeItem.line, targetId);
                }
                const dragPayload = `[[${representativeItem.file.basename}#^${targetId}|Group: ${representativeItem.text}]]`;
                event.dataTransfer.setData('text/plain', dragPayload);
                this.draggedSidebarItems = items; 
            });

            headerDiv.addEventListener('dragend', () => {
                this.draggedSidebarItems = null; 
                headerDiv.removeClass('cornell-drop-target');
            });

            headerDiv.addEventListener('dragenter', (e: DragEvent) => {
                e.preventDefault(); 
                const isSelf = this.draggedSidebarItems && this.draggedSidebarItems.some(i => items.includes(i));
                if (this.draggedSidebarItems && !isSelf) headerDiv.addClass('cornell-drop-target');
            });

            headerDiv.addEventListener('dragover', (e: DragEvent) => {
                e.preventDefault(); 
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; 
            });

            headerDiv.addEventListener('dragleave', () => { headerDiv.removeClass('cornell-drop-target'); });

            headerDiv.addEventListener('drop', async (e: DragEvent) => {
                e.preventDefault(); e.stopPropagation(); 
                headerDiv.removeClass('cornell-drop-target');
                const isSelf = this.draggedSidebarItems && this.draggedSidebarItems.some(i => items.includes(i));
                if (this.draggedSidebarItems && !isSelf) {
                    await this.executeMassStitch(items, this.draggedSidebarItems);
                    this.draggedSidebarItems = null;
                }
            });

            const childrenContainer = groupParent.createDiv({ cls: 'cornell-thread-tree is-collapsed' });
            const toggleBtn = headerDiv.createDiv({ cls: 'cornell-collapse-toggle is-collapsed' });
            toggleBtn.innerHTML = '▼';
            headerDiv.prepend(toggleBtn);

            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                if (childrenContainer.hasClass('is-collapsed')) {
                    childrenContainer.removeClass('is-collapsed');
                    toggleBtn.removeClass('is-collapsed');
                } else {
                    childrenContainer.addClass('is-collapsed');
                    toggleBtn.addClass('is-collapsed');
                }
            };

            items.forEach(item => {
                const childDiv = this.createItemDiv(item, childrenContainer);
                const textNode = childDiv.querySelector('.cornell-sidebar-item-text > span:first-child') as HTMLElement;
                if (textNode) textNode.style.display = 'none'; 
                
                const metaNode = childDiv.querySelector('.cornell-sidebar-item-meta') as HTMLElement;
                if (metaNode) {
                    metaNode.style.fontSize = '0.9em';
                    metaNode.style.textAlign = 'left';
                    metaNode.style.color = 'var(--text-normal)';
                }
            });
        }

        if (totalFound === 0) container.createEl('p', { text: 'No notes match your search.', cls: 'cornell-sidebar-empty' });
    }

    renderThreads(rootItems: MarginaliaItem[], container: HTMLElement, isFilteredMode: boolean = false) {
        container.empty();
        if (rootItems.length === 0) {
            container.createEl('p', { text: 'No matching threads found.', cls: 'cornell-sidebar-empty' });
            return;
        }
        for (const root of rootItems) {
            const threadGroup = container.createDiv({ cls: 'cornell-thread-parent' });
            this.renderThreadNode(root, threadGroup, this.cachedItems, new Set<string>(), isFilteredMode, true);
        }
    }

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

        if (isFilteredMode && isRootCall && item.blockId) {
            const parentNode = allItems.find(p => p.outgoingLinks.some(link => link.includes(`#^${item.blockId}`)));
            if (parentNode) {
                const upBtn = nodeWrapper.createDiv({ cls: 'cornell-thread-up-btn', title: 'Go to parent note' });
                upBtn.innerHTML = `↑ Child of: <b>${parentNode.file.basename}</b>`;
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
                if (childrenContainer.hasClass('is-collapsed')) {
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

    createItemDiv(item: MarginaliaItem, parentContainer: HTMLElement, isPinboardView: boolean = false, pinIndex: number = -1): HTMLElement {
        const itemDiv = parentContainer.createDiv({ cls: 'cornell-sidebar-item' });
        itemDiv.style.borderLeftColor = item.color;

        const textRow = itemDiv.createDiv({ cls: 'cornell-sidebar-item-text' });
        textRow.style.display = 'flex';
        textRow.style.justifyContent = 'space-between';
        textRow.style.alignItems = 'flex-start';

        const textSpan = textRow.createSpan({ text: item.text });
        // 🧠 NUEVO: Controles de Jerarquía solo visibles en el Pinboard
        if (isPinboardView) {
            const indentControls = textRow.createSpan();
            indentControls.style.marginLeft = '10px';
            indentControls.style.marginRight = 'auto'; // Empuja los pines a la derecha
            indentControls.style.opacity = '0.5';

            const btnLeft = indentControls.createEl('span', { text: '←', title: 'Outdent' });
            btnLeft.style.cursor = 'pointer';
            btnLeft.style.marginRight = '8px';
            btnLeft.onclick = (e) => { 
                e.stopPropagation(); 
                item.indentLevel = Math.max(0, (item.indentLevel || 0) - 1); 
                this.applyFiltersAndRender(); 
            };

            const btnRight = indentControls.createEl('span', { text: '→', title: 'Indent' });
            btnRight.style.cursor = 'pointer';
            btnRight.onclick = (e) => { 
                e.stopPropagation(); 
                item.indentLevel = (item.indentLevel || 0) + 1; 
                this.applyFiltersAndRender(); 
            };
        }
        textSpan.style.flexGrow = '1';

        const isAlreadyPinned = this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path);
        let iconText = isPinboardView ? '×' : (isAlreadyPinned ? '●' : '○');
        
        const pinBtn = textRow.createEl('span', { text: iconText });
        pinBtn.style.cursor = 'pointer';
        pinBtn.style.marginLeft = '10px';
        pinBtn.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        pinBtn.style.opacity = (isPinboardView || isAlreadyPinned) ? '1' : '0';

        itemDiv.addEventListener('mouseenter', () => {
            const currentPinned = this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path);
            if (!isPinboardView && !currentPinned) pinBtn.style.opacity = '0.5';
        });

        itemDiv.addEventListener('mouseleave', () => {
            const currentPinned = this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path);
            if (!isPinboardView && !currentPinned) pinBtn.style.opacity = '0';
        });

        pinBtn.onmouseenter = () => { pinBtn.style.opacity = '1'; pinBtn.style.transform = 'scale(1.2)'; };
        pinBtn.onmouseleave = () => { 
            pinBtn.style.transform = 'scale(1)'; 
            const currentPinned = this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path);
            if (!isPinboardView && !currentPinned) pinBtn.style.opacity = '0.5';
        };

        pinBtn.onclick = (e) => {
            e.stopPropagation(); 
            if (isPinboardView) {
                this.pinboardItems.splice(pinIndex, 1);
                this.applyFiltersAndRender();
            } else {
                const currentPinned = this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path);
                if (currentPinned) {
                    this.pinboardItems = this.pinboardItems.filter(p => !(p.rawText === item.rawText && p.file.path === item.file.path));
                    pinBtn.innerText = '○';
                    pinBtn.style.opacity = '0.5'; 
                } else {
                    this.pinboardItems.push(item);
                    pinBtn.innerText = '●';
                    pinBtn.style.opacity = '1';
                }
            }
        };

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
                    await this.executeMassStitch([this.sourceStitchItem], [item]);
                    this.isStitchingMode = false;
                    this.sourceStitchItem = null;
                    this.updateStitchBanner();
                }
                return;
            }
            const leaf = this.plugin.app.workspace.getLeaf(false);
            await leaf.openFile(item.file, { eState: { line: item.line } });
        };

        // 🛡️ MOTOR DE VISIÓN DE RAYOS X (Blindado Anti-Zombis)
        let hoverTimeout: NodeJS.Timeout | null = null;
        let tooltipEl: HTMLElement | null = null;
        let isHovering = false; 

        const removeTooltip = () => {
            isHovering = false; 
            if (hoverTimeout) clearTimeout(hoverTimeout);
            if (tooltipEl) {
                tooltipEl.remove();
                tooltipEl = null;
            }
            document.querySelectorAll('.cornell-hover-tooltip').forEach(el => el.remove());
        };

        itemDiv.addEventListener('mouseenter', (e: MouseEvent) => {
            isHovering = true;
            hoverTimeout = setTimeout(async () => {
                if (!isHovering) return; 
                const content = await this.plugin.app.vault.cachedRead(item.file);
                if (!isHovering) return; 
                if (!document.body.contains(itemDiv)) return;

                const lines = content.split('\n');
                const startLine = Math.max(0, item.line - 1);
                const endLine = Math.min(lines.length - 1, item.line + 1);
                
                let contextText = '';
                for (let i = startLine; i <= endLine; i++) {
                    let cleanLine = lines[i].replace(/%%[><](.*?)%%/g, '').trim();
                    if (cleanLine) {
                        if (i === item.line) {
                            contextText += `<div class="cornell-hover-highlight">${cleanLine}</div>`;
                        } else {
                            contextText += `<div class="cornell-hover-text-line">${cleanLine}</div>`;
                        }
                    }
                }

                if (!contextText) contextText = "<div class='cornell-hover-text-line'><i>No text context available.</i></div>";

                document.querySelectorAll('.cornell-hover-tooltip').forEach(el => el.remove());

                tooltipEl = document.createElement('div');
                tooltipEl.className = 'cornell-hover-tooltip';
                
                const header = tooltipEl.createDiv({ cls: 'cornell-hover-context' });
                header.innerHTML = `<span>📄 <b>${item.file.basename}</b></span> <span>L${item.line + 1}</span>`;
                
                const body = tooltipEl.createDiv();
                body.innerHTML = contextText;

                document.body.appendChild(tooltipEl);

                const rect = itemDiv.getBoundingClientRect();
                let leftPos = rect.left - 340; 
                if (leftPos < 10) leftPos = rect.right + 20; 
                
                tooltipEl.style.left = `${leftPos}px`;
                tooltipEl.style.top = `${Math.min(rect.top, window.innerHeight - 150)}px`;
                
                requestAnimationFrame(() => {
                    if (tooltipEl) tooltipEl.addClass('is-visible');
                });
            }, 600); 
        });

        itemDiv.addEventListener('mouseleave', removeTooltip);
        
        if (!isPinboardView) {
        itemDiv.setAttr('draggable', 'true');
        itemDiv.addEventListener('dragstart', (event: DragEvent) => {
            removeTooltip(); 
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
            this.draggedSidebarItems = [item]; 
        });

        itemDiv.addEventListener('dragend', () => {
            this.draggedSidebarItems = null; 
            itemDiv.removeClass('cornell-drop-target');
        });

        itemDiv.addEventListener('dragenter', (e: DragEvent) => {
            e.preventDefault(); 
            if (this.draggedSidebarItems && !this.draggedSidebarItems.includes(item)) {
                itemDiv.addClass('cornell-drop-target');
            }
        });

        itemDiv.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault(); 
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; 
        });

        itemDiv.addEventListener('dragleave', () => {
            itemDiv.removeClass('cornell-drop-target'); 
        });

        itemDiv.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation(); 
            itemDiv.removeClass('cornell-drop-target');

            if (this.draggedSidebarItems && !this.draggedSidebarItems.includes(item)) {
                await this.executeMassStitch([item], this.draggedSidebarItems);
                this.draggedSidebarItems = null;
            }
        });
    }
        return itemDiv;
    }

async executeMassStitch(sources: MarginaliaItem[], targets: MarginaliaItem[]) {
        const totalLinks = sources.length * targets.length;
        
        // 🧠 Encapsulamos la lógica de costura pura
        const processStitching = async () => {
            new Notice(`Stitching ${totalLinks} thread(s)... ⛓︎`);

            for (const target of targets) {
                if (!target.blockId) {
                    target.blockId = Math.random().toString(36).substring(2, 8);
                    await this.injectBackgroundBlockId(target.file, target.line, target.blockId);
                }
            }

            for (const source of sources) {
                let linksToInject = "";
                for (const target of targets) {
                    if (source === target) continue; 
                    linksToInject += ` [[${target.file.basename}#^${target.blockId}]]`;
                }
                if (linksToInject.length > 0) {
                    await this.plugin.app.vault.process(source.file, (data) => {
                        const lines = data.split('\n');
                        if (source.line >= 0 && source.line < lines.length) {
                            lines[source.line] = lines[source.line].replace(source.rawText, source.rawText + linksToInject);
                        }
                        return lines.join('\n');
                    });
                }
            }

            new Notice("¡Hilos conectados con éxito! ✨");
            await this.scanNotes(); 
        };

        // 🛡️ Si es masivo, abrimos el modal nativo; si es 1 a 1, lo hace directo.
        if (totalLinks > 1) {
            new ConfirmStitchModal(
                this.plugin.app, 
                `You are about to create ${totalLinks} connections.\nThis will modify ${sources.length} note(s).\n\nAre you sure you want to proceed?`,
                processStitching
            ).open();
        } else {
            await processStitching();
        }
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
        this.registerView(CORNELL_VIEW_TYPE, (leaf) => new CornellNotesView(leaf, this));

        this.addCommand({
            id: 'open-cornell-explorer',
            name: 'Open Marginalia Explorer',
            callback: () => { this.activateView(); }
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
            editorCallback: (editor: Editor, view: MarkdownView) => { this.generateFlashcards(editor); }
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
            editorCallback: (editor: Editor) => { this.prepareForPrint(editor); }
        });

        this.addCommand({
            id: 'restore-pdf-print',
            name: 'Restore Marginalia after PDF Print',
            editorCallback: (editor: Editor) => { this.restoreFromPrint(editor); }
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

                const regex = /%%([><])(.*?)%%/g;
                let match;
                
                while ((match = regex.exec(line)) !== null) {
                    const direction = match[1];
                    let noteContent = match[2].trim();
                    const isFlashcard = noteContent.endsWith(";;");
                    
                    if (isFlashcard) {
                        noteContent = noteContent.slice(0, -2).trim();
                    }

                    let matchedColor = null;
                    let finalNoteText = noteContent;

                    for (const tag of this.settings.tags) {
                        if (finalNoteText.startsWith(tag.prefix)) {
                            matchedColor = tag.color;
                            finalNoteText = finalNoteText.substring(tag.prefix.length).trim();
                            break;
                        }
                    }

                    let finalRenderText = finalNoteText;
                    const imagesToRender: string[] = [];
                    
                    // 🛡️ VACUNA REGEX LECTURA
                    const imgRegex = /img:\s*\[\[(.*?)\]\]/gi;
                    const imgMatches = Array.from(finalRenderText.matchAll(imgRegex));
                    imgMatches.forEach(m => imagesToRender.push(m[1]));
                    finalRenderText = finalRenderText.replace(imgRegex, '').trim();

                    const threadLinks: string[] = [];
                    const linkRegex = /(?<!!)\[\[(.*?)\]\]/g;
                    const linkMatches = Array.from(finalRenderText.matchAll(linkRegex));
                    linkMatches.forEach(m => threadLinks.push(m[1]));
                    finalRenderText = finalRenderText.replace(linkRegex, '').trim();

                    const marginDiv = document.createElement("div");
                    marginDiv.className = "cm-cornell-margin reading-mode-margin"; 
                    
                    if (matchedColor) {
                        marginDiv.style.setProperty('border-color', matchedColor, 'important');
                        marginDiv.style.setProperty('color', matchedColor, 'important');
                    }

                    MarkdownRenderer.render(this.app, finalRenderText, marginDiv, ctx.sourcePath, this);

                    if (imagesToRender.length > 0) {
                        imagesToRender.forEach(imgName => {
                            const cleanName = imgName.split('|')[0];
                            const file = this.app.metadataCache.getFirstLinkpathDest(cleanName, ctx.sourcePath);
                            if (file) {
                                const imgSrc = this.app.vault.getResourcePath(file);
                                marginDiv.createEl('img', { attr: { src: imgSrc } });
                            }
                        });
                    }

                    if (threadLinks.length > 0) {
                        const threadContainer = marginDiv.createDiv({ cls: 'cornell-thread-container' });
                        threadLinks.forEach(linkTarget => {
                            const btn = threadContainer.createEl('button', { cls: 'cornell-thread-btn', title: `Follow thread: ${linkTarget}` });
                            btn.innerHTML = '🔗'; 
                            btn.onclick = (e) => {
                                e.preventDefault(); e.stopPropagation(); 
                                this.app.workspace.openLinkText(linkTarget, ctx.sourcePath, true); 
                            };
                            btn.onmouseover = (event) => {
                                this.app.workspace.trigger('hover-link', {
                                    event: event, source: 'cornell-marginalia', hoverParent: threadContainer,
                                    targetEl: btn, linktext: linkTarget, sourcePath: ctx.sourcePath
                                });
                            };
                        });
                    }

                    currentTarget.classList.add('cornell-reading-container');
                    
                    const isMainLeft = this.settings.alignment === 'left';
                    const isNoteLeft = (isMainLeft && direction === '>') || (!isMainLeft && direction === '<');

                    marginDiv.style.setProperty('position', 'relative', 'important');
                    marginDiv.style.setProperty('width', '100%', 'important');
                    marginDiv.style.setProperty('left', 'auto', 'important');
                    marginDiv.style.setProperty('right', 'auto', 'important');
                    marginDiv.style.setProperty('margin-top', '0', 'important');
                    marginDiv.style.setProperty('margin-bottom', '12px', 'important');

                    let colClass = isNoteLeft ? 'cornell-col-left' : 'cornell-col-right';
                    let column = Array.from(currentTarget.children).find(c => c.classList.contains(colClass)) as HTMLElement;
                    
                    if (!column) {
                        column = document.createElement('div');
                        column.className = colClass;
                        column.style.setProperty('position', 'absolute', 'important');
                        column.style.setProperty('top', '0', 'important');
                        column.style.setProperty('width', 'var(--cornell-width)', 'important');
                        
                        if (isNoteLeft) {
                            column.style.setProperty('left', 'var(--cornell-margin-left)', 'important');
                        } else {
                            column.style.setProperty('right', 'calc(-1 * var(--cornell-width) - 20px)', 'important');
                        }
                        currentTarget.appendChild(column);
                    }

                    if ((isMainLeft && direction === '<') || (!isMainLeft && direction === '>')) {
                        marginDiv.classList.add('cornell-reverse-align');
                    }

                    column.appendChild(marginDiv);

                    if (isFlashcard) {
                        currentTarget.classList.add('cornell-flashcard-target');
                    }
                    
                    setTimeout(() => {
                        const colLeft = Array.from(currentTarget.children).find(c => c.classList.contains('cornell-col-left')) as HTMLElement;
                        const colRight = Array.from(currentTarget.children).find(c => c.classList.contains('cornell-col-right')) as HTMLElement;
                        
                        let maxH = 0;
                        if (colLeft) maxH = Math.max(maxH, colLeft.offsetHeight);
                        if (colRight) maxH = Math.max(maxH, colRight.offsetHeight);
                        
                        if (maxH > 0) {
                            currentTarget.style.minHeight = `${maxH + 10}px`; 
                        }
                    }, 100);
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
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: CORNELL_VIEW_TYPE, active: true });
            }
        }

        if (leaf) workspace.revealLeaf(leaf);
    }

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
            document.body.style.setProperty('--cornell-float', 'left');
            document.body.style.setProperty('--cornell-margin-left', `calc(-1 * var(--cornell-width) - 20px)`);
            document.body.style.setProperty('--cornell-margin-right', '15px');
            document.body.style.setProperty('--cornell-border-r', '2px solid var(--text-accent)');
            document.body.style.setProperty('--cornell-border-l', 'none');
            document.body.style.setProperty('--cornell-text-align', 'right');
        } else {
            document.body.style.setProperty('--cornell-float', 'right');
            document.body.style.setProperty('--cornell-margin-right', `calc(-1 * var(--cornell-width) - 20px)`);
            document.body.style.setProperty('--cornell-margin-left', '15px');
            document.body.style.setProperty('--cornell-border-l', '2px solid var(--text-accent)');
            document.body.style.setProperty('--cornell-border-r', 'none');
            document.body.style.setProperty('--cornell-text-align', 'left');
        }
    }

    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }

    async prepareForPrint(editor: Editor) {
        let content = editor.getValue();
        let modified = false;

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