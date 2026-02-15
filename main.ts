import { App, Plugin, PluginSettingTab, Setting, MarkdownRenderer, Component, Editor, Notice, MarkdownView } from 'obsidian';
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
}

const DEFAULT_SETTINGS: CornellSettings = {
    ignoredFolders: 'Templates, Archivos/Excluidos',
    alignment: 'left', 
    marginWidth: 25,
    fontSize: '0.85em',
    fontFamily: 'inherit',
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
        const isRecallMode = getActiveRecallMode(); 

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

                // --- LÓGICA DE ACTIVE RECALL (BLUR) ---
                if (isRecallMode && noteContent.trim().endsWith(";;")) {
                    builder.add(line.from, line.from, Decoration.line({
                        class: "cornell-blur"
                    }));
                }

                // --- LÓGICA DE MARGINALIA ---
                let matchedColor = null;
                const trimmedContent = noteContent.trim();
                for (const tag of settings.tags) {
                    if (trimmedContent.startsWith(tag.prefix)) {
                        matchedColor = tag.color;
                        break;
                    }
                }

                builder.add(matchStart, matchEnd, Decoration.replace({
                    widget: new MarginNoteWidget(noteContent, app, matchedColor)
                }));
            }
        }
        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});

// --- SETTINGS TAB ---
class CornellSettingTab extends PluginSettingTab {
    plugin: CornellMarginalia;
    constructor(app: App, plugin: CornellMarginalia) { super(app, plugin); this.plugin = plugin; }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Cornell Marginalia Settings' });

        containerEl.createEl('h3', { text: 'General Appearance' });
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
    }

    toggleActiveRecall() {
        this.activeRecallMode = !this.activeRecallMode;
        new Notice(this.activeRecallMode ? 'Active Recall Mode: ON 🙈' : 'Active Recall Mode: OFF 👁️');
        
        if (this.activeRecallMode) {
            this.ribbonIcon.setAttribute('aria-label', 'Disable Active Recall');
            this.app.workspace.updateOptions();
        } else {
            this.ribbonIcon.setAttribute('aria-label', 'Enable Active Recall');
            this.app.workspace.updateOptions();
        }
    }

    // --- LÓGICA DE FLASHCARDS INTELIGENTE ---
    generateFlashcards(editor: Editor) {
        const content = editor.getValue();
        const headerText = "### Flashcards";
        const lines = content.split('\n');
        
        // 1. Encontrar todas las flashcards potenciales en el texto (las que tienen ;;)
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

        // 2. Comprobar si ya existe la sección ### Flashcards
        let headerLineIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === headerText) {
                headerLineIndex = i;
                break;
            }
        }

        let newFlashcards: string[] = [];

        if (headerLineIndex !== -1) {
            // 3a. Si la sección existe, leemos qué hay debajo para no duplicar
            const existingContent = lines.slice(headerLineIndex + 1).join('\n');
            
            foundFlashcards.forEach(card => {
                // Solo añadimos si NO está ya en la sección de flashcards
                if (!existingContent.includes(card)) {
                    newFlashcards.push(card);
                }
            });

            if (newFlashcards.length > 0) {
                // Insertamos solo las nuevas AL FINAL del archivo
                const textToAppend = '\n' + newFlashcards.join('\n');
                const lastLine = editor.lineCount();
                editor.replaceRange(textToAppend, { line: lastLine, ch: 0 });
                new Notice(`Added ${newFlashcards.length} new flashcards.`);
            } else {
                new Notice('All flashcards are already up to date!');
            }

        } else {
            // 3b. Si la sección NO existe, la creamos con todas las cartas encontradas
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
