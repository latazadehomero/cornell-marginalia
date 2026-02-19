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
    enableReadingView: boolean; // <- NUEVO
}
// barra lateral item
interface MarginaliaItem {
    text: string;
    color: string;
    file: TFile;
    line: number;
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

// --- WIDGET DE MARGEN ---
class MarginNoteWidget extends WidgetType {
    constructor(
        readonly text: string, 
        readonly app: App, 
        readonly customColor: string | null 
    ) { super(); }

    toDOM(view: EditorView): HTMLElement {
        const div = document.createElement("div");
        div.className = "cm-cornell-margin";
        
        if (this.customColor) {
            div.style.borderColor = this.customColor;
            div.style.color = this.customColor;       
        }

        MarkdownRenderer.render(this.app, this.text, div, "", new Component());
        
        div.onclick = (e) => {
            const target = e.target as HTMLElement;
            if (target.tagName !== 'A') e.preventDefault();
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
                    widget: new MarginNoteWidget(finalNoteText, app, matchedColor)
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

// --- VISTA LATERAL (SIDEBAR EXPLORER) ---
class CornellNotesView extends ItemView {
    plugin: CornellMarginalia;
    currentTab: 'current' | 'vault' = 'current';

    constructor(leaf: WorkspaceLeaf, plugin: CornellMarginalia) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return CORNELL_VIEW_TYPE; }
    getDisplayText() { return "Marginalia Explorer"; }
    getIcon() { return "list"; }

    async onOpen() {
        this.renderUI();
        await this.scanNotes(); // Escanear al abrir
    }

    renderUI() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('cornell-sidebar-container');

        container.createEl("h4", { text: "Marginalia Explorer", cls: "cornell-sidebar-title" });

        const controlsDiv = container.createDiv({ cls: 'cornell-sidebar-controls' });
        
        const tabCurrent = controlsDiv.createEl("button", { text: "Current Note", cls: this.currentTab === 'current' ? 'cornell-tab-active' : '' });
        const tabVault = controlsDiv.createEl("button", { text: "All Vault", cls: this.currentTab === 'vault' ? 'cornell-tab-active' : '' });
        const btnRefresh = controlsDiv.createEl("button", { text: "🔄", title: "Refresh data" });

        // Contenedor donde irán los resultados
        container.createDiv({ cls: 'cornell-sidebar-content' });

        tabCurrent.onclick = async () => {
            this.currentTab = 'current';
            this.renderUI();
            await this.scanNotes();
        };

        tabVault.onclick = async () => {
            this.currentTab = 'vault';
            this.renderUI();
            await this.scanNotes();
        };

        btnRefresh.onclick = async () => {
            new Notice("Buscando marginalias...");
            await this.scanNotes();
        };
    }

    // --- EL MOTOR DE BÚSQUEDA ---
    async scanNotes() {
        const contentDiv = this.containerEl.querySelector('.cornell-sidebar-content') as HTMLElement;
        if (!contentDiv) return;
        
        contentDiv.empty();
        contentDiv.createEl('p', { text: 'Scanning...', cls: 'cornell-sidebar-empty' });

        const results: Record<string, MarginaliaItem[]> = {};
        const defaultColor = 'var(--text-accent)'; // Color por defecto si no tiene tag

        let filesToScan: TFile[] = [];
        if (this.currentTab === 'current') {
            const activeFile = this.plugin.app.workspace.getActiveFile();
            if (activeFile) filesToScan.push(activeFile);
        } else {
            filesToScan = this.plugin.app.vault.getMarkdownFiles();
            // Filtrar carpetas ignoradas
            const ignoredPaths = this.plugin.settings.ignoredFolders.split(',').map(s => s.trim()).filter(s => s.length > 0);
            filesToScan = filesToScan.filter(f => !ignoredPaths.some(p => f.path.startsWith(p)));
        }

        for (const file of filesToScan) {
            // cachedRead es super rápido porque lee la memoria interna de Obsidian
            const content = await this.plugin.app.vault.cachedRead(file);
            const lines = content.split('\n');
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineRegex = /%%>(.*?)%%/g;
                let match;

                while ((match = lineRegex.exec(line)) !== null) {
                    let noteContent = match[1].trim();
                    
                    // Si es una flashcard (termina en ;;), limpiamos eso para la vista
                    if (noteContent.endsWith(';;')) {
                        noteContent = noteContent.slice(0, -2).trim();
                    }

                    let matchedColor = defaultColor;
                    let finalText = noteContent;

                    for (const tag of this.plugin.settings.tags) {
                        if (finalText.startsWith(tag.prefix)) {
                            matchedColor = tag.color;
                            finalText = finalText.substring(tag.prefix.length).trim();
                            break;
                        }
                    }

                    if (finalText.length === 0) continue;

                    if (!results[matchedColor]) results[matchedColor] = [];
                    results[matchedColor].push({
                        text: finalText,
                        color: matchedColor,
                        file: file,
                        line: i // Guardamos la línea para poder viajar a ella
                    });
                }
            }
        }

        this.renderResults(results, contentDiv);
    }

// --- RENDERIZADO VISUAL Y NAVEGACIÓN ---
    renderResults(results: Record<string, MarginaliaItem[]>, container: HTMLElement) {
        container.empty();
        let totalFound = 0;

        for (const [color, items] of Object.entries(results)) {
            if (items.length === 0) continue;
            totalFound += items.length;

            // 1. Cabecera del Grupo (El punto de color)
            const groupHeader = container.createDiv({ cls: 'cornell-sidebar-group' });
            const colorDot = groupHeader.createSpan({ cls: 'cornell-sidebar-color-dot' });
            colorDot.style.backgroundColor = color;
            groupHeader.createSpan({ text: `${items.length} notes` });

            // 2. Elementos de la lista
            for (const item of items) {
                const itemDiv = container.createDiv({ cls: 'cornell-sidebar-item' });
                itemDiv.style.borderLeftColor = color;

                itemDiv.createDiv({ cls: 'cornell-sidebar-item-text', text: item.text });
                itemDiv.createDiv({ cls: 'cornell-sidebar-item-meta', text: `${item.file.basename} (L${item.line + 1})` });

                // 3. EVENTO DE CLIC (Viajar a la nota - Solución Nativa)
                itemDiv.onclick = async () => {
                    const leaf = this.plugin.app.workspace.getLeaf(false);
                    // eState le dice a Obsidian que haga scroll automático a esa línea
                    await leaf.openFile(item.file, { eState: { line: item.line } });
                };
            }
        }

        if (totalFound === 0) {
            container.createEl('p', { text: 'No marginalia found.', cls: 'cornell-sidebar-empty' });
        }
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

                    const marginDiv = document.createElement("div");
                    marginDiv.className = "cm-cornell-margin reading-mode-margin"; 
                    
                    if (matchedColor) {
                        marginDiv.style.setProperty('border-color', matchedColor, 'important');
                        marginDiv.style.setProperty('color', matchedColor, 'important');
                    }

                    MarkdownRenderer.render(this.app, finalNoteText, marginDiv, ctx.sourcePath, this);

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
}
