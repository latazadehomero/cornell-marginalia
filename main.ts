import { App, Plugin, PluginSettingTab, Setting, MarkdownRenderer, Component, Editor, Notice, MarkdownView, ItemView, WorkspaceLeaf, TFile, Modal, MarkdownFileInfo, HoverPopover, setIcon, editorLivePreviewField, } from 'obsidian';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
// 👇 IMPORTAMOS NUESTRO NUEVO ADDON
import { GamificationAddon } from "./addons/GamificationAddon";
import { CustomBackgroundAddon } from "./addons/CustomBackgroundAddon";
import { RhizomeAddon, RHIZOME_VIEW_TYPE } from "./addons/RhizomeAddon";
import { PdfDoodleAddon } from "./addons/PdfDoodleAddon";
import { SuperDoodleAddon } from "./addons/super-doodle";
import { BlurtingAddon, BlurtingSetupModal } from "./addons/BlurtingAddon";
import { MargidoroAddon } from "./addons/margidoro";
import { AnkiSyncAddon } from "./addons/AnkiSyncAddon";
import { ZoomDoodleAddon } from "./addons/ZoomDoodleAddon"; 
import { DashboardAddon } from "./addons/DashboardAddon";

// =================================================================
// 🛡️ UTILIDADES DE SEGURIDAD (SANITIZACIÓN)
// =================================================================
export function sanitizeFileName(name: string): string {
    // Previene Path Traversal (..) y elimina caracteres ilegales en Windows/Mac/Linux
    return name.replace(/[\/\?<>\\:\*\|":]/g, '-').replace(/\.\./g, '').trim();
}

export function sanitizeForTemplater(text: string): string {
    // Previene Ejecución de Código Remoto (RCE) a través de Templater
    return text.replace(/<%/g, '&lt;%').replace(/%>/g, '%&gt;');
}
// 🛡️ UTILIDAD: Sanitizador estricto para Anki
export function sanitizeAnkiDeckName(name: string): string {
    if (!name) return "Default";
    // Eliminamos etiquetas HTML y caracteres raros. Solo permitimos texto, números, espacios, '-', '_' y '::'
    return name.replace(/<[^>]*>?/gm, '') // Elimina HTML
               .replace(/[^\w\s\-\_:]/g, '') // Elimina caracteres especiales
               .replace(/:{3,}/g, '::') // Evita que pongan ::: o más
               .trim();
}


// =================================================================
// 🏷️ TAG SUGGESTER: Autocompletado Nativo para Textareas
// =================================================================
export class TagSuggester {
    private app: App;
    private inputEl: HTMLTextAreaElement | HTMLInputElement;
    private suggestEl: HTMLElement;
    private suggestions: string[] = [];
    private activeIndex: number = 0;
    private currentMatchStart: number = 0;
    private currentMatchLength: number = 0;

    constructor(app: App, inputEl: HTMLTextAreaElement | HTMLInputElement) {
        this.app = app;
        this.inputEl = inputEl;

        // 1. Crear el contenedor del Dropdown usando clases nativas de Obsidian
        this.suggestEl = document.createElement('div');
        this.suggestEl.className = 'suggestion-container cornell-tag-suggest';
        this.suggestEl.style.display = 'none';
        this.suggestEl.style.position = 'absolute';
        this.suggestEl.style.zIndex = '99999';
        this.suggestEl.style.top = 'calc(100% + 2px)';
        this.suggestEl.style.left = '0';
        this.suggestEl.style.width = '100%';
        this.suggestEl.style.maxHeight = '200px';
        this.suggestEl.style.overflowY = 'auto';

        // 2. Envolver el input mágicamente para no romper tu layout
        const parent = this.inputEl.parentNode;
        if (parent) {
            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';
            wrapper.style.width = this.inputEl.style.width || '100%';
            wrapper.style.marginBottom = this.inputEl.style.marginBottom || '0px';
            this.inputEl.style.marginBottom = '0px'; 
            
            parent.insertBefore(wrapper, this.inputEl);
            wrapper.appendChild(this.inputEl);
            wrapper.appendChild(this.suggestEl);
        }

        // 3. Escuchadores de eventos
        this.inputEl.addEventListener('input', this.onInput.bind(this));
        this.inputEl.addEventListener('keydown', (e: Event) => this.onKeyDown(e as KeyboardEvent));
        // Escondemos con delay para permitir el click del ratón
        this.inputEl.addEventListener('blur', () => setTimeout(() => this.close(), 150));
    }

    onInput() {
        const val = this.inputEl.value;
        const cursorPos = this.inputEl.selectionStart || 0;
        const textBefore = val.substring(0, cursorPos);
        
        // Atrapa el tag que se está escribiendo (ej. #ur)
        const match = textBefore.match(/(?:^|\s)(#[a-zA-Z0-9_/-]*)$/);
        
        if (match) {
            const prefix = match[1];
            this.currentMatchStart = cursorPos - prefix.length;
            this.currentMatchLength = prefix.length;
            
            const allTags = Object.keys((this.app.metadataCache as any).getTags());
            // Filtramos y limitamos a las 10 mejores sugerencias
            this.suggestions = allTags
                .filter(t => t.toLowerCase().includes(prefix.toLowerCase()) && t !== prefix)
                .slice(0, 10);
            
            if (this.suggestions.length > 0) {
                this.renderSuggestions();
                return;
            }
        }
        this.close();
    }

    renderSuggestions() {
        this.suggestEl.empty();
        this.activeIndex = 0;
        
        this.suggestions.forEach((tag, index) => {
            const itemEl = this.suggestEl.createDiv({ cls: 'suggestion-item' });
            itemEl.createSpan({ text: tag });
            
            if (index === 0) itemEl.addClass('is-selected');
            
            itemEl.onmousedown = (e) => {
                e.preventDefault();
                this.selectSuggestion(tag);
            };
            itemEl.onmouseenter = () => {
                this.suggestEl.querySelectorAll('.suggestion-item').forEach(el => el.removeClass('is-selected'));
                itemEl.addClass('is-selected');
                this.activeIndex = index;
            };
        });

        this.suggestEl.style.display = 'block';
    }

    onKeyDown(e: KeyboardEvent) {
        if (this.suggestEl.style.display === 'none') return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.activeIndex = (this.activeIndex + 1) % this.suggestions.length;
            this.updateSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.activeIndex = (this.activeIndex - 1 + this.suggestions.length) % this.suggestions.length;
            this.updateSelection();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            e.stopPropagation(); // 🛑 VITAL: Evita que el modal de Obsidian guarde la captura al presionar Enter para autocompletar
            this.selectSuggestion(this.suggestions[this.activeIndex]);
        } else if (e.key === 'Escape') {
            this.close();
        }
    }

    updateSelection() {
        const items = this.suggestEl.querySelectorAll('.suggestion-item');
        items.forEach((item, index) => {
            if (index === this.activeIndex) {
                item.addClass('is-selected');
                (item as HTMLElement).scrollIntoView({ block: 'nearest' });
            } else {
                item.removeClass('is-selected');
            }
        });
    }

    selectSuggestion(tag: string) {
        const val = this.inputEl.value;
        const before = val.substring(0, this.currentMatchStart);
        const after = val.substring(this.currentMatchStart + this.currentMatchLength);
        
        // Insertamos el tag completo + un espacio para seguir escribiendo
        this.inputEl.value = before + tag + " " + after;
        this.inputEl.focus();
        
        // Dejamos el cursor listo al final
        const newCursorPos = this.currentMatchStart + tag.length + 1;
        this.inputEl.setSelectionRange(newCursorPos, newCursorPos);
        
        this.close();
        this.inputEl.dispatchEvent(new Event('input'));
    }

    close() {
        this.suggestEl.style.display = 'none';
        this.suggestEl.empty();
    }
}

// =================================================================
// 🧠 EL CEREBRO PÚBLICO: OMNI CAPTURE MANAGER
// =================================================================
export interface CapturePayload {
    thought: string;
    destination: string;
    doodleData: ArrayBuffer | null;
}

export class OmniCaptureManager {
    public app: App;
    public plugin: any; 
    
    // Memorias estáticas del portapapeles
    static lastCapturedContext: string = "";
    static lastCapturedImageLength: number = 0;

    constructor(app: App, plugin: any) {
        this.app = app;
        this.plugin = plugin;
    }

    public openDoodle(): Promise<{ data: ArrayBuffer, isInstant: boolean }> {
        return new Promise((resolve) => {
            new SidebarDoodleModal(this.app, (arrayBuffer: ArrayBuffer, isInstant: boolean) => {
                resolve({ data: arrayBuffer, isInstant });
            }).open();
        });
    }

    // 💾 AQUÍ VIVE TU VIEJA LÓGICA DE GUARDADO (Intacta y Desacoplada)
    public async saveCapture(payload: CapturePayload, pendingClipboardImageData: ArrayBuffer | null = null, pendingClipboardImageExt: string = "png"): Promise<void> {
        const thought = payload.thought;
        let rawDestInput = payload.destination;

        // 🛡️ SANITIZACIÓN DE RUTA APLICADA AQUÍ (Solo una vez)
        let cleanDestName = sanitizeFileName(rawDestInput.replace(/^\d{12,14}\s*-\s*/, '').trim());
        if (!cleanDestName) cleanDestName = "Marginalia Inbox";
        let finalDestName = cleanDestName;

        if (this.plugin.settings.zkMode) {
            // @ts-ignore
            const zkId = window.moment().format('YYYYMMDDHHmmss');
            finalDestName = (cleanDestName !== "Marginalia Inbox") ? `${zkId} - ${cleanDestName}` : zkId;
        }

        // 1. AUTO-LECTURA DEL PORTAPAPELES (Primero obtenemos el texto)
        let context = "";
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                if (item.types.includes("text/plain")) {
                    const blob = await item.getType("text/plain");
                    const text = await blob.text();
                    if (text && text !== OmniCaptureManager.lastCapturedContext) {
                        context = text.trim();
                        OmniCaptureManager.lastCapturedContext = context;
                    }
                }
                const imageType = item.types.find((type: string) => type.startsWith("image/"));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const buffer = await blob.arrayBuffer();
                    if (buffer.byteLength !== OmniCaptureManager.lastCapturedImageLength) {
                        pendingClipboardImageData = buffer;
                        pendingClipboardImageExt = imageType.split('/')[1] || 'png';
                        OmniCaptureManager.lastCapturedImageLength = buffer.byteLength;
                    }
                }
            }
        } catch (err) {
            try {
                const clipText = await navigator.clipboard.readText();
                if (clipText && clipText !== OmniCaptureManager.lastCapturedContext) {
                    context = clipText.trim();
                    OmniCaptureManager.lastCapturedContext = context;
                }
            } catch (e) { }
        }

        // 🛡️ SANITIZACIÓN DE TEMPLATER (Se hace DESPUÉS de haber leído el portapapeles)
        let safeContext = sanitizeForTemplater(context);

        if (!thought && !context && !payload.doodleData && !pendingClipboardImageData) {
            new Notice("⚠️ Capture is empty!");
            throw new Error("Empty capture");
        }

        // 2. PROCESAR IMÁGENES AL DISCO
        let contextImageSyntax = "";
        if (pendingClipboardImageData) {
            // @ts-ignore
            const dateStr = window.moment().format('YYYYMMDD_HHmmss');
            const fileName = `clip_${dateStr}.${pendingClipboardImageExt}`;
            let attachmentPath = fileName;
            try { attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(fileName, ""); } catch (e) { }
            await this.app.vault.createBinary(attachmentPath, pendingClipboardImageData);
            contextImageSyntax = `![[${attachmentPath.split('/').pop()}]]`; 
        }

        let doodleSyntax = "";
        if (payload.doodleData) {
            // @ts-ignore
            const dateStr = window.moment().format('YYYYMMDD_HHmmss');
            const fileName = `doodle_${dateStr}.png`;
            const folder = this.plugin.settings.doodleFolder.trim();
            let attachmentPath = folder ? `${folder}/${fileName}` : fileName;
            
            if (folder) await this.plugin.ensureFolderExists(folder);
            else { try { attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(fileName, ""); } catch (e) { } }
            
            await this.app.vault.createBinary(attachmentPath, payload.doodleData);
            doodleSyntax = `img:[[${attachmentPath.split('/').pop()}]]`; 
        }

        // ====================================================================
        // 3. 🧩 ENSAMBLAJE DE MARKDOWN (LÓGICA MULTI-MARGINALIA AÑADIDA AQUÍ)
        // ====================================================================
        let marginaliaContent = "";

        if (thought) {
            // Dividimos el texto introducido basándonos en tu separador ";;"
            const parts = thought.split(';;');
            
            // Mapeamos cada parte para inyectar la sintaxis de múltiples bloques
            marginaliaContent = parts.map((part, index) => {
                let trimmed = part.trim();
                
                // Si no es el último bloque, lo tratamos como Flashcard
                if (index < parts.length - 1) {
                    // Mantenemos el ";;" para la flashcard, cerramos el bloque %% y abrimos uno nuevo %%>
                    return `${trimmed};; %%\n%%> `;
                }
                
                // Si es el último bloque, es la explicación personal. No añadimos ";;"
                return trimmed;
            }).join('');
        }

        if (doodleSyntax) {
            // Agregamos el doodle al final si existe
            marginaliaContent += marginaliaContent ? `\n${doodleSyntax}` : doodleSyntax;
        }
        
        marginaliaContent = marginaliaContent.trim();

        // 📝 Plantilla por defecto
        const defaultTemplate = "\n%%> {{text}} %%\n{{citation}}\n{{image}}\n\n---";
        let templateStr = this.plugin.settings.omniCaptureTemplate || defaultTemplate;

        // 🔄 Reemplazamos las variables dinámicas
        let finalMd = templateStr
            .replace(/{{text}}/gi, marginaliaContent)
            .replace(/{{citation}}/gi, safeContext)
            .replace(/{{image}}/gi, contextImageSyntax);

        // 🧹 Limpieza Inteligente: 
        // Si hay bloques vacíos (ej. pusiste un ";;" al final por accidente), esto lo limpia.
        finalMd = finalMd.replace(/%%>\s*%%/g, '');

        // 🚀 ¡SOPORTE TEMPLATER PARA OMNI-CAPTURE!
        const templaterPlugin = (this.app as any).plugins.plugins["templater-obsidian"];
        if (templaterPlugin && templaterPlugin.templater) {
            try {
                const activeContextFile = this.app.workspace.getActiveFile();
                finalMd = await templaterPlugin.templater.parse_template(
                    { target_file: activeContextFile, run_mode: 4 },
                    finalMd
                );
            } catch (err) {
                console.warn("Cornell Marginalia: Error de Templater en OmniCapture", err);
            }
        }

        // Limpiamos saltos de línea excesivos
        finalMd = finalMd.replace(/\n{4,}/g, '\n\n\n');

        // 4. INYECCIÓN
        let file = this.app.metadataCache.getFirstLinkpathDest(finalDestName, "");
        if (file instanceof TFile) {
            await this.app.vault.append(file, finalMd);
        } else {
            let fileName = finalDestName.endsWith(".md") ? finalDestName : `${finalDestName}.md`;
            let folderPath = this.plugin.settings.zkMode ? this.plugin.settings.zkFolder.trim() : this.plugin.settings.omniCaptureFolder.trim(); 
            if (folderPath) {
                await this.plugin.ensureFolderExists(folderPath); 
                fileName = `${folderPath}/${fileName}`; 
            }
            let header = this.plugin.settings.zkMode ? `# 🗃️ ${finalDestName}\n` : `# 📥 ${finalDestName}\n`;
            
            if (this.plugin.settings.zkMode && this.plugin.settings.zkTemplatePath) {
                const activeFile = this.app.workspace.getActiveFile();
                const activeSourceName = activeFile ? activeFile.basename : "No Active Source";

                // @ts-ignore
                const dateStr = window.moment().format('YYYY-MM-DD');
                // @ts-ignore
                const timeStr = window.moment().format('HH:mm');
                
                const templateData = await this.plugin.getTemplateContent(this.plugin.settings.zkTemplatePath, {
                    title: finalDestName,
                    date: dateStr,
                    time: timeStr,
                    source_note: activeSourceName
                });
                
                if (templateData) header = templateData; 
            } 
            await this.app.vault.create(fileName, header + finalMd);
        }
        
        new Notice(`⚡ Capture injected into ${finalDestName}`);
        
        if (this.plugin.settings.lastOmniDestination !== cleanDestName) {
            this.plugin.settings.lastOmniDestination = cleanDestName;
            await this.plugin.saveSettings();
        }
    }
}
// =================================================================
// --- ESTRUCTURAS ---
interface CornellTag {
    prefix: string; 
    color: string;  
}

// --- NUEVAS ESTRUCTURAS PARA EL PERFIL ---
export interface UserStats {
    xp: number;
    level: number;
    marginaliasCreated: number;
    colorUsage: Record<string, number>;
    profileImage: string;
    quote: string;
    customBackground: string;
    bgBlur: number;
    bgOpacity: number;
    activeReading: Record<string, { lastReview: number; confidence: number; nextReview: number }>;
    // 👇 NUEVA MEMORIA PARA LA MÁQUINA DEL TIEMPO
    rhizomeReviews: Record<string, { 
        lastReviewed: number; // Fecha en milisegundos
        interval: number;     // Días hasta la próxima revisión
        ease: number;         // Factor de facilidad (Algoritmo SM-2 de Anki)
        
    }>;
    margidoroPending: string[];
}

export interface TrackerSession {
    timestamp: number; // La hora exacta en que empezó el Pomodoro
    objective: string; // El objetivo que escribiste
    durationMinutes?: number;
}

export interface SyllabusTopic {
    id: string;
    name: string;
    rule: string; // Ej: "#huesos" o "tema::huesos"
}

export interface ExamSubject {
    id: string;
    name: string;
    examDate: number; 
    color: string;
    sources: string[]; 
    syllabus: SyllabusTopic[]; // 👈 El nuevo esquema inteligente
    activeReading: Record<string, { lastReview: number; confidence: number; nextReview: number }>; // 👈 1. AGREGA ESTA LÍNEA AQUÍ
}

// 🌳 ESTRUCTURA DEL ÁRBOL SEMÁNTICO INFINITO
export interface SemanticTreeNode {
    name: string;      // ej: "padre"
    fullPath: string;  // ej: "#abuelo/padre"
    children: Map<string, SemanticTreeNode>; // Sub-recuadros (infinitos)
    items: any[];      // Las marginalias raíces exactas de este nivel
}

interface CornellSettings {
    pinnedThreads: string[];
    exportCleanTags: boolean;
    exportCleanIds: boolean;
    dragDropTemplate: string;
    structuralColors: { tag: string, color: string }[];
    collapsedBoxes: string[];
    ignoredFolders: string;
    alignment: 'left' | 'right'; 
    marginWidth: number;
    marginOffset: number;
    fontSize: string;
    fontFamily: string;
    tags: CornellTag[];
    enableReadingView: boolean;
    outgoingLinks: string[]; 
    lastOmniDestination: string;
    extractHighlights: boolean;
    ignoredHighlightFolders: string;
    ignoredHighlightTexts: string;
    showSyntaxInSourceMode: boolean;
    zkMode: boolean;
    zkFolder: string;
    zkTemplatePath: string;
    doodleFolder: string;
    canvasFolder: string;
    pinboardFolder: string;
    pinboardTemplatePath: string;
    pinboardItemTemplatePath: string;
    canvasItemTemplatePath: string;
    omniCaptureFolder: string;
    omniCaptureTemplate: string;
    responsiveMarginalia: boolean;
    responsiveThreshold: number;
    addons: Record<string, boolean>; 
    ankiRecentDecks: string[];
    ankiTagToDeck: Record<string, string>;
    userStats: UserStats;
    enablePdfDoodle: boolean;
    adaptiveMode: boolean;
    blurExplanatoryMarginalia: boolean;
    enableDashboardAddon: boolean; // <- Nuevo toggle
    dashboardData: {
    trackerHistory: TrackerSession[]; // 👈 Aquí guardaremos el historial
    deleteCompletedTasks: boolean;
    enableTaskNotesIntegration: boolean;
};
    margidoro: {
        workTime: number;
        shortBreak: number;
        longBreak: number;
        logFolder: string;
        hardPrefix: string; // Ej: "?" para auto-clasificar como difícil
        reviewReminderTime: string; // 👈 NUEVO
        cyclesBeforeLongBreak: number;
    };
    deleteCompletedTasks: boolean;
    enableTaskNotesIntegration: boolean;
    visualHelper: boolean
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
    isCustom?: boolean;
    indentLevel?: number;
    context?: string;
   
}

 // 🌉 EL PUENTE: Memoria estática para cruzar datos entre vistas (Drag & Drop)
    export class OmniDragManager {
    static payload: MarginaliaItem | null = null;
    }
const DEFAULT_SETTINGS: CornellSettings = {
    exportCleanTags: true,
    exportCleanIds: true,
    dragDropTemplate: "- {{text}} {{source_note}}",
    collapsedBoxes: [],
    pinnedThreads: [],
    structuralColors: [],
    ignoredFolders: 'Templates',
    alignment: 'left', 
    marginWidth: 25,
    marginOffset: 20,
    fontSize: '0.85em',
    fontFamily: 'inherit',
    adaptiveMode: false,
    enableReadingView: true,
    tags: [
        { prefix: '!', color: '#ffea00' }, 
        { prefix: '?', color: '#ff9900' }, 
        { prefix: 'X-', color: '#ff4d4d' }, 
        { prefix: 'V-', color: '#00cc66' }  
    ],
    outgoingLinks: [],
    lastOmniDestination: 'Marginalia Inbox',
    extractHighlights: false,
    ignoredHighlightFolders: 'Excalidraw',
    ignoredHighlightTexts: '⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠', 
    showSyntaxInSourceMode: false,
    zkMode: false,
    zkFolder: 'Zettelkasten',
    zkTemplatePath: '',
    doodleFolder: 'Marginalia Attachments',
    canvasFolder: 'Evidence Boards',
    pinboardFolder: 'Pinboards',
    pinboardTemplatePath: '',
    pinboardItemTemplatePath: '',
    canvasItemTemplatePath: '',
    omniCaptureFolder: '',
    omniCaptureTemplate: "\n%%> {{text}} %%\n{{citation}}\n{{image}}\n\n---",
    responsiveMarginalia: false,
    responsiveThreshold: 850,
    blurExplanatoryMarginalia: false,
    enableDashboardAddon: false,
    dashboardData: {
    trackerHistory: [],
    deleteCompletedTasks: false,
    enableTaskNotesIntegration: false,
},
    // 👇 LOS VALORES POR DEFECTO PARA LOS NUEVOS USUARIOS
    addons: {
        "gamification-profile": false, // Por defecto viene apagado
        "custom-background": false,
        "rhizome-time-machine": false,
        "super-doodle": false, // 🎨
        "anki-sync": false,
        "zoom-doodle": false
    },
    userStats: {
        xp: 0,
        level: 1,
        marginaliasCreated: 0,
        colorUsage: {},
        profileImage: "", quote: "Stay curious.",
        customBackground: "", bgBlur: 5, bgOpacity: 0.8,
        rhizomeReviews: {},
        margidoroPending: [],
        activeReading: {}
        
    },
    enablePdfDoodle: false,
    // recuerda mazos
    ankiRecentDecks: [],
    ankiTagToDeck: {},
    //  VALORES POR DEFECTO MARGIDORO
    margidoro: {
        workTime: 25,
        shortBreak: 5,
        longBreak: 15,
        logFolder: "Margidoro Logs",
        hardPrefix: "?",
        reviewReminderTime: "20:00", // 👈 NUEVO: Hora por defecto
        cyclesBeforeLongBreak: 4,
    },
    deleteCompletedTasks: false,
    enableTaskNotesIntegration: false,
    visualHelper: false,
}


// --- WIDGET DE MARGEN ---
class VisualAnchorWidget extends WidgetType {
    color: string;

    constructor(color: string | null) {
        super();
        this.color = color || 'var(--text-accent)'; // Color por defecto si no hay match
    }

    toDOM() {
        const dot = document.createElement("span");
        dot.addClass("cornell-visual-anchor");
        dot.style.display = "inline-block";
        dot.style.width = "8px";
        dot.style.height = "8px";
        dot.style.borderRadius = "50%";
        dot.style.backgroundColor = this.color;
        // Pequeño ajuste visual para que no se pegue al texto si decides mostrarlo en otros contextos
        dot.style.marginRight = "4px"; 
        dot.style.verticalAlign = "middle";
        return dot;
    }
}

class MarginNoteWidget extends WidgetType {
    constructor(
        readonly text: string, 
        readonly app: App, 
        readonly customColor: string | null,
        readonly sourcePath: string = "",
        readonly direction: string = ">",
        readonly isFlashcard: boolean = false // <--- ESTE PARÁMETRO
    ) { super(); }

    toDOM(view: EditorView): HTMLElement {
        const div = document.createElement("div");
        div.className = "cm-cornell-margin";
        
        // Asignamos la clase correcta para el blur
        if (this.isFlashcard) {
            div.classList.add("is-flashcard");
        } else {
            div.classList.add("is-explanatory");
        }

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

        //  ESCUDO INTELIGENTE PARA MODO FUENTE!! 
        if (settings.showSyntaxInSourceMode) {
            // editorLivePreviewField evalúa a 'true' en Live Preview y a 'false' en Source Mode.
            const isLivePreview = view.state.field(editorLivePreviewField, false);
            if (!isLivePreview) {
                // Si estamos en Source Mode, devolvemos el constructor vacío.
                // Esto aborta la decoración y permite que el usuario vea la sintaxis "%%" cruda.
                return builder.finish(); 
            }
        }
        //  =================================== 

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

// 🛡️ ESCUDO INTELIGENTE: Bloquea el código, EXCEPTO si es nuestro bloque editorial
let isCornellBlock = false;
if (isCode) {
    let lineNum = state.doc.lineAt(matchStart).number;
    // Escaneamos hacia arriba para ver en qué lenguaje está el bloque
    while (lineNum > 0) {
        const lineText = state.doc.line(lineNum).text.trim();
        if (lineText.startsWith("```") || lineText.startsWith("~~~")) {
            if (lineText.toLowerCase().includes("cornell")) {
                isCornellBlock = true;
            }
            break;
        }
        lineNum--;
    }
}

// Si es código normal (ej. JS, Python), lo ignoramos. Si es Cornell, lo dibujamos.
if (isCode && !isCornellBlock) continue;

                let isCursorInside = false;
                const line = state.doc.lineAt(matchStart);
                
                for (const range of cursorRanges) {
                    if (range.from >= line.from && range.to <= line.to) {
                        isCursorInside = true;
                        break;
                    }
                }

                if (isCursorInside) continue;

                // 👇 1. IDENTIFICAR SI ES FLASHCARD Y DEFINIR EL BLOQUE
                let tempNoteContent = noteContent.replace(/\s*\^([a-zA-Z0-9]+)\s*$/, '').trim();
                const isFlashcard = tempNoteContent.includes(";;");

                if (isFlashcard) {
                    const lineNum = line.number;
                    let startLineNum = lineNum;
                    let endLineNum = lineNum;
                    
                    let textWithoutMarginalia = line.text.replace(/%%[><](.*?)%%/g, '').trim();
                    textWithoutMarginalia = textWithoutMarginalia.replace(/\^[a-zA-Z0-9_-]+$/, '').trim();

                    // Quitamos el '>' si es un callout para ver si la marginalia está realmente sola
                    const isCalloutLine = textWithoutMarginalia.startsWith('>');
                    let cleanTextForStandalone = textWithoutMarginalia;
                    if (isCalloutLine) cleanTextForStandalone = cleanTextForStandalone.replace(/^>\s*/, '').trim();
                    
                    const isStandalone = cleanTextForStandalone === '';

                    if (!isStandalone) {
                        // 🧠 REGLA 1: INLINE (Toca texto)
                        if (isCalloutLine) {
                            // Callout: Expande hasta el último '>'
                            while (startLineNum > 1 && state.doc.line(startLineNum - 1).text.trim().startsWith('>')) startLineNum--;
                            while (endLineNum < state.doc.lines && state.doc.line(endLineNum + 1).text.trim().startsWith('>')) endLineNum++;
                        } else {
                            // Prosa o Viñetas: NO SE EXPANDE. Se queda en su línea, respetando el "esto ya no"
                        }
                    } else {
                        // 🧠 REGLA 2: STANDALONE (No toca texto)
                        let nextIdx = lineNum + 1;
                        // Baja ignorando las líneas estéticas vacías
                        while (nextIdx <= state.doc.lines && state.doc.line(nextIdx).text.replace(/%%[><](.*?)%%/g, '').trim() === '') nextIdx++;
                        
                        if (nextIdx <= state.doc.lines) {
                            startLineNum = nextIdx;
                            endLineNum = nextIdx;
                            const targetText = state.doc.line(nextIdx).text.trim();
                            
                            if (targetText.startsWith('>')) {
                                // Abajo hay un Callout: Pinta hasta el último '>'
                                while (endLineNum < state.doc.lines && state.doc.line(endLineNum + 1).text.trim().startsWith('>')) endLineNum++;
                            } else if (targetText.startsWith('```')) {
                                // Abajo hay Código: Pinta todo el bloque de código
                                endLineNum++;
                                while (endLineNum <= state.doc.lines && !state.doc.line(endLineNum).text.trim().startsWith('```')) endLineNum++;
                            }
                            // Si es prosa abajo, NO SE EXPANDE (pinta solo esa línea y frena)
                        }
                    }

                    for (let n = startLineNum; n <= endLineNum; n++) {
                        const targetLine = state.doc.line(n);
                        if (!decorationsData.some(d => d.from === targetLine.from && d.type === 0)) {
                            decorationsData.push({
                                from: targetLine.from, to: targetLine.from, type: 0,
                                dec: Decoration.line({ class: "cornell-flashcard-target" })
                            });
                        }
                    }
                    tempNoteContent = tempNoteContent.replace(";;", "").replace(/\s{2,}/g, ' ').trim();
                }
                // 👇 2. ASIGNAMOS EL TEXTO PURIFICADO (Declarado una sola vez)
                let finalNoteText = tempNoteContent; 

                // ✨ SOLUCIÓN: Declaramos la variable con un color por defecto
                let matchedColor = 'var(--text-accent)';
                
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
                        // 👇 3. PASAMOS 'isFlashcard' COMO ÚLTIMO PARÁMETRO
                        widget: new MarginNoteWidget(finalNoteText, app, matchedColor, file?.path || "", direction, isFlashcard),
                        side: -1 
                    })
                });

                // NUEVO VISUAL HELPER: El punto de anclaje (type: 2)
                if (settings.visualHelper) {
                    decorationsData.push({
                        from: matchStart,
                        to: matchStart, // ⚠️ CRÍTICO: Mismo inicio y fin (longitud 0)
                        type: 2,
                        dec: Decoration.widget({
                            widget: new VisualAnchorWidget(matchedColor),
                            side: -1 // Se renderiza justo antes de la marca de ocultación
                        })
                    });
                }

                decorationsData.push({
                    from: matchStart, 
                    to: matchEnd, 
                    type: 3,
                    dec: Decoration.mark({ class: "cornell-hide-raw" })
                });
            }
        }

        // 🛡️ ESCUDO ANTI-CRASH PARA RANGESETBUILDER (CM6)
        decorationsData.sort((a, b) => {
            // 1. Ordenar estrictamente por inicio
            if (a.from !== b.from) return a.from - b.from;
            // 2. Si empiezan igual, los rangos más cortos DEBEN ir primero (Widget antes que Mark)
            if (a.to !== b.to) return a.to - b.to; 
            // 3. Empate técnico, ordenar por tipo lógico
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

// --- MODAL DE FUSIÓN DE HILOS (DRAG & DROP) ---
class ThreadMergeModal extends Modal {
    sourceTag: string;
    targetTag: string;
    onSubmit: (newParentName: string) => void;

    constructor(app: App, sourceTag: string, targetTag: string, onSubmit: (newParentName: string) => void) {
        super(app);
        this.sourceTag = sourceTag;
        this.targetTag = targetTag;
        this.onSubmit = onSubmit;
    }

    // --- MODAL DE FUSIÓN DE HILOS (DRAG & DROP) ---
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: "🗂️ Merge Threads" });
        
        // 🛡️ SANITIZADO: Uso de la API de Obsidian en lugar de innerHTML
        const descEl = contentEl.createEl("p", { cls: "cornell-modal-text" });
        descEl.appendText("You are grouping ");
        descEl.createEl("b", { text: this.sourceTag });
        descEl.appendText(" and ");
        descEl.createEl("b", { text: this.targetTag });
        descEl.appendText(".");
        
        contentEl.createEl("p", { 
            text: "Enter a name for the new parent collection (e.g., 'abuelo'):", 
            attr: { style: "font-size: 0.9em; color: var(--text-muted); margin-bottom: 5px;" } 
        });

        const inputEl = contentEl.createEl("input", { type: "text", placeholder: "New collection name..." });
        inputEl.style.width = "100%";
        inputEl.style.marginBottom = "20px";

        const btnContainer = contentEl.createDiv({ attr: { style: "display: flex; justify-content: flex-end; gap: 10px;" } });
        
        const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = btnContainer.createEl("button", { text: "Group Threads", cls: "mod-cta" });
        confirmBtn.onclick = () => {
            const val = inputEl.value.trim();
            if (!val) {
                new Notice("⚠️ Please enter a valid name.");
                return;
            }
            // Limpiamos espacios y caracteres raros por si el usuario escribe mal el tag
            const safeTagName = val.replace(/\s+/g, '-').replace(/[^\w-]/g, '');
            this.onSubmit(safeTagName);
            this.close();
        };

        // UX: Permitir presionar Enter para confirmar rápidamente
        inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") confirmBtn.click();
        });

        // UX: Foco automático para que el usuario empiece a escribir de inmediato
        setTimeout(() => inputEl.focus(), 50);
    }

    onClose() {
        this.contentEl.empty();
    }
}

// --- MOTOR DE DIBUJO (TRUE MARGINALIA) 🎨 ---
class DoodleModal extends Modal {
    editor: Editor;
    canvas!: HTMLCanvasElement;
    ctx!: CanvasRenderingContext2D;
    isDrawing: boolean = false;

    constructor(app: App, editor: Editor) {
        super(app);
        this.editor = editor;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.style.width = "80vw"; // Modal ancho para dibujar cómodo
        this.modalEl.style.maxWidth = "800px";

        // --- ⚡ NUEVO: CAPTURE NOW (Ctrl+Enter para guardar) ---
        this.scope.register(['Mod'], 'Enter', (e: KeyboardEvent) => {
            e.preventDefault();
            this.saveDoodle();
        });
        // --------------------------------------------------------

        contentEl.createEl("h3", { text: "✏️ Marginalia Doodle" });

        // 1. Crear el contenedor y el lienzo
        const canvasContainer = contentEl.createDiv();
        canvasContainer.style.border = "2px dashed var(--background-modifier-border)";
        canvasContainer.style.borderRadius = "8px";
        canvasContainer.style.backgroundColor = "#ffffff"; // Fondo blanco para que el trazo negro resalte
        canvasContainer.style.cursor = "crosshair";
        canvasContainer.style.touchAction = "none"; // Evita que la pantalla táctil haga scroll

        this.canvas = canvasContainer.createEl("canvas");
        this.canvas.width = 750;
        this.canvas.height = 400;
        this.canvas.style.display = "block";
        
        this.ctx = this.canvas.getContext("2d")!;
        // Estilo del trazo (Tinta)
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.strokeStyle = "#000000";

        

        // 2. Lógica de Dibujo (Soporta Ratón y Tableta Gráfica)
        this.canvas.addEventListener("pointerdown", (e) => {
            this.isDrawing = true;
            const rect = this.canvas.getBoundingClientRect();
            this.ctx.beginPath();
            this.ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
        });

        this.canvas.addEventListener("pointermove", (e) => {
            if (!this.isDrawing) return;
            const rect = this.canvas.getBoundingClientRect();
            this.ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
            this.ctx.stroke();
        });

        this.canvas.addEventListener("pointerup", () => { this.isDrawing = false; });
        this.canvas.addEventListener("pointerout", () => { this.isDrawing = false; });

        // 3. Botonera (Herramientas + Cancelar/Guardar)
        const btnContainer = contentEl.createDiv();
        btnContainer.style.display = "flex";
        btnContainer.style.justifyContent = "space-between";
        btnContainer.style.marginTop = "15px";

        // --- GRUPO IZQUIERDO: Herramientas nativas ---
        const leftBtns = btnContainer.createDiv();
        leftBtns.style.display = "flex";
        leftBtns.style.gap = "8px";

        // 1ro: CREAMOS LOS BOTONES
        const penBtn = leftBtns.createEl("button", { cls: "mod-cta" });
        setIcon(penBtn, "pencil");
        penBtn.setAttribute("aria-label", "Pen");

        const eraserBtn = leftBtns.createEl("button");
        setIcon(eraserBtn, "eraser");
        eraserBtn.setAttribute("aria-label", "Eraser");

        const clearBtn = leftBtns.createEl("button");
        setIcon(clearBtn, "trash-2");
        clearBtn.setAttribute("aria-label", "Clear Canvas");

        // 2do: LE ASIGNAMOS LOS CLICS (Ahora sí existen)
        penBtn.onclick = (e) => {
            e.preventDefault();
            this.ctx.globalCompositeOperation = "source-over";
            this.ctx.lineWidth = 3; 
            penBtn.addClass("mod-cta");
            eraserBtn.removeClass("mod-cta");
        };

        eraserBtn.onclick = (e) => {
            e.preventDefault();
            this.ctx.globalCompositeOperation = "destination-out"; 
            this.ctx.lineWidth = 20; 
            eraserBtn.addClass("mod-cta");
            penBtn.removeClass("mod-cta");
        };

        clearBtn.onclick = () => this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // --- GRUPO DERECHO: Acciones ---
        const rightBtns = btnContainer.createDiv();
        rightBtns.style.display = "flex";
        rightBtns.style.gap = "10px";

        // 1. Botón Cancelar
        const cancelBtn = rightBtns.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => this.close();

        // 2. Botón Guardar (Único y principal)
        const saveBtn = rightBtns.createEl("button", { text: "Save to Margin", cls: "mod-cta" });
        saveBtn.style.backgroundColor = "var(--interactive-accent)";
        saveBtn.style.color = "var(--text-on-accent)";
        saveBtn.onclick = () => this.saveDoodle();
    }

    async saveDoodle() {
        // 1. Convertir el dibujo a Base64 (Imagen Web)
        const dataUrl = this.canvas.toDataURL("image/png");
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        
        // 2. Convertir Base64 a datos binarios que Obsidian pueda guardar
        const arrayBuffer = base64ToArrayBuffer(base64Data);

        // @ts-ignore
        const dateStr = window.moment().format('YYYYMMDD_HHmmss');
        const fileName = `doodle_${dateStr}.png`;
        
        try {
            // 3. Averiguar dónde guarda Obsidian los adjuntos de forma SEGURA
            const activeFile = this.app.workspace.getActiveFile();
            let attachmentPath = fileName;
            
            if (activeFile) {
                try {
                    // API Oficial y moderna de Obsidian
                    // @ts-ignore
                    attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(fileName, activeFile.path);
                } catch (e) {
                    // Fallback de emergencia: Guardar en la misma carpeta que la nota
                    const parentPath = activeFile.parent ? activeFile.parent.path : "";
                    attachmentPath = parentPath === "/" || !parentPath ? fileName : `${parentPath}/${fileName}`;
                }
            }

            // 4. Guardar la imagen en el disco duro
            await this.app.vault.createBinary(attachmentPath, arrayBuffer);

            // 5. Inyectar la marginalia con la imagen en el editor
            const actualFileName = attachmentPath.split('/').pop(); // Extraer solo el nombre.png
            const insertion = `%%> img:[[${actualFileName}]] %%`;
            
            const cursor = this.editor.getCursor();
            this.editor.replaceRange(insertion, cursor);
            
            new Notice("✏️ Doodle saved!");
            this.close();
        } catch (error) {
            new Notice("Error saving doodle. Check console.");
            console.error(error);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

// Utilidad auxiliar para transformar la imagen a binario
function base64ToArrayBuffer(base64: string) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// --- OMNI-CAPTURE MODAL (Captura rápida de Ideas, Portapapeles y Doodles) ⚡ ---
// --- OMNI-CAPTURE MODAL (Fast Capture for Ideas, Clipboard & Doodles) ⚡ ---
// --- OMNI-CAPTURE MODAL (Fast Capture for Ideas, Clipboard & Doodles) ⚡ ---
class OmniCaptureModal extends Modal {
    // 🧠 CACHÉ INTELIGENTE (Memoria a corto plazo del Plugin)
    static lastCapturedContext: string = "";
    static lastCapturedImageLength: number = 0;

    thoughtInput!: HTMLTextAreaElement;
    clipboardInput!: HTMLTextAreaElement;
    destinationInput!: HTMLInputElement;
    
    // Elementos del Doodle
    canvasContainer!: HTMLElement;
    canvas!: HTMLCanvasElement;
    ctx!: CanvasRenderingContext2D;
    isDrawing: boolean = false;
    hasDoodle: boolean = false;
    
    // Elementos de la Imagen del Portapapeles
    clipboardImagePreview!: HTMLImageElement;
    clipboardImageData: ArrayBuffer | null = null;
    clipboardImageExt: string = "png";

    plugin: CornellMarginalia;

    constructor(app: App, plugin: CornellMarginalia) {
        super(app);
        this.plugin = plugin;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.style.width = "60vw";
        this.modalEl.style.maxWidth = "700px";

        contentEl.createEl("h2", { text: "⚡ Omni-Capture" });

        // 1. Destino con Autocompletado
        const destRow = contentEl.createDiv({ attr: { style: "margin-bottom: 15px; display: flex; gap: 10px; align-items: center;" } });
        destRow.createSpan({ text: "📥 Destination:", attr: { style: "font-weight: bold;" } });
        
        const lastTarget = this.plugin.settings.lastOmniDestination || "Marginalia Inbox";
        this.destinationInput = destRow.createEl("input", { type: "text", value: lastTarget });
        this.destinationInput.style.flexGrow = "1";

        const datalist = contentEl.createEl("datalist");
        datalist.id = "omni-vault-files";
        this.app.vault.getMarkdownFiles().forEach(f => datalist.createEl("option", { value: f.basename }));
        this.destinationInput.setAttribute("list", "omni-vault-files");

        // 2. Tu Pensamiento
        contentEl.createEl("h4", { text: "💡 Your Idea/Thought:", attr: { style: "margin-bottom: 5px;" } });
        this.thoughtInput = contentEl.createEl("textarea", { placeholder: "e.g., Windows is like fast food, Linux is fresh vegetables..." });
        this.thoughtInput.style.width = "100%";
        this.thoughtInput.style.height = "80px";
        this.thoughtInput.style.marginBottom = "15px";
        // 🏷️ Encender el Auto-Completado de Tags
        new TagSuggester(this.app, this.thoughtInput);

        // 3. El Portapapeles (Contexto) CON BOTÓN DE LIMPIEZA
        const contextHeader = contentEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 5px;" } });
        contextHeader.createEl("h4", { text: "📄 Context (Clipboard):", attr: { style: "margin: 0;" } });
        
        // 🧹 Botón de Limpieza Manual
        const clearCtxBtn = contextHeader.createEl("span", { text: "🧹 Clear", attr: { style: "cursor: pointer; font-size: 0.85em; color: var(--text-muted);" } });
        clearCtxBtn.onclick = () => {
            this.clipboardInput.value = "";
            this.clipboardImageData = null;
            this.clipboardImagePreview.style.display = "none";
            this.clipboardImagePreview.src = "";
            this.clipboardInput.placeholder = "Context cleared. Type or paste (Ctrl+V) here...";
        };

        this.clipboardInput = contentEl.createEl("textarea", { placeholder: "Loading clipboard..." });
        this.clipboardInput.style.width = "100%";
        this.clipboardInput.style.height = "60px";
        this.clipboardInput.style.opacity = "0.8";
        
        this.clipboardImagePreview = contentEl.createEl("img");
        this.clipboardImagePreview.style.maxWidth = "100%";
        this.clipboardImagePreview.style.maxHeight = "200px";
        this.clipboardImagePreview.style.display = "none";
        this.clipboardImagePreview.style.marginTop = "10px";
        this.clipboardImagePreview.style.borderRadius = "8px";
        this.clipboardImagePreview.style.border = "1px solid var(--background-modifier-border)";

        // 🧠 AUTO-LECTURA INTELIGENTE (Filtra lo viejo)
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const item of clipboardItems) {
                if (item.types.includes("text/plain")) {
                    const blob = await item.getType("text/plain");
                    const text = await blob.text();
                    if (text && text !== OmniCaptureModal.lastCapturedContext) {
                        this.clipboardInput.value = text;
                    } else if (text) {
                        this.clipboardInput.placeholder = "Old clipboard ignored. Paste (Ctrl+V) if needed.";
                    }
                }
                const imageType = item.types.find(type => type.startsWith("image/"));
                if (imageType) {
                    const blob = await item.getType(imageType);
                    const buffer = await blob.arrayBuffer();
                    // Si el peso de la imagen es distinto al último guardado, es una imagen nueva
                    if (buffer.byteLength !== OmniCaptureModal.lastCapturedImageLength) {
                        this.clipboardImageData = buffer;
                        this.clipboardImageExt = imageType.split('/')[1] || 'png';
                        this.clipboardImagePreview.src = URL.createObjectURL(blob);
                        this.clipboardImagePreview.style.display = "block";
                    }
                }
            }
        } catch (err) {
            try {
                const clipText = await navigator.clipboard.readText();
                if (clipText && clipText !== OmniCaptureModal.lastCapturedContext) {
                    this.clipboardInput.value = clipText;
                }
            } catch (e) {
                this.clipboardInput.placeholder = "Paste your context here (Ctrl+V)...";
            }
        }

        // 🛡️ LISTENER DE PEGADO MANUAL (Ctrl+V)
        this.modalEl.addEventListener("paste", async (e: ClipboardEvent) => {
            if (!e.clipboardData) return;
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf("image") !== -1) {
                    const blob = items[i].getAsFile();
                    if (blob) {
                        this.clipboardImageData = await blob.arrayBuffer();
                        this.clipboardImageExt = blob.type.split('/')[1] || 'png';
                        this.clipboardImagePreview.src = URL.createObjectURL(blob);
                        this.clipboardImagePreview.style.display = "block";
                    }
                }
            }
        });

        // 4. El Lienzo Oculto (Doodle)
        this.canvasContainer = contentEl.createDiv();
        this.canvasContainer.style.display = "none";
        this.canvasContainer.style.border = "2px dashed var(--background-modifier-border)";
        this.canvasContainer.style.borderRadius = "8px";
        this.canvasContainer.style.backgroundColor = "#ffffff";
        this.canvasContainer.style.cursor = "crosshair";
        this.canvasContainer.style.marginTop = "15px";
        this.canvasContainer.style.touchAction = "none";

        this.canvas = this.canvasContainer.createEl("canvas");
        this.canvas.width = 650;
        this.canvas.height = 250;
        this.canvas.style.display = "block";
        
        this.ctx = this.canvas.getContext("2d")!;
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.strokeStyle = "#000000";

        

        this.canvas.addEventListener("pointerdown", (e) => {
            this.isDrawing = true;
            this.hasDoodle = true;
            const rect = this.canvas.getBoundingClientRect();
            this.ctx.beginPath();
            this.ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
        });
        this.canvas.addEventListener("pointermove", (e) => {
            if (!this.isDrawing) return;
            const rect = this.canvas.getBoundingClientRect();
            this.ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
            this.ctx.stroke();
        });
        this.canvas.addEventListener("pointerup", () => { this.isDrawing = false; });
        this.canvas.addEventListener("pointerout", () => { this.isDrawing = false; });

        this.canvas.addEventListener("pointerout", () => { this.isDrawing = false; });

        // --- HERRAMIENTAS DEL ZENDOODLE (Nativas) ---
        const doodleTools = this.canvasContainer.createDiv();
        doodleTools.style.display = "flex";
        doodleTools.style.gap = "8px";
        doodleTools.style.marginTop = "10px";
        doodleTools.style.paddingTop = "10px";
        doodleTools.style.borderTop = "1px solid var(--background-modifier-border)";

        const penBtn = doodleTools.createEl("button", { cls: "mod-cta" });
        setIcon(penBtn, "pencil");
        penBtn.setAttribute("aria-label", "Pen");

        const eraserBtn = doodleTools.createEl("button");
        setIcon(eraserBtn, "eraser");
        eraserBtn.setAttribute("aria-label", "Eraser");

        const clearBtn = doodleTools.createEl("button");
        setIcon(clearBtn, "trash-2");
        clearBtn.setAttribute("aria-label", "Clear Doodle");

        penBtn.onclick = (e) => {
            e.preventDefault();
            this.ctx.globalCompositeOperation = "source-over";
            this.ctx.lineWidth = 3;
            penBtn.addClass("mod-cta");
            eraserBtn.removeClass("mod-cta");
        };

        eraserBtn.onclick = (e) => {
            e.preventDefault();
            this.ctx.globalCompositeOperation = "destination-out";
            this.ctx.lineWidth = 20;
            eraserBtn.addClass("mod-cta");
            penBtn.removeClass("mod-cta");
        };

        clearBtn.onclick = (e) => {
            e.preventDefault();
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.hasDoodle = false;
        };

        // 5. Botonera
        const btnContainer = contentEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; margin-top: 20px;" } });

        const doodleBtn = btnContainer.createEl("button", { text: "🎨 Add Doodle" });
        doodleBtn.onclick = () => {
            if (this.canvasContainer.style.display === "none") {
                this.canvasContainer.style.display = "block";
                doodleBtn.innerText = "🗑️ Clear Doodle";
            } else {
                this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
                this.hasDoodle = false;
                this.canvasContainer.style.display = "none";
                doodleBtn.innerText = "🎨 Add Doodle";
            }
        };

        const rightBtns = btnContainer.createDiv({ attr: { style: "display: flex; gap: 10px;" } });

        

        const cancelBtn = rightBtns.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => this.close();

        const saveBtn = rightBtns.createEl("button", { text: "💾 Save Capture", cls: "mod-cta" });
        saveBtn.style.backgroundColor = "var(--interactive-accent)";
        saveBtn.style.color = "var(--text-on-accent)";
        saveBtn.onclick = () => this.saveCapture();
        
        // 🚀 ATAJO RÁPIDO: Ctrl+Enter o Cmd+Enter para guardar al instante
        this.modalEl.addEventListener("keydown", (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                this.saveCapture();
            }
        });

        setTimeout(() => {
            this.thoughtInput.focus();
        }, 50);
    }

    async saveCapture() {
        const thought = this.thoughtInput.value.trim();
        const context = this.clipboardInput.value.trim();
        // 🛡️ CÓDIGO SEGURO
let rawDestInput = this.destinationInput.value.trim() || "Marginalia Inbox";
let cleanDestName = sanitizeFileName(rawDestInput.replace(/^\d{12,14}\s*-\s*/, '').trim());
        if (!cleanDestName) cleanDestName = "Marginalia Inbox";

        let finalDestName = cleanDestName;

        if (this.plugin.settings.zkMode) {
            // @ts-ignore
            const zkId = window.moment().format('YYYYMMDDHHmmss');
            if (cleanDestName !== "Marginalia Inbox") {
                finalDestName = `${zkId} - ${cleanDestName}`;
            } else {
                finalDestName = zkId;
            }
        }
        
        if (!thought && !context && !this.hasDoodle && !this.clipboardImageData) {
            new Notice("Capture is empty!");
            return;
        }

        if (this.plugin.settings.lastOmniDestination !== cleanDestName) {
            this.plugin.settings.lastOmniDestination = cleanDestName;
            await this.plugin.saveSettings();
        }
        
        OmniCaptureModal.lastCapturedContext = context;
        OmniCaptureModal.lastCapturedImageLength = this.clipboardImageData ? this.clipboardImageData.byteLength : 0;

        let contextImageSyntax = "";
        if (this.clipboardImageData) {
            // @ts-ignore
            const dateStr = window.moment().format('YYYYMMDD_HHmmss');
            const fileName = `clip_${dateStr}.${this.clipboardImageExt}`;
            let attachmentPath = fileName;
            try {
                // @ts-ignore
                attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(fileName, "");
            } catch (e) {
                attachmentPath = fileName;
            }
            await this.app.vault.createBinary(attachmentPath, this.clipboardImageData);
            const actualFileName = attachmentPath.split('/').pop();
            contextImageSyntax = `![[${actualFileName}]]`; 
        }

        let doodleSyntax = "";
        if (this.hasDoodle) {
            const dataUrl = this.canvas.toDataURL("image/png");
            const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
            const binaryString = window.atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
            
            // @ts-ignore
            const dateStr = window.moment().format('YYYYMMDD_HHmmss');
            const fileName = `doodle_${dateStr}.png`;
            const folder = this.plugin.settings.doodleFolder.trim();
            let attachmentPath = fileName;
            
            if (folder) {
                await this.plugin.ensureFolderExists(folder);
                attachmentPath = `${folder}/${fileName}`;
            } else {
                try {
                    // @ts-ignore
                    attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(fileName, "");
                } catch (e) { 
                    attachmentPath = fileName; 
                }
            }
            
            await this.app.vault.createBinary(attachmentPath, bytes.buffer);
            const actualFileName = attachmentPath.split('/').pop();
            doodleSyntax = `img:[[${actualFileName}]]`; 
        }

        let marginaliaContent = "";
        if (thought) marginaliaContent += `${thought} `; 
        if (doodleSyntax) marginaliaContent += `${doodleSyntax}`;

        let finalMd = "\n";
        if (marginaliaContent.trim()) {
            finalMd += `%%> ${marginaliaContent.trim()} %%\n`;
        }
        if (context) {
            finalMd += `${context}\n`;
        }
        if (contextImageSyntax) {
            finalMd += `${contextImageSyntax}\n`;
        }
        finalMd += `\n---\n`;

        let file = this.app.metadataCache.getFirstLinkpathDest(finalDestName, "");

        try {
            if (file instanceof TFile) {
                await this.app.vault.append(file, finalMd);
            } else {
                let fileName = finalDestName.endsWith(".md") ? finalDestName : `${finalDestName}.md`;
                let folderPath = ""; 

                if (this.plugin.settings.zkMode) {
                    folderPath = this.plugin.settings.zkFolder.trim(); 
                } else {
                    folderPath = this.plugin.settings.omniCaptureFolder.trim(); 
                }

                if (folderPath) {
                    await this.plugin.ensureFolderExists(folderPath); 
                    fileName = `${folderPath}/${fileName}`; 
                }

                let header = this.plugin.settings.zkMode ? `# 🗃️ ${finalDestName}\n` : `# 📥 ${finalDestName}\n`;
            
            if (this.plugin.settings.zkMode && this.plugin.settings.zkTemplatePath) {
                // 🧠 INTELIGENCIA ZK: Leemos qué archivo tiene abierto el usuario ahora mismo
                const activeFile = this.app.workspace.getActiveFile();
                const activeSourceName = activeFile ? activeFile.basename : "No Active Source";

                // @ts-ignore
                const dateStr = window.moment().format('YYYY-MM-DD');
                // @ts-ignore
                const timeStr = window.moment().format('HH:mm');
                
                const templateData = await this.plugin.getTemplateContent(this.plugin.settings.zkTemplatePath, {
                    title: finalDestName,
                    date: dateStr,
                    time: timeStr,
                    source_note: activeSourceName // 🎯 Inyectamos inteligentemente el archivo activo
                });
                
                if (templateData) header = templateData; 
            } 
            await this.app.vault.create(fileName, header + finalMd);
            }
            new Notice(`✅ Capture injected into ${finalDestName}`);
            // --- 🎮 MOTOR DE EXPERIENCIA (GAMIFICACIÓN) ---
            if (this.plugin.settings.addons && this.plugin.settings.addons["gamification-profile"]) {
                this.plugin.gamificationAddon.addXp();
                
                // Le avisamos a la barra lateral que se redibuje para actualizar la barra de XP visualmente
                this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE).forEach(leaf => {
                    if (leaf.view instanceof CornellNotesView) leaf.view.renderUI();
                });
            }
            // ----------------------------------------------
            this.close();
        } catch (error) {
            new Notice("Error saving capture. Check console.");
            console.error(error);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
} // <--- Esta última llave cierra la clase OmniCaptureModal

  


// 🎨 MODAL AUXILIAR PARA EL OMNI-CAPTURE LATERAL
class SidebarDoodleModal extends Modal {
    canvas!: HTMLCanvasElement;
    ctx!: CanvasRenderingContext2D;
    isDrawing: boolean = false;
    
    // 👇 Modificamos la firma para aceptar el parámetro instant
    onSave: (data: ArrayBuffer, instant: boolean) => void;

    constructor(app: App, onSave: (data: ArrayBuffer, instant: boolean) => void) {
        super(app);
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.style.width = "80vw";
        this.modalEl.style.maxWidth = "800px";

        // --- ⚡ ATAJO CAPTURE NOW (Ctrl+Enter) ---
        this.scope.register(['Mod'], 'Enter', (e: KeyboardEvent) => {
            e.preventDefault();
            this.attachDoodle(true); // Atajo de teclado dispara el rayo
        });
        // ----------------------------------------

        contentEl.createEl("h3", { text: "✏️ Omni-Capture Doodle" });

        const canvasContainer = contentEl.createDiv();
        canvasContainer.style.border = "2px dashed var(--background-modifier-border)";
        canvasContainer.style.borderRadius = "8px";
        canvasContainer.style.backgroundColor = "#ffffff";
        canvasContainer.style.cursor = "crosshair";
        canvasContainer.style.touchAction = "none";

        this.canvas = canvasContainer.createEl("canvas");
        this.canvas.width = 750;
        this.canvas.height = 400;
        this.canvas.style.display = "block";
        
        this.ctx = this.canvas.getContext("2d")!;
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.strokeStyle = "#000000";

        this.canvas.addEventListener("pointerdown", (e) => {
            this.isDrawing = true;
            const rect = this.canvas.getBoundingClientRect();
            this.ctx.beginPath();
            this.ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
        });

        this.canvas.addEventListener("pointermove", (e) => {
            if (!this.isDrawing) return;
            const rect = this.canvas.getBoundingClientRect();
            this.ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
            this.ctx.stroke();
        });

        this.canvas.addEventListener("pointerup", () => { this.isDrawing = false; });
        this.canvas.addEventListener("pointerout", () => { this.isDrawing = false; });

        // --- BOTONERA ---
        const btnContainer = contentEl.createDiv();
        btnContainer.style.display = "flex";
        btnContainer.style.justifyContent = "space-between";
        btnContainer.style.marginTop = "15px";

        // 1. Grupo Izquierdo (Herramientas Nativas)
        const leftBtns = btnContainer.createDiv();
        leftBtns.style.display = "flex";
        leftBtns.style.gap = "8px";
        
        const penBtn = leftBtns.createEl("button", { cls: "mod-cta" });
        setIcon(penBtn, "pencil");
        penBtn.setAttribute("aria-label", "Pen");

        const eraserBtn = leftBtns.createEl("button");
        setIcon(eraserBtn, "eraser");
        eraserBtn.setAttribute("aria-label", "Eraser");

        const clearBtn = leftBtns.createEl("button");
        setIcon(clearBtn, "trash-2");
        clearBtn.setAttribute("aria-label", "Clear Canvas");

        penBtn.onclick = (e) => {
            e.preventDefault();
            this.ctx.globalCompositeOperation = "source-over";
            this.ctx.lineWidth = 3; 
            penBtn.addClass("mod-cta");
            eraserBtn.removeClass("mod-cta");
        };

        eraserBtn.onclick = (e) => {
            e.preventDefault();
            this.ctx.globalCompositeOperation = "destination-out"; 
            this.ctx.lineWidth = 20; 
            eraserBtn.addClass("mod-cta");
            penBtn.removeClass("mod-cta");
        };

        clearBtn.onclick = () => this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // 2. Grupo Derecho (Acciones)
        const rightBtns = btnContainer.createDiv({ attr: { style: "display: flex; gap: 10px;" } });
        
        // 1. Botón Cancelar (Izquierda del grupo)
        const cancelBtn = rightBtns.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => this.close();

        // 2. Botón Attach (Centro, ahora con color natural/secundario)
        const saveBtn = rightBtns.createEl("button", { text: "✔️ Attach" });
        saveBtn.title = "Attach image and keep writing";
        saveBtn.onclick = () => this.attachDoodle(false);

        // 3. Botón Rayo (Derecha, ahora resaltado como acción principal)
        const zapBtn = rightBtns.createEl("button", { text: " Save", cls: "mod-cta" });
        setIcon(zapBtn, "zap"); 
        zapBtn.setAttribute("aria-label", "Save Entire Capture Now (Ctrl+Enter)");
        // Aplicamos los estilos de acento visual al rayo
        zapBtn.style.backgroundColor = "var(--interactive-accent)";
        zapBtn.style.color = "var(--text-on-accent)";
        zapBtn.style.display = "flex";
        zapBtn.style.alignItems = "center";
        zapBtn.style.gap = "4px";
        zapBtn.onclick = () => this.attachDoodle(true);
    }

    attachDoodle(instant: boolean) {
        const dataUrl = this.canvas.toDataURL("image/png");
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        const arrayBuffer = base64ToArrayBuffer(base64Data); 
        this.onSave(arrayBuffer, instant); // Le pasamos la orden a la barra lateral
        this.close();
    }

    onClose() { 
        this.contentEl.empty(); 
    }
}
// --- VISTA LATERAL (EXPLORER) ESTÉTICA MINIMALISTA Y BLINDADA ●🧠 ---
export class CornellNotesView extends ItemView {
    plugin: CornellMarginalia;
    currentTab: 'current' | 'vault' | 'threads' | 'pinboard' | 'reviews' = 'current';
    // 🧠 Memoria para el Cosido por Teclado
    selectedForStitch: MarginaliaItem[] = [];
    
    isStitchingMode: boolean = false;
    sourceStitchItem: MarginaliaItem | null = null;

    searchQuery: string = '';
    activeColorFilters: Set<string> = new Set();
    cachedItems: MarginaliaItem[] = []; 

    // NUEVO: Memoria para el filtro de "Ultra-Recientes" (Sesión activa)
    isRecentFilterActive: boolean = false;

    // 📖 NUEVO: Memoria para el modo de salto directo a PDF++
    isDirectPdfModeActive: boolean = false;

    // 🧠 NUEVO: Memoria para el Active Recall en PDFs
    isActiveRecallPdfMode: boolean = false;

    // ⚡ NUEVO: Memoria para el Filtro de Flashcards
    isFlashcardFilterActive: boolean = false;

    // 🚀 NUEVA MEMORIA RAM (Caché de Bóveda)
    private vaultCache: Map<string, { mtime: number, items: MarginaliaItem[] }> = new Map();

    // 📚 MEMORIA ZOTLIKE
    isZotlikeMode: boolean = false;
    activePdfName: string = "";

    draggedSidebarItems: MarginaliaItem[] | null = null; 
    isGroupedByContent: boolean = false; 
    isGroupedByFolder: boolean = false; // 📁 NUEVO: Memoria para la vista de carpetas

    pinboardItems: MarginaliaItem[] = [];

    pinboardFocusIndex: number | null = null;
    targetInsertIndex: number | null = null;
    targetInsertAsChild: boolean = false;
    // 🗄️ VARIABLES DEL SLIDER (CAJÓN DESLIZANTE)
    sliderContainer!: HTMLElement;
    sliderDestInput!: HTMLInputElement;
    sliderIdeaInput!: HTMLTextAreaElement;
    isSliderOpen: boolean = false;
    // HASTA ACA
    autoPasteInterval: number | null = null;
    lastClipboardText: string = "";
    
    // 🚀 NUEVA CACHÉ PARA OPTIMIZAR IMÁGENES
    private imagePathCache: { [filename: string]: string } = {};

    // 🎨 VARIABLES DEL LIENZO INMORTAL (ZEN DOODLE)
    isZenMode: boolean = false;
    zenCanvasEl: HTMLCanvasElement | null = null;
    zenCtx: CanvasRenderingContext2D | null = null;
    zenIsDrawing: boolean = false;

    // 🧠 MEMORIA DEL OMNI-CAPTURE LATERAL
    static lastCapturedContext: string = "";
    static lastCapturedImageLength: number = 0;
    static lastDraggedPayload: string = ""; //templater
    pendingDoodleData: ArrayBuffer | null = null;
    pendingClipboardImageData: ArrayBuffer | null = null;
    pendingClipboardImageExt: string = "png";
    
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

    // 🎨 MOTOR DEL ZEN DOODLE (LIENZO DE PANEL COMPLETO)
    renderZenDoodle(container: HTMLElement) {
        const zenContainer = container.createDiv({ cls: 'cornell-zen-container' });
        zenContainer.style.display = 'flex';
        zenContainer.style.flexDirection = 'column';
        zenContainer.style.height = '100%';
        zenContainer.style.gap = '15px';
        zenContainer.style.padding = '10px 0';

        // 1. TOP BAR (Botonera)
        const topBar = zenContainer.createDiv();
        topBar.style.display = 'flex';
        topBar.style.justifyContent = 'space-between';
        topBar.style.alignItems = 'center';

        // --- GRUPO IZQUIERDO (Atrás + Herramientas) ---
        const leftGrp = topBar.createDiv({ attr: { style: 'display:flex; gap:6px; align-items:center;' } });
        
        const cancelBtn = leftGrp.createEl('button', { title: 'Return to Board' });
        setIcon(cancelBtn, "arrow-left"); // Usamos icono en vez de texto para ahorrar espacio
        cancelBtn.style.boxShadow = 'none';
        // 👇 Si está en Focus Mode, desaparecemos el botón de volver atrás para que no escape
        if (this.isBlurtingActive) {
            cancelBtn.style.display = 'none';
        } else {
            cancelBtn.onclick = () => {
                this.isZenMode = false;
                this.applyFiltersAndRender();
            };
        }

        const penBtn = leftGrp.createEl('button', { cls: 'mod-cta', title: 'Pen' });
        setIcon(penBtn, "pencil");

        const eraserBtn = leftGrp.createEl('button', { title: 'Eraser' });
        setIcon(eraserBtn, "eraser");

        penBtn.onclick = () => {
            if (this.zenCtx) {
                this.zenCtx.globalCompositeOperation = "source-over";
                this.zenCtx.lineWidth = 4; // Grosor original del Zen Doodle
                penBtn.addClass("mod-cta");
                eraserBtn.removeClass("mod-cta");
            }
        };

        eraserBtn.onclick = () => {
            if (this.zenCtx) {
                this.zenCtx.globalCompositeOperation = "destination-out"; // Magia de borrado
                this.zenCtx.lineWidth = 25; // Más grueso para borrar fácil en pantalla completa
                eraserBtn.addClass("mod-cta");
                penBtn.removeClass("mod-cta");
            }
        };

        // --- GRUPO DERECHO (Limpiar + Guardar) ---
        const rightGrp = topBar.createDiv({ attr: { style: 'display:flex; gap:6px;' } });
        
        const clearBtn = rightGrp.createEl('button', { title: 'Clear Canvas' });
        setIcon(clearBtn, "trash-2"); // Icono nativo de basura
        clearBtn.style.boxShadow = 'none';
        clearBtn.onclick = () => {
            if (this.zenCanvasEl && this.zenCtx) {
                this.zenCtx.clearRect(0, 0, this.zenCanvasEl.width, this.zenCanvasEl.height);
            }
        };

        
        

        // ⬇️ EL BOTÓN INTELIGENTE (Attach normal o Finish Blurting)
        const saveBtn = rightGrp.createEl('button', { cls: 'mod-cta' });

        if (this.isBlurtingActive) {
            // --- 🧠 MODO BLURTING: Finalizar Sesión ---
            saveBtn.innerText = '🏁 Finish & Audit';
            saveBtn.title = 'Finish Session and Audit';
            saveBtn.style.backgroundColor = 'var(--color-purple)';
            saveBtn.style.color = 'white';
            
            saveBtn.onclick = () => {
                this.isBlurtingActive = false;
                new Notice("🎨 Visual Session finished! Time to audit in RED.");
                
                // NOTA: No cerramos isZenMode aquí para que el dibujo siga en pantalla
                this.renderUI();
                this.applyFiltersAndRender();
            };
        } else {
            // --- 💾 MODO NORMAL: Attach al Board ---
            saveBtn.innerText = '💾 Attach';
            saveBtn.title = 'Save and add to Board';
            saveBtn.style.backgroundColor = 'var(--interactive-accent)';
            saveBtn.style.color = 'var(--text-on-accent)';
            
            saveBtn.onclick = async () => {
                if (!this.zenCanvasEl) return;
                saveBtn.innerText = '⏳ Saving...';
                
                const dataUrl = this.zenCanvasEl.toDataURL("image/png");
                const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
                const arrayBuffer = base64ToArrayBuffer(base64Data);

                // @ts-ignore
                const dateStr = window.moment().format('YYYYMMDD_HHmmss');
                const fileName = `zendoodle_${dateStr}.png`;
                const folder = this.plugin.settings.doodleFolder.trim();
                let attachmentPath = fileName;
                
                if (folder) {
                    await this.plugin.ensureFolderExists(folder);
                    attachmentPath = `${folder}/${fileName}`;
                } else {
                    try {
                        // @ts-ignore
                        attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(fileName, "");
                    } catch (e) { 
                        attachmentPath = fileName; 
                    }
                }
                
                await this.app.vault.createBinary(attachmentPath, arrayBuffer);
                const actualFileName = attachmentPath.split('/').pop();
                const doodleSyntax = `![[${actualFileName}]]`; 
                
                this.pinboardItems.push({ 
                    text: doodleSyntax, 
                    rawText: doodleSyntax, 
                    color: 'transparent', 
                    file: null as any, 
                    line: -1, 
                    blockId: null, 
                    outgoingLinks: [], 
                    isCustom: true, // Lo metemos como nodo esqueleto para que no busque archivos asociados
                    indentLevel: 0
                });
                
                new Notice('🎨 Zen Doodle attached to Board!');
                this.isZenMode = false;
                // Limpiamos el lienzo para la próxima vez
                if (this.zenCtx) this.zenCtx.clearRect(0, 0, this.zenCanvasEl.width, this.zenCanvasEl.height);
                this.applyFiltersAndRender();
            };
        }

        // 2. EL LIENZO INMORTAL
        if (!this.zenCanvasEl) {
            this.zenCanvasEl = document.createElement("canvas");
            this.zenCanvasEl.width = 800; // Resolución interna alta para que no se pixele
            this.zenCanvasEl.height = 1200;
            this.zenCtx = this.zenCanvasEl.getContext("2d")!;
            this.zenCtx.lineWidth = 4;
            this.zenCtx.lineCap = "round";
            this.zenCtx.lineJoin = "round";
            this.zenCtx.strokeStyle = "#000000"; 
            
            this.zenCanvasEl.style.backgroundColor = "#ffffff";
            this.zenCanvasEl.style.border = "2px dashed var(--background-modifier-border)";
            this.zenCanvasEl.style.borderRadius = "8px";
            this.zenCanvasEl.style.width = "100%";
            this.zenCanvasEl.style.flexGrow = "1";
            this.zenCanvasEl.style.cursor = "crosshair";
            this.zenCanvasEl.style.touchAction = "none"; // 📱 VITAL: Evita que el móvil haga scroll al dibujar

            const getPointerPos = (e: PointerEvent) => {
                const rect = this.zenCanvasEl!.getBoundingClientRect();
                const scaleX = this.zenCanvasEl!.width / rect.width;
                const scaleY = this.zenCanvasEl!.height / rect.height;
                return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
            };

            this.zenCanvasEl.addEventListener("pointerdown", (e) => {
                this.zenIsDrawing = true;
                const pos = getPointerPos(e);
                this.zenCtx!.beginPath();
                this.zenCtx!.moveTo(pos.x, pos.y);
            });

            this.zenCanvasEl.addEventListener("pointermove", (e) => {
                if (!this.zenIsDrawing) return;
                const pos = getPointerPos(e);
                this.zenCtx!.lineTo(pos.x, pos.y);
                this.zenCtx!.stroke();
            });

            this.zenCanvasEl.addEventListener("pointerup", () => { this.zenIsDrawing = false; });
            this.zenCanvasEl.addEventListener("pointerout", () => { this.zenIsDrawing = false; });
            this.zenCanvasEl.addEventListener("pointercancel", () => { this.zenIsDrawing = false; });
        }
        
        zenContainer.appendChild(this.zenCanvasEl);
    }

    renderUI() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('cornell-sidebar-container');

        if (this.isBlurtingActive || this.isAuditing) {
            // 🛡️ 1. JAULA CSS DE TITANIO (Absolute Fill)
            container.style.position = "absolute";
            container.style.top = "0";
            container.style.bottom = "0";
            container.style.left = "0";
            container.style.right = "0";
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.padding = "10px";
            container.style.overflow = "hidden";

            // Cambiamos el título dinámicamente
            const titleText = this.isBlurtingActive ? "🧠 Focus Mode (Draw!)" : "🖍️ Audit Phase (Correct in Red)";
            container.createEl("h4", { text: titleText, cls: "cornell-sidebar-title" });
            
            const actionBtn = container.createEl("button", { cls: "mod-cta" });
            actionBtn.style.width = "100%";
            actionBtn.style.marginBottom = "15px";
            actionBtn.style.flexShrink = "0"; 
            
            if (this.isBlurtingActive) {
                actionBtn.innerText = "🏁 Finish & Audit";
                actionBtn.style.backgroundColor = "var(--color-purple)";
                actionBtn.style.color = "white";
                
                actionBtn.onclick = () => {
                    // 📸 1. CAPTURAR LA IMAGEN ORIGINAL ANTES DE CAMBIAR A ROJO
                    if (this.blurtingFormat === "visual" && this.zenCanvasEl) {
                        const dataUrl = this.zenCanvasEl.toDataURL("image/png");
                        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
                        this.originalCanvasData = base64ToArrayBuffer(base64Data);
                    }

                    // 🔄 2. CAMBIO DE ESTADO
                    this.isBlurtingActive = false;
                    this.isAuditing = true; 
                    
                    new Notice("🎨 Session finished! Time to audit in RED.");
                    this.renderUI(); // Redibuja la interfaz en modo Split-Screen
                    
                    // 🪄 3. DISPARAR LÁPIZ ROJO (micro-retraso para que el DOM esté listo)
                    if (this.blurtingFormat === "visual") {
                        setTimeout(() => this.containerEl.dispatchEvent(new CustomEvent('cornell-force-red-pen')), 50);
                    }
                };
            } else {
                actionBtn.innerText = "💾 Save Session to Vault";
                actionBtn.style.backgroundColor = "var(--color-green)";
                actionBtn.style.color = "white";
                actionBtn.onclick = () => this.saveBlurtingSession();
            }

            // 📦 ZONA SUPERIOR: EL CANVAS (Ocupa 100% si dibujas, 50% si auditas)
            const contentDiv = container.createDiv({ cls: 'cornell-sidebar-content' });
            contentDiv.style.flexGrow = "1";
            contentDiv.style.height = this.isAuditing ? "50%" : "100%"; // 👈 La magia de la pantalla dividida
            contentDiv.style.width = "100%";
            contentDiv.style.position = "relative";
            contentDiv.style.display = "flex";
            contentDiv.style.flexDirection = "column";
            contentDiv.style.overflow = "hidden";
            
            if (this.blurtingFormat === "visual") {
                this.renderZenDoodle(contentDiv);
            }

            // 📚 ZONA INFERIOR: LAS NOTAS DE REFERENCIA (Solo aparece en Auditoría)
            if (this.isAuditing) {
                const deckDiv = container.createDiv({ cls: 'cornell-audit-deck' });
                deckDiv.style.flexGrow = "1";
                deckDiv.style.height = "50%";
                deckDiv.style.overflowY = "auto";
                deckDiv.style.borderTop = "2px dashed var(--background-modifier-border)";
                deckDiv.style.marginTop = "10px";
                deckDiv.style.paddingTop = "10px";
                deckDiv.style.display = "flex";
                deckDiv.style.flexDirection = "column";
                deckDiv.style.gap = "10px";
                
                deckDiv.createEl("h5", { text: "📚 Your Reference Notes:", attr: { style: "margin: 0; color: var(--text-muted); text-align: center;" } });
                
                // Pintamos las tarjetas que el usuario estaba estudiando
                this.blurtingDeck.forEach(item => {
                    this.createItemDiv(item, deckDiv);
                });
            }

            return; 
        
        }

        // LIMPIEZA DE SEGURIDAD PARA EL EXPLORADOR NORMAL
        container.style.position = "";
        container.style.top = "";
        container.style.bottom = "";
        container.style.left = "";
        container.style.right = "";
        container.style.display = ""; 
        container.style.flexDirection = "";
        container.style.padding = "";
        container.style.overflow = "";

        container.createEl("h4", { text: "Marginalia Explorer", cls: "cornell-sidebar-title" });
        

    
        // --- 🧩 INYECCIÓN DEL ADDON DE GAMIFICACIÓN ---
        if (this.plugin.settings.addons && this.plugin.settings.addons["gamification-profile"]) {
            const stats = this.plugin.settings.userStats;
            const profileDiv = container.createDiv({ cls: 'cornell-profile-widget' });
            
            const nextLevelXp = stats.level * 100;
            const xpPercentage = Math.min(100, (stats.xp / nextLevelXp) * 100);

            // Si no hay foto, usamos un emoji de placeholder
            const avatarHtml = stats.profileImage 
                ? `<img src="${stats.profileImage}" class="cornell-profile-avatar-img" />` 
                : `<div class="cornell-profile-avatar">👤</div>`;

            const quoteHtml = stats.quote 
                ? `<div class="cornell-profile-quote">"${stats.quote}"</div>` 
                : ``;

            profileDiv.innerHTML = `
                ${avatarHtml}
                <div class="cornell-profile-info">
                    <div class="cornell-profile-header">
                        <span class="cornell-profile-level">Level ${stats.level}</span>
                        <span class="cornell-profile-score">${stats.marginaliasCreated} Notes</span>
                    </div>
                    <div class="cornell-xp-bar-container">
                        <div class="cornell-xp-bar" style="width: ${xpPercentage}%;"></div>
                    </div>
                    <div class="cornell-xp-text">${stats.xp} / ${nextLevelXp} XP</div>
                    ${quoteHtml}
                </div>
            `;
        }
        // ----------------------------------------------

        this.renderQuickCapture(container as HTMLElement); // Aquí inyectamos la barra superior

        const controlsDiv = container.createDiv({ cls: 'cornell-sidebar-controls' });
        
        const tabCurrent = controlsDiv.createEl("button", { text: "Current", cls: this.currentTab === 'current' ? 'cornell-tab-active' : '' });
        const tabVault = controlsDiv.createEl("button", { text: "Vault", cls: this.currentTab === 'vault' ? 'cornell-tab-active' : '' });
        const tabThreads = controlsDiv.createEl("button", { text: "⌇ Threads", cls: this.currentTab === 'threads' ? 'cornell-tab-active' : '' });
        const tabPinboard = controlsDiv.createEl("button", { text: "● Board", cls: this.currentTab === 'pinboard' ? 'cornell-tab-active' : '', title: "Your Pinboard" });
        // 🧩 INYECCIÓN CONDICIONAL DEL BOTÓN REVIEWS (Solo si Blurting está activo)
        if (this.plugin.settings.addons && this.plugin.settings.addons["blurting-mode"]) {
            const tabReviews = controlsDiv.createEl("button", { 
                cls: this.currentTab === 'reviews' ? 'cornell-tab-active' : '', 
                title: "Spaced Repetition Reviews" 
            });
            
            // Estética Nativa (Icono Lucide + Texto)
            tabReviews.style.display = "flex";
            tabReviews.style.alignItems = "center";
            tabReviews.style.justifyContent = "center";
            tabReviews.style.gap = "5px";
            
            const iconSpan = tabReviews.createSpan();
            setIcon(iconSpan, "calendar-clock"); // 👈 Icono nativo de Obsidian
            tabReviews.createSpan({ text: "Reviews" });

            // La acción del clic ahora vive aquí, junto a su botón
            tabReviews.onclick = async () => { 
                this.currentTab = 'reviews'; 
                this.renderUI(); 
                this.applyFiltersAndRender(); 
            };
        } else if (this.currentTab === 'reviews') {
            // 🛡️ Seguro de vida: Si apagó el addon mientras estaba en esta pestaña, lo devolvemos a Current
            this.currentTab = 'current';
        }
        const actionControlsDiv = container.createDiv({ cls: 'cornell-sidebar-controls' });
        // 🧩 INYECCIÓN DEL ADDON DE BLURTING 
        // 👇 INYECCIÓN CONDICIONAL DEL BOTÓN BLURTING (Ahora con icono nativo)
        if (this.plugin.settings.addons && this.plugin.settings.addons["blurting-mode"]) {
            const btnBlurting = actionControlsDiv.createEl("button", { title: "Start Active Recall Session (1-3-7)" });
            btnBlurting.style.display = "flex";
            btnBlurting.style.alignItems = "center";
            btnBlurting.style.gap = "5px";
            
            setIcon(btnBlurting.createSpan(), "brain"); // 👈 Icono nativo de Lucide
            btnBlurting.createSpan({ text: "Blurt" });

            btnBlurting.onclick = () => {
            const deck = this.getCurrentFilteredDeck(); 
            if (deck.length === 0) {
                new Notice("⚠️ Your current deck is empty. Scan notes or adjust filters first.");
                return;
            }
            
            // 👈 AQUÍ EL ARREGLO: Pasamos 'this' justo en el medio
            new BlurtingSetupModal(this.plugin.app, this, deck).open();
        };
        }
        const btnStitch = actionControlsDiv.createEl("button", { text: "⛓︎ Stitch", title: "Connect two notes" });
        
        const btnGroup = actionControlsDiv.createEl("button", { 
            text: "🗁 Group", 
            title: "Group identical notes", 
            cls: this.isGroupedByContent ? 'cornell-tab-active' : '' 
        });
        
        const btnRefresh = actionControlsDiv.createEl("button", { text: "⟳", title: "Refresh data" });

        const filterContainer = container.createDiv({ cls: 'cornell-sidebar-filters' });
        // 👁️ OCULTAMIENTO CONTEXTUAL: Si estamos en el Board, la barra de búsqueda y los colores desaparecen
        if (this.currentTab === 'pinboard') {
            filterContainer.style.display = 'none';
            actionControlsDiv.style.display = 'none';
        }
        // Barra de búsqueda con icono nativo incrustado
     const searchWrapper = filterContainer.createDiv({ cls: 'cornell-search-wrapper' });
     const searchIconEl = searchWrapper.createSpan({ cls: 'cornell-search-icon' });
     setIcon(searchIconEl, 'search'); // Lupa nativa
     const searchInput = searchWrapper.createEl('input', { type: 'text', placeholder: 'Search notes...', cls: 'cornell-search-bar' });
        
        searchInput.value = this.searchQuery;
        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            this.applyFiltersAndRender(); 
        };

        // nuevo contenedor recientes
        const filtersRow = filterContainer.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-top: 8px;' } });

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

        // 🕒 2. BOTÓN ULTRA-RECIENTES (Hereda exactamente las propiedades de un color-pill)
        const recentBtn = pillsContainer.createEl('span', { cls: 'cornell-color-pill', title: "Recientes (Última hora)" });
        
        recentBtn.style.backgroundColor = this.isRecentFilterActive ? 'var(--interactive-accent)' : 'transparent';
        recentBtn.style.border = '1px solid var(--background-modifier-border)';
        recentBtn.style.color = this.isRecentFilterActive ? 'var(--text-on-accent)' : 'var(--text-muted)';
        recentBtn.style.cursor = 'pointer';

        // 🪄 EL SECRETO: Lo hacemos relativo para anclar el ícono, 
        // pero NO le ponemos flex ni modificamos su display nativo.
        recentBtn.style.position = 'relative';

        setIcon(recentBtn, 'clock'); 
        
        // 🪄 CENTRADO ABSOLUTO: Sacamos el SVG del flujo normal.
        // Así el botón se alinea idéntico a los círculos vacíos de color.
        const svg = recentBtn.querySelector('svg');
        if (svg) {
            svg.style.width = '14px'; 
            svg.style.height = '14px';
            svg.style.strokeWidth = '2.2'; // Un poquito más gordito para que resalte
            
            // Centrado mágico con CSS matemático
            svg.style.position = 'absolute';
            svg.style.top = '50%';
            svg.style.left = '50%';
            svg.style.transform = 'translate(-50%, -50%)';
        }

        recentBtn.onclick = async () => {
            this.isRecentFilterActive = !this.isRecentFilterActive;
            
            // Actualizamos la UI del botón al instante
            recentBtn.style.backgroundColor = this.isRecentFilterActive ? 'var(--interactive-accent)' : 'transparent';
            recentBtn.style.color = this.isRecentFilterActive ? 'var(--text-on-accent)' : 'var(--text-muted)';
            
            await this.scanNotes(); 
        };
// hasta acaaaaaaa
        // 📖 3. NUEVO BOTÓN: MODO SALTO DIRECTO PDF (El "Librito" - Ahora a la derecha)
        const directPdfBtn = pillsContainer.createEl('span', { cls: 'cornell-color-pill', title: "Direct PDF Mode" });
        
        directPdfBtn.style.backgroundColor = this.isDirectPdfModeActive ? 'var(--interactive-accent)' : 'transparent';
        directPdfBtn.style.border = '1px solid var(--background-modifier-border)';
        directPdfBtn.style.color = this.isDirectPdfModeActive ? 'var(--text-on-accent)' : 'var(--text-muted)';
        directPdfBtn.style.cursor = 'pointer';
        directPdfBtn.style.position = 'relative';

        setIcon(directPdfBtn, 'book'); 

        const pdfSvg = directPdfBtn.querySelector('svg');
        if (pdfSvg) {
            pdfSvg.style.width = '14px'; 
            pdfSvg.style.height = '14px';
            pdfSvg.style.strokeWidth = '2.2';
            pdfSvg.style.position = 'absolute';
            pdfSvg.style.top = '50%';
            pdfSvg.style.left = '50%';
            pdfSvg.style.transform = 'translate(-50%, -50%)';
        }

        directPdfBtn.onclick = () => {
            this.isDirectPdfModeActive = !this.isDirectPdfModeActive;
            
            // Actualizamos la UI del botón al instante
            directPdfBtn.style.backgroundColor = this.isDirectPdfModeActive ? 'var(--interactive-accent)' : 'transparent';
            directPdfBtn.style.color = this.isDirectPdfModeActive ? 'var(--text-on-accent)' : 'var(--text-muted)';
            
            new Notice(this.isDirectPdfModeActive ? "📖 Modo PDF Directo: Activado" : "📖 Modo PDF Directo: Desactivado");
        };

        // ⚡ 3.5 NUEVO BOTÓN: FILTRO DE FLASHCARDS (Solo ;;)
        const flashcardFilterBtn = pillsContainer.createEl('span', { cls: 'cornell-color-pill', title: "Show only Flashcards (;;)" });
        
        flashcardFilterBtn.style.backgroundColor = this.isFlashcardFilterActive ? 'var(--interactive-accent)' : 'transparent';
        flashcardFilterBtn.style.border = '1px solid var(--background-modifier-border)';
        flashcardFilterBtn.style.color = this.isFlashcardFilterActive ? 'var(--text-on-accent)' : 'var(--text-muted)';
        flashcardFilterBtn.style.cursor = 'pointer';
        flashcardFilterBtn.style.position = 'relative';

        setIcon(flashcardFilterBtn, 'layers'); 

        const fcSvg = flashcardFilterBtn.querySelector('svg');
        if (fcSvg) {
            fcSvg.style.width = '14px'; 
            fcSvg.style.height = '14px';
            fcSvg.style.strokeWidth = '2.2';
            fcSvg.style.position = 'absolute';
            fcSvg.style.top = '50%';
            fcSvg.style.left = '50%';
            fcSvg.style.transform = 'translate(-50%, -50%)';
        }

        flashcardFilterBtn.onclick = () => {
            this.isFlashcardFilterActive = !this.isFlashcardFilterActive;
            
            flashcardFilterBtn.style.backgroundColor = this.isFlashcardFilterActive ? 'var(--interactive-accent)' : 'transparent';
            flashcardFilterBtn.style.color = this.isFlashcardFilterActive ? 'var(--text-on-accent)' : 'var(--text-muted)';
            
            this.applyFiltersAndRender(); 
        };
        // 🧠 4. NUEVO BOTÓN: ACTIVE RECALL EN PDF
        const activeRecallPdfBtn = pillsContainer.createEl('span', { cls: 'cornell-color-pill', title: "Active Recall en PDF (Oculta los resaltados para repasar)" });
        
        activeRecallPdfBtn.style.backgroundColor = this.isActiveRecallPdfMode ? 'var(--color-purple)' : 'transparent';
        activeRecallPdfBtn.style.border = '1px solid var(--background-modifier-border)';
        activeRecallPdfBtn.style.color = this.isActiveRecallPdfMode ? 'white' : 'var(--text-muted)';
        activeRecallPdfBtn.style.cursor = 'pointer';
        activeRecallPdfBtn.style.position = 'relative';

        setIcon(activeRecallPdfBtn, 'brain-circuit'); 

        const arSvg = activeRecallPdfBtn.querySelector('svg');
        if (arSvg) {
            arSvg.style.width = '14px'; 
            arSvg.style.height = '14px';
            arSvg.style.strokeWidth = '2.2';
            arSvg.style.position = 'absolute';
            arSvg.style.top = '50%';
            arSvg.style.left = '50%';
            arSvg.style.transform = 'translate(-50%, -50%)';
        }

        // 🛡️ MEMORIA CACHÉ PARA EVITAR LAG
        let currentSyncChain: HTMLElement[] = [];

        activeRecallPdfBtn.onclick = () => {
            this.isActiveRecallPdfMode = !this.isActiveRecallPdfMode;
            
            activeRecallPdfBtn.style.backgroundColor = this.isActiveRecallPdfMode ? 'var(--color-purple)' : 'transparent';
            activeRecallPdfBtn.style.color = this.isActiveRecallPdfMode ? 'white' : 'var(--text-muted)';
            
            if (this.isActiveRecallPdfMode) {
                document.body.classList.add('cornell-pdf-active-recall');
                new Notice("🧠 Active Recall PDF: Activado (Pasa el ratón para revelar bloque completo)");

// --- 🪄 NUEVO MOTOR JS: ALGORITMO ESPACIAL CACHEADO ---
                (this as any).pdfHoverSync = (e: MouseEvent) => {
                    const target = e.target as HTMLElement;
                    if (!target || !target.matches) return;

                    // 🛑 ESCUDO ANTI-LAG: Si ya estamos iluminando este bloque, no re-calculamos nada
                    if (currentSyncChain.includes(target)) return;

                    if (target.matches('.pdf-plus-backlink, .rect-highlight, .pdf-highlight, .textLayer .highlight, .annotationLayer .highlight, .pdf-cropped-embed')) {
                        
                        // Limpiamos el grupo anterior antes de encender el nuevo
                        currentSyncChain.forEach(el => el.classList.remove('cornell-reveal-sync'));
                        currentSyncChain = [];

                        target.classList.add('cornell-reveal-sync');
                        currentSyncChain.push(target);

                        // 🛑 ESCUDO ANTI-CROP DEFINITIVO (Heurística de Altura)
                        // Si la caja mide más de 32px de alto, es un recorte de imagen. Cortamos la cadena aquí.
                        const isCrop = target.classList.contains('rect-highlight') || 
                                       target.closest('.pdf-cropped-embed') || 
                                       target.tagName.toLowerCase() === 'img' ||
                                       (target.classList.contains('pdf-plus-backlink') && target.getBoundingClientRect().height > 32);

                        if (isCrop) {
                            return; 
                        }

                        const page = target.closest('.page, .markdown-preview-view');
                        if (!page) return;

                        // 🧹 FILTRO: Agarramos solo las líneas de texto. 
                        // Ignoramos a los demás crops de la página para no saltar hacia ellos accidentalmente.
                        const allHighlights = Array.from(page.querySelectorAll('.pdf-plus-backlink, .pdf-highlight, .textLayer .highlight, .annotationLayer .highlight'))
                            .filter(el => {
                                const elIsCrop = el.classList.contains('rect-highlight') || 
                                                 el.closest('.pdf-cropped-embed') ||
                                                 (el.classList.contains('pdf-plus-backlink') && el.getBoundingClientRect().height > 32);
                                return !elIsCrop;
                            });
                        
                        const targetIdx = allHighlights.indexOf(target);
                        if (targetIdx === -1) return;

                        const targetColor = window.getComputedStyle(target).backgroundColor;

                        // Reacción hacia ARRIBA
                        for (let i = targetIdx - 1; i >= 0; i--) {
                            const el = allHighlights[i] as HTMLElement;
                            const prevEl = allHighlights[i + 1] as HTMLElement; 
                            
                            if (window.getComputedStyle(el).backgroundColor === targetColor && 
                                Math.abs(el.getBoundingClientRect().bottom - prevEl.getBoundingClientRect().top) < 45) {
                                el.classList.add('cornell-reveal-sync');
                                currentSyncChain.push(el);
                            } else {
                                break; 
                            }
                        }

                        // Reacción hacia ABAJO
                        for (let i = targetIdx + 1; i < allHighlights.length; i++) {
                            const el = allHighlights[i] as HTMLElement;
                            const prevEl = allHighlights[i - 1] as HTMLElement;
                            
                            if (window.getComputedStyle(el).backgroundColor === targetColor && 
                                Math.abs(el.getBoundingClientRect().top - prevEl.getBoundingClientRect().bottom) < 45) {
                                el.classList.add('cornell-reveal-sync');
                                currentSyncChain.push(el);
                            } else {
                                break;
                            }
                        }
                    }
                };

                (this as any).pdfMouseOutSync = (e: MouseEvent) => {
                    const related = e.relatedTarget as HTMLElement;
                    // 🛑 ESCUDO ANTI-LAG: Si el ratón se mueve a otra línea del MISMO párrafo, no apagamos la luz
                    if (related && currentSyncChain.includes(related)) return;

                    currentSyncChain.forEach(el => el.classList.remove('cornell-reveal-sync'));
                    currentSyncChain = [];
                };

                document.body.addEventListener('mouseover', (this as any).pdfHoverSync);
                document.body.addEventListener('mouseout', (this as any).pdfMouseOutSync);

            } else {
                document.body.classList.remove('cornell-pdf-active-recall');
                new Notice("🧠 Active Recall PDF: Desactivado");
                
                if ((this as any).pdfHoverSync) document.body.removeEventListener('mouseover', (this as any).pdfHoverSync);
                if ((this as any).pdfMouseOutSync) document.body.removeEventListener('mouseout', (this as any).pdfMouseOutSync);
                currentSyncChain.forEach(el => el.classList.remove('cornell-reveal-sync'));
                currentSyncChain = [];
            }
        };

        // 📁 3. BOTÓN DE CARPETAS (Solo visible en Vault)
        const folderBtn = pillsContainer.createEl('span', { cls: 'cornell-color-pill', title: "Agrupar por Carpetas y Archivos" });
        
        folderBtn.style.backgroundColor = this.isGroupedByFolder ? 'var(--interactive-accent)' : 'transparent';
        folderBtn.style.border = '1px solid var(--background-modifier-border)';
        folderBtn.style.color = this.isGroupedByFolder ? 'var(--text-on-accent)' : 'var(--text-muted)';
        folderBtn.style.cursor = 'pointer';
        folderBtn.style.position = 'relative';
        
        // 👁️ La magia condicional: Solo existe visualmente si estamos en 'vault'
        folderBtn.style.display = this.currentTab === 'vault' ? 'inline-block' : 'none';

        setIcon(folderBtn, 'folder-tree'); // Ícono nativo de carpetas
        
        const fSvg = folderBtn.querySelector('svg');
        if (fSvg) {
            fSvg.style.width = '14px'; 
            fSvg.style.height = '14px';
            fSvg.style.strokeWidth = '2.2';
            fSvg.style.position = 'absolute';
            fSvg.style.top = '50%'; 
            fSvg.style.left = '50%';
            fSvg.style.transform = 'translate(-50%, -50%)';
        }

        folderBtn.onclick = () => {
            this.isGroupedByFolder = !this.isGroupedByFolder;
            
            // Actualizamos la UI del botón al instante
            folderBtn.style.backgroundColor = this.isGroupedByFolder ? 'var(--interactive-accent)' : 'transparent';
            folderBtn.style.color = this.isGroupedByFolder ? 'var(--text-on-accent)' : 'var(--text-muted)';
            
            this.applyFiltersAndRender(); 
        };

        container.createDiv({ cls: 'cornell-stitch-banner', text: '' }).style.display = 'none';
        // hasta acaaaaaaaa!!!!
        container.createDiv({ cls: 'cornell-stitch-banner', text: '' }).style.display = 'none';
        container.createDiv({ cls: 'cornell-sidebar-content' });

        tabCurrent.onclick = async () => { this.currentTab = 'current'; this.renderUI(); await this.scanNotes(); };
        tabVault.onclick = async () => { this.currentTab = 'vault'; this.renderUI(); await this.scanNotes(); };
        tabThreads.onclick = async () => { this.currentTab = 'threads'; this.renderUI(); await this.scanNotes(); };
        tabPinboard.onclick = async () => { this.currentTab = 'pinboard'; this.renderUI(); this.applyFiltersAndRender(); };
        btnRefresh.onclick = async () => { 
            new Notice("Scanning & Syncing..."); 
            await this.scanNotes(); 
            // 🚀 Solo llama a TaskNotes si el usuario tiene la opción activada
            if (this.plugin.settings.enableTaskNotesIntegration) {
                await this.syncTasksFromTaskNotes();
            }
        };

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



    // 🚀 SALTO RÁPIDO A LA LISTA CON FLECHA ABAJO
        // 🚀 SALTO RÁPIDO A LA LISTA CON FLECHA ABAJO
        (container as HTMLElement).addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                const activeEl = document.activeElement as HTMLElement;
                // Si el usuario YA está navegando en la lista de notas, no interrumpimos el movimiento normal
                if (activeEl && (activeEl.classList.contains('cornell-sidebar-item') || activeEl.classList.contains('cornell-pinboard-item'))) return;

                // Si está en el buscador o en cualquier otro lado del panel, forzamos el salto a la primera nota
                e.preventDefault();
                const firstItem = container.querySelector('.cornell-sidebar-item, .cornell-pinboard-item') as HTMLElement;
                if (firstItem) firstItem.focus();
            }
        });

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
    // 🗄️ UI DEL CAJÓN DESLIZANTE (OMNI-CAPTURE)
    // ⚡ OMNI-CAPTURE TOP BAR (DISEÑO PERSISTENTE)
    // ⚡ OMNI-CAPTURE BAR (DISEÑO MUTANTE CONTEXTUAL)
    renderQuickCapture(parent: HTMLElement) {
        const qcContainer = parent.createDiv({ cls: 'cornell-quick-capture' });

        if (this.currentTab === 'pinboard') {
            // 📌 ESTADO 2: MODO "CORCHO" (Pinboard)
            const topRow = qcContainer.createDiv({ cls: 'cornell-qc-toprow' });
            topRow.style.justifyContent = 'center'; // Centramos el texto para que se vea elegante
            
            // 🎨 ICONO: Tablero en lugar de 📍
            const destLabel = topRow.createSpan({ cls: 'cornell-qc-label' });
            destLabel.style.display = 'flex'; destLabel.style.alignItems = 'center'; destLabel.style.gap = '4px';
            setIcon(destLabel, 'layout-dashboard');
            destLabel.createSpan({ text: 'Active Board' });

            const bottomRow = qcContainer.createDiv({ cls: 'cornell-qc-bottomrow' });
            this.sliderIdeaInput = bottomRow.createEl('textarea', { placeholder: 'Add text (# for titles, - for children)' });
            this.sliderIdeaInput.classList.add('cornell-qc-textarea');
            // 🏷️ Encender el Auto-Completado en el Board
            new TagSuggester(this.plugin.app, this.sliderIdeaInput);

            // 🎨 ICONO: Plus en lugar de ➕
            const submitBtn = bottomRow.createEl('button', { title: 'Add to Board (Enter)' });
            submitBtn.classList.add('cornell-qc-submit');
            setIcon(submitBtn, 'plus');
            
            // Replicamos la magia de los guiones y la inserción contextual aquí
            const addAction = () => {
                const val = this.sliderIdeaInput.value.trim();
                if (val) {
                    let newItem: MarginaliaItem;
                    let isManualHyphen = false;

                    if (val.startsWith('#')) {
                        newItem = { text: val, rawText: val, color: 'transparent', file: null as any, line: -1, blockId: null, outgoingLinks: [], isTitle: true };
                    } else {
                        const dashMatch = val.match(/^(-+)\s*(.*)/);
                        let cleanText = val;
                        let manualIndent = 0;
                        if (dashMatch) { isManualHyphen = true; manualIndent = dashMatch[1].length; cleanText = dashMatch[2] || "Empty node"; }
                        newItem = { text: cleanText, rawText: cleanText, color: 'transparent', file: null as any, line: -1, blockId: null, outgoingLinks: [], isCustom: true, indentLevel: manualIndent };
                    }

                    if (this.targetInsertIndex !== null && this.targetInsertIndex >= 0) {
                        if (!newItem.isTitle && !isManualHyphen) {
                            const parentIndent = this.pinboardItems[this.targetInsertIndex].indentLevel || 0;
                            newItem.indentLevel = this.targetInsertAsChild ? parentIndent + 1 : parentIndent;
                        }
                        this.pinboardItems.splice(this.targetInsertIndex + 1, 0, newItem);
                        this.targetInsertIndex = null;
                    } else {
                        this.pinboardItems.push(newItem);
                    }

                    this.sliderIdeaInput.value = '';
                    this.applyFiltersAndRender(); 
                    
                    setTimeout(() => { if (this.sliderIdeaInput) this.sliderIdeaInput.focus(); }, 50);
                }
            };

            submitBtn.onclick = addAction;
            // Atajo para disparar con Enter (sin Shift)
            this.sliderIdeaInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addAction(); }
            });

        } else {
            // 📝 ESTADO 1: MODO "LECTURA" (CEREBRO OMNI-CAPTURE RESTAURADO)
            const topRow = qcContainer.createDiv({ cls: 'cornell-qc-toprow' });
            
            const destLabel = topRow.createSpan({ cls: 'cornell-qc-label' });
            destLabel.style.display = 'flex'; destLabel.style.alignItems = 'center'; destLabel.style.gap = '4px';
            setIcon(destLabel, 'inbox');
            destLabel.createSpan({ text: 'Dest:' });
            
            this.sliderDestInput = topRow.createEl('input', { type: 'text', placeholder: 'Inbox...' });
            this.sliderDestInput.value = this.plugin.settings.lastOmniDestination || "Marginalia Inbox";
            this.sliderDestInput.classList.add('cornell-qc-dest');

            // Autocompletado de bóveda (igual que tu viejo modal)
            const datalistId = "sidebar-omni-vault-files";
            let datalist = document.getElementById(datalistId) as HTMLDataListElement;
            if (!datalist) {
                datalist = document.body.createEl("datalist", { attr: { id: datalistId } });
            } else { datalist.empty(); }
            this.app.vault.getMarkdownFiles().forEach(f => datalist.createEl("option", { value: f.basename }));
            this.sliderDestInput.setAttribute("list", datalistId);
            
            // 🗃️ BOTÓN ZK (Interruptor con memoria)
            const zkBtn = topRow.createEl('button', { title: 'Toggle Zettelkasten Mode' });
            zkBtn.classList.add('cornell-qc-btn');
            zkBtn.style.display = 'flex'; zkBtn.style.alignItems = 'center'; zkBtn.style.gap = '4px';
            setIcon(zkBtn, 'fingerprint');
            zkBtn.createSpan({ text: 'ZK' });

            const updateZkUI = () => {
                if (this.plugin.settings.zkMode) {
                    zkBtn.style.color = "var(--color-green)";
                    zkBtn.style.backgroundColor = "var(--background-modifier-hover)";
                    zkBtn.style.borderColor = "var(--color-green)";
                } else {
                    zkBtn.style.color = "var(--text-muted)";
                    zkBtn.style.backgroundColor = "transparent";
                    zkBtn.style.borderColor = "var(--background-modifier-border)";
                }
            };
            updateZkUI(); // Pintar el estado inicial

            zkBtn.onclick = async () => {
                this.plugin.settings.zkMode = !this.plugin.settings.zkMode;
                await this.plugin.saveSettings();
                updateZkUI();
                new Notice(this.plugin.settings.zkMode ? "🗃️ ZK Mode: ON (Will create new notes)" : "🗃️ ZK Mode: OFF (Will append to Destination)");
                this.sliderIdeaInput.focus();
            };

            const clearCtxBtn = topRow.createEl('button', { title: 'Clear Clipboard & Memory' });
            clearCtxBtn.classList.add('cornell-qc-btn');
            clearCtxBtn.style.display = 'flex'; clearCtxBtn.style.alignItems = 'center'; clearCtxBtn.style.gap = '4px';
            setIcon(clearCtxBtn, 'eraser');
            clearCtxBtn.createSpan({ text: 'Clear' });
            clearCtxBtn.onclick = async () => { 
                await navigator.clipboard.writeText('');
                CornellNotesView.lastCapturedContext = "";
                CornellNotesView.lastCapturedImageLength = 0;
                this.pendingClipboardImageData = null;
                this.pendingDoodleData = null;
                doodleBtn.style.color = "var(--text-muted)"; // Resetea el color del doodle
                new Notice("🧹 Clipboard & Memory cleared!"); 
            };

            const doodleBtn = topRow.createEl('button', { title: 'Attach Doodle' });
            doodleBtn.classList.add('cornell-qc-btn');
            doodleBtn.style.display = 'flex'; doodleBtn.style.alignItems = 'center'; doodleBtn.style.gap = '4px';
            setIcon(doodleBtn, 'palette');
            doodleBtn.createSpan({ text: 'Doodle' });
            
            // 🎨 BOTÓN DOODLE: Solo le pide al cerebro que abra el modal
            doodleBtn.onclick = async () => { 
                const result = await this.plugin.captureManager.openDoodle();
                this.pendingDoodleData = result.data;
                doodleBtn.style.color = "var(--color-green)"; 
                
                if (result.isInstant) {
                    executeSave(); // Guardado automático
                } else {
                    new Notice("🎨 Doodle attached! Press ⚡ to save.");
                }
            };

            const bottomRow = qcContainer.createDiv({ cls: 'cornell-qc-bottomrow' });
            this.sliderIdeaInput = bottomRow.createEl('textarea', { placeholder: '💡 Your Idea (Auto-paste enabled)...' });
            this.sliderIdeaInput.classList.add('cornell-qc-textarea');
            // 🏷️ Encender el Auto-Completado en Captura Rápida
            new TagSuggester(this.plugin.app, this.sliderIdeaInput);
            
            this.sliderIdeaInput.addEventListener("paste", async (e: ClipboardEvent) => {
                if (!e.clipboardData) return;
                const items = e.clipboardData.items;
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf("image") !== -1) {
                        const blob = items[i].getAsFile();
                        if (blob) {
                            this.pendingClipboardImageData = await blob.arrayBuffer();
                            this.pendingClipboardImageExt = blob.type.split('/')[1] || 'png';
                            new Notice("🖼️ Image attached to capture!");
                        }
                    }
                }
            });

            const submitBtn = bottomRow.createEl('button', { title: 'Save Capture (Ctrl+Enter)' });
            submitBtn.classList.add('cornell-qc-submit');
            setIcon(submitBtn, 'zap');

            // 🧠 EL NUEVO PUENTE (Las manos hablan con el cerebro)
            const executeSave = async () => {
                const payload = {
                    thought: this.sliderIdeaInput.value.trim(),
                    destination: this.sliderDestInput.value.trim() || "Marginalia Inbox",
                    doodleData: this.pendingDoodleData
                };

                try {
                    // 1. Mandamos procesar el disco al Cerebro
                    await this.plugin.captureManager.saveCapture(payload, this.pendingClipboardImageData, this.pendingClipboardImageExt);
                    
                    // 2. Si el cerebro tuvo éxito, LA VISTA se encarga de la UI y los Puntos XP
                    if (this.plugin.settings.addons && this.plugin.settings.addons["gamification-profile"]) {
                        this.plugin.gamificationAddon.addXp();
                        this.renderUI(); 
                    }

                    // 3. Limpiamos la UI
                    this.sliderIdeaInput.value = '';
                    let cleanDestName = payload.destination.replace(/^\d{12,14}\s*-\s*/, '').trim() || "Marginalia Inbox";
                    this.sliderDestInput.value = cleanDestName;
                    
                    this.pendingDoodleData = null;
                    this.pendingClipboardImageData = null;
                    doodleBtn.style.color = "var(--text-muted)";
                    this.applyFiltersAndRender();

                } catch (e) {
                    // El error visual ya fue notificado por el Cerebro
                }
            };

            submitBtn.onclick = executeSave;
            this.sliderIdeaInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    executeSave();
                }
            });

            
        }
    }
    // 🧠 HELPER: Captura el estado actual de la vista respetando los filtros
    getCurrentFilteredDeck(): MarginaliaItem[] {
        const isFilterActive = this.searchQuery.length > 0 || this.activeColorFilters.size > 0 || this.isRecentFilterActive;
        
        const matchesFilter = (item: MarginaliaItem) => {
            const matchesSearch = item.text.toLowerCase().includes(this.searchQuery) || item.file.basename.toLowerCase().includes(this.searchQuery);
            
            // ⚡ Si estamos en Recientes, ignoramos qué colores estén cliqueados
            const matchesColor = this.isRecentFilterActive || this.activeColorFilters.size === 0 || this.activeColorFilters.has(item.color);
            
            // ⚡ LÓGICA ULTRA-RECIENTE
            const FRESHNESS_WINDOW_MS = 3600000; 
            const matchesRecent = !this.isRecentFilterActive || (item.file && (Date.now() - item.file.stat.mtime < FRESHNESS_WINDOW_MS));
            
            // ⚡ LÓGICA DE FLASHCARDS
            const matchesFlashcard = !this.isFlashcardFilterActive || item.rawText.includes(';;');

            return matchesSearch && matchesColor && matchesRecent && matchesFlashcard;
        };

        return this.cachedItems.filter(matchesFilter);
    }

// 🚀 MOTOR DE SINCRONIZACIÓN ON-DEMAND (Cero lag, cero background)
    async syncTasksFromTaskNotes() {
        if (!this.plugin.settings.enableTaskNotesIntegration) return;
        
        const { port, token } = await this.plugin.getTaskNotesConfig();
        try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;

            // Pedimos las últimas 200 tareas a TaskNotes
            const response = await fetch(`http://localhost:${port}/api/tasks?limit=200`, { headers });
            if (!response.ok) return;
            
            const data = await response.json();
            if (!data.success || !data.data || !data.data.tasks) return;

            const tnTasks = data.data.tasks;
            
            // Filtramos las marginalias locales que AÚN están pendientes [- [ ]]
            const localTasks = this.cachedItems.filter(item => item.text.match(/^-\s*\[ \]\s+(.*)/));
            let syncedCount = 0;

            const filesToMutate = new Map<TFile, any[]>();

            for (const localTask of localTasks) {
                const match = localTask.text.match(/^-\s*\[ \]\s+(.*)/);
                if (!match) continue;
                
                const rawTitle = match[1];
                const cleanTitle = this.cleanExportText(rawTitle); // El mismo texto limpio que enviamos

                // Buscamos si existe en TaskNotes por el título purificado
                const remoteTask = tnTasks.find((t: any) => t.title === cleanTitle || t.title.includes(cleanTitle));
                
                // Verificamos si en TaskNotes ya fue marcada como lista
                const isCompletedRemotely = remoteTask && (remoteTask.completed === true || remoteTask.status === 'done' || remoteTask.status === 'completed' || remoteTask.status === 'x');

                if (isCompletedRemotely) {
                    if (!filesToMutate.has(localTask.file)) filesToMutate.set(localTask.file, []);
                    filesToMutate.get(localTask.file)!.push(localTask);
                    syncedCount++;
                }
            }

            if (syncedCount > 0) {
                for (const [file, items] of filesToMutate.entries()) {
                    await this.plugin.app.vault.process(file, (content) => {
                        const lines = content.split('\n');
                        for (const item of items) {
                            if (item.line >= 0 && item.line < lines.length) {
                                // 💥 Replicamos la misma lógica (Destruir o Marcar con 'x')
                                if (this.plugin.settings.deleteCompletedTasks) {
                                    const escapedRaw = item.rawText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                                    const fullMarginaliaRegex = new RegExp(`%%[><]\\s*${escapedRaw}\\s*%%`, 'g');
                                    if (fullMarginaliaRegex.test(lines[item.line])) {
                                        lines[item.line] = lines[item.line].replace(fullMarginaliaRegex, '');
                                    } else {
                                        lines[item.line] = lines[item.line].replace(item.rawText, '');
                                    }
                                } else {
                                    const newRaw = item.rawText.replace(/-\s*\[ \]/, `- [x]`);
                                    lines[item.line] = lines[item.line].replace(item.rawText, newRaw);
                                }
                            }
                        }
                        return lines.join('\n');
                    });
                }
                new Notice(`🔄 Synced ${syncedCount} task(s) completed in TaskNotes!`);
                await this.scanNotes();
            } else {
                new Notice("✅ Tasks are up to date with TaskNotes.");
            }

        } catch (e) {
            console.log("TaskNotes sync bypass (Server likely off):", e);
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

        const allItemsFlat: MarginaliaItem[] = []; 
        const defaultColor = 'var(--text-accent)'; 

        let filesToScan: TFile[] = [];
        
        // 🧠 RESET ZOTLIKE
        this.isZotlikeMode = false;
        this.activePdfName = "";
        let activePdfBasename = "";

        // 1. OBTENER ARCHIVOS SEGÚN EL CONTEXTO (Current o Vault)
        if (this.currentTab === 'current') {
            const activeFile = this.plugin.app.workspace.getActiveFile();
            if (activeFile) {
                if (activeFile.extension.toLowerCase() === 'pdf') {
                    // 🎯 DETECCIÓN ZOTLIKE ACTIVADA
                    this.isZotlikeMode = true;
                    this.activePdfName = activeFile.name;
                    activePdfBasename = activeFile.basename;
                    
                    filesToScan = this.plugin.app.vault.getMarkdownFiles();
                    const ignoredPaths = this.plugin.settings.ignoredFolders.split(',').map(s => s.trim()).filter(s => s.length > 0);
                    filesToScan = filesToScan.filter(f => !ignoredPaths.some(p => f.path.startsWith(p)));
                } else {
                    // Si es una nota MD normal, SOLO escaneamos esta nota
                    filesToScan.push(activeFile);
                }
            } else {
                contentDiv.createEl('p', { text: 'No active file.', cls: 'cornell-sidebar-empty' });
                return;
            }
        } else {
            // Pestaña Vault: Escaneamos todo
            filesToScan = this.plugin.app.vault.getMarkdownFiles();
            const ignoredPaths = this.plugin.settings.ignoredFolders.split(',').map(s => s.trim()).filter(s => s.length > 0);
            filesToScan = filesToScan.filter(f => !ignoredPaths.some(p => f.path.startsWith(p)));
        }

        // 🚀 2. INTERCEPTOR MODO RECIENTE: Ordenar y limitar SOLO la lista que ya respeta el contexto
        if (this.isRecentFilterActive) {
            // Ordenamos los archivos válidos por fecha (los más nuevos primero)
            filesToScan = filesToScan.sort((a, b) => b.stat.mtime - a.stat.mtime);
            
            // Si NO es un PDF (Zotlike), podemos cortar la lista a 5 archivos de forma segura para ahorrar memoria
            if (!this.isZotlikeMode) {
                filesToScan = filesToScan.slice(0, 5);
            }
        }

        const baseEncoded = activePdfBasename.replace(/ /g, '%20');
        const nameEncoded = this.activePdfName.replace(/ /g, '%20');
        
        let zotlikeFilesProcessed = 0;

        for (const file of filesToScan) {
            // 🎯 EL FILTRO ZOTLIKE DEFINITIVO
            if (this.isZotlikeMode) {
                const fullContent = await this.plugin.app.vault.cachedRead(file);
                if (!fullContent.includes(this.activePdfName) && 
                    !fullContent.includes(nameEncoded) && 
                    !fullContent.includes(`[[${activePdfBasename}`) && 
                    !fullContent.includes(`[[${baseEncoded}`)) {
                    continue; 
                }

                // En modo Zotlike Reciente, si ya encontramos 5 archivos vinculados al PDF válidos, detenemos el escaneo
                if (this.isRecentFilterActive) {
                    zotlikeFilesProcessed++;
                    if (zotlikeFilesProcessed > 5) break;
                }
            }

            let itemsToPush: MarginaliaItem[] = [];

            // 🚀 1. CONSULTAR CACHÉ (Acelerador)
            const cachedData = this.vaultCache.get(file.path);
            if (cachedData && cachedData.mtime === file.stat.mtime) {
                itemsToPush = cachedData.items;
            } else {
                // 🐢 2. LECTURA Y EXTRACCIÓN
                const content = await this.plugin.app.vault.cachedRead(file);
                const lines = content.split('\n');
                const fileItems: MarginaliaItem[] = []; 
                
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const lineRegex = /%%[><](.*?)%%/g;
                    let match;

                    while ((match = lineRegex.exec(line)) !== null) {
                        let noteContent = match[1].trim();

                        // 1. Limpieza universal del ID fantasma (para que la nueva sintaxis se vea limpia en el sidebar)
                        let tempNoteContent = noteContent.replace(/\s*\^([a-zA-Z0-9]+)\s*$/, '').trim();

                        // 2. Detección simple de Flashcard
                        if (tempNoteContent.includes(';;')) {
                            tempNoteContent = tempNoteContent.replace(";;", "").replace(/\s{2,}/g, ' ').trim();
                        }

                        const rawTextForStitching = noteContent; // Intacto para el cosido
                        let cleanText = tempNoteContent;

                        let matchedColor = defaultColor;
                        for (const tag of this.plugin.settings.tags) {
                            if (cleanText.startsWith(tag.prefix)) {
                                matchedColor = tag.color;
                                cleanText = cleanText.substring(tag.prefix.length).trim();
                                break;
                            }
                        }

                        cleanText = cleanText.replace(/img:\s*\[\[(.*?)\]\]/gi, '![[$1]]').trim();

                        const linkRegex = /(?<!!)\[\[(.*?)\]\]/g;
                        const outgoingLinks: string[] = [];
                        const linkMatches = Array.from(cleanText.matchAll(linkRegex));
                        linkMatches.forEach(m => outgoingLinks.push(m[1]));
                        cleanText = cleanText.replace(linkRegex, '').trim();

                        if (cleanText.length === 0) continue;

                        // 🛡️ ESCÁNER UNIVERSAL DE IDs: Atrapa tanto la vieja sintaxis (afuera) como la nueva (adentro)
                        const blockIdMatch = line.match(/\^([a-zA-Z0-9]+)(?:\s*%%)?\s*$/);
                        const existingBlockId = blockIdMatch ? blockIdMatch[1] : null;

                       // 🕵️‍♂️ PRE-CALCULAR CITATION (CONTEXTO) PARA MEMORIA RAM
                        let startLine = i;
                        let endLine = i;
                        let textWithoutMarginalia = lines[i].replace(/%%[><](.*?)%%/g, '').trim();
                        textWithoutMarginalia = textWithoutMarginalia.replace(/\^[a-zA-Z0-9_-]+$/, '').trim();

                        let isTargetingCallout = false;

                        if (lines[i].trim().startsWith('>')) {
                            // Caso 1: La marginalia está DENTRO del Callout
                            isTargetingCallout = true;
                        } else if (textWithoutMarginalia === '') {
                            // Caso 2: La marginalia está SOLA. Miramos si abajo hay un Callout.
                            let nextIdx = i + 1;
                            while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
                            if (nextIdx < lines.length && lines[nextIdx].trim().startsWith('>')) {
                                isTargetingCallout = true;
                                startLine = nextIdx;
                                endLine = nextIdx;
                            }
                        }

                        // Expandimos los límites
                        if (isTargetingCallout) {
                            // Atrapamos TODO el Callout (sube y baja por los '>')
                            while (startLine > 0 && lines[startLine - 1].trim().startsWith('>')) startLine--;
                            while (endLine < lines.length - 1 && lines[endLine + 1].trim().startsWith('>')) endLine++;
                        } else {
                            // Caso 3: Prosa. Expandimos hasta encontrar un salto de línea vacío o un Callout.
                            while (startLine > 0 && lines[startLine - 1].trim() !== '' && !lines[startLine - 1].trim().startsWith('>')) startLine--;
                            while (endLine < lines.length - 1 && lines[endLine + 1].trim() !== '' && !lines[endLine + 1].trim().startsWith('>')) endLine++;
                        }

                        let fullContext = "";
                        for (let j = startLine; j <= endLine; j++) {
                            let cleanLine = lines[j].replace(/%%[><](.*?)%%/g, '').trim();
                            cleanLine = cleanLine.replace(/\^[a-zA-Z0-9_-]+$/, '').trim();
                            if (cleanLine) fullContext += `${cleanLine}\n`;
                        }

                        const finalContext = fullContext.trim();

                        fileItems.push({
                            text: cleanText,
                            rawText: rawTextForStitching,
                            color: matchedColor,
                            file: file,
                            line: i,
                            blockId: existingBlockId,
                            outgoingLinks: outgoingLinks,
                            context: finalContext // 👈 Contexto perfecto, respeta los saltos de línea.
                        });
                    }
                }
                
                // 💾 3. GUARDAR EN MEMORIA (El array en su orden original, sin alterar)
                this.vaultCache.set(file.path, { mtime: file.stat.mtime, items: fileItems });
                itemsToPush = fileItems;
            }

            // 🚀 ORDENAMIENTO INTELIGENTE PARA NOTAS FRESCAS
            // Invertimos SOLO la copia que va a la UI. El caché queda a salvo.
            if (this.isRecentFilterActive) {
                allItemsFlat.push(...[...itemsToPush].reverse()); 
            } else {
                allItemsFlat.push(...itemsToPush);
            }
        }
        
        // 🌉 EL PUENTE 
        this.cachedItems = allItemsFlat; 
        this.applyFiltersAndRender();
    }

    applyFiltersAndRender() {
        if (this.isBlurtingActive) {
            // Ya inyectamos el canvas directo en renderUI() de forma 100% segura. 
            // Solo detenemos el flujo para que no intente cargar ni pisar notas.
            return; 
        }
        // 🧹 CAZAFANTASMAS 1: Destruye cualquier tooltip huérfano antes de redibujar la barra
        document.querySelectorAll('.cornell-hover-tooltip').forEach(el => el.remove());
        const contentDiv = this.containerEl.querySelector('.cornell-sidebar-content') as HTMLElement;
        if (!contentDiv) return;
    

        if (this.currentTab === 'pinboard') {
            this.renderPinboardTab(contentDiv);
            return;
        }
        if (this.currentTab === 'reviews') {
            this.renderReviewsTab(contentDiv);
            return;
        }

        const isFilterActive = this.searchQuery.length > 0 || this.activeColorFilters.size > 0 || this.isFlashcardFilterActive;

        const matchesFilter = (item: MarginaliaItem) => {
            const matchesSearch = item.text.toLowerCase().includes(this.searchQuery) || item.file.basename.toLowerCase().includes(this.searchQuery);
            const matchesColor = this.activeColorFilters.size === 0 || this.activeColorFilters.has(item.color);
            const matchesFlashcard = !this.isFlashcardFilterActive || item.rawText.includes(';;');
            return matchesSearch && matchesColor && matchesFlashcard;
        };

       if (this.currentTab === 'threads') {
            contentDiv.empty(); // Limpiamos la pantalla una sola vez al inicio

            // 🔗 2. RENDERIZAR HILOS SEMÁNTICOS
            const threadsWrapper = contentDiv.createDiv();
            threadsWrapper.createEl("h5", { 
                text: "🔗 Semantic Threads", 
                attr: { style: "margin: 0 0 10px 0; color: var(--text-muted); text-transform: uppercase; font-size: 0.8em; letter-spacing: 1px;" }
            });

            // 1. Identificamos a todas las "Hijas" (notas a las que alguien más apunta)
            const allTargetIds = new Set<string>();
            this.cachedItems.forEach(item => {
                item.outgoingLinks.forEach(l => {
                    const parts = l.split('#^');
                    if (parts.length === 2) allTargetIds.add(parts[1]);
                });
            });

            if (!isFilterActive) {
                // ==========================================
                // 🧠 MOTOR ZETTELKASTEN: DETECCIÓN DE RAÍCES
                // ==========================================
                const rootItems = this.cachedItems.filter(item => {
                    // ¿Es hija? Si alguien le apunta, nunca es la raíz principal.
                    const isChild = item.blockId && allTargetIds.has(item.blockId);
                    if (isChild) return false;

                    // ¿Es padre? (¿Tiene enlaces [[...]] hacia otras notas?)
                    const isParent = item.outgoingLinks.length > 0;

                    // ¿Tiene tag estructural? (ej: #abuelo)
                    const hasTag = /#([a-zA-Z0-9_/-]+)/.test(item.text);

                    // 🎯 TUS 4 REGLAS EXACTAS:
                    // 1. Tiene hijos y tiene tag -> ENTRA (isParent cumple)
                    // 2. Tiene hijos y NO tiene tag -> ENTRA a Untagged (isParent cumple)
                    // 3. Está sola y tiene tag -> ENTRA (hasTag cumple)
                    // 4. Está sola y NO tiene tag -> FANTASMA. DESCARTADA.
                    return isParent || hasTag;
                });

                // Mandamos las raíces al ensamblador de cajas
                this.renderThreads(rootItems, threadsWrapper, false);
            } else {
                const matchingItems = this.cachedItems.filter(matchesFilter);
                const topLevelMatches = matchingItems.filter(item => {
                    const isChildOfAnotherMatch = matchingItems.some(parent => item.blockId && parent.outgoingLinks.some(link => link.includes(`#^${item.blockId}`)));
                    return !isChildOfAnotherMatch;
                });
                
                // 🛡️ En modo búsqueda, también filtramos la basura
                const zettelTopLevelMatches = topLevelMatches.filter(item => {
                    const isChild = item.blockId && allTargetIds.has(item.blockId);
                    const isParent = item.outgoingLinks.length > 0;
                    const hasTag = /#([a-zA-Z0-9_/-]+)/.test(item.text);
                    
                    // Si el usuario busca algo, le mostramos si cumple las reglas,
                    // o si es una Hija que hizo match directo (y su padre no).
                    // Los "Fantasmas" (solas y sin tag) siguen sin aparecer aquí.
                    return isParent || hasTag || isChild; 
                });

                this.renderThreads(zettelTopLevelMatches, threadsWrapper, true);
            }
        } else {
            // 🛡️ TODO LO DE ABAJO ESTÁ 100% INTACTO A TU VERSIÓN ORIGINAL
            const filtered = this.cachedItems.filter(matchesFilter);
            
            // ⚡ 1. MODO RECIENTES: Ignora la agrupación por color y junta todo en un solo Feed
            if (this.isRecentFilterActive) {
                const recentResults: Record<string, MarginaliaItem[]> = {
                    'transparent': filtered // Usamos 'transparent' para que no le pinte el borde al grupo
                };
                this.renderResults(recentResults, contentDiv);
            } 
            // 📁 2. MODO AGRUPADO POR CARPETAS (Solo activo en Vault)
            else if (this.currentTab === 'vault' && this.isGroupedByFolder) {
                this.renderFolderTree(filtered, contentDiv, isFilterActive); // ✅ El nombre correcto
            }
            // 3. MODO AGRUPADO POR CONTENIDO
            else if (this.isGroupedByContent) {
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
        

        // 🧠 INTERCEPTOR ZEN: Si estamos en modo Zen, cortamos aquí y dibujamos el lienzo.
        if (this.isZenMode) {
            this.renderZenDoodle(container);
            return; 
        }
        // 🪄 LA ALFOMBRA: Contenedor desechable que muere limpiamente en cada redibujado
        const boardCanvas = container.createDiv();
        boardCanvas.style.minHeight = '100%';
        boardCanvas.style.display = 'flex';
        boardCanvas.style.flexDirection = 'column';
        
        boardCanvas.addEventListener('dragenter', (e) => { if (OmniDragManager.payload) e.preventDefault(); });
        boardCanvas.addEventListener('dragover', (e) => {
            if (OmniDragManager.payload) {
                e.preventDefault(); 
                boardCanvas.style.boxShadow = 'inset 0 0 10px rgba(var(--interactive-accent-rgb), 0.3)';
            }
        });
        boardCanvas.addEventListener('dragleave', () => { boardCanvas.style.boxShadow = 'none'; });
        boardCanvas.addEventListener('drop', (e) => {
            boardCanvas.style.boxShadow = 'none';
            if (OmniDragManager.payload) {
                e.preventDefault(); e.stopPropagation();
                // Aquí aplicamos también la traducción de imágenes que hicimos antes
                const translatedText = OmniDragManager.payload.text.replace(/img:\s*\[\[(.*?)\]\]/gi, '![[$1]]').trim();
                const newItem = { ...OmniDragManager.payload, text: translatedText, indentLevel: 0 };
                this.pinboardItems.push(newItem);
                this.pinboardFocusIndex = this.pinboardItems.length - 1;
                this.applyFiltersAndRender();
            }
        });

        const topControls = boardCanvas.createDiv({ cls: 'cornell-pinboard-controls' });
        topControls.style.display = 'flex';
        topControls.style.flexDirection = 'column';
        topControls.style.gap = '10px';
        topControls.style.marginBottom = '20px';

        // 🛠️ BARRA DE HERRAMIENTAS MINIMALISTA
        const toolbarRow = topControls.createDiv();
        toolbarRow.style.display = 'flex';
        toolbarRow.style.justifyContent = 'space-between';
        toolbarRow.style.alignItems = 'center';
        toolbarRow.style.marginBottom = '5px';

        const leftGroup = toolbarRow.createDiv();
        leftGroup.style.display = 'flex';
        leftGroup.style.gap = '4px';

        const createIconBtn = (icon: string, title: string) => {
            const btn = leftGroup.createEl('button', { title });
            btn.style.height = '28px';
            btn.style.width = '32px';
            btn.style.padding = '0';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.backgroundColor = 'transparent';
            btn.style.boxShadow = 'none';
            btn.style.border = '1px solid var(--background-modifier-border)';
            btn.style.color = 'var(--text-muted)';
            btn.style.borderRadius = '4px';
            btn.onmouseenter = () => { btn.style.backgroundColor = 'var(--background-modifier-hover)'; btn.style.color = 'var(--text-normal)'; };
            btn.onmouseleave = () => { btn.style.backgroundColor = 'transparent'; btn.style.color = 'var(--text-muted)'; };
            setIcon(btn, icon);
            return btn;
        };

        createIconBtn('copy', 'Copy Board to Clipboard').onclick = () => this.exportMindmap();
        createIconBtn('download', 'Import skeleton from active note').onclick = () => this.importActiveFileSkeleton();
        
        // 🖌️ NUEVO BOTÓN ZEN
        createIconBtn('pen-tool', 'Zen Doodle Mode').onclick = () => { 
            this.isZenMode = true; 
            this.applyFiltersAndRender(); 
        };
        
        createIconBtn('file-text', 'Export to Markdown Note').onclick = () => this.exportPinboard();
        createIconBtn('layout-dashboard', 'Export to Canvas').onclick = () => this.exportCanvas();

        const clearBtn = createIconBtn('trash-2', 'Clear Board');
        clearBtn.onmouseenter = () => { clearBtn.style.backgroundColor = 'var(--background-modifier-error-hover)'; clearBtn.style.color = 'var(--text-error)'; };
        clearBtn.onclick = () => { 
            this.pinboardItems = []; 
            this.applyFiltersAndRender(); 
            new Notice('Board cleared!');
        };

        // Grupo derecho: Botón Inteligente de Auto-Paste
        const autoPasteBtn = toolbarRow.createEl('button', { title: 'Auto-add copied text to Board' });
        autoPasteBtn.style.height = '28px';
        autoPasteBtn.style.padding = '0 10px';
        autoPasteBtn.style.display = 'flex';
        autoPasteBtn.style.alignItems = 'center';
        autoPasteBtn.style.gap = '6px';
        autoPasteBtn.style.fontSize = '0.8em';
        autoPasteBtn.style.border = '1px solid var(--background-modifier-border)';
        autoPasteBtn.style.borderRadius = '4px';
        autoPasteBtn.style.boxShadow = 'none';
        autoPasteBtn.style.cursor = 'pointer';

        const updateAutoBtn = () => {
            autoPasteBtn.empty();
            if (this.autoPasteInterval) {
                setIcon(autoPasteBtn.createSpan(), 'pause');
                autoPasteBtn.createSpan({ text: 'Auto' });
                autoPasteBtn.style.backgroundColor = 'var(--color-green)';
                autoPasteBtn.style.color = '#fff';
                autoPasteBtn.style.borderColor = 'var(--color-green)';
            } else {
                setIcon(autoPasteBtn.createSpan(), 'play');
                autoPasteBtn.createSpan({ text: 'Auto' });
                autoPasteBtn.style.backgroundColor = 'transparent';
                autoPasteBtn.style.color = 'var(--text-muted)';
                autoPasteBtn.style.borderColor = 'var(--background-modifier-border)';
            }
        };
        updateAutoBtn(); 

        autoPasteBtn.onclick = async () => {
            if (this.autoPasteInterval) {
                window.clearInterval(this.autoPasteInterval);
                this.autoPasteInterval = null;
                new Notice("🤖 Auto-Paste deactivated.");
            } else {
                this.lastClipboardText = await navigator.clipboard.readText(); 
                this.autoPasteInterval = window.setInterval(async () => {
                    try {
                        const currentText = await navigator.clipboard.readText();
                        if (currentText && currentText !== this.lastClipboardText) {
                            this.lastClipboardText = currentText;
                            this.pinboardItems.push({ text: currentText, rawText: currentText, color: 'transparent', file: null as any, line: -1, blockId: null, outgoingLinks: [], isCustom: true, indentLevel: 0 });
                            this.applyFiltersAndRender();
                            new Notice("Text auto-pasted! 📝");
                        }
                    } catch (e) { }
                }, 1000);
                new Notice("🤖 Auto-Paste ON! Copy text to see it appear.");
            }
            updateAutoBtn(); 
        };

        if (this.pinboardItems.length === 0) {
            boardCanvas.createEl('p', { text: 'Your Board is empty. Paste a skeleton, add nodes, or pin notes!', cls: 'cornell-sidebar-empty' });
            return;
        }

        let draggedIndex: number | null = null;
        const listContainer = boardCanvas.createDiv();

        this.pinboardItems.forEach((item, index) => {
            let currentIndex = index; 
            
            let itemWrapper = listContainer.createDiv();
            itemWrapper.setAttr('draggable', 'true');
            itemWrapper.classList.add('cornell-pinboard-item'); 
            itemWrapper.tabIndex = 0; 
            itemWrapper.style.cursor = 'grab';
            itemWrapper.style.marginBottom = '5px';
            
            const indent = item.indentLevel || 0;
            itemWrapper.style.marginLeft = `${indent * 20}px`;
            itemWrapper.style.borderRadius = '4px';

            itemWrapper.addEventListener('focus', () => { 
                itemWrapper.style.backgroundColor = 'var(--background-modifier-hover)'; 
                itemWrapper.style.outline = '2px solid var(--interactive-accent)'; 
                itemWrapper.style.outlineOffset = '-2px'; 
            });
            itemWrapper.addEventListener('blur', () => { 
                itemWrapper.style.backgroundColor = 'transparent'; 
                itemWrapper.style.outline = 'none';
            });

            itemWrapper.addEventListener('cornell-move', (e: Event) => {
                const dir = (e as CustomEvent).detail;
                if (dir === 'up' && index > 0) {
                    const temp = this.pinboardItems[index];
                    this.pinboardItems[index] = this.pinboardItems[index - 1];
                    this.pinboardItems[index - 1] = temp;
                    this.pinboardFocusIndex = index - 1; 
                    this.applyFiltersAndRender();
                } else if (dir === 'down' && index < this.pinboardItems.length - 1) {
                    const temp = this.pinboardItems[index];
                    this.pinboardItems[index] = this.pinboardItems[index + 1];
                    this.pinboardItems[index + 1] = temp;
                    this.pinboardFocusIndex = index + 1; 
                    this.applyFiltersAndRender();
                } else if (dir === 'left') {
                    item.indentLevel = Math.max(0, (item.indentLevel || 0) - 1);
                    this.pinboardFocusIndex = index;
                    this.applyFiltersAndRender();
                } else if (dir === 'right') {
                    item.indentLevel = (item.indentLevel || 0) + 1;
                    this.pinboardFocusIndex = index;
                    this.applyFiltersAndRender();
                }
            });

            itemWrapper.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault(); e.stopPropagation();
                    this.targetInsertIndex = currentIndex;
                    this.targetInsertAsChild = e.altKey; 
                    if (this.sliderIdeaInput) this.sliderIdeaInput.focus();
                    return; 
                }

                if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
                    if (e.key === 'ArrowUp') {
                        e.preventDefault(); e.stopPropagation();
                        if (itemWrapper.previousElementSibling) (itemWrapper.previousElementSibling as HTMLElement).focus();
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault(); e.stopPropagation();
                        if (itemWrapper.nextElementSibling) (itemWrapper.nextElementSibling as HTMLElement).focus();
                    } else if (e.key.toLowerCase() === 'h') {
                        e.preventDefault(); e.stopPropagation();
                        const hoverEvent = new MouseEvent('mouseenter', { bubbles: true, cancelable: true });
                        itemWrapper.dispatchEvent(hoverEvent);
                    } else if (e.key === 'Escape') {
                        e.preventDefault(); e.stopPropagation();
                        const leaveEvent = new MouseEvent('mouseleave', { bubbles: true, cancelable: true });
                        itemWrapper.dispatchEvent(leaveEvent);
                    }   
                }
            });

            // --- RENDERIZADO INTERNO ---
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
                
                const titleSpan = itemWrapper.createSpan({ text: match ? match[2] : item.text });
                titleSpan.style.wordBreak = 'break-word';
                titleSpan.style.whiteSpace = 'normal';
                titleSpan.style.cursor = 'text'; // 👈 Indica que es editable
                titleSpan.title = "Double-click to edit";
                
                const delBtn = itemWrapper.createSpan({ text: '×', title: 'Borrar' });
                delBtn.style.cursor = 'pointer';
                delBtn.style.flexShrink = '0'; 
                delBtn.onclick = () => { this.pinboardItems.splice(currentIndex, 1); this.applyFiltersAndRender(); };

                // ✏️ MAGIA: Edición con Doble Clic para Títulos
                titleSpan.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    const currentText = match ? match[2] : item.text;
                    const prefix = match ? match[1] + " " : ""; // Conserva los '#'
                    
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = currentText;
                    input.style.width = '100%';
                    input.style.background = 'transparent';
                    input.style.border = '1px solid var(--interactive-accent)';
                    input.style.color = 'inherit';
                    input.style.font = 'inherit';
                    input.style.outline = 'none';
                    
                    itemWrapper.replaceChild(input, titleSpan);
                    input.focus();
                    
                    const saveEdit = () => {
                        const newVal = input.value.trim();
                        if (newVal) {
                            item.text = prefix + newVal;
                            item.rawText = prefix + newVal;
                        }
                        this.applyFiltersAndRender();
                    };
                    
                    input.addEventListener('blur', saveEdit);
                    input.addEventListener('keydown', (ev) => { 
                        if (ev.key === 'Enter') saveEdit(); 
                        if (ev.key === 'Escape') this.applyFiltersAndRender(); // Cancela sin guardar
                    });
                });
            
            } else if (item.isCustom) {
                itemWrapper.style.padding = '6px 8px';
                itemWrapper.style.display = 'flex';
                itemWrapper.style.justifyContent = 'space-between';
                itemWrapper.style.alignItems = 'flex-start';
                itemWrapper.style.color = 'var(--text-normal)';
                itemWrapper.style.borderLeft = '2px solid var(--background-modifier-border)';
                itemWrapper.style.backgroundColor = 'var(--background-primary-alt)';
                
                const textSpan = itemWrapper.createSpan();
                textSpan.style.wordBreak = 'break-word';
                textSpan.style.whiteSpace = 'normal';
                textSpan.style.flex = '1';
                textSpan.style.marginRight = '10px';
                textSpan.style.cursor = 'text'; // 👈 Indica que es editable
                textSpan.title = "Double-click to edit";
                
                // 🎨 MAGIA PARA EL DOODLE (Intacta)
                if (item.text.startsWith('![')) {
                    MarkdownRenderer.renderMarkdown(item.text, textSpan, "", this.plugin);
                    setTimeout(() => {
                        const img = textSpan.querySelector('img') as HTMLElement;
                        if (img) {
                            img.style.maxHeight = '250px'; 
                            img.style.maxWidth = '100%';
                            img.style.objectFit = 'contain';
                            img.style.borderRadius = '4px';
                        }
                    }, 50);
                } else {
                    textSpan.innerText = '⚬ ' + item.text;
                }

                const delBtn = itemWrapper.createSpan({ text: '×', title: 'Delete node' });
                delBtn.style.cursor = 'pointer';
                delBtn.style.opacity = '0.3';
                delBtn.style.flexShrink = '0'; 
                delBtn.onclick = () => { this.pinboardItems.splice(currentIndex, 1); this.applyFiltersAndRender(); };
                itemWrapper.onmouseenter = () => delBtn.style.opacity = '1';
                itemWrapper.onmouseleave = () => delBtn.style.opacity = '0.3';

                // ✏️ MAGIA: Edición con Doble Clic para Nodos Esqueleto/Doodles
                textSpan.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = item.text; // Editable (sea texto normal o el enlace del doodle)
                    input.style.width = '100%';
                    input.style.background = 'transparent';
                    input.style.border = '1px solid var(--interactive-accent)';
                    input.style.color = 'inherit';
                    input.style.font = 'inherit';
                    input.style.outline = 'none';
                    
                    itemWrapper.replaceChild(input, textSpan);
                    input.focus();
                    
                    const saveEdit = () => {
                        const newVal = input.value.trim();
                        if (newVal) {
                            item.text = newVal;
                            item.rawText = newVal;
                        }
                        this.applyFiltersAndRender();
                    };
                    
                    input.addEventListener('blur', saveEdit);
                    input.addEventListener('keydown', (ev) => { 
                        if (ev.key === 'Enter') saveEdit(); 
                        if (ev.key === 'Escape') this.applyFiltersAndRender(); // Cancela sin guardar
                    });
                });

            } else {
                const marginaliaDOM = this.createItemDiv(item, itemWrapper, true, currentIndex);
                marginaliaDOM.setAttr('draggable', 'false'); 
            }

            
            // Drag & Drop
            itemWrapper.addEventListener('dragstart', (e: DragEvent) => { 
                draggedIndex = currentIndex; 
                itemWrapper.style.opacity = '0.4'; 
                e.stopPropagation(); 
                
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'copyMove';
                    
                    let targetId = item.blockId;
                    if (!targetId && item.file) { 
                        targetId = Math.random().toString(36).substring(2, 8);
                        item.blockId = targetId; 
                        this.injectBackgroundBlockId(item.file, item.line, targetId);
                    }

                    // 🚀 EXCALIDRAW SPLIT-MODE (Activado con CTRL / CMD)
                    if (e.ctrlKey || e.metaKey) {
                        let cleanText = this.cleanExportText(item.text);
                        if (!cleanText) cleanText = item.text.replace(/!\[\[(.*?)\]\]/g, '🖼️ [Image]').trim() || "Pinboard Node";
                        
                        let citationText = item.context || "";
                        
                        // 🧽 SANITIZADOR MULTILÍNEA: Aplasta saltos de línea para que Excalidraw no se rompa con PDF++
                        cleanText = cleanText.replace(/\r?\n|\r/g, ' ').replace(/\s{2,}/g, ' ').trim();
                        citationText = citationText.replace(/\r?\n|\r/g, ' ').replace(/\s{2,}/g, ' ').trim();

                        // 1. El Ratón lleva SOLO el texto (La Marginalia) al lienzo
                        e.dataTransfer.setData('text/plain', cleanText);
                        e.dataTransfer.setData('application/cornell-marginalia-payload', cleanText);
                        
                        // 2. El Portapapeles se traga la Cita (PDF++)
                        if (citationText) {
                            navigator.clipboard.writeText(citationText);
                            new Notice("🎨 Excalidraw: Marginalia soltada. ¡Presiona Ctrl+V para pegar el PDF++!");
                        } else {
                            new Notice("🎨 Excalidraw: Marginalia soltada en el lienzo.");
                        }
                    } else {
                        // 📝 MODO NORMAL
                        let dragPayload = this.buildThreadDropText(item, 0, new Set<string>(), undefined, false);
                        e.dataTransfer.setData('text/plain', dragPayload.trim());
                        CornellNotesView.lastDraggedPayload = dragPayload.trim(); // ESTA MEMORIA para templeter!
                    }
                }
            });
            // esta linea la toque, realidad solo terminaba hasta stopPropagation (); } ) ;
            itemWrapper.addEventListener('dragover', (e) => { e.preventDefault(); itemWrapper.style.borderTop = '3px solid var(--interactive-accent)';
                console.log("✈️ 2. DRAG OVER: Volando sobre una nota. ¿Hay payload?", OmniDragManager.payload !== null);
            });
            itemWrapper.addEventListener('dragleave', () => { itemWrapper.style.borderTop = ''; });
            itemWrapper.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation(); itemWrapper.style.borderTop = '';
                // 👽 CASO EXTERNO: Viene de la Máquina del Tiempo
            if (OmniDragManager.payload) {
                const newItem = { ...OmniDragManager.payload, indentLevel: 0 };
                this.pinboardItems.splice(currentIndex, 0, newItem);
                this.applyFiltersAndRender();
                return; // Cortamos aquí para que no ejecute el código de abajo
            }
                if (draggedIndex !== null && draggedIndex !== currentIndex) {
                    const itemToMove = this.pinboardItems[draggedIndex];
                    this.pinboardItems.splice(draggedIndex, 1);
                    const targetIndex = draggedIndex < currentIndex ? currentIndex - 1 : currentIndex;
                    this.pinboardItems.splice(targetIndex, 0, itemToMove);
                    this.pinboardFocusIndex = targetIndex; 
                    this.applyFiltersAndRender();
                }
            });
            itemWrapper.addEventListener('dragend', () => { 
    itemWrapper.style.opacity = '1'; 
    draggedIndex = null; 
    this.triggerTemplaterAfterDrop();

    // ⚡ INVOCAMOS AL NUEVO MOTOR
    
});
        });

        // --- 🎯 NUEVA ZONA DE CAÍDA INVISIBLE AL FINAL ---
        const dropZone = listContainer.createDiv();
        dropZone.style.height = '60px'; // Área cómoda para soltar
        dropZone.style.width = '100%';
        dropZone.style.marginTop = '10px';
        dropZone.style.borderRadius = '4px';
        dropZone.style.transition = 'all 0.2s ease';
        
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            console.log("✈️ 2.5 DRAG OVER: Volando sobre la zona vacía. ¿Hay payload?", OmniDragManager.payload !== null);
            // Borde punteado al pasar por encima
            dropZone.style.border = '2px dashed var(--interactive-accent)'; 
        });
        
        dropZone.addEventListener('dragleave', () => {
            dropZone.style.border = 'none'; // Desaparece al salir
        });
        
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.style.border = 'none';
            // 👽 CASO EXTERNO: Viene de la Máquina del Tiempo
            if (OmniDragManager.payload) {
                console.log("🛬 3. DROP: ¡Aterrizaje autorizado en el Pinboard!");
                const newItem = { ...OmniDragManager.payload, indentLevel: 0 };
                this.pinboardItems.push(newItem); // Va al final de la lista
                this.pinboardFocusIndex = this.pinboardItems.length - 1;
                this.applyFiltersAndRender();
                return; // Cortamos aquí
            }
            
            // Mueve la nota al final
            if (draggedIndex !== null && draggedIndex !== this.pinboardItems.length - 1) {
                const itemToMove = this.pinboardItems[draggedIndex];
                this.pinboardItems.splice(draggedIndex, 1); 
                this.pinboardItems.push(itemToMove); 
                this.pinboardFocusIndex = this.pinboardItems.length - 1; 
                this.applyFiltersAndRender();
            }
        });
        // -------------------------------------------------

        if (this.pinboardFocusIndex !== null && listContainer.children[this.pinboardFocusIndex]) {
            (listContainer.children[this.pinboardFocusIndex] as HTMLElement).focus();
            this.pinboardFocusIndex = null; 
        }
    }
// --- 🧠 ESTADOS DE BLURTING ---
    isBlurtingActive: boolean = false;
    isAuditing: boolean = false;
    originalCanvasData: ArrayBuffer | null = null;
    blurtingFormat: "visual" | "textual" = "textual"; // 👈 Nueva memoria
    blurtingDeck: MarginaliaItem[] = [];


    // ======================================================
    // 🧠 MOTOR DE REPETICIÓN ESPACIADA (1-3-7) Y AUDITORÍA
    // ======================================================
    async saveBlurtingSession() {
        // @ts-ignore
        const zkId = window.moment().format('YYYYMMDDHHmmss');
        // @ts-ignore
        const today = window.moment().format('YYYY-MM-DD');
        // @ts-ignore
        const nextReview = window.moment().add(1, 'days').format('YYYY-MM-DD'); 
        
        let fileContent = `---
blurting_source_query: "${this.searchQuery || 'Full Vault'}"
first_session: ${today}
next_review: ${nextReview}
review_stage: 1
---\n\n# 🧠 Blurting Audit: ${this.searchQuery || 'Session'}\n\n`;

        if (this.blurtingFormat === "visual" && this.zenCanvasEl) {
            const folder = this.plugin.settings.doodleFolder.trim();
            await this.plugin.ensureFolderExists(folder);

            // 📸 IMAGEN 1: ORIGINAL (La que guardamos en memoria al pulsar Finish)
            if (this.originalCanvasData) {
                const origName = `blurting_raw_${zkId}.png`;
                const origPath = folder ? `${folder}/${origName}` : origName;
                await this.plugin.app.vault.createBinary(origPath, this.originalCanvasData);
                fileContent += `### 🧠 1. The Blurt (Original)\n![[${origName}]]\n\n`;
            }

            // 📸 IMAGEN 2: CORREGIDA (La que está actualmente en el canvas con marcas rojas)
            const dataUrl = this.zenCanvasEl.toDataURL("image/png");
            const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
            const correctedBuffer = base64ToArrayBuffer(base64Data);
            
            const corrName = `blurting_audit_${zkId}.png`;
            const corrPath = folder ? `${folder}/${corrName}` : corrName;
            await this.plugin.app.vault.createBinary(corrPath, correctedBuffer);
            fileContent += `### 🖍️ 2. The Audit (Corrections)\n![[${corrName}]]\n\n`;
        }

        fileContent += `*Deck contained ${this.blurtingDeck.length} notes.*`;

        const folderPath = this.plugin.settings.zkFolder.trim() || "/";
        await this.plugin.ensureFolderExists(folderPath);
        
        let finalPath = folderPath === "/" ? `Audit_${zkId}.md` : `${folderPath}/Audit_${zkId}.md`;
        await this.plugin.app.vault.create(finalPath, fileContent);
        
        new Notice("✅ Dual Session saved to Spaced Repetition Engine!");
        
        // Limpieza final y liberación de memoria
        this.originalCanvasData = null;
        this.isAuditing = false;
        this.isZenMode = false;
        this.currentTab = 'reviews'; 
        this.renderUI();
        this.applyFiltersAndRender();
    }

    renderReviewsTab(container: HTMLElement) {
        container.empty();
        container.createEl("h3", { text: "🔔 Due for Review (1-3-7)", cls: "cornell-sidebar-title" });

        // @ts-ignore
        const todayStr = window.moment().format('YYYY-MM-DD');
        const cache = this.plugin.app.metadataCache;
        const allFiles = this.plugin.app.vault.getMarkdownFiles();
        
        const dueReviews: any[] = [];

        // Escáner ultrasónico de caché
        for (const file of allFiles) {
            const fileCache = cache.getFileCache(file);
            if (fileCache?.frontmatter && fileCache.frontmatter.next_review) {
                const nextReview = fileCache.frontmatter.next_review;
                const stage = fileCache.frontmatter.review_stage || 1;
                
                if (stage < 4 && nextReview <= todayStr) { 
                    dueReviews.push({ file, frontmatter: fileCache.frontmatter });
                }
            }
        }

        if (dueReviews.length === 0) {
            container.createEl("p", { text: "🎉 You're all caught up! No reviews pending.", cls: "cornell-sidebar-empty" });
            return;
        }

        dueReviews.forEach(review => {
            const card = container.createDiv({ cls: 'cornell-sidebar-item' });
            card.style.borderLeftColor = "var(--color-purple)";
            
            const title = review.frontmatter.blurting_source_query || review.file.basename;
            card.createDiv({ text: `📚 Topic: ${title}`, attr: { style: "font-weight: bold; margin-bottom: 5px; color: var(--text-normal);" }});
            card.createDiv({ text: `Stage: ${review.frontmatter.review_stage} (Due: ${review.frontmatter.next_review})`, cls: 'cornell-sidebar-item-meta' });
            
            const btnRow = card.createDiv({ attr: { style: "display: flex; gap: 10px; margin-top: 10px;" }});
            
            const openBtn = btnRow.createEl('button', { text: "👁️ Open" });
            openBtn.onclick = () => this.plugin.app.workspace.getLeaf(false).openFile(review.file);
            
            const advanceBtn = btnRow.createEl('button', { text: "✅ Advance Stage", cls: "mod-cta" });
            advanceBtn.style.backgroundColor = "var(--color-green)";
            advanceBtn.style.color = "white";
            advanceBtn.onclick = async () => {
                await this.advanceReviewStage(review.file, review.frontmatter);
                this.applyFiltersAndRender(); // Recargar la vista visualmente
            };
        });
    }

    async advanceReviewStage(file: TFile, currentFrontmatter: any) {
        const currentStage = currentFrontmatter.review_stage || 1;
        let daysToAdd = 0;
        let newStage = currentStage + 1;
        
        if (currentStage === 1) daysToAdd = 2; // Día 1 -> +2 = Día 3
        else if (currentStage === 2) daysToAdd = 4; // Día 3 -> +4 = Día 7
        else if (currentStage === 3) daysToAdd = 999; 
        
        // @ts-ignore
        const nextReviewStr = window.moment().add(daysToAdd, 'days').format('YYYY-MM-DD');
        
        await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            frontmatter.review_stage = newStage;
            if (newStage > 3) {
                frontmatter.next_review = "Mastered";
            } else {
                frontmatter.next_review = nextReviewStr;
            }
        });
        
        new Notice(newStage > 3 ? "🎓 Topic Mastered!" : `📈 Advanced! Next review on ${nextReviewStr}`);
    }
    // --- ⚡ DISPARADOR DE LA SESIÓN ---
    async startBlurtingSession(deck: MarginaliaItem[], format: "visual" | "textual") {
        this.isBlurtingActive = true;
        this.blurtingDeck = deck;
        this.blurtingFormat = format;

        if (format === "visual") {
            this.currentTab = 'pinboard'; 
            this.isZenMode = true; // Fundamental mantenerlo para la fase de Auditoría
        } else {
            // @ts-ignore
            const zkId = window.moment().format('YYYYMMDDHHmmss');
            const fileName = `${this.plugin.settings.zkFolder}/Blurting_${zkId}.md`;
            
            await this.plugin.ensureFolderExists(this.plugin.settings.zkFolder);
            const header = `# 🧠 Blurting Session\n*Write down everything you remember about the ${deck.length} notes in your deck.*\n\n---\n\n`;
            const newFile = await this.plugin.app.vault.create(fileName, header);
            
            await this.plugin.app.workspace.getLeaf(true).openFile(newFile);
        }

        this.renderUI();
        this.applyFiltersAndRender();
    }
    async exportPinboard() {
        if (this.pinboardItems.length === 0) return;
        // @ts-ignore
        const dateStr = window.moment().format('YYYY-MM-DD_HH-mm-ss');
        const folder = this.plugin.settings.pinboardFolder.trim();
        await this.plugin.ensureFolderExists(folder);
        const fileName = folder ? `${folder}/Pinboard_${dateStr}.md` : `Pinboard_${dateStr}.md`;

        // 🧠 NUEVO: ALGORITMO PARA DESCUBRIR LA FUENTE PRINCIPAL
        let dominantSource = "Multiple Sources";
        
        // Si estamos en un PDF, esa es la fuente absoluta
        if (this.isZotlikeMode && this.activePdfName) {
            dominantSource = this.activePdfName;
        } else {
            // Concurso de popularidad de notas
            const sourceCounts: Record<string, number> = {};
            let maxCount = 0;
            let topSource = "";

            for (const item of this.pinboardItems) {
                // Ignoramos títulos, doodles o texto manual porque no tienen un archivo origen ('file')
                if (!item.isTitle && !item.isCustom && item.file && item.file.basename) {
                    const basename = item.file.basename;
                    sourceCounts[basename] = (sourceCounts[basename] || 0) + 1;
                    
                    if (sourceCounts[basename] > maxCount) {
                        maxCount = sourceCounts[basename];
                        topSource = basename;
                    }
                }
            }

            if (topSource) {
                // Si encontramos un ganador, lo usamos
                dominantSource = topSource;
            } else {
                // Si el tablero es puro texto manual y dibujos sin origen de bóveda
                dominantSource = "Custom Board"; 
            }
        }

        // 👇
        // 👇
        let content = "";
        
        if (this.plugin.settings.pinboardTemplatePath) {
             // @ts-ignore
            content = await this.plugin.getTemplateContent(this.plugin.settings.pinboardTemplatePath, {
                title: `Pinboard_${dateStr}`,
                // @ts-ignore
                date: window.moment().format('YYYY-MM-DD'),
                // @ts-ignore
                time: window.moment().format('HH:mm'),
                source_note: dominantSource // 🎯 FIX: Ahora sí usa el algoritmo inteligente
            });
        }

        // Si la plantilla falló o el usuario no configuró ninguna, usamos el diseño clásico por defecto
        if (!content) {
            // @ts-ignore
            content = `# ● Pinboard Session\n*Exported on: ${window.moment().format('YYYY-MM-DD HH:mm')}*\n\n---\n\n`;
        }

        // 🧠 1. LEER LA PLANTILLA DEL ÍTEM (Fuera del bucle por rendimiento)
        let itemTemplateRaw = "";
        if (this.plugin.settings.pinboardItemTemplatePath) {
            const templateFile = this.app.metadataCache.getFirstLinkpathDest(this.plugin.settings.pinboardItemTemplatePath, "");
            if (templateFile instanceof TFile) {
                itemTemplateRaw = await this.app.vault.read(templateFile);
            }
        }

        for (const item of this.pinboardItems) {
            if (item.isTitle) {
                const text = item.text.startsWith('#') ? item.text : `## ${item.text}`;
                content += `${text}\n\n`;
                continue; 
            }
            if (item.isCustom) {
                // 🦴 NODO ESQUELETO (Preservado de tu código original)
                const indentSpaces = "  ".repeat(item.indentLevel || 0);
                content += `${indentSpaces}- ${item.text}\n\n`;
                continue;
            }
            
            // 🛡️ PRESERVADO: Tu lógica de blockId para no romper las conexiones de la bóveda
            let targetId = item.blockId;
            if (!targetId) {
                targetId = Math.random().toString(36).substring(2, 8);
                item.blockId = targetId;
                await this.injectBackgroundBlockId(item.file, item.line, targetId);
            }

            // 🕵️‍♂️ CAZADOR DE CITAS Y CONTEXTO
            let citation = "";
            let contextText = "";
            
            if (item.file && item.line !== undefined) {
                const fileContent = await this.plugin.app.vault.cachedRead(item.file);
                const lines = fileContent.split('\n');
                
                // Línea original donde está la marginalia
                contextText = lines[item.line] || '';
                contextText = contextText.replace(/%%[><](.*?)%%/g, '').trim();
                
                // Buscar la cita en bloque (ej. de un PDF) debajo
                let searchIdx = item.line + 1; 
                while (searchIdx < lines.length) {
                    const lineStr = lines[searchIdx].trim();
                    if (lineStr.startsWith('>')) {
                        citation += `${lineStr}\n`; 
                    } else if (lineStr.startsWith('^') || lineStr === '') {
                        // Ignoramos anclas y vacíos
                    } else {
                        break; 
                    }
                    searchIdx++;
                }
            }

            // Enlace con ancla al bloque exacto preservado
            const sourceLink = item.file ? `[[${item.file.basename}#^${targetId}|${item.file.basename}]]` : "Custom";

            // 🧼 PURIFICAMOS Y DESARMAMOS TEMPLATER EN EL TEXTO DE ENTRADA
const cleanExportItemText = sanitizeForTemplater(this.cleanExportText(item.text));

// 🎨 3. RENDERIZADO BASADO EN PLANTILLA PERSONALIZADA
if (itemTemplateRaw) {
    let currentItemContent = itemTemplateRaw;
    currentItemContent = currentItemContent.replace(/{{text}}/g, cleanExportItemText); 
    
    // 🛡️ Sanitizamos también el contexto/cita por si el usuario copió código malicioso de un PDF
    const finalCitation = sanitizeForTemplater(citation ? citation.trim() : contextText);
    currentItemContent = currentItemContent.replace(/{{citation}}/g, finalCitation);
                
                currentItemContent = currentItemContent.replace(/{{source_note}}/g, sourceLink);
                
                content += `${currentItemContent}\n\n`;
            } else {
                // FALLBACK: Diseño limpio sin plantilla configurada
                content += `${cleanExportItemText}\n\n`; // 👈 Usamos el texto limpio
                if (citation) {
                    content += `${citation}\n`; 
                } else if (contextText) {
                    content += `${contextText}\n`;
                }
                content += `*— 🔗 ${sourceLink}*\n\n---\n\n`; 
            }
        }
        // NUEVO: INTEGRACIÓN TEMPLATER (PARSEADO EN LOTE / BATCH)
        // Pasamos el string final completo una sola vez por Templater antes de guardarlo
        const templaterPlugin = (this.app as any).plugins.plugins["templater-obsidian"];
        if (templaterPlugin && templaterPlugin.templater) {
            try {
                const activeContextFile = this.app.workspace.getActiveFile();
                content = await templaterPlugin.templater.parse_template(
                    { target_file: activeContextFile, run_mode: 4 },
                    content
                );
            } catch (err) {
                console.warn("Cornell Marginalia: Error de Templater en Pinboard", err);
            }
        }
        try {
            const newFile = await this.plugin.app.vault.create(fileName, content);
            await this.plugin.app.workspace.getLeaf(true).openFile(newFile);
            new Notice('Pinboard compiled successfully!');
            
        } catch (error) {
            new Notice('Error creating Pinboard file. Check console.');
        }
    }
// 🌳 NUEVA FUNCIÓN MEJORADA: Exportador al Portapapeles para Mindmaps (Excalidraw)
    async exportMindmap() {
        if (this.pinboardItems.length === 0) {
            new Notice('El Board está vacío.');
            return;
        }

        let content = "";

        for (const item of this.pinboardItems) {
            if (item.isTitle) {
                const text = item.text.startsWith('#') ? item.text : `# ${item.text}`;
                content += `${text}\n`;
            } else if (item.isCustom) {
                // 🦴 NODO ESQUELETO
                const indentSpaces = "\t".repeat(item.indentLevel || 0);
                content += `${indentSpaces}- ${item.text}\n`;
            } else {
                const indentSpaces = "\t".repeat(item.indentLevel || 0);
                
                let targetId = item.blockId;
                if (!targetId) {
                    targetId = Math.random().toString(36).substring(2, 8);
                    item.blockId = targetId;
                    await this.injectBackgroundBlockId(item.file, item.line, targetId);
                }

                // 🧠 1. DESACOPLAMIENTO DE IMÁGENES PARA EXCALIDRAW
                const imgRegex = /img:\s*\[\[(.*?)\]\]/i;
                const match = item.rawText.match(imgRegex);
                let cleanText = item.rawText.replace(imgRegex, '').trim();

                // 🧼 Aplicamos el Purificador Universal
                cleanText = this.cleanExportText(cleanText);

                // 🕵️‍♂️ 2. CAZADOR DE CONTEXTO (Integrado para Excalidraw)
                let contextText = "";
                if (item.file && item.line !== undefined) {
                    const fileContent = await this.plugin.app.vault.cachedRead(item.file);
                    const lines = fileContent.split('\n');
                    
                    let originalLine = lines[item.line] || '';
                    originalLine = originalLine.replace(/%%[><](.*?)%%/g, '').trim();
                    originalLine = originalLine.replace(/\^[a-zA-Z0-9_-]+$/, '').trim();
                    
                    if (!originalLine && item.line > 0) {
                        originalLine = lines[item.line - 1].trim();
                    }

                    let searchIdx = item.line + 1; 
                    let citation = "";
                    while (searchIdx < lines.length) {
                        const lineStr = lines[searchIdx].trim();
                        if (lineStr.startsWith('>')) citation += `${lineStr}\n`; 
                        else if (lineStr.startsWith('^') || lineStr === '') {} 
                        else break; 
                        searchIdx++;
                    }
                    contextText = citation ? citation.trim() : originalLine;
                }

                // 🏗️ 3. CONSTRUCCIÓN DEL ÁRBOL MARKDOWN ESTRICTO

                // A. Nodo Padre (La idea principal de la Marginalia)
                if (cleanText.length > 0) {
                    content += `${indentSpaces}- [[${item.file.basename}#^${targetId}|${cleanText}]]\n`;
                } else if (match) {
                    // Si solo es un dibujo sin texto, le ponemos un nombre genérico para que tenga enlace
                    content += `${indentSpaces}- [[${item.file.basename}#^${targetId}|🎨 Doodle]]\n`;
                }

                // B. Sub-nodo: La Imagen (Si existe)
                if (match) {
                    const imageName = match[1];
                    content += `${indentSpaces}\t- ![[${imageName}]]\n`;
                }

                // C. Sub-nodo: El Contexto / Cita (Si existe)
                if (contextText) {
                    // Limpiamos los saltos de línea para que Excalidraw no divida el nodo en pedazos
                    const cleanContext = contextText.replace(/\n/g, ' '); 
                    content += `${indentSpaces}\t-  ${cleanContext}\n`;
                }
            }
        }

        try {
            await navigator.clipboard.writeText(content);
            new Notice('📋 ¡Mindmap copiado! Ve a Excalidraw y presiona Ctrl+V');
        } catch (error) {
            new Notice('Error al copiar al portapapeles. Revisa la consola.');
            console.error(error);
        }
    }
    
    // 🎨 NUEVO MOTOR: Generador Automático de Canvas (Tablero de Evidencia) con Plantillas
    async exportCanvas() {
        if (this.pinboardItems.length === 0) return;

        // @ts-ignore
        const dateStr = window.moment().format('YYYY-MM-DD_HH-mm-ss');
        const folder = this.plugin.settings.canvasFolder.trim();
        await this.plugin.ensureFolderExists(folder);
        const fileName = folder ? `${folder}/EvidenceBoard_${dateStr}.canvas` : `EvidenceBoard_${dateStr}.canvas`;

        // 🧠 1. LEER LA PLANTILLA DE LA TARJETA PRINCIPAL
        let canvasTemplateRaw = "";
        if (this.plugin.settings.canvasItemTemplatePath) {
            const templateFile = this.app.metadataCache.getFirstLinkpathDest(this.plugin.settings.canvasItemTemplatePath, "");
            if (templateFile instanceof TFile) {
                canvasTemplateRaw = await this.app.vault.read(templateFile);
            }
        }

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
        // 🛡️ Sanitizamos el título
        const rawTitle = item.text.startsWith('#') ? item.text : `# ${item.text}`;
        const titleText = sanitizeForTemplater(rawTitle);
        nodes.push({ id: nodeId, type: "text", text: titleText, x: 0, y: currentY, width: 350, height: 100, color: "1" }); 
        lastTitleId = nodeId;
        parentAtLevel = {}; 
        parentAtLevel[-1] = nodeId; 
        currentY += 150; 
    } else if (item.isCustom) {
        // 🛡️ Sanitizamos el nodo esqueleto
        const safeSkeletonText = sanitizeForTemplater(item.text);
        const indent = item.indentLevel || 0;
        const baseX = (indent + 1) * 450;
        nodes.push({ id: nodeId, type: "text", text: `**${safeSkeletonText}**`, x: baseX, y: currentY, width: 250, height: 60, color: "5" }); 
        
        const parentId = parentAtLevel[indent - 1] || lastTitleId;
        if (parentId) edges.push({ id: genId(), fromNode: parentId, fromSide: "right", toNode: nodeId, toSide: "left" });
        parentAtLevel[indent] = nodeId;
        
        currentY += 100; 
    } else {
        const indent = item.indentLevel || 0;
        const baseX = (indent + 1) * 450; 

        let targetId = item.blockId;
        if (!targetId) {
            targetId = Math.random().toString(36).substring(2, 8);
            item.blockId = targetId;
            await this.injectBackgroundBlockId(item.file, item.line, targetId);
        }

        let canvasNoteContent = item.rawText;
        const hasImage = /img:\s*\[\[(.*?)\]\]/gi.test(canvasNoteContent);
        canvasNoteContent = canvasNoteContent.replace(/img:\s*\[\[(.*?)\]\]/gi, '![[$1]]');

        // 🛡️ Aplicamos el Purificador Universal Y la Sanitización de Templater
        canvasNoteContent = sanitizeForTemplater(this.cleanExportText(canvasNoteContent));

        const sourceLink = `[[${item.file.basename}#^${targetId}|🔗 Origin]]`;
        let noteText = "";
        
        if (canvasTemplateRaw) {
            noteText = canvasTemplateRaw;
            noteText = noteText.replace(/{{text}}/g, canvasNoteContent);
            noteText = noteText.replace(/{{source_note}}/g, sourceLink);
        } else {
            noteText = `**Marginalia:**\n${canvasNoteContent}\n\n${sourceLink}`;
        }
        
        const nodeHeight = hasImage ? 320 : 140;
        nodes.push({ id: nodeId, type: "text", text: noteText, x: baseX, y: currentY, width: 300, height: nodeHeight, color: "4" }); 

        const parentId = parentAtLevel[indent - 1] || lastTitleId;
        if (parentId) {
            edges.push({ id: genId(), fromNode: parentId, fromSide: "right", toNode: nodeId, toSide: "left" });
        }
        parentAtLevel[indent] = nodeId;

                // 📚 3. EXTRAER EL TEXTO DEL CONTEXTO (BLOQUE COMPLETO)
                const fileContent = await this.plugin.app.vault.cachedRead(item.file);
                const lines = fileContent.split('\n');

                let startLine = item.line;
                let endLine = item.line;

                // Subimos hasta encontrar una línea vacía o el inicio de un bloque (```)
                while (startLine > 0 && lines[startLine - 1].trim() !== '' && !lines[startLine - 1].startsWith('```')) {
                    startLine--;
                }
                // Bajamos hasta encontrar una línea vacía o el fin de un bloque (```)
                while (endLine < lines.length - 1 && lines[endLine + 1].trim() !== '' && !lines[endLine + 1].startsWith('```')) {
                    endLine++;
                }

                let contextText = '';
                for (let i = startLine; i <= endLine; i++) {
                    let cleanLine = lines[i].replace(/%%[><](.*?)%%/g, '').trim();
                    
                    // Limpiamos identificadores de bloque residuales (^id) para que el Canvas quede limpio
                    cleanLine = cleanLine.replace(/\^[a-zA-Z0-9_-]+$/, '').trim();

                    // Ignoramos las etiquetas de código para que el Canvas se vea limpio
                    if (cleanLine.startsWith('```')) continue;
                    
                    if (cleanLine) {
                        contextText += cleanLine + '\n';
                    }
                }
                contextText = contextText.trim();

                // 🛡️ Cuando creas el nodo de contexto, sanitízalo también:
        if (contextText) {
            const safeContextText = sanitizeForTemplater(contextText.trim());
            const contextNodeId = genId();
            nodes.push({ id: contextNodeId, type: "text", text: `> ${safeContextText}`, x: baseX + 400, y: currentY - 20, width: 450, height: Math.max(180, nodeHeight) });
            edges.push({ id: genId(), fromNode: nodeId, fromSide: "right", toNode: contextNodeId, toSide: "left" });
        }

        currentY += hasImage ? 360 : 220; 
    }
}

        // Ensamblamos el JSON del Canvas (Cambiamos const a let)
        let canvasData = JSON.stringify({ nodes, edges }, null, 2);

        // ⚡ NUEVO: INTEGRACIÓN TEMPLATER (PARSEADO EN LOTE PARA JSON)
        const templaterPlugin = (this.app as any).plugins.plugins["templater-obsidian"];
        if (templaterPlugin && templaterPlugin.templater) {
            try {
                const activeContextFile = this.app.workspace.getActiveFile();
                // Parseamos el string JSON completo. Templater reemplazará los tags <% %> 
                // que estén dentro de los valores de texto de los nodos.
                canvasData = await templaterPlugin.templater.parse_template(
                    { target_file: activeContextFile, run_mode: 4 },
                    canvasData
                );
            } catch (err) {
                console.warn("Cornell Marginalia: Error de Templater en Canvas", err);
            }
        }

        try {
            const newFile = await this.plugin.app.vault.create(fileName, canvasData);
            await this.plugin.app.workspace.getLeaf(true).openFile(newFile);
            new Notice('🎨 Evidence Board created successfully!');
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
                CornellNotesView.lastDraggedPayload = dragPayload; // 👈 GUARDAMOS EN MEMORIA
                this.draggedSidebarItems = items; 
            });

            headerDiv.addEventListener('dragend', () => {
                this.draggedSidebarItems = null; 
                headerDiv.removeClass('cornell-drop-target');
                this.triggerTemplaterAfterDrop();
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
    // 📁 NUEVO MOTOR: Convierte rutas físicas en Cajas Semánticas
    renderFolderTree(items: MarginaliaItem[], container: HTMLElement, isFilteredMode: boolean = false) {
        container.empty();
        if (items.length === 0) {
            container.createEl('p', { text: 'No notes match your search.', cls: 'cornell-sidebar-empty' });
            return;
        }

        const tree = new Map<string, SemanticTreeNode>();

        for (const item of items) {
            if (!item.file) continue;
            
            // 1. Extraemos la ruta (Ej: "Facultad/Medicina/Cardio.md") y le quitamos el .md
            const cleanPath = item.file.path.replace(/\.md$/i, '');
            const parts = cleanPath.split('/');

            let currentLevel = tree;
            // 🛡️ Le ponemos un prefijo único para que sus configuraciones de color no choquen con los #tags normales
            let currentPath = "📁"; 

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                currentPath += `/${part}`;

                if (!currentLevel.has(part)) {
                    currentLevel.set(part, {
                        name: part,
                        fullPath: currentPath,
                        children: new Map(),
                        items: []
                    });
                }

                const node = currentLevel.get(part)!;

                // Si es el último nivel (el archivo en sí), inyectamos la marginalia
                if (i === parts.length - 1) {
                    node.items.push(item);
                }

                currentLevel = node.children;
            }
        }

        // 2. Reutilizamos tu maravilloso sistema de Anclaje (Pin)
        if (!this.plugin.settings.pinnedThreads) this.plugin.settings.pinnedThreads = [];
        
        const pinnedRoots: SemanticTreeNode[] = [];
        const unpinnedRoots: SemanticTreeNode[] = [];

        tree.forEach(node => {
            if (this.plugin.settings.pinnedThreads.includes(node.fullPath)) {
                pinnedRoots.push(node);
            } else {
                unpinnedRoots.push(node);
            }
        });

        // 3. Enviamos el árbol a tu renderizador nativo (Hereda pines, colores y botón de Board)
        pinnedRoots.forEach(node => this.renderSemanticTree(node, container, isFilteredMode, 0));

        if (pinnedRoots.length > 0 && unpinnedRoots.length > 0) {
            const sep = container.createDiv();
            sep.style.height = '1px';
            sep.style.backgroundColor = 'var(--background-modifier-border)';
            sep.style.margin = '15px 0';
            sep.style.opacity = '0.5';
        }

        unpinnedRoots.forEach(node => this.renderSemanticTree(node, container, isFilteredMode, 0));
    }
    
// tag boxes
    renderThreads(rootItems: MarginaliaItem[], container: HTMLElement, isFilteredMode: boolean = false) {
        container.empty();
        if (rootItems.length === 0) {
            container.createEl('p', { text: 'No matching threads found.', cls: 'cornell-sidebar-empty' });
            return;
        }

        // 🧠 PASO 1.1: Construir el Árbol Fractal a partir de los tags
        const tree = new Map<string, SemanticTreeNode>();

        for (const root of rootItems) {
            // 🔍 EXTRAEMOS TODOS LOS TAGS (Interseccionalidad / Poliarquía)
            // Usamos matchAll para atrapar #glaucoma, #nieto, etc.
            const tagMatches = Array.from(root.text.matchAll(/#([a-zA-Z0-9_/-]+)/g));
            
            // Si tiene tags, iteramos sobre todos. Si no tiene ninguno, va a Untagged.
            const tagsToProcess = tagMatches.length > 0 ? tagMatches.map(m => m[1]) : ["Untagged"];

            // 🌳 MULTI-PRESENCIA: Por cada tag, creamos o ubicamos la caja correspondiente
            for (const fullTag of tagsToProcess) {
                const parts = fullTag.split('/'); // Lo rompe en ["abuelo", "padre"]

                let currentLevel = tree;
                let currentPath = "";

                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    currentPath += (i === 0 ? part : `/${part}`);

                    // Si esta "caja" no existe en este nivel, la creamos
                    if (!currentLevel.has(part)) {
                        currentLevel.set(part, {
                            name: part,
                            fullPath: `#${currentPath}`,
                            children: new Map(),
                            items: []
                        });
                    }

                    const node = currentLevel.get(part)!;

                    // Si llegamos a la profundidad final de ESTE tag, guardamos el hilo real aquí
                    if (i === parts.length - 1) {
                        // 🛡️ Evitamos duplicados visuales por si el usuario escribe el mismo tag 2 veces en la nota
                        // Usamos la ruta del archivo y la línea como su "ADN" único en lugar de un ID
                        if (!node.items.some(existing => existing.file?.path === root.file?.path && existing.line === root.line)) {
                            node.items.push(root);
                        }
                    }

                    currentLevel = node.children; // Bajamos al siguiente sub-nivel
                }
            }
        }

        // 🎨 PASO 1.2: Disparar el dibujado recursivo con Sistema de Anclaje (Pin)
        if (!this.plugin.settings.pinnedThreads) this.plugin.settings.pinnedThreads = [];
        
        const pinnedRoots: SemanticTreeNode[] = [];
        const unpinnedRoots: SemanticTreeNode[] = [];

        // Separamos las raíces
        tree.forEach(node => {
            if (this.plugin.settings.pinnedThreads.includes(node.fullPath)) {
                pinnedRoots.push(node);
            } else {
                unpinnedRoots.push(node);
            }
        });

        // 1. Dibujamos los fijados primero
        pinnedRoots.forEach(node => this.renderSemanticTree(node, container, isFilteredMode, 0));

        // 2. Línea separadora sutil (Solo si hay de ambos tipos)
        if (pinnedRoots.length > 0 && unpinnedRoots.length > 0) {
            const sep = container.createDiv();
            sep.style.height = '1px';
            sep.style.backgroundColor = 'var(--background-modifier-border)';
            sep.style.margin = '15px 0';
            sep.style.opacity = '0.5';
        }

        // 3. Dibujamos el resto
        unpinnedRoots.forEach(node => this.renderSemanticTree(node, container, isFilteredMode, 0));
    }

    // 🧼 PURIFICADOR UNIVERSAL PARA EXPORTACIONES
    cleanExportText(text: string): string {
        let clean = text;

        // 1. Limpiar Tags Estructurales (si está activado en settings)
        if (this.plugin.settings.exportCleanTags) {
            clean = clean.replace(/#[a-zA-Z0-9_/-]+/g, '');
        }

        // 2. Limpiar Block IDs y Stitches (si está activado en settings)
        if (this.plugin.settings.exportCleanIds) {
            // A. Destruye cualquier ID nativo o de Anki en CUALQUIER lugar del texto (ej: ^anki-12345 o ^7mocgil)
            clean = clean.replace(/(?:\s+|^)\^[a-zA-Z0-9_-]+/g, '');
            
            // B. Destruye los enlaces de cosido (Stitches) que apuntan a IDs de bloque
            // Ej: [[otra nota#^u9h2aj]] o [[otra nota#^u9h2aj|alias]]
            clean = clean.replace(/\[\[[^\]]+#\^[a-zA-Z0-9_-]+(?:\|[^\]]+)?\]\]/g, '');
        }

        // 3. Limpiar sintaxis de Flashcards
        // 🎯 FIX: Simplemente borramos los ';;' ya que la respuesta vive en el contexto exterior
        clean = clean.replace(/\s*;;\s*/g, '');

        // 4. Elimina espacios dobles, saltos de línea huérfanos y recortes residuales
        return clean.trim().replace(/\s{2,}/g, ' ');
    }
// 🧵 NUEVO MOTOR RECURSIVO: Construye el texto de una marginalia y todos sus hijos
    buildThreadDropText(item: MarginaliaItem, depth: number, visitedIds: Set<string>, customTitle?: string, includeChildren: boolean = true): string {
        // 🛡️ Prevenir bucles infinitos (referencias circulares)
        if (item.blockId && visitedIds.has(item.blockId)) return ""; 
        const newVisited = new Set(visitedIds);
        if (item.blockId) newVisited.add(item.blockId);

        // 1. Variables de tiempo
        // @ts-ignore
        const dateStr = window.moment().format('YYYY-MM-DD');
        // @ts-ignore
        const timeStr = window.moment().format('HH:mm');
        
        let cleanText = this.cleanExportText(item.text);
        if (!cleanText) {
            cleanText = item.text.replace(/!\[\[(.*?)\]\]/g, '🖼️ [Image]').trim() || "Marginalia Doodle";
        }
        
        const targetId = item.blockId ? `#^${item.blockId}` : "";
        const sourceLink = item.file ? `[[${item.file.basename}${targetId}]]` : "";
        const citationText = item.context || "";
        
        const rootTitle = customTitle || (item.file ? item.file.basename : "Note");
        
        // 3. Aplicar motor de plantillas
        let lineStr = this.plugin.settings.dragDropTemplate || "- {{text}} {{source_note}}";
        lineStr = lineStr.replace(/{{title}}/g, rootTitle);
        lineStr = lineStr.replace(/{{date}}/g, dateStr);
        lineStr = lineStr.replace(/{{time}}/g, timeStr);
        lineStr = lineStr.replace(/{{text}}/g, cleanText);
        lineStr = lineStr.replace(/{{source_note}}/g, sourceLink);
        lineStr = lineStr.replace(/{{citation}}/g, citationText);

        // 4. Tabulación
        const indentSpaces = "\t".repeat(depth);
        let formattedItem = lineStr.split('\n').map(line => line.trim() ? indentSpaces + line : "").join('\n') + '\n';

        // 5. 🕷️ Buscar a los hijos SOLO si el interruptor está encendido
        if (includeChildren && item.outgoingLinks && item.outgoingLinks.length > 0) {
            for (const linkStr of item.outgoingLinks) {
                const parts = linkStr.split('#^');
                if (parts.length === 2) {
                    const childId = parts[1];
                    const childItem = this.cachedItems.find(i => i.blockId === childId);
                    if (childItem) {
                        // Si arrastramos hijos, la recursividad sigue activada hacia abajo
                        formattedItem += this.buildThreadDropText(childItem, depth + 1, newVisited, customTitle, true);
                    }
                }
            }
        }
        
        return formattedItem;
    }
    // 🪆 NUEVA FUNCIÓN: Dibuja cajas dentro de cajas al infinito
    renderSemanticTree(node: SemanticTreeNode, container: HTMLElement, isFilteredMode: boolean, depth: number) {
        // 1. El recuadro mayor de este nivel
        const groupEl = container.createDiv({ cls: 'cornell-thread-parent' });
        groupEl.style.border = '1px solid var(--background-modifier-border)';
        groupEl.style.marginBottom = '10px';
        groupEl.style.borderRadius = '6px';
        groupEl.style.overflow = 'hidden';
        groupEl.style.backgroundColor = depth > 0 ? 'var(--background-primary-alt)' : 'transparent';
        
        // Atributos de datos que usaremos en el Paso 2 para la "Fagocitación" (Drag & Drop)
        groupEl.setAttribute('data-semantic-path', node.fullPath);

        // 2. Cabecera del recuadro
        const headerEl = groupEl.createDiv({ cls: 'cornell-thread-header' });
        headerEl.style.fontWeight = 'bold';
        headerEl.style.padding = '6px 10px';
        headerEl.style.backgroundColor = 'var(--background-secondary)';
        headerEl.style.display = 'flex';
        headerEl.style.alignItems = 'center';
        headerEl.style.gap = '6px';
        headerEl.style.cursor = 'pointer';

        // 🧠 INTELIGENCIA DE MODO (Detecta si es un Tag o una Carpeta Física)
        const isFolderMode = node.fullPath.startsWith('📁');
        const isFile = isFolderMode && node.children.size === 0;

        // ORDEN VISUAL 1: 🔘 Icono de colapso (flecha)
        const toggleIcon = headerEl.createSpan({ cls: 'cornell-collapse-icon' });
        setIcon(toggleIcon, 'chevron-down');
        toggleIcon.style.color = 'var(--text-muted)';
        
        if (!this.plugin.settings.pinnedThreads) this.plugin.settings.pinnedThreads = [];
        const isPinned = this.plugin.settings.pinnedThreads.includes(node.fullPath);

        // ORDEN VISUAL 2: 📁 Icono dinámico (Tag, Carpeta o Archivo)
        const iconSpan = headerEl.createSpan();
        if (isPinned) {
            setIcon(iconSpan, 'pin');
            iconSpan.style.color = 'var(--interactive-accent)';
        } else if (isFolderMode) {
            setIcon(iconSpan, isFile ? 'file-text' : 'folder');
            if (isFile) iconSpan.style.color = 'var(--interactive-accent)';
        } else {
            setIcon(iconSpan, depth === 0 ? 'folder-closed' : 'folder-tree'); 
        }
        
        // ORDEN VISUAL 3: 📝 Texto
        const displayName = isFolderMode ? node.name : node.name.toUpperCase();
        headerEl.createSpan({ text: displayName });

        if (isFile) {
            headerEl.createSpan({ text: `(${node.items.length})`, attr: { style: 'margin-left: 4px; font-size: 0.85em; color: var(--text-muted); font-weight: normal;' }});
        }

        // ORDEN VISUAL 4: 🎛️ CONTROLES HOVER (Botones mágicos)
        const controlsEl = headerEl.createDiv({ cls: 'cornell-thread-controls' });
        controlsEl.style.marginLeft = 'auto'; 
        controlsEl.style.display = 'flex';
        controlsEl.style.gap = '10px';
        controlsEl.style.opacity = '0'; 
        controlsEl.style.transition = 'opacity 0.2s ease';

        headerEl.addEventListener('mouseenter', () => controlsEl.style.opacity = '1');
        headerEl.addEventListener('mouseleave', () => controlsEl.style.opacity = '0');

        // 📌 BOTÓN DE FIJAR (PIN)
        const pinBtn = controlsEl.createEl('span', { attr: { title: isPinned ? "Unpin" : "Pin to top" }});
        pinBtn.style.cursor = 'pointer';
        pinBtn.style.color = isPinned ? 'var(--interactive-accent)' : 'var(--text-muted)';
        setIcon(pinBtn, 'pin');

        pinBtn.onclick = async (e) => {
            e.stopPropagation();
            if (isPinned) {
                this.plugin.settings.pinnedThreads = this.plugin.settings.pinnedThreads.filter(p => p !== node.fullPath);
            } else {
                this.plugin.settings.pinnedThreads.push(node.fullPath);
            }
            await this.plugin.saveSettings();
            this.applyFiltersAndRender();
        };

        // 🎨 BOTÓN DE COLOR
        const colorBtn = controlsEl.createEl('span', { attr: { title: "Paint Box (Saves to Settings)" }});
        colorBtn.style.cursor = 'pointer';
        colorBtn.style.color = 'var(--text-muted)';
        setIcon(colorBtn, 'palette'); 

        const colorInput = controlsEl.createEl('input', { type: 'color' });
        colorInput.style.display = 'none';

        colorBtn.onclick = (e) => {
            e.stopPropagation(); 
            colorInput.click();
        };

        colorInput.onchange = async (e: Event) => {
            const newColor = (e.target as HTMLInputElement).value;
            if (!this.plugin.settings.structuralColors) this.plugin.settings.structuralColors = [];
            const existing = this.plugin.settings.structuralColors.find(c => c.tag === node.fullPath);
            if (existing) {
                existing.color = newColor;
            } else {
                this.plugin.settings.structuralColors.push({ tag: node.fullPath, color: newColor });
            }
            await this.plugin.saveSettings();
            this.applyFiltersAndRender();
        };

        // ⏺︎ BOTÓN DE EXPORTAR AL BOARD
        const exportBtn = controlsEl.createEl('span', { text: "⏺︎", attr: { title: "Export full tree to Board" }});
        exportBtn.style.cursor = 'pointer';
        exportBtn.style.color = 'var(--text-muted)';
        exportBtn.style.fontSize = '1.2em';
        exportBtn.style.lineHeight = '1';

        exportBtn.onclick = (e) => {
            e.stopPropagation(); 
            const pushItemAndChildrenToBoard = (marginalia: MarginaliaItem, indent: number, visitedIds: Set<string>) => {
                if (marginalia.blockId && visitedIds.has(marginalia.blockId)) return;
                const newVisited = new Set(visitedIds);
                if (marginalia.blockId) newVisited.add(marginalia.blockId);

                const alreadyPinned = this.pinboardItems.some(p => 
                    p.file && marginalia.file && p.blockId === marginalia.blockId && p.file.path === marginalia.file.path
                );
                
                if (!alreadyPinned) {
                    this.pinboardItems.push({ ...marginalia, indentLevel: indent });
                }
                // 🕷️ Buscar y propagar a los hijos
                // 🛑 CORRECCIÓN: Solo atrapar a los hijos si estamos en el modo Hilos
                if (this.currentTab === 'threads' && marginalia.outgoingLinks && marginalia.outgoingLinks.length > 0) {
                    for (const linkStr of marginalia.outgoingLinks) {
                        const parts = linkStr.split('#^');
                        if (parts.length === 2) {
                            const childId = parts[1].split('|')[0].trim();
                            const childItem = this.cachedItems.find(i => i.blockId === childId);
                            if (childItem) pushItemAndChildrenToBoard(childItem, indent + 1, newVisited);
                        }
                    }
                }
            };

            const exportTreeToBoard = (currentNode: any, currentDepth: number) => {
                const headingLevel = '#'.repeat(currentDepth + 1); 
                const headingText = `${headingLevel} ${currentNode.name.toUpperCase()}`;
                
                this.pinboardItems.push({
                    text: headingText, rawText: headingText, color: 'transparent',
                    file: null as any, line: -1, blockId: null, outgoingLinks: [], isTitle: true 
                });

                for (const item of currentNode.items) {
                    pushItemAndChildrenToBoard(item, 0, new Set<string>());
                }
                currentNode.children.forEach((child: any) => exportTreeToBoard(child, currentDepth + 1));
            };

            exportTreeToBoard(node, depth);
            this.applyFiltersAndRender();
            new Notice(`📦 ${node.name} exportado al Board con todos sus hilos!`);
        };

        const contentEl = groupEl.createDiv({ cls: 'cornell-thread-content' });
        contentEl.style.padding = '10px';
        contentEl.style.display = 'flex';
        contentEl.style.flexDirection = 'column';
        contentEl.style.gap = '4px';

        // 🎨 MOTOR DE COLOR ESTRUCTURAL
        let matchedColor: string | null = null;
        if (this.plugin.settings?.structuralColors) {
            for (const structColor of this.plugin.settings.structuralColors) {
                const settingTag = structColor.tag.trim();
                if (settingTag === node.fullPath || settingTag === node.name || settingTag === `#${node.name}`) {
                    matchedColor = structColor.color;
                    break; 
                }
            }
        }

        if (matchedColor) {
            groupEl.style.border = `1px solid ${matchedColor}66`; 
            groupEl.style.borderLeft = `4px solid ${matchedColor}`; 
            headerEl.style.backgroundColor = `${matchedColor}22`; 
            headerEl.style.color = matchedColor;
            iconSpan.style.color = matchedColor;
            toggleIcon.style.color = matchedColor;
        }

        // ==========================================
        // 🧠 LÓGICA DE COLAPSO Y LAZY LOADING (Cero Lag)
        // ==========================================
        if (!this.plugin.settings.collapsedBoxes) this.plugin.settings.collapsedBoxes = [];
        
        let isCollapsed = isFolderMode ? true : false;
        
        if (this.plugin.settings.collapsedBoxes.includes(node.fullPath)) {
            isCollapsed = !isCollapsed;
        }

        contentEl.style.display = isCollapsed ? 'none' : 'flex';
        setIcon(toggleIcon, isCollapsed ? 'chevron-right' : 'chevron-down');
        headerEl.style.borderBottom = isCollapsed ? 'none' : '1px solid var(--background-modifier-border)';

        let isRendered = false; 

        const renderItemsLazy = () => {
            if (isRendered) return;
            
            // 3. Dibujar las notas (Con inteligencia de pestañas)
            for (const rootItem of node.items) {
                
                if (this.currentTab === 'threads') {
                    // 🧵 MODO HILOS: Tarjetas envueltas, recursivas y arrastrables con todo su árbol
                    const threadWrapper = contentEl.createDiv({ cls: 'cornell-draggable-thread' });
                    threadWrapper.setAttr('draggable', 'true');
                    threadWrapper.style.cursor = 'grab';
                    threadWrapper.style.backgroundColor = 'var(--background-primary)';
                    threadWrapper.style.border = '1px solid var(--background-modifier-border)';
                    threadWrapper.style.borderRadius = '6px';
                    threadWrapper.style.padding = '8px';
                    threadWrapper.style.marginBottom = '10px'; 
                    threadWrapper.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.05)';
                    threadWrapper.style.transition = 'box-shadow 0.2s ease, opacity 0.2s';
                    
                    threadWrapper.addEventListener('dragstart', (e: DragEvent) => {
                        if (!e.dataTransfer) return;
                        e.stopPropagation(); // 🛑 Evita arrastrar la caja padre por accidente
                        
                        // A. Datos internos para el plugin (Fagocitación / Fusión)
                        e.dataTransfer.setData('application/cornell-single-thread', JSON.stringify({
                            filePath: rootItem.file.path,
                            rawText: rootItem.rawText,
                            currentTag: node.fullPath,
                            line: rootItem.line
                        }));

                        // B. 📝 LA SOLUCIÓN UNTAGGED: Texto plano para Obsidian (Markdown/Canvas)
                        // Al ser la pestaña Threads, SIEMPRE arrastramos con los hijos incluidos (true)
                        const dragPayload = this.buildThreadDropText(rootItem, 0, new Set<string>(), undefined, true);
                        e.dataTransfer.setData('text/plain', dragPayload.trim());
                        CornellNotesView.lastDraggedPayload = dragPayload.trim(); //  EL HILO EN MEMORIA!
                        
                        e.dataTransfer.effectAllowed = 'copyMove';
                        setTimeout(() => threadWrapper.style.opacity = '0.5', 0);
                    });

                    threadWrapper.addEventListener('dragend', (e: DragEvent) => {
    e.stopPropagation();
    threadWrapper.style.opacity = '1';
    this.triggerTemplaterAfterDrop();

    // ⚡ INVOCAMOS AL NUEVO MOTOR
    
});

                    // Dibuja el hilo y sus descendientes visualmente
                    this.renderThreadNode(rootItem, threadWrapper, this.cachedItems, new Set<string>(), isFilteredMode, true);
                
                } else {
                    // 📁 MODO VAULT (CARPETAS): Marginalias individuales, planas y puras
                    const marginaliaDOM = this.createItemDiv(rootItem, contentEl);
                    marginaliaDOM.classList.add('cornell-sidebar-item');
                    marginaliaDOM.tabIndex = 0;
                }
            }
            isRendered = true;
        };

        if (!isCollapsed) renderItemsLazy();

        headerEl.onclick = async (e: MouseEvent) => {
            e.stopPropagation(); 
            isCollapsed = !isCollapsed; 
            
            contentEl.style.display = isCollapsed ? 'none' : 'flex';
            setIcon(toggleIcon, isCollapsed ? 'chevron-right' : 'chevron-down');
            headerEl.style.borderBottom = isCollapsed ? 'none' : '1px solid var(--background-modifier-border)';

            if (!isCollapsed) renderItemsLazy();

            if (this.plugin.settings.collapsedBoxes.includes(node.fullPath)) {
                this.plugin.settings.collapsedBoxes = this.plugin.settings.collapsedBoxes.filter(path => path !== node.fullPath);
            } else {
                this.plugin.settings.collapsedBoxes.push(node.fullPath);
            }
            await this.plugin.saveSettings();
        };

        // ==========================================
        // 🛸 MAGIA D&D (FAGOCITACIÓN)
        // ==========================================
        groupEl.setAttr('draggable', 'true');
        groupEl.style.cursor = 'grab';
        
        groupEl.addEventListener('dragstart', (e: DragEvent) => {
            if (!e.dataTransfer) return;
            e.stopPropagation(); 

            e.dataTransfer.setData('application/cornell-semantic-path', node.fullPath);
            const isMajor = node.children.size > 0 ? 'true' : 'false';
            e.dataTransfer.setData('application/cornell-is-major', isMajor);

            let dropText = "";
            const rootTitle = node.name.toUpperCase(); 

            const buildDropText = (currentNode: any, currentDepth: number) => {
                const headingLevel = '#'.repeat(currentDepth + 1); 
                dropText += `${headingLevel} ${currentNode.name.toUpperCase()}\n\n`;
                
                const includeChildren = this.currentTab === 'threads'; // 🧠 INTELIGENCIA CONTEXTUAL

                for (const item of currentNode.items) {
                    dropText += this.buildThreadDropText(item, 0, new Set<string>(), rootTitle, includeChildren);
                }
                dropText += "\n";
                currentNode.children.forEach((child: any) => buildDropText(child, currentDepth + 1));
            };
            
            buildDropText(node, 0);

            e.dataTransfer.setData('text/plain', dropText.trim());
            CornellNotesView.lastDraggedPayload = dropText.trim(); //  EL RECUADRO EN MEMORIA!
            e.dataTransfer.effectAllowed = 'copyMove';
            
            setTimeout(() => groupEl.style.opacity = '0.5', 0);
        });

        groupEl.addEventListener('dragend', (e: DragEvent) => {
    e.stopPropagation();
    groupEl.style.opacity = '1';
    this.triggerTemplaterAfterDrop();

    // ⚡ INVOCAMOS AL NUEVO MOTOR
    
});

        groupEl.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation(); 
            e.dataTransfer!.dropEffect = 'move';
            groupEl.style.boxShadow = '0 0 0 2px var(--interactive-accent) inset';
        });

        groupEl.addEventListener('dragleave', (e: DragEvent) => {
            e.stopPropagation();
            groupEl.style.boxShadow = '';
        });

        groupEl.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            groupEl.style.boxShadow = '';

            const targetPath = node.fullPath; 

            // 🛡️ ESCUDO: Si es una caja de carpeta/archivo, abortamos la fusión
            if (targetPath.startsWith('📁')) {
                new Notice("⚠️ Cannot merge physical folders or files. Please use the Obsidian file explorer to move them.");
                return;
            }

            const singleThreadData = e.dataTransfer?.getData('application/cornell-single-thread');
            if (singleThreadData) {
                const threadPayload = JSON.parse(singleThreadData);
                if (threadPayload.currentTag === targetPath) return; 
                await this.executeSingleThreadMerge(threadPayload, targetPath);
                return; 
            }

            const sourcePath = e.dataTransfer?.getData('application/cornell-semantic-path');
            if (sourcePath) {
                if (sourcePath === targetPath || targetPath.startsWith(`${sourcePath}/`)) {
                    new Notice("⚠️ You cannot merge a box into itself or its own children.");
                    return;
                }

                const isSourceMajor = e.dataTransfer?.getData('application/cornell-is-major') === 'true';
                const isTargetMajor = node.children.size > 0;

                if (!isSourceMajor && isTargetMajor) {
                    await this.executeFractalMerge(sourcePath, targetPath);
                } else {
                    new ThreadMergeModal(this.plugin.app, sourcePath, targetPath, async (newParentName) => {
                        await this.executeGroupMerge(sourcePath, targetPath, newParentName);
                    }).open();
                }
            }
        });

        const pinnedChildren: SemanticTreeNode[] = [];
        const unpinnedChildren: SemanticTreeNode[] = [];

        node.children.forEach(childNode => {
            if (this.plugin.settings.pinnedThreads.includes(childNode.fullPath)) {
                pinnedChildren.push(childNode);
            } else {
                unpinnedChildren.push(childNode);
            }
        });

        pinnedChildren.forEach(childNode => this.renderSemanticTree(childNode, contentEl, isFilteredMode, depth + 1));

        if (pinnedChildren.length > 0 && unpinnedChildren.length > 0) {
            const sep = contentEl.createDiv();
            sep.style.height = '1px';
            sep.style.backgroundColor = 'var(--background-modifier-border)';
            sep.style.margin = '5px 0';
            sep.style.opacity = '0.3';
        }

        unpinnedChildren.forEach(childNode => this.renderSemanticTree(childNode, contentEl, isFilteredMode, depth + 1));
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

        // 🎯 RENDERIZADO DEL BANNER ZOTLIKE PERSISTENTE
        if (this.isZotlikeMode) {
            const zotBanner = container.createDiv({ cls: 'cornell-sidebar-item' });
            zotBanner.style.borderLeftColor = 'var(--interactive-accent)';
            zotBanner.style.backgroundColor = 'var(--background-secondary)';
            zotBanner.style.marginBottom = '15px';
            zotBanner.style.padding = '10px';
            zotBanner.style.borderRadius = '4px';
            zotBanner.createDiv({ text: `📚 Linked to Active PDF:`, attr: { style: 'font-size: 0.85em; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;' } });
            zotBanner.createDiv({ text: this.activePdfName, attr: { style: 'font-weight: bold; color: var(--text-accent); word-break: break-all; font-size: 1.1em;' } });
        }

        for (const [color, items] of Object.entries(results)) {
            if (items.length === 0) continue;
            totalFound += items.length;

            const groupHeader = container.createDiv({ cls: 'cornell-sidebar-group' });
            const colorDot = groupHeader.createSpan({ cls: 'cornell-sidebar-color-dot' });
            colorDot.style.backgroundColor = color;
            groupHeader.createSpan({ text: `${items.length} notes` });

            for (const item of items) {
                // 🧠 MAGIA LIMPIA: Usamos directamente la marginalia creada, sin cajas extra
                const marginaliaDOM = this.createItemDiv(item, container);
                
                // Le inyectamos la capacidad de recibir foco del teclado
                marginaliaDOM.classList.add('cornell-sidebar-item'); // Etiqueta para que el comando Alt+E lo encuentre
                marginaliaDOM.tabIndex = 0; 
                marginaliaDOM.style.outline = 'none';

                // 🎯 Foco visual usando 'outline' (no afecta los bordes nativos ni mueve el diseño)
                marginaliaDOM.addEventListener('focus', () => { 
                    marginaliaDOM.style.outline = '2px solid var(--interactive-accent)'; 
                    marginaliaDOM.style.outlineOffset = '2px'; // Lo empuja hacia afuera para que no pise tu color
                });
                marginaliaDOM.addEventListener('blur', () => { 
                    marginaliaDOM.style.outline = 'none';
                });

                // 🏎️ MOTOR DE NAVEGACIÓN Y ACCIONES
                // 🏎️ MOTOR DE NAVEGACIÓN Y ACCIONES (RESTAURADO Y MEJORADO)
                marginaliaDOM.addEventListener('keydown', async (e) => {

                    // 🧠 Función auxiliar para pinear rápidamente sin duplicar código
                    // 🧠 Función auxiliar para pinear rápidamente sin duplicar código
                    const pinCurrentItem = (targetItem: MarginaliaItem, domEl: HTMLElement) => {
                        // 🛡️ BLINDADO: Verificamos que "pinned.file" y "targetItem.file" existan 
                        // antes de comparar rutas, para no chocar con títulos o auto-pastes.
                        const alreadyPinned = this.pinboardItems.some(pinned => 
                            pinned.file && targetItem.file && 
                            pinned.blockId === targetItem.blockId && 
                            pinned.file.path === targetItem.file.path
                        );

                        if (!alreadyPinned) {
                            this.pinboardItems.push(targetItem);
                            new Notice(`📌 Pinned: ${targetItem.text.substring(0, 15)}...`);

                            // Efecto visual de destello verde
                            const originalBg = domEl.style.backgroundColor;
                            domEl.style.backgroundColor = 'var(--color-green)';
                            setTimeout(() => domEl.style.backgroundColor = originalBg, 200);
                        }
                    };

                    if (e.key === 'ArrowUp') {
                        e.preventDefault(); e.stopPropagation();
                        let prev = marginaliaDOM.previousElementSibling as HTMLElement;
                        while (prev && prev.tabIndex < 0) { prev = prev.previousElementSibling as HTMLElement; }
                        if (prev) {
                            prev.focus();
                            // 🚀 PIN MASIVO: Si mantienes presionado Shift mientras subes
                            if (e.shiftKey) pinCurrentItem(item, marginaliaDOM);
                        }

                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault(); e.stopPropagation();
                        let next = marginaliaDOM.nextElementSibling as HTMLElement;
                        while (next && next.tabIndex < 0) { next = next.nextElementSibling as HTMLElement; }
                        if (next) {
                            next.focus();
                            // 🚀 PIN MASIVO: Si mantienes presionado Shift mientras bajas
                            if (e.shiftKey) pinCurrentItem(item, marginaliaDOM);
                        }

                    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        // 🚀 CTRL + ENTER = Ir a la nota original
                        e.preventDefault(); e.stopPropagation();
                        const leaf = this.plugin.app.workspace.getLeaf(false);
                        await leaf.openFile(item.file, { eState: { line: item.line } });

                    } else if (e.key === 'Enter' || e.key.toLowerCase() === 'p') {
                        // 📌 ENTER o P = Pinear al Board (Restaurado)
                        e.preventDefault(); e.stopPropagation();
                        pinCurrentItem(item, marginaliaDOM);

                    } else if (e.code === 'Space') {
                        e.preventDefault(); e.stopPropagation();
                        const selIndex = this.selectedForStitch.findIndex(i => i === item);
                        if (selIndex > -1) {
                            this.selectedForStitch.splice(selIndex, 1);
                            marginaliaDOM.style.boxShadow = ''; 
                        } else {
                            this.selectedForStitch.push(item);
                            marginaliaDOM.style.boxShadow = '0 0 0 2px var(--color-blue) inset'; 
                        }

                    }  else if (e.key.toLowerCase() === 'h') {
                        // 👁️ HOVER (Restaurado)
                        e.preventDefault(); e.stopPropagation();
                        const hoverEvent = new MouseEvent('mouseenter', { bubbles: true, cancelable: true });
                        marginaliaDOM.dispatchEvent(hoverEvent);

                    } else if (e.key === 'Escape') {
                        // 🚪 CERRAR HOVER (Restaurado)
                        e.preventDefault(); e.stopPropagation();
                        const leaveEvent = new MouseEvent('mouseleave', { bubbles: true, cancelable: true });
                        marginaliaDOM.dispatchEvent(leaveEvent);
                        document.querySelectorAll('.hover-popover').forEach(el => el.remove());
                    }
                });
            }
        }
        
        if (totalFound === 0) container.createEl('p', { text: 'No notes match your search.', cls: 'cornell-sidebar-empty' });
    }
    // 🦴 NUEVO MOTOR: Importador de Esqueletos
    async importActiveFileSkeleton() {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("⚠️ Open a note first to import its skeleton.");
            return;
        }

        const content = await this.plugin.app.vault.cachedRead(activeFile);
        const lines = content.split('\n');
        let importedCount = 0;

        for (const line of lines) {
            // Detectar Títulos
            const titleMatch = line.match(/^(#+)\s+(.*)/);
            if (titleMatch) {
                this.pinboardItems.push({
                    text: line, rawText: line, color: 'transparent', file: null as any, line: -1, blockId: null, outgoingLinks: [], isTitle: true
                });
                importedCount++;
                continue;
            }

            // Detectar Outlines/Viñetas (calculando la sangría)
            const listMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
            if (listMatch) {
                const spaces = listMatch[1].length;
                const level = Math.floor(spaces / 2); // Asume 2 espacios por nivel de sangría
                const text = listMatch[2];
                this.pinboardItems.push({
                    text: text, rawText: text, color: 'transparent', file: null as any, line: -1, blockId: null, outgoingLinks: [], isCustom: true, indentLevel: level
                });
                importedCount++;
            }
        }

        if (importedCount > 0) {
            new Notice(`🦴 Imported ${importedCount} skeleton nodes!`);
            this.applyFiltersAndRender();
        } else {
            new Notice("No headers or lists found in this note.");
        }
    }

    createItemDiv(item: MarginaliaItem, parentContainer: HTMLElement, isPinboardView: boolean = false, pinIndex: number = -1): HTMLElement {
        const itemDiv = parentContainer.createDiv({ cls: 'cornell-sidebar-item' });
        itemDiv.style.borderLeftColor = item.color;

        const textRow = itemDiv.createDiv({ cls: 'cornell-sidebar-item-text' });
        textRow.style.display = 'flex';
        textRow.style.justifyContent = 'space-between';
        textRow.style.alignItems = 'flex-start';

        // 🕵️‍♂️ DETECCIÓN DE TAREAS (¡AHORA SÍ PARA TODAS LAS NOTAS!)
        const taskMatch = item.text.match(/^-\s*\[([ xX])\]\s+(.*)/);
        const isTask = !!taskMatch;
        const isChecked = taskMatch ? taskMatch[1].toLowerCase() === 'x' : false;

        if (isTask) {
            const checkbox = textRow.createEl('input', { type: 'checkbox' });
            checkbox.checked = isChecked;
            checkbox.style.marginRight = '8px';
            checkbox.style.marginTop = '4px';
            checkbox.style.cursor = 'pointer';
            checkbox.style.flexShrink = '0';
            
            checkbox.onclick = async (e) => {
                e.stopPropagation();
                const targetState = checkbox.checked ? 'x' : ' ';
                
                await this.plugin.app.vault.process(item.file, (data) => {
                    const lines = data.split('\n');
                    if (item.line >= 0 && item.line < lines.length) {
                        // 💥 AUTO-DESTRUCTOR
                        // 💥 AUTO-DESTRUCTOR TOTAL: Destruye el envoltorio %%> %% también
                                if (checkbox.checked && this.plugin.settings.deleteCompletedTasks) {
                                    // Escapamos los caracteres raros para la búsqueda
                                    const escapedRaw = item.rawText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                                    // Buscamos el bloque completo: %%> texto %% o %%< texto %%
                                    const fullMarginaliaRegex = new RegExp(`%%[><]\\s*${escapedRaw}\\s*%%`, 'g');
                                    
                                    if (fullMarginaliaRegex.test(lines[item.line])) {
                                        lines[item.line] = lines[item.line].replace(fullMarginaliaRegex, '');
                                    } else {
                                        lines[item.line] = lines[item.line].replace(item.rawText, ''); // Fallback
                                    }
                                    new Notice("🗑️ Task completed and marginalia deleted!");
                                } else {
                                    // MUTACIÓN NORMAL: Solo cambia la [ ] por [x]
                                    const newRaw = item.rawText.replace(/-\s*\[[ xX]\]/, `- [${targetState}]`);
                                    lines[item.line] = lines[item.line].replace(item.rawText, newRaw);
                                }
                    }
                    return lines.join('\n');
                });
                this.scanNotes();
            };
        }

        // 1. Creamos el contenedor vacío para el texto/imagen
        const textSpan = textRow.createSpan();
        textSpan.style.wordBreak = 'break-word';
        textSpan.style.flexGrow = '1';
        textSpan.style.marginRight = '10px';
        if (isChecked) textSpan.style.textDecoration = 'line-through';

        // 🎨 NUEVO: PRE-PROCESADOR DE IMÁGENES
        // Si es tarea, quitamos el " - [ ]" para que Obsidian no renderice doble checkbox
        let textToRender = isTask ? taskMatch![2] : item.text; 
        const imgRegex = /!\[\[(.*?(?:\.png|\.jpg|\.jpeg|\.gif|\.bmp|\.svg))\|?(.*?)\]\]/gi;
        
        textToRender = textToRender.replace(imgRegex, (match, filename) => {
            const trimmedFilename = filename.trim();
            
            // 1.🚀 REVISAR CACHÉ: ¿Ya buscamos esta imagen antes?
            if (this.imagePathCache[trimmedFilename]) {
                 // ¡Sí! Usamos la ruta guardada en RAM. Rápido.
                 const cachedPath = this.imagePathCache[trimmedFilename];
                 // Nota el cambio de estilo: max-height: 35px (tamaño renglón)
                 return `<img src="${cachedPath}" class="cornell-sidebar-thumb" style="max-height: 35px; width: auto; object-fit: contain; border-radius: 3px; display: inline-block; vertical-align: middle; margin-right: 5px;" />`;
            }

            // 2. SI NO ESTÁ EN CACHÉ: La buscamos en el disco (Lento la primera vez)
            const file = this.plugin.app.metadataCache.getFirstLinkpathDest(trimmedFilename, item.file.path);
            if (file) {
                const resourcePath = this.plugin.app.vault.getResourcePath(file);
                // Guardamos en caché para la próxima
                this.imagePathCache[trimmedFilename] = resourcePath;
                 // Nota el cambio de estilo: max-height: 35px
                return `<img src="${resourcePath}" class="cornell-sidebar-thumb" style="max-height: 35px; width: auto; object-fit: contain; border-radius: 3px; display: inline-block; vertical-align: middle; margin-right: 5px;" />`;
            }
            return match; // Si no existe, devolvemos el texto original
        });;

        // 2. 🎨 MAGIA PURA: Le pasamos el texto PROCESADO al motor nativo
        MarkdownRenderer.renderMarkdown(
            textToRender,      // 👈 AHORA LE PASAMOS EL TEXTO CON LA ETIQUETA <img>
            textSpan,          // Dónde lo vamos a dibujar
            item.file.path,    // 🔗 FUNDAMENTAL: La ruta base
            this               // El componente actual
        );  

        // 3. 🩹 Parche de Estilos Post-Renderizado
        setTimeout(() => {
            const paragraphs = textSpan.querySelectorAll('p');
            paragraphs.forEach(p => {
                p.style.margin = '0'; 
                p.style.display = 'inline';
            });
            
            const embeds = textSpan.querySelectorAll('.internal-embed, img');
            embeds.forEach(embed => {
                const el = embed as HTMLElement;
                
                // 🎨 ARREGLO DE MINIATURAS: El tamaño depende de dónde estamos
                if (isPinboardView) {
                    el.style.maxHeight = '180px'; // Grande para el corcho
                    el.style.display = 'block';
                    el.style.marginTop = '5px';
                } else {
                    el.style.maxHeight = '35px';  // Miniatura para la lista
                    el.style.display = 'inline-block';
                    el.style.verticalAlign = 'middle';
                    el.style.marginRight = '8px';
                }
                
                el.style.maxWidth = '100%';
                el.style.objectFit = 'contain';
                el.style.borderRadius = '4px';
            });
        }, 50);

        // 🧠 Controles de Jerarquía solo visibles en el Pinboard
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
        pinBtn.style.flexShrink = '0'; 
        pinBtn.style.cursor = 'pointer';
        pinBtn.style.marginLeft = '10px';
        pinBtn.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        pinBtn.style.opacity = (isPinboardView || isAlreadyPinned) ? '1' : '0';

        // 🚀 BOTÓN TASKNOTES (Solo aparece si es tarea y está habilitado en Settings)
        let taskBtn: HTMLElement | null = null;
        if (isTask && this.plugin.settings.enableTaskNotesIntegration) {
            taskBtn = textRow.createEl('span', { attr: { title: 'Send to TaskNotes' } });
            taskBtn.style.cursor = 'pointer';
            taskBtn.style.opacity = '0'; // Oculto por defecto
            taskBtn.style.flexShrink = '0';
            taskBtn.style.marginLeft = '8px';
            taskBtn.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            taskBtn.style.color = 'var(--color-blue)'; 
            setIcon(taskBtn, 'list-todo'); 

            taskBtn.onmouseenter = () => { taskBtn!.style.transform = 'scale(1.2)'; };
            taskBtn.onmouseleave = () => { taskBtn!.style.transform = 'scale(1)'; };

            taskBtn.onclick = (e) => {
                e.stopPropagation();
                const rawTitle = taskMatch![2];
                const cleanTitle = this.cleanExportText(rawTitle); 
                
                const tagMatches = [...rawTitle.matchAll(/#([a-zA-Z0-9_/-]+)/g)];
                const tags = tagMatches.map(m => m[1]);

                this.plugin.sendToTaskNotes(cleanTitle, tags);
            };
        }

        // Lógica Hover para mostrar AMBOS botones
        itemDiv.addEventListener('mouseenter', () => {
            const currentPinned = this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path);
            if (!isPinboardView && !currentPinned) pinBtn.style.opacity = '0.5';
            if (taskBtn) taskBtn.style.opacity = '1'; // Muestra TaskNotes
        });

        itemDiv.addEventListener('mouseleave', () => {
            const currentPinned = this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path);
            if (!isPinboardView && !currentPinned) pinBtn.style.opacity = '0';
            if (taskBtn) taskBtn.style.opacity = '0'; // Oculta TaskNotes
        });

        pinBtn.onmouseenter = () => { pinBtn.style.opacity = '1'; pinBtn.style.transform = 'scale(1.2)'; };
        pinBtn.onmouseleave = () => { 
            pinBtn.style.transform = 'scale(1)'; 
            const currentPinned = this.pinboardItems.some(p => p.rawText === item.rawText && p.file.path === item.file.path);
            if (!isPinboardView && !currentPinned) pinBtn.style.opacity = '0.5';
        };

        pinBtn.onclick = (e) => {
            e.stopPropagation(); 
            // 🧹 CAZAFANTASMAS 2: Destruye el tooltip instantáneamente al hacer clic
            document.querySelectorAll('.cornell-hover-tooltip').forEach(el => el.remove());
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
            // 1. MODO STITCHING (Prioridad Absoluta)
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

            // 📖 2. NUEVO: MODO SALTO DIRECTO PDF SUPER-CAZADOR
            if (this.isDirectPdfModeActive) {
                const searchArea = `${item.context || ""} ${item.rawText || ""} ${item.text || ""}`;
                
                // 1. Cazador de Enlaces Obsidian (WikiLinks)
                // Atrapa: [[Archivo.pdf#...|Alias]] o inclusos rotos como ![Archivo.pdf#...|Alias]]
                const wikiRegex = /\[+([^\[\]]+\.pdf[^\]]*?)\]+/i;
                
                // 2. Cazador de Enlaces Markdown
                // Atrapa: [Alias](Archivo.pdf#...)
                const mdRegex = /\[.*?\]\((.*?\.pdf.*?)\)/i;
                
                // 3. Cazador de Emergencia (Texto plano)
                const fallbackRegex = /([a-zA-Z0-9_ \-\.]+\.pdf(?:#[a-zA-Z0-9=&,\-\.]+)?)/i;

                let pdfLink = "";
                
                const wikiMatch = searchArea.match(wikiRegex);
                const mdMatch = searchArea.match(mdRegex);
                const fallbackMatch = searchArea.match(fallbackRegex);

                if (wikiMatch) {
                    // Si encontró un [[Link]], le quitamos el alias (|Mi texto)
                    pdfLink = wikiMatch[1].split('|')[0].trim();
                } else if (mdMatch) {
                    pdfLink = mdMatch[1].trim();
                } else if (fallbackMatch) {
                    pdfLink = fallbackMatch[1].trim();
                }

                if (pdfLink) {
                    console.log("🔗 PDF++ Link capturado:", pdfLink); 
                    await this.plugin.app.workspace.openLinkText(pdfLink, item.file.path, false);
                    return; // 🛑 Cortamos aquí para que no abra el markdown
                } else {
                    new Notice("⚠️ No se encontró una cita a un PDF en esta marginalia.");
                }
            }

            // 📝 3. COMPORTAMIENTO NORMAL: Abrir la nota markdown
            const leaf = this.plugin.app.workspace.getLeaf(false);
            await leaf.openFile(item.file, { eState: { line: item.line } });
        };

        // 🛡️ MOTOR DE VISIÓN DE RAYOS X (Estabilidad Absoluta + Integración PDF++)
        let hoverTimeout: NodeJS.Timeout | null = null;
        let tooltipEl: HTMLElement | null = null;
        let tooltipComponent: Component | null = null;
        let isHovering = false; 

        const removeTooltip = () => {
            isHovering = false; 
            if (hoverTimeout) clearTimeout(hoverTimeout);
            if (tooltipComponent) { tooltipComponent.unload(); tooltipComponent = null; }
            if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
            document.querySelectorAll('.cornell-hover-tooltip').forEach(el => el.remove());
        };

        itemDiv.addEventListener('mouseenter', (e: MouseEvent) => {
            isHovering = true;
            hoverTimeout = setTimeout(async () => {
                if (!isHovering) return; 
                const content = await this.plugin.app.vault.cachedRead(item.file);
                if (!isHovering || !document.body.contains(itemDiv)) return;
                const lines = content.split('\n');

                let startLine = item.line;
                let endLine = item.line;
                let textWithoutMarginalia = lines[item.line].replace(/%%[><](.*?)%%/g, '').trim();
                textWithoutMarginalia = textWithoutMarginalia.replace(/\^[a-zA-Z0-9_-]+$/, '').trim();

                let isTargetingCallout = false;

                if (lines[item.line].trim().startsWith('>')) {
                    isTargetingCallout = true;
                } else if (textWithoutMarginalia === '') {
                    let nextIdx = item.line + 1;
                    while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
                    if (nextIdx < lines.length && lines[nextIdx].trim().startsWith('>')) {
                        isTargetingCallout = true;
                        startLine = nextIdx;
                        endLine = nextIdx;
                    }
                }

                if (isTargetingCallout) {
                    while (startLine > 0 && lines[startLine - 1].trim().startsWith('>')) startLine--;
                    while (endLine < lines.length - 1 && lines[endLine + 1].trim().startsWith('>')) endLine++;
                } else {
                    while (startLine > 0 && lines[startLine - 1].trim() !== '' && !lines[startLine - 1].trim().startsWith('>')) startLine--;
                    while (endLine < lines.length - 1 && lines[endLine + 1].trim() !== '' && !lines[endLine + 1].trim().startsWith('>')) endLine++;
                }
                
                removeTooltip(); 

                // 👁️ VISIÓN PANORÁMICA Y CAZADOR DE 3 NIVELES (PDF++)
                const wikiRegex = /\[+([^\[\]]+\.pdf[^\]]*?)\]+/i;
                const mdRegex = /\[.*?\]\((.*?\.pdf.*?)\)/i;
                const fallbackRegex = /([a-zA-Z0-9_ \-\.]+\.pdf(?:#[a-zA-Z0-9=&,\-\.]+)?)/i;
                
                let pdfLinkText = null;

                for (let j = startLine; j <= endLine; j++) {
                    const lineStr = lines[j];
                    const wikiMatch = lineStr.match(wikiRegex);
                    const mdMatch = lineStr.match(mdRegex);
                    const fallbackMatch = lineStr.match(fallbackRegex);

                    if (wikiMatch) pdfLinkText = wikiMatch[1].split('|')[0].trim();
                    else if (mdMatch) pdfLinkText = mdMatch[1].trim();
                    else if (fallbackMatch) pdfLinkText = fallbackMatch[1].trim();

                    if (pdfLinkText) break;
                }

                if (pdfLinkText) {
                    this.plugin.app.workspace.trigger("hover-link", {
                        event: e, source: "preview", hoverParent: itemDiv,
                        targetEl: itemDiv, linktext: pdfLinkText, sourcePath: item.file.path
                    });
                    return;
                }

                let rawBlock = '';
                let highlightApplied = false;
                for (let i = startLine; i <= endLine; i++) {
                    let cleanLine = lines[i].replace(/%%[><](.*?)%%/g, '').trim();
                    if (cleanLine.startsWith('```')) continue;
                    if (cleanLine) {
                        if ((i === item.line || (i >= item.line && !highlightApplied)) && !highlightApplied) {
                            rawBlock += `==${cleanLine}==\n`; highlightApplied = true;
                        } else rawBlock += `${cleanLine}\n`;
                    }
                }

                tooltipEl = document.createElement('div');
                tooltipEl.className = 'popover hover-popover cornell-hover-tooltip markdown-rendered markdown-preview-view'; 
                tooltipEl.style.position = 'fixed'; 
                tooltipEl.style.zIndex = '99999';
                tooltipEl.style.width = '450px'; 
                tooltipEl.style.maxHeight = '350px'; 
                tooltipEl.style.overflowY = 'auto'; 
                tooltipEl.style.backgroundColor = 'var(--background-primary)';
                tooltipEl.style.border = '1px solid var(--background-modifier-border)';
                tooltipEl.style.boxShadow = '0 10px 20px rgba(0,0,0,0.3)';
                tooltipEl.style.borderRadius = '8px';
                tooltipEl.style.padding = '12px';
                tooltipEl.style.display = 'flex'; 
                tooltipEl.style.flexDirection = 'column'; 
                tooltipEl.style.gap = '8px'; 

                const styleTag = document.createElement('style');
                styleTag.innerHTML = `.cornell-hover-tooltip p { margin: 0 0 8px 0 !important; }`;
                tooltipEl.appendChild(styleTag);
                
                const header = tooltipEl.createDiv({ cls: 'cornell-hover-context' });
                // 🛡️ CÓDIGO SEGURO (Uso de createEl)
const headerText = `📄 ${item.file.basename} (L${item.line + 1})`;
header.createEl('span', {
    text: headerText, // Text escapa automáticamente cualquier tag HTML
    attr: { 
        style: "font-size: 1.1em; color: var(--text-normal); font-weight: bold; display: block; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px; width: 100%;" 
    }
});
                const body = tooltipEl.createDiv();
                body.style.width = '100%'; 
                document.body.appendChild(tooltipEl);

                const rect = itemDiv.getBoundingClientRect();
                let leftPos = rect.right + 20; 
                if (leftPos + 450 > window.innerWidth) leftPos = rect.left - 470; 
                if (leftPos < 10) leftPos = 10; 
                tooltipEl.style.left = `${leftPos}px`;
                
                let topPos = rect.top;
                if (topPos + 350 > window.innerHeight) topPos = window.innerHeight - 360;
                tooltipEl.style.top = `${Math.max(10, topPos)}px`;

                const inlineImgRegex = /!\[\[(.*?\.(?:png|jpg|jpeg|gif|bmp|svg))\|?(.*?)\]\]/gi;
                rawBlock = rawBlock.replace(inlineImgRegex, (match2, filename) => {
                    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(filename.trim(), item.file.path);
                    if (file) {
                        const resourcePath = this.plugin.app.vault.getResourcePath(file);
                        return `<img src="${resourcePath}" style="max-height:220px; max-width:100%; border-radius:6px; display:block; margin:8px auto;">`;
                    }
                    return match2; 
                });

                if (!rawBlock.trim()) rawBlock = "*No text context available.*";

                // @ts-ignore
                await MarkdownRenderer.renderMarkdown(rawBlock, body, item.file.path, this);

                requestAnimationFrame(() => {
                    if (tooltipEl) tooltipEl.addClass('is-visible');
                });
            }, 500); 
        }); 

        itemDiv.addEventListener('mouseleave', removeTooltip);
        
        if (!isPinboardView) {
            itemDiv.setAttr('draggable', 'true');
            itemDiv.addEventListener('dragstart', (event: DragEvent) => {
                // 🛑 LA MAGIA: Detiene el "burbujeo". Evita que al arrastrar la nota, se arrastre la carpeta padre.
                event.stopPropagation();
                
                // 🧹 ELIMINAMOS EL TOOLTIP NATIVO AL ARRASTRAR LA NOTA
                document.querySelectorAll('.hover-popover').forEach(el => el.remove());
                if (!event.dataTransfer) return;
                event.dataTransfer.effectAllowed = 'copy'; 
                
                let targetId = item.blockId;
                if (!targetId) {
                    targetId = Math.random().toString(36).substring(2, 8);
                    item.blockId = targetId; 
                    this.injectBackgroundBlockId(item.file, item.line, targetId);
                }

                // 🚀 EXCALIDRAW SPLIT-MODE (Activado con CTRL / CMD)
                if (event.ctrlKey || event.metaKey) {
                    let cleanText = this.cleanExportText(item.text);
                    if (!cleanText) cleanText = item.text.replace(/!\[\[(.*?)\]\]/g, '🖼️ [Image]').trim() || "Marginalia Doodle";
                    
                    let citationText = item.context || "";
                    
                    // 🧽 SANITIZADOR MULTILÍNEA: Aplasta saltos de línea para que Excalidraw no se rompa con PDF++
                    cleanText = cleanText.replace(/\r?\n|\r/g, ' ').replace(/\s{2,}/g, ' ').trim();
                    citationText = citationText.replace(/\r?\n|\r/g, ' ').replace(/\s{2,}/g, ' ').trim();

                    // 1. El Ratón lleva SOLO el texto (La Marginalia) al lienzo
                    event.dataTransfer.setData('text/plain', cleanText);
                    CornellNotesView.lastDraggedPayload = cleanText; // 👈 GUARDAMOS EN MEMORIA
                    
                    // 2. El Portapapeles se traga la Cita (PDF++)
                    if (citationText) {
                        navigator.clipboard.writeText(citationText);
                        new Notice("🎨 Excalidraw: Marginalia soltada. ¡Presiona Ctrl+V para pegar el PDF++!");
                    } else {
                        new Notice("🎨 Excalidraw: Marginalia soltada en el lienzo.");
                    }
                } else {
                    // 📝 MODO NORMAL (Mantiene los hijos si existieran en la rama)
                    const shouldIncludeChildren = this.currentTab === 'threads';
                    let dragPayload = this.buildThreadDropText(item, 0, new Set<string>(), undefined, shouldIncludeChildren);
                    event.dataTransfer.setData('text/plain', dragPayload.trim());
                    CornellNotesView.lastDraggedPayload = dragPayload.trim(); // 👈 GUARDAMOS EN MEMORIA
                }

                this.draggedSidebarItems = [item]; 
            });

            itemDiv.addEventListener('dragend', () => {
                this.draggedSidebarItems = null; 
                itemDiv.removeClass('cornell-drop-target');
                this.triggerTemplaterAfterDrop();

                // ⚡ INVOCAMOS AL NUEVO MOTOR
    
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

// ======================================================
    // 🗂️ MOTOR DE FUSIÓN DE HILOS (DRAG & DROP)
    // ======================================================
    async executeThreadMerge(sourcePayload: any, targetItem: MarginaliaItem, newParentName: string, targetTag: string) {
        // 1. Rescatamos el objeto completo del origen usando la caché y la ruta del payload
        const sourceItem = this.cachedItems.find(i => i.file.path === sourcePayload.filePath && i.text === sourcePayload.text);
        
        if (!sourceItem) {
            new Notice("⚠️ Could not locate the source thread in the vault.");
            return;
        }

        // 2. Preparamos las nuevas etiquetas limpiando el '#' original
        const sourceCleanTag = sourcePayload.currentTag.replace('#', '');
        const targetCleanTag = targetTag.replace('#', '');
        
        const newSourceTag = `#${newParentName}/${sourceCleanTag}`;
        const newTargetTag = `#${newParentName}/${targetCleanTag}`;

        new Notice(`🗂️ Grouping into #${newParentName}...`);

        // 3. MUTACIÓN DEL ORIGEN (El hilo que arrastraste)
        await this.plugin.app.vault.process(sourceItem.file, (data) => {
            const lines = data.split('\n');
            if (sourceItem.line >= 0 && sourceItem.line < lines.length) {
                // Reemplazamos SOLO el tag dentro de la marginalia original
                const newRaw = sourceItem.rawText.replace(sourcePayload.currentTag, newSourceTag);
                // Reemplazamos SOLO la marginalia dentro de esa línea exacta
                lines[sourceItem.line] = lines[sourceItem.line].replace(sourceItem.rawText, newRaw);
            }
            return lines.join('\n');
        });

        // 4. MUTACIÓN DEL DESTINO (El hilo sobre el que soltaste)
        await this.plugin.app.vault.process(targetItem.file, (data) => {
            const lines = data.split('\n');
            if (targetItem.line >= 0 && targetItem.line < lines.length) {
                const newRaw = targetItem.rawText.replace(targetTag, newTargetTag);
                lines[targetItem.line] = lines[targetItem.line].replace(targetItem.rawText, newRaw);
            }
            return lines.join('\n');
        });

        new Notice(`✅ Threads successfully grouped under #${newParentName}!`);
        
        // 5. Forzamos un escaneo total para que la UI reconstruya el árbol con las nuevas etiquetas nativas
        await this.scanNotes();
    }

    // ======================================================
    // 🎯 MOTOR DE ASIMILACIÓN (HILOS INDIVIDUALES)
    // ======================================================
    async executeSingleThreadMerge(threadPayload: any, targetPath: string) {
        const file = this.plugin.app.vault.getAbstractFileByPath(threadPayload.filePath);
        if (!(file instanceof TFile)) return;

        await this.plugin.app.vault.process(file, (data) => {
            const lines = data.split('\n');
            const lineIdx = threadPayload.line;

            // Seguridad: Asegurarnos de que la coordenada de línea es válida
            if (lineIdx !== undefined && lineIdx >= 0 && lineIdx < lines.length) {
                let currentLine = lines[lineIdx];

                if (targetPath === "#Untagged") {
                    // CASO A: Regresa a la bandeja de entrada (Borramos el tag original)
                    const cleanRaw = threadPayload.rawText.replace(threadPayload.currentTag, "").replace(/\s{2,}/g, ' ');
                    currentLine = currentLine.replace(threadPayload.rawText, cleanRaw);
                } 
                else if (threadPayload.currentTag === "#Untagged") {
                    // CASO B: Viene de Untagged y se asimila a una caja
                    
                    let prefixToKeep = "";
                    let contentAfterColor = threadPayload.rawText.trim();
                    
                    // 🎨 FIX: Detectar si el texto INTERNO arranca con un Color Tag
                    if (this.plugin.settings?.tags) {
                        for (const colorTag of this.plugin.settings.tags) {
                            const cPrefix = colorTag.prefix.trim();
                            // Buscamos si el texto empieza exactamente con ese prefijo (ej: "?")
                            if (cPrefix && contentAfterColor.startsWith(cPrefix)) {
                                prefixToKeep = `${cPrefix} `; // Guardamos el prefijo con un espacio
                                contentAfterColor = contentAfterColor.substring(cPrefix.length).trim(); // Cortamos el color del resto
                                break; // Ya encontramos su color, paramos
                            }
                        }
                    }
                    
                    // Ensamblamos la sintaxis perfecta: Color Tag (si lo hay) -> Tag Semántico -> Texto Restante
                    const newInnerRaw = `${prefixToKeep}${targetPath} ${contentAfterColor}`;
                    
                    // Reemplazamos exactamente el texto interno dentro de la línea
                    currentLine = currentLine.replace(threadPayload.rawText, newInnerRaw);
                }
                else {
                    // CASO C: Se mueve de una caja existente a otra caja
                    const newRaw = threadPayload.rawText.replace(threadPayload.currentTag, targetPath);
                    currentLine = currentLine.replace(threadPayload.rawText, newRaw);
                }

                // Aplicamos la mutación solo a esa línea específica
                lines[lineIdx] = currentLine;
            }
            
            return lines.join('\n');
        });

        new Notice(`✅ Hilo asimilado exitosamente en ${targetPath}`);
        
        // Re-escaneamos para redibujar la UI
        await this.scanNotes();
    }
    // ======================================================
    // 🧬 MOTOR DE MUTACIÓN FRACTAL (FAGOCITACIÓN)
    // ======================================================
    async executeFractalMerge(sourcePath: string, targetPath: string) {
        new Notice(`🧬 Asimilando ${sourcePath} dentro de ${targetPath}...`);
        const undoRecords: UndoRecord[] = [];

        const affectedItems = this.cachedItems.filter(item => {
            const tagMatches = [...item.text.matchAll(/#([a-zA-Z0-9_/-]+)/g)];
            const tags = tagMatches.map(m => `#${m[1]}`);
            return tags.some(t => t === sourcePath || t.startsWith(`${sourcePath}/`));
        });

        if (affectedItems.length === 0) return;

        const filesToMutate = new Map<TFile, any[]>();
        for (const item of affectedItems) {
            if (!filesToMutate.has(item.file)) filesToMutate.set(item.file, []);
            filesToMutate.get(item.file)!.push(item);
        }

        for (const [file, items] of filesToMutate.entries()) {
            await this.plugin.app.vault.process(file, (data) => {
                const lines = data.split('\n');
                
                for (const item of items) {
                    if (item.line >= 0 && item.line < lines.length) {
                        const currentLine = lines[item.line];
                        let newRawText = item.rawText;
                        
                        // 🧠 BUSCAMOS EXACTAMENTE EL TAG ORIGEN (Poliarquía)
                        const tagMatches = [...newRawText.matchAll(/#([a-zA-Z0-9_/-]+)/g)];
                        for (const match of tagMatches) {
                            const tag = `#${match[1]}`;
                            if (tag === sourcePath || tag.startsWith(`${sourcePath}/`)) {
                                const cleanTagRest = tag.substring(sourcePath.length); 
                                const cleanSource = sourcePath.replace('#', ''); 
                                const newTag = `${targetPath}/${cleanSource}${cleanTagRest}`;
                                
                                // 🎯 REGEX QUIRÚRGICO: Solo cambia la palabra exacta
                                const escapedTag = tag.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                                const regex = new RegExp(escapedTag + '(?=[\\s]|$|%%)', 'g');
                                newRawText = newRawText.replace(regex, newTag);
                            }
                        }
                        
                        undoRecords.push({ file: item.file, line: item.line, oldRaw: item.rawText, newRaw: newRawText });
                        lines[item.line] = currentLine.replace(item.rawText, newRawText);
                    }
                }
                return lines.join('\n');
            });
        }
        this.plugin.lastStitchAction = undoRecords;
        new Notice(`✅ Asimilación completa! (Press Ctrl+Shift+Z to Undo)`);
        await this.scanNotes();
    }

    // ======================================================
    // 🗂️ MOTOR DE AGRUPACIÓN FRACTAL (SÚPER-RECUADRO)
    // ======================================================
    async executeGroupMerge(sourcePath: string, targetPath: string, newParentName: string) {
        new Notice(`🧬 Creando súper-recuadro #${newParentName}...`);
        const undoRecords: UndoRecord[] = [];

        const affectedItems = this.cachedItems.filter(item => {
            const tagMatches = [...item.text.matchAll(/#([a-zA-Z0-9_/-]+)/g)];
            const tags = tagMatches.map(m => `#${m[1]}`);
            return tags.some(t => t === sourcePath || t.startsWith(`${sourcePath}/`) || t === targetPath || t.startsWith(`${targetPath}/`));
        });

        if (affectedItems.length === 0) return;

        const filesToMutate = new Map<TFile, any[]>();
        for (const item of affectedItems) {
            if (!filesToMutate.has(item.file)) filesToMutate.set(item.file, []);
            filesToMutate.get(item.file)!.push(item);
        }

        for (const [file, items] of filesToMutate.entries()) {
            await this.plugin.app.vault.process(file, (data) => {
                const lines = data.split('\n');
                
                for (const item of items) {
                    if (item.line >= 0 && item.line < lines.length) {
                        const currentLine = lines[item.line];
                        let newRawText = item.rawText;
                        
                        const tagMatches = [...newRawText.matchAll(/#([a-zA-Z0-9_/-]+)/g)];
                        
                        for (const match of tagMatches) {
                            const tag = `#${match[1]}`;
                            
                            if (tag === sourcePath || tag.startsWith(`${sourcePath}/`)) {
                                const cleanTagRest = tag.substring(sourcePath.length); 
                                const cleanSource = sourcePath.replace('#', ''); 
                                const newTag = `#${newParentName}/${cleanSource}${cleanTagRest}`;
                                
                                const escapedTag = tag.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                                const regex = new RegExp(escapedTag + '(?=[\\s]|$|%%)', 'g');
                                newRawText = newRawText.replace(regex, newTag);
                            }
                            else if (tag === targetPath || tag.startsWith(`${targetPath}/`)) {
                                const cleanTagRest = tag.substring(targetPath.length); 
                                const cleanTarget = targetPath.replace('#', ''); 
                                const newTag = `#${newParentName}/${cleanTarget}${cleanTagRest}`;
                                
                                const escapedTag = tag.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                                const regex = new RegExp(escapedTag + '(?=[\\s]|$|%%)', 'g');
                                newRawText = newRawText.replace(regex, newTag);
                            }
                        }

                        undoRecords.push({ file: item.file, line: item.line, oldRaw: item.rawText, newRaw: newRawText });
                        lines[item.line] = currentLine.replace(item.rawText, newRawText);
                    }
                }
                return lines.join('\n');
            });
        }
        this.plugin.lastStitchAction = undoRecords; 
        new Notice(`✅ Súper-recuadro #${newParentName} creado. (Press Ctrl+Shift+Z to Undo)`);
        await this.scanNotes();
    }
async executeMassStitch(sources: MarginaliaItem[], targets: MarginaliaItem[]) {
        const totalLinks = sources.length * targets.length;
        
        // 🧠 Encapsulamos la lógica de costura pura
        const processStitching = async () => {
            new Notice(`Stitching ${totalLinks} thread(s)... ⛓︎`);
            const undoRecords: UndoRecord[] = []; // 🧠 Preparamos la memoria

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
                    let expectedNewRaw = "";

                    await this.plugin.app.vault.process(source.file, (data) => {
                        const lines = data.split('\n');
                        if (source.line >= 0 && source.line < lines.length) {
                            let newRaw = source.rawText;
                            const idMatch = newRaw.match(/(\s*\^[a-zA-Z0-9]+)\s*$/);
                            if (idMatch) {
                                newRaw = newRaw.substring(0, idMatch.index) + linksToInject + idMatch[1];
                            } else {
                                newRaw = newRaw + linksToInject;
                            }
                            expectedNewRaw = newRaw; // Guardamos cómo quedó
                            lines[source.line] = lines[source.line].replace(source.rawText, newRaw);
                        }
                        return lines.join('\n');
                    });
                    
                    // 🧠 Guardamos el fantasma con el antes y el después
                    undoRecords.push({ file: source.file, line: source.line, oldRaw: source.rawText, newRaw: expectedNewRaw });
                }
            }
            this.plugin.lastStitchAction = undoRecords; // 🧠 Sellamos la memoria global
            new Notice("Threads successfully connected! ✨ (Press Ctrl+Shift+Z to Undo)");
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
                let line = lines[lineIndex];
                // Comprobamos si ya tiene un ID, sin importar si está dentro o fuera del %%
                if (!line.match(/\^([a-zA-Z0-9]+)(?:\s*%%)?\s*$/)) {
                    const lastPercentIndex = line.lastIndexOf('%%');
                    if (lastPercentIndex !== -1 && lastPercentIndex > 0) {
                        // Lo inyectamos justo antes de que cierre el comentario
                        line = line.substring(0, lastPercentIndex) + ` ^${newId} ` + line.substring(lastPercentIndex);
                    } else {
                        line = line + ` ^${newId}`;
                    }
                    lines[lineIndex] = line;
                }
            }
            return lines.join('\n');
        });
    }
 // 🧠 MOTOR DE SINCRONIZACIÓN TEMPLATER (Quirúrgico y Seguro para Undo)
    async triggerTemplaterAfterDrop() {
        const payload = CornellNotesView.lastDraggedPayload;
        if (!payload || !payload.includes('<%')) return; // Solo actuamos si hay código Templater

        const templaterPlugin = (this.plugin.app as any).plugins.plugins["templater-obsidian"];
        if (!templaterPlugin || !templaterPlugin.templater) return;

        const activeView = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || !activeView.file || !activeView.editor) return;

        const editor = activeView.editor;

        // Le damos 50ms a Obsidian para que termine de inyectar el texto del Drop nativo
        setTimeout(async () => {
            try {
                const content = editor.getValue();
                const cursor = editor.getCursor();
                
                // Calculamos si el texto cayó exactamente donde está el cursor ahora
                const endOffset = editor.posToOffset(cursor);
                const startOffset = endOffset - payload.length;
                
                // 1. Buscamos exactamente dónde cayó el texto
                let targetStartOffset = -1;
                if (startOffset >= 0 && content.substring(startOffset, endOffset) === payload) {
                    targetStartOffset = startOffset; // El cursor nos dice la posición exacta
                } else {
                    targetStartOffset = content.lastIndexOf(payload); // Fallback: buscamos la última vez que apareció ese texto
                }

                if (targetStartOffset === -1) return; // No se encontró el texto, abortar

                // 2. Le pedimos a Templater que parsee SOLO ese pedacito de texto en memoria
                const parsedPayload = await templaterPlugin.templater.parse_template(
                    { target_file: activeView.file, run_mode: 4 }, // 4 = API Interna
                    payload
                );

                if (parsedPayload === payload) return; // Templater no hizo cambios

                // 3. Reemplazamos QUIRÚRGICAMENTE solo el rango del Drop
                // ESTO ES LO QUE MANTIENE VIVO EL CTRL+Z Y ELIMINA EL EFECTO FANTASMA
                const startPos = editor.offsetToPos(targetStartOffset);
                const endPos = editor.offsetToPos(targetStartOffset + payload.length);

                editor.replaceRange(parsedPayload, startPos, endPos);
                
                // Limpiamos la memoria para el próximo drag
                CornellNotesView.lastDraggedPayload = "";

            } catch (err) {
                console.warn("Cornell Marginalia: Fallo al procesar Templater tras Drag & Drop", err);
            }
        }, 50);
    }   

    // Se ejecuta cuando cierras la barra lateral
    async onClose() {
        if (this.autoPasteInterval) {
            window.clearInterval(this.autoPasteInterval);
            this.autoPasteInterval = null;
        }
    }

}

// --- SETTINGS TAB ---
export class CornellSettingTab extends PluginSettingTab {
    plugin: CornellMarginalia;

    constructor(app: App, plugin: CornellMarginalia) { 
        super(app, plugin); 
        this.plugin = plugin; 
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        
        containerEl.createEl('h2', { text: 'Cornell Marginalia Settings' });

        // ======================================================
        // 🎨 APPEARANCE & RENDERING
        // ======================================================
        containerEl.createEl('h3', { text: '🎨 Appearance & Rendering' });

        // 👇 margenes resposivos
        new Setting(containerEl)
            .setName('Responsive Marginalia (Auto-Collapse)')
            .setDesc('OPTIONAL: Automatically move marginalia inside the text when the note pane is too narrow (e.g. when you open the sidebar).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.responsiveMarginalia)
                .onChange(async (value) => {
                    this.plugin.settings.responsiveMarginalia = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateStyles(); // 👈 Refresca el CSS al instante
                }));
        new Setting(containerEl)
            .setName('Responsive Threshold (px)')
            .setDesc('Set the width at which marginalia collapses into the text. (Requires Auto-Collapse to be ON).')
            .addSlider(slider => slider
                .setLimits(400, 1200, 10) // Mínimo 400, Máximo 1200, saltos de 10px
                .setValue(this.plugin.settings.responsiveThreshold)
                .setDynamicTooltip() // Muestra un globito con el valor exacto al deslizar
                .onChange(async (value) => {
                    this.plugin.settings.responsiveThreshold = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateStyles(); // Refresca el CSS en vivo
                }));

        new Setting(containerEl)
            .setName('Adaptive Width (Theme Compatibility)')
            .setDesc('🧠 Auto-calculates margin width based on empty screen space. Turn ON if you are having problems with your current  theme to prevent overlap.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.adaptiveMode)
                .onChange(async (value) => {
                    this.plugin.settings.adaptiveMode = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateStyles(); // Aplicamos el CSS en tiempo real
                })
            );

        new Setting(containerEl)
            .setName('Margin Alignment')
            .addDropdown(d => d
                .addOption('left', 'Left')
                .addOption('right', 'Right')
                .setValue(this.plugin.settings.alignment)
                .onChange(async (v) => { 
                    this.plugin.settings.alignment = v as any; 
                    await this.plugin.saveSettings(); 
                    this.plugin.updateStyles(); 
                })
            );

        new Setting(containerEl)
            .setName('Margin Width (%)')
            .addSlider(s => s
                .setLimits(15, 60, 1)
                .setValue(this.plugin.settings.marginWidth)
                .setDynamicTooltip()
                .onChange(async (v) => { 
                    this.plugin.settings.marginWidth = v; 
                    await this.plugin.saveSettings(); 
                    this.plugin.updateStyles(); 
                })
            );
        // 👇 NUEVO SLIDER DE OFFSET
        new Setting(containerEl)
            .setName('Margin Distance (Offset)')
            .setDesc('Adjust how close or far the marginalia sits from the main text. Higher values push it outwards, lower values pull it inwards.')
            .addSlider(s => s
                .setLimits(-50, 150, 5) // Permitimos números negativos por si el usuario quiere montar la nota sobre el texto
                .setValue(this.plugin.settings.marginOffset)
                .setDynamicTooltip()
                .onChange(async (v) => { 
                    this.plugin.settings.marginOffset = v; 
                    await this.plugin.saveSettings(); 
                    this.plugin.updateStyles(); // 🪄 Actualización en vivo
                })
            );

        new Setting(containerEl)
            .setName('Font Size')
            .addText(t => t
                .setValue(this.plugin.settings.fontSize)
                .onChange(async (v) => { 
                    this.plugin.settings.fontSize = v; 
                    await this.plugin.saveSettings(); 
                    this.plugin.updateStyles(); 
                })
            );

        new Setting(containerEl)
            .setName('Font Family')
            .addText(t => t
                .setValue(this.plugin.settings.fontFamily)
                .onChange(async (v) => { 
                    this.plugin.settings.fontFamily = v; 
                    await this.plugin.saveSettings(); 
                    this.plugin.updateStyles(); 
                })
            );

        new Setting(containerEl)
            .setName('Enable in Reading View')
            .setDesc('Shows marginalia in reading mode. Turn this off if you prefer a clean view.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableReadingView)
                .onChange(async (value) => {
                    this.plugin.settings.enableReadingView = value;
                    await this.plugin.saveSettings();
                    new Notice('Reload the note to see changes in Reading View.');
                })
            );

        new Setting(containerEl)
            .setName('Extract Highlights')
            .setDesc('OPTIONAL: Include standard text highlights (==text==) in the Explorer and Pinboard.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.extractHighlights)
                .onChange(async (value) => {
                    this.plugin.settings.extractHighlights = value;
                    await this.plugin.saveSettings();
                    this.plugin.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE).forEach(leaf => {
                        if (leaf.view instanceof CornellNotesView) leaf.view.scanNotes();
                    });
                })
            );
        new Setting(containerEl)
    .setName('Blur Explanatory Marginalias')
    .setDesc('🧠 Active Recall: Blurs regular marginalias that share a line with a flashcard, preventing spoilers.')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.blurExplanatoryMarginalia)
        .onChange(async (value) => {
            this.plugin.settings.blurExplanatoryMarginalia = value;
            await this.plugin.saveSettings();
            this.plugin.updateStyles(); // Aplicamos el cambio en vivo
        })
    );

        // ======================================================
        // 🏷️ COLOR TAGS
        // ======================================================
        containerEl.createEl('h3', { text: '🏷️ Color Tags' });
        
        this.plugin.settings.tags.forEach((tag, index) => {
            new Setting(containerEl)
                .setName(`Tag ${index + 1}`)
                .addText(t => t
                    .setValue(tag.prefix)
                    .onChange(async (v) => { 
                        this.plugin.settings.tags[index].prefix = v; 
                        await this.plugin.saveSettings(); 
                        this.plugin.app.workspace.updateOptions(); 
                    })
                )
                .addColorPicker(c => c
                    .setValue(tag.color)
                    .onChange(async (v) => { 
                        this.plugin.settings.tags[index].color = v; 
                        await this.plugin.saveSettings(); 
                        this.plugin.app.workspace.updateOptions(); 
                    })
                )
                .addButton(b => b
                    .setIcon('trash')
                    .onClick(async () => { 
                        this.plugin.settings.tags.splice(index, 1); 
                        await this.plugin.saveSettings(); 
                        this.display(); 
                        this.plugin.app.workspace.updateOptions(); 
                    })
                );
        });

        new Setting(containerEl)
            .addButton(b => b
                .setButtonText('Add Tag')
                .onClick(async () => { 
                    this.plugin.settings.tags.push({ prefix: 'New', color: '#888' }); 
                    await this.plugin.saveSettings(); 
                    this.display(); 
                })
            );
        // ======================================================
        // 🗂️ STRUCTURAL BOX COLORS (SOLO RECUADROS)
        // ======================================================
        containerEl.createEl('h3', { text: '🗂️ Structural Box Colors' });
        containerEl.createEl('p', { 
            text: 'Asigna colores EXCLUSIVAMENTE a los recuadros de los Hilos Semánticos (ej: #abuelo). Esto NO alterará el color de tus marginalias en el texto.', 
            cls: 'setting-item-description' 
        });

        // Aseguramos que el array exista por retrocompatibilidad
        if (!this.plugin.settings.structuralColors) this.plugin.settings.structuralColors = [];

        this.plugin.settings.structuralColors.forEach((struct, index) => {
            new Setting(containerEl)
                .setName(`Box Tag ${index + 1}`)
                .addText(t => t
                    .setPlaceholder('#tag-estructural')
                    .setValue(struct.tag)
                    .onChange(async (v) => { 
                        this.plugin.settings.structuralColors[index].tag = v; 
                        await this.plugin.saveSettings(); 
                        this.plugin.app.workspace.updateOptions(); // Redibuja la UI
                    })
                )
                .addColorPicker(c => c
                    .setValue(struct.color)
                    .onChange(async (v) => { 
                        this.plugin.settings.structuralColors[index].color = v; 
                        await this.plugin.saveSettings(); 
                        this.plugin.app.workspace.updateOptions(); 
                    })
                )
                .addButton(b => b
                    .setIcon('trash')
                    .onClick(async () => { 
                        this.plugin.settings.structuralColors.splice(index, 1); 
                        await this.plugin.saveSettings(); 
                        this.display(); 
                        this.plugin.app.workspace.updateOptions(); 
                    })
                );
        });

        new Setting(containerEl)
            .addButton(b => b
                .setButtonText('Add Box Color')
                .onClick(async () => { 
                    this.plugin.settings.structuralColors.push({ tag: '#new-box', color: '#4a90e2' }); 
                    await this.plugin.saveSettings(); 
                    this.display(); 
                })
            );
        // ======================================================
        // ✅ TASK MANAGEMENT & INTEGRATIONS
        // ======================================================
        containerEl.createEl('h3', { text: '✅ Task Management' });

        new Setting(containerEl)
            .setName('Auto-Delete Completed Tasks')
            .setDesc('When you check a marginalia task (- [x]), it will be permanently deleted from the Markdown file to keep your vault clean.')
            .addToggle(t => t
                .setValue(this.plugin.settings.deleteCompletedTasks)
                .onChange(async v => { this.plugin.settings.deleteCompletedTasks = v; await this.plugin.saveSettings(); })
            );

        new Setting(containerEl)
            .setName('TaskNotes HTTP API Integration')
            .setDesc('Shows a button on task marginalias to send them directly to the TaskNotes plugin.')
            .addToggle(t => t
                .setValue(this.plugin.settings.enableTaskNotesIntegration)
                .onChange(async v => { this.plugin.settings.enableTaskNotesIntegration = v; await this.plugin.saveSettings(); this.display(); })
            );
        // ======================================================
        // 📂 FILE & OUTPUT MANAGEMENT
        // ======================================================
        containerEl.createEl('h3', { text: '📂 File & Output Management' });

        new Setting(containerEl)
            .setName('Omni-Capture Default Folder')
            .setDesc('Folder where new marginalia files will be created (leave empty for root).')
            .addText(text => text
                .setPlaceholder('Example: 00_Inbox')
                .setValue(this.plugin.settings.omniCaptureFolder)
                .onChange(async (value) => {
                    this.plugin.settings.omniCaptureFolder = value.trim();
                    await this.plugin.saveSettings();
                })
            ); 
        // 👇 NUEVO AJUSTE PARA EL TEMPLATE DEL OMNI-CAPTURE
        new Setting(containerEl)
            .setName("Omni-Capture Template")
            .setDesc("Define the output format for your captures. Use {{text}}, {{citation}}, and {{image}}. Supports Templater (<% %>). If you want to use Flashcard mode, remember to include ';;' inside your text template.")
            .addTextArea(text => text
                .setPlaceholder("\\n%%> {{text}} %%\\n{{citation}}\\n{{image}}\\n\\n---")
                .setValue(this.plugin.settings.omniCaptureTemplate)
                .onChange(async (value) => {
                    this.plugin.settings.omniCaptureTemplate = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Zettelkasten Folder')
            .setDesc('Where should your ZK notes be created? (Leave empty for root).')
            .addText(t => t
                .setValue(this.plugin.settings.zkFolder)
                .onChange(async (v) => { 
                    this.plugin.settings.zkFolder = v; 
                    await this.plugin.saveSettings(); 
                })
            );
        new Setting(containerEl)
            .setName('Zettelkasten Template Path')
            .setDesc('Optional: Path to a markdown file to use as a template (e.g., Templates/ZK.md). Supports {{title}}, {{date}}, {{time}}.')
            .addText(t => t
                .setValue(this.plugin.settings.zkTemplatePath)
                .onChange(async (v) => { 
                    this.plugin.settings.zkTemplatePath = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        new Setting(containerEl)
            .setName('Doodles Folder')
            .setDesc('Where should your hand-drawn images be saved? (Leave empty for root).')
            .addText(t => t
                .setValue(this.plugin.settings.doodleFolder)
                .onChange(async (v) => { 
                    this.plugin.settings.doodleFolder = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        new Setting(containerEl)
            .setName('Evidence Boards Folder')
            .setDesc('Where should your Canvas files be exported?')
            .addText(t => t
                .setValue(this.plugin.settings.canvasFolder)
                .onChange(async (v) => { 
                    this.plugin.settings.canvasFolder = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        new Setting(containerEl)
            .setName('Pinboards Folder')
            .setDesc('Where should your exported Pinboard Markdown files go?')
            .addText(t => t
                .setValue(this.plugin.settings.pinboardFolder)
                .onChange(async (v) => { 
                    this.plugin.settings.pinboardFolder = v; 
                    await this.plugin.saveSettings(); 
                })
            );
        new Setting(containerEl)
            .setName('Pinboards Template Path')
            .setDesc('Optional: Path to a markdown file to use as a template for exported Boards.')
            .addText(t => t
                .setValue(this.plugin.settings.pinboardTemplatePath)
                .onChange(async (v) => { 
                    this.plugin.settings.pinboardTemplatePath = v; 
                    await this.plugin.saveSettings(); 
                })
            );
        new Setting(containerEl)
            .setName('Pinboards Item Template Path')
            .setDesc('Optional: Template for each individual marginalia in the board. Supports {{text}}, {{citation}}, and {{source_note}}.')
            .addText(t => t
                .setValue(this.plugin.settings.pinboardItemTemplatePath)
                .onChange(async (v) => { 
                    this.plugin.settings.pinboardItemTemplatePath = v; 
                    await this.plugin.saveSettings(); 
                })
            );
        new Setting(containerEl)
            .setName('Canvas Item Template Path')
            .setDesc('Optional: Template for the main marginalia node in the Evidence Board. Supports {{text}} and {{source_note}}.')
            .addText(t => t
                .setValue(this.plugin.settings.canvasItemTemplatePath)
                .onChange(async (v) => { 
                    this.plugin.settings.canvasItemTemplatePath = v; 
                    await this.plugin.saveSettings(); 
                })
            );
        new Setting(containerEl)
            .setName('✨ Clean Exports (Remove Tags)')
            .setDesc('Automatically strip #tags from notes when exporting to Pinboard, Canvas, or Dragging to a note.')
            .addToggle(t => t
                .setValue(this.plugin.settings.exportCleanTags)
                .onChange(async v => { this.plugin.settings.exportCleanTags = v; await this.plugin.saveSettings(); })
            );

        new Setting(containerEl)
            .setName('✨ Clean Exports (Remove Block IDs)')
            .setDesc('Automatically strip ^block-ids from your notes when exporting.')
            .addToggle(t => t
                .setValue(this.plugin.settings.exportCleanIds)
                .onChange(async v => { this.plugin.settings.exportCleanIds = v; await this.plugin.saveSettings(); })
            );

        new Setting(containerEl)
            .setName('Drag & Drop Template (To Note)')
            .setDesc('Format used when you drag a Semantic Thread box directly into a Markdown note. Supports {{text}}, {{citation}}, {{time}} and {{source_note}}.')
            .addTextArea(t => t
                .setValue(this.plugin.settings.dragDropTemplate)
                .onChange(async v => { this.plugin.settings.dragDropTemplate = v; await this.plugin.saveSettings(); })
            );

        // ======================================================
        // ⚙️ ADVANCED & EXCLUSIONS
        // ======================================================
        containerEl.createEl('h3', { text: '⚙️ Advanced & Exclusions' });

        new Setting(containerEl)
            .setName('Show Syntax in Source Mode')
            .setDesc('If enabled, Cornell Notes will show as raw Markdown syntax when using Source Mode, instead of rendering visual blocks.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showSyntaxInSourceMode)
                .onChange(async (value) => { 
                    this.plugin.settings.showSyntaxInSourceMode = value; 
                    await this.plugin.saveSettings(); 
                    // Obligamos al Workspace a repintarse para que el cambio se vea al instante
                    this.plugin.app.workspace.updateOptions(); 
                })
            );
        
        new Setting(containerEl)
            .setName('Ignored Folders')
            .setDesc('Comma-separated list of folders to completely ignore.')
            .addTextArea(t => t
                .setValue(this.plugin.settings.ignoredFolders)
                .onChange(async (v) => { 
                    this.plugin.settings.ignoredFolders = v; 
                    await this.plugin.saveSettings(); 
                    this.plugin.app.workspace.updateOptions(); 
                })
            );

        new Setting(containerEl)
            .setName('Ignored Folders for Highlights')
            .setDesc('Comma-separated list of folders to ignore ONLY for highlights (e.g., Excalidraw, Templates).')
            .addTextArea(t => t
                .setValue(this.plugin.settings.ignoredHighlightFolders)
                .onChange(async (v) => { 
                    this.plugin.settings.ignoredHighlightFolders = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        new Setting(containerEl)
            .setName('Ignored Highlight Texts')
            .setDesc('Comma-separated list of exact texts or fragments to ignore (e.g., Switch to EXCALIDRAW VIEW).')
            .addTextArea(t => t
                .setValue(this.plugin.settings.ignoredHighlightTexts)
                .onChange(async (v) => { 
                    this.plugin.settings.ignoredHighlightTexts = v; 
                    await this.plugin.saveSettings(); 
                })
            );

        // ======================================================
        // 🧩 ADDONS & MODULES
        // ======================================================
        containerEl.createEl('h3', { text: '🧩 Addons & Modules' });

        // --- ADDON: GAMIFICATION ---
        new Setting(containerEl)
            .setName('Gamification & User Profile')
            .setDesc('Turn your marginalia into a game! Earn XP, level up, and customize your profile sidebar.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addons["gamification-profile"])
                .onChange(async (value) => {
                    this.plugin.settings.addons["gamification-profile"] = value;
                    await this.plugin.saveSettings();

                    if (value) {
                        this.plugin.gamificationAddon.load();
                        new Notice("🎮 Gamification Addon Enabled!");
                    } else {
                        this.plugin.gamificationAddon.unload();
                        new Notice("🛑 Gamification Addon Disabled.");
                    }
                    this.display(); // Refresh to show/hide sub-settings
                })
            );    
       
        if (this.plugin.settings.addons["gamification-profile"]) {
            new Setting(containerEl)
                .setName('Profile Image URL')
                .setDesc('Paste an image URL for your avatar.')
                .addText(text => text
                    .setValue(this.plugin.settings.userStats.profileImage)
                    .onChange(async (value) => {
                        this.plugin.settings.userStats.profileImage = value; 
                        await this.plugin.saveSettings();
                    })
                );
            new Setting(containerEl)
                .setName('Inspirational Quote')
                .setDesc('A short bio or quote for your profile.')
                .addText(text => text
                    .setValue(this.plugin.settings.userStats.quote)
                    .onChange(async (value) => {
                        this.plugin.settings.userStats.quote = value; 
                        await this.plugin.saveSettings();
                    })
                );
        }

        // --- ADDON: CUSTOM BACKGROUND ---
        new Setting(containerEl)
            .setName('Custom Explorer Background')
            .setDesc('Add a beautiful background image to your Marginalia Explorer.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addons["custom-background"])
                .onChange(async (value) => {
                    this.plugin.settings.addons["custom-background"] = value;
                    await this.plugin.saveSettings();
                    if (value) { this.plugin.backgroundAddon.load(); } 
                    else { this.plugin.backgroundAddon.unload(); }
                    this.display(); 
                })
            );

        if (this.plugin.settings.addons["custom-background"]) {
            new Setting(containerEl)
                .setName('Background Image URL')
                .setDesc('Paste an image URL (e.g., from Unsplash) or local vault path.')
                .addText(text => text
                    .setValue(this.plugin.settings.userStats.customBackground)
                    .onChange(async (value) => {
                        this.plugin.settings.userStats.customBackground = value; 
                        await this.plugin.saveSettings(); 
                        this.plugin.backgroundAddon.applyStyles();
                    })
                );
            new Setting(containerEl)
                .setName('Background Blur')
                .setDesc('Amount of blur (lo-fi effect).')
                .addSlider(slider => slider
                    .setLimits(0, 20, 1)
                    .setValue(this.plugin.settings.userStats.bgBlur)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.userStats.bgBlur = value; 
                        await this.plugin.saveSettings(); 
                        this.plugin.backgroundAddon.applyStyles();
                    })
                );
            new Setting(containerEl)
                .setName('Dark Overlay Opacity')
                .setDesc('Dims the background so text is readable (0 = invisible, 1 = pitch black).')
                .addSlider(slider => slider
                    .setLimits(0.1, 1.0, 0.05)
                    .setValue(this.plugin.settings.userStats.bgOpacity)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.userStats.bgOpacity = value; 
                        await this.plugin.saveSettings(); 
                        this.plugin.backgroundAddon.applyStyles();
                    })
                );
        } 

        // --- ADDON: TIME MACHINE & RHIZOME ---
        new Setting(containerEl)
            .setName('🌱 Time Machine & Rhizome')
            .setDesc('Explore your marginaliae on a chronological, full-screen interactive canvas with spaced repetition.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addons["rhizome-time-machine"])
                .onChange(async (value) => {
                    this.plugin.settings.addons["rhizome-time-machine"] = value;
                    await this.plugin.saveSettings();
                    if (value) { 
                        this.plugin.rhizomeAddon.load(); 
                        new Notice("🌱 Time Machine Enabled! Check the left ribbon.");
                    } else { 
                        this.plugin.rhizomeAddon.unload(); 
                        new Notice("🛑 Time Machine Disabled.");
                    }
                    this.display();
                })
            );
            
        if (this.plugin.settings.addons["rhizome-time-machine"]) {
            new Setting(containerEl)
                .setName('🌌 Time Machine Wallpaper URL')
                .setDesc('Paste a direct link to an image (jpg, png, gif) for your Time Machine background.')
                .addText(text => text
                    .setPlaceholder('https://example.com/background.jpg')
                    .setValue((this.plugin.settings as any).rhizomeBgImage || "") 
                    .onChange(async (value) => {
                        (this.plugin.settings as any).rhizomeBgImage = value;
                        await this.plugin.saveSettings();
                    })
                );

            new Setting(containerEl)
                .setName('🌌 Wallpaper Opacity')
                .setDesc('Adjust the background transparency so it doesn\'t interfere with your notes (0.1 to 1.0).')
                .addSlider(slider => slider
                    .setLimits(0.1, 1.0, 0.1)
                    .setValue((this.plugin.settings as any).rhizomeBgOpacity || 0.3)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        (this.plugin.settings as any).rhizomeBgOpacity = value;
                        await this.plugin.saveSettings();
                    })
                );
            new Setting(containerEl)
                .setName('🌌 Wallpaper Blur')
                .setDesc('Apply a blur effect to the background to make your notes stand out more (0 to 20).')
                .addSlider(slider => slider
                    .setLimits(0, 20, 1)
                    .setValue((this.plugin.settings as any).rhizomeBgBlur !== undefined ? (this.plugin.settings as any).rhizomeBgBlur : 2)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        (this.plugin.settings as any).rhizomeBgBlur = value;
                        await this.plugin.saveSettings();
                    })
                );
        }
        
        // --- ADDON: PDF DOODLE ---
        new Setting(containerEl)
            .setName('Pdf Doodle & Harvest')
            .setDesc('Enable temporary drawing mode on PDFs.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enablePdfDoodle)
                .onChange(async (value) => {
                    this.plugin.settings.enablePdfDoodle = value;
                    await this.plugin.saveSettings();
                    new Notice("Restart Obsidian to apply Addon changes.");
                })
            );

        // --- ADDON: SUPER DOODLE ---
        new Setting(containerEl)
            .setName(this.plugin.superDoodleAddon.name)
            .setDesc(this.plugin.superDoodleAddon.description)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addons[this.plugin.superDoodleAddon.id] || false)
                .onChange(async (value) => {
                    this.plugin.settings.addons[this.plugin.superDoodleAddon.id] = value;
                    await this.plugin.saveSettings();

                    if (value) {
                        this.plugin.superDoodleAddon.load();
                        new Notice(`✅ ${this.plugin.superDoodleAddon.name} enabled`);
                    } else {
                        this.plugin.superDoodleAddon.unload();
                        new Notice(`❌ ${this.plugin.superDoodleAddon.name} disabled`);
                    }
                })
            );
        
        // --- ADDON: BLURTING MODE ---
        new Setting(containerEl)
            .setName(this.plugin.blurtingAddon.name)
            .setDesc(this.plugin.blurtingAddon.description)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addons[this.plugin.blurtingAddon.id] || false)
                .onChange(async (value) => {
                    this.plugin.settings.addons[this.plugin.blurtingAddon.id] = value;
                    await this.plugin.saveSettings();

                    if (value) {
                        this.plugin.blurtingAddon.load();
                        new Notice(`✅ ${this.plugin.blurtingAddon.name} enabled`);
                    } else {
                        this.plugin.blurtingAddon.unload();
                        new Notice(`❌ ${this.plugin.blurtingAddon.name} disabled`);
                    }
                    // Refrescamos las vistas laterales para que el botón aparezca/desaparezca en vivo
                    this.plugin.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE).forEach(leaf => {
                        if (leaf.view instanceof CornellNotesView) leaf.view.renderUI();
                    });
                })
    
            );
            // --- ADDON: MARGIDORO (POMODORO) ---
        new Setting(containerEl)
            .setName("🍅 Margidoro Engine")
            .setDesc("Knowledge-aware Pomodoro timer. Tracks your marginalias during study sessions and schedules reviews.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addons["margidoro"] || false)
                .onChange(async (value) => {
                    this.plugin.settings.addons["margidoro"] = value;
                    await this.plugin.saveSettings();

                    if (value) {
                        this.plugin.margidoroAddon.load();
                        new Notice("🍅 Margidoro Enabled! Check the bottom status bar.");
                    } else {
                        this.plugin.margidoroAddon.unload();
                        new Notice("🛑 Margidoro Disabled.");
                    }
                    this.display();
                })
            );

        if (this.plugin.settings.addons["margidoro"]) {
            new Setting(containerEl)
                .setName('Work Duration (min)')
                .addSlider(s => s.setLimits(5, 60, 5).setValue(this.plugin.settings.margidoro.workTime).setDynamicTooltip()
                    .onChange(async (v) => { this.plugin.settings.margidoro.workTime = v; await this.plugin.saveSettings(); }));
        new Setting(containerEl)
                .setName('Short Break Duration (min)')
                .addSlider(s => s.setLimits(1, 15, 1).setValue(this.plugin.settings.margidoro.shortBreak || 5).setDynamicTooltip()
                    .onChange(async (v) => { this.plugin.settings.margidoro.shortBreak = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .setName('Long Break Duration (min)')
                .addSlider(s => s.setLimits(10, 45, 5).setValue(this.plugin.settings.margidoro.longBreak || 15).setDynamicTooltip()
                    .onChange(async (v) => { this.plugin.settings.margidoro.longBreak = v; await this.plugin.saveSettings(); }));

            new Setting(containerEl)
                .setName('Pomodoros before Long Break')
                .setDesc('How many work cycles to complete before taking a longer break.')
                .addSlider(s => s.setLimits(1, 10, 1).setValue(this.plugin.settings.margidoro.cyclesBeforeLongBreak || 4).setDynamicTooltip()
                    .onChange(async (v) => { this.plugin.settings.margidoro.cyclesBeforeLongBreak = v; await this.plugin.saveSettings(); }));
            
            new Setting(containerEl)
                .setName('Hard Marginalia Auto-Tag')
                .setDesc('Prefix (like ? or X-) that automatically marks a note as HARD during the session review.')
                .addText(t => t.setValue(this.plugin.settings.margidoro.hardPrefix)
                    .onChange(async (v) => { this.plugin.settings.margidoro.hardPrefix = v; await this.plugin.saveSettings(); }));
            
            new Setting(containerEl)
                .setName('Session Logs Folder')
                .setDesc('Where your daily Pomodoro summaries will be saved. ⚠️ TIP: Add this folder name to "Ignored Folders" above to prevent duplicating notes in your Explorer.')
                .addText(t => t.setValue(this.plugin.settings.margidoro.logFolder)
                    .onChange(async (v) => { this.plugin.settings.margidoro.logFolder = v; await this.plugin.saveSettings(); }));
            new Setting(containerEl)
                .setName('🔔 Daily Review Reminder')
                .setDesc('Time (HH:mm) to remind you to review your pending Hard Marginalias. Example: 20:00')
                .addText(t => t.setValue(this.plugin.settings.margidoro.reviewReminderTime)
                    .onChange(async (v) => { this.plugin.settings.margidoro.reviewReminderTime = v; await this.plugin.saveSettings(); }));
        }
        // --- ADDON: ANKI SYNC ---
        new Setting(containerEl)
            .setName(this.plugin.ankiSyncAddon.name)
            .setDesc(this.plugin.ankiSyncAddon.description)
            .addToggle(toggle => toggle
                // Leemos el estado actual desde los settings
                .setValue(this.plugin.settings.addons[this.plugin.ankiSyncAddon.id] || false)
                .onChange(async (value) => {
                    // Guardamos el nuevo estado
                    this.plugin.settings.addons[this.plugin.ankiSyncAddon.id] = value;
                    await this.plugin.saveSettings();

                    // Encendemos o apagamos el motor dinámicamente
                    if (value) {
                        this.plugin.ankiSyncAddon.load();
                        new Notice(`✅ ${this.plugin.ankiSyncAddon.name} enabled`);
                    } else {
                        this.plugin.ankiSyncAddon.unload();
                        new Notice(`❌ ${this.plugin.ankiSyncAddon.name} disabled`);
                    }
                })
            );
            // --- CONFIGURACIÓN DE RUTAS ANKI (Solo si el addon está activo) ---
        if (this.plugin.settings.addons["anki-sync"]) {
            containerEl.createEl('h4', { text: '🏷️ Anki Auto-Sync (Tag Mappings)' });
            
            new Setting(containerEl)
                .setName('Add Tag Mapping')
                .setDesc('Map an Obsidian tag to an Anki deck. Only notes with these tags will be bulk-synced.')
                .addButton(btn => btn
                    .setButtonText('+ Add Route')
                    .setCta()
                    .onClick(async () => {
                        // Crea una ruta vacía por defecto
                        this.plugin.settings.ankiTagToDeck['#new-tag'] = 'Deck::New';
                        await this.plugin.saveSettings();
                        this.display(); // Recarga la vista
                    })
                );

            // Dibujamos cada ruta guardada
            for (const [tag, deck] of Object.entries(this.plugin.settings.ankiTagToDeck)) {
                const mappingDiv = containerEl.createDiv({ attr: { style: 'display: flex; gap: 10px; margin-bottom: 10px; align-items: center; background: var(--background-secondary); padding: 10px; border-radius: 8px;' }});
                
                const tagInput = mappingDiv.createEl('input', { type: 'text', value: tag });
                tagInput.placeholder = "#etiqueta";
                tagInput.style.width = "150px";
                
                mappingDiv.createSpan({ text: '➔', attr: { style: 'color: var(--text-muted);' } });

                const deckInput = mappingDiv.createEl('input', { type: 'text', value: deck });
                deckInput.placeholder = "Deck::Subdeck";
                deckInput.style.flexGrow = "1";

                // Botón de Guardar (Icono de disco flexible o check)
                const saveBtn = mappingDiv.createEl('button');
                setIcon(saveBtn, 'save'); // Ícono nativo de Lucide
                saveBtn.title = "Save mapping";
                saveBtn.onclick = async () => {
                    let newTag = tagInput.value.trim();
                    if (!newTag.startsWith('#')) newTag = '#' + newTag; 
                    
                    // 🛡️ SANITIZAMOS EL NOMBRE DEL MAZO ANTES DE GUARDAR EN SETTINGS
                    const safeDeck = sanitizeAnkiDeckName(deckInput.value);
                    
                    if (newTag !== tag) delete this.plugin.settings.ankiTagToDeck[tag];
                    
                    this.plugin.settings.ankiTagToDeck[newTag] = safeDeck;
                    await this.plugin.saveSettings();
                    new Notice('✅ Mapping saved');
                    this.display();
                };

                // Botón de Eliminar (Icono de basurero)
                const delBtn = mappingDiv.createEl('button');
                setIcon(delBtn, 'trash-2'); // Ícono nativo de Lucide
                delBtn.title = "Delete mapping";
                delBtn.onclick = async () => {
                    delete this.plugin.settings.ankiTagToDeck[tag];
                    await this.plugin.saveSettings();
                    this.display();
                };
            }
        }
        // --- ADDON: ZOOM DOODLE ---
        new Setting(containerEl)
            .setName(this.plugin.zoomDoodleAddon.name)
            .setDesc(this.plugin.zoomDoodleAddon.description)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addons[this.plugin.zoomDoodleAddon.id] || false)
                .onChange(async (value) => {
                    this.plugin.settings.addons[this.plugin.zoomDoodleAddon.id] = value;
                    await this.plugin.saveSettings();

                    if (value) {
                        this.plugin.zoomDoodleAddon.load();
                        new Notice(`✅ ${this.plugin.zoomDoodleAddon.name} activado`);
                    } else {
                        this.plugin.zoomDoodleAddon.unload();
                        new Notice(`❌ ${this.plugin.zoomDoodleAddon.name} desactivado`);
                    }
                })
            );
        new Setting(containerEl)
    .setName('🚀 Dashboard:Smart Study ')
    .setDesc('Linear calendar, routines, subjects, and dynamic spaced review.')
    .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableDashboardAddon)
        .onChange(async (value) => {
            this.plugin.settings.enableDashboardAddon = value;
            await this.plugin.saveSettings();
            
            // Le avisamos al usuario que necesita recargar para ver el icono
            new Notice(value ? "🚀 Dashboard Activado: Por favor recarga el plugin." : "🛑 Dashboard Desactivado: Por favor recarga el plugin.");
        }));
        
        }
    

        
}




// --- 🕰️ LIENZO DE LA MÁQUINA DEL TIEMPO (RHIZOME) ---
// ... (Tus importaciones y settings arriba quedan igual)

export class RhizomeView extends ItemView {
    plugin: CornellMarginalia;
    isReviewMode: boolean = false; 
    isMargidoroMode: boolean = false;
    isStitchingMode: boolean = false;
    isMoleculeMode: boolean = false;
    hideOrphans: boolean = false; // 👻 Controla si ocultamos las notas sin conexiones
    is3DMode: boolean = false; // 🌌 Activa la perspectiva de mesa holográfica
    focusedClusterId: string | null = null; // 🎯 Recuerda qué molécula estamos aislando
    sourceStitchItem: any = null;

    // 🔍 NUEVOS ESTADOS DE FILTRO Y CACHÉ
    searchQuery: string = '';
    activeColorFilters: Set<string> = new Set();
    showOnlyFlashcards: boolean = false;
    cachedTimelineData: Record<string, any[]> = {};
    allCachedNodes: any[] = [];
    
    topBarEl!: HTMLElement;
    canvasEl!: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: CornellMarginalia) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return RHIZOME_VIEW_TYPE; }
    getDisplayText() { return "Rhizome Time Machine"; }
    getIcon() { return "git-commit-vertical"; }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        
        // 🛡️ PARCHE DE MEMORIA
        if (!this.plugin.settings.userStats) {
            this.plugin.settings.userStats = { xp: 0, level: 1, marginaliasCreated: 0, colorUsage: {}, profileImage: "", quote: "Stay curious.", customBackground: "", bgBlur: 5, bgOpacity: 0.8, rhizomeReviews: {}, margidoroPending: [], activeReading: {} };
        }
        if (!this.plugin.settings.userStats.rhizomeReviews) {
            this.plugin.settings.userStats.rhizomeReviews = {};
        }

        const wrapper = container.createDiv({ cls: 'cornell-rhizome-wrapper' });
        
        this.topBarEl = wrapper.createDiv({ cls: 'cornell-rhizome-topbar' });
        this.canvasEl = wrapper.createDiv({ cls: 'cornell-rhizome-canvas' });
        this.canvasEl.style.flexGrow = '1';
        this.canvasEl.style.position = 'relative';
        // 🌌 INYECTAR EL FONDO PERSONALIZADO
        const bgUrl = (this.plugin.settings as any).rhizomeBgImage;
        if (bgUrl && bgUrl.trim() !== "") {
            const customBg = wrapper.createDiv({ cls: 'cornell-rhizome-custom-bg' });
            customBg.style.backgroundImage = `url("${bgUrl}")`;
            customBg.style.opacity = ((this.plugin.settings as any).rhizomeBgOpacity || 0.3).toString();
            // Le aplicamos el nivel de blur del usuario
            const blurValue = (this.plugin.settings as any).rhizomeBgBlur !== undefined ? (this.plugin.settings as any).rhizomeBgBlur : 2;
            customBg.style.filter = `blur(${blurValue}px)`;
            
            // Lo movemos al fondo absoluto de la capa
            wrapper.prepend(customBg);
            // Le avisamos al canvas que se vuelva de cristal
            this.canvasEl.classList.add('has-custom-bg');
        }

        this.renderTopBar();

        this.canvasEl.createEl("h2", { 
            text: "⏳ Time travel... (Scanning vault)",
            attr: { style: "color: var(--text-muted); text-align: center; margin-top: 20%;" }
        });

        await this.scanVault();
        await this.runGarbageCollector(); // 🧹 Llamamos al limpiador silencioso
        this.renderTimeline();
    }

    renderTopBar() {
        this.topBarEl.empty();
        
        const searchWrapper = this.topBarEl.createDiv({ cls: 'cornell-search-wrapper' });
        const searchIconEl = searchWrapper.createSpan({ cls: 'cornell-search-icon' });
        setIcon(searchIconEl, 'search');
        const searchInput = searchWrapper.createEl('input', { type: 'text', placeholder: 'Search timeline...', cls: 'cornell-search-bar' });
        searchInput.value = this.searchQuery;
        
        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            this.renderTimeline(); 
        };

        const flashcardBtn = this.topBarEl.createEl('button', { 
            title: 'Show only Flashcards (;;)', 
            cls: 'cornell-rhizome-filter-btn' + (this.showOnlyFlashcards ? ' is-active' : '')
        });
        setIcon(flashcardBtn, 'layers');
        flashcardBtn.createSpan({ text: 'Flashcards' });
        flashcardBtn.onclick = () => {
            this.showOnlyFlashcards = !this.showOnlyFlashcards;
            flashcardBtn.classList.toggle('is-active', this.showOnlyFlashcards);
            this.renderTimeline();
        };

        const pillsContainer = this.topBarEl.createDiv({ cls: 'cornell-color-pills' });
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
                this.renderTimeline();
            };
        });

        // 🔬 MODO MOLÉCULA
        const moleculeBtn = this.topBarEl.createEl('button', { 
            title: 'Molecule View (Compass)', 
            cls: 'cornell-rhizome-filter-btn' + (this.isMoleculeMode ? ' is-active' : '') 
        });
        setIcon(moleculeBtn, 'share-2'); 
        moleculeBtn.createSpan({ text: 'Molecule' });

        // 👻 FILTRO HUÉRFANAS
        const orphanBtn = this.topBarEl.createEl('button', { 
            title: 'Hide notes without compass links', 
            cls: 'cornell-rhizome-filter-btn' + (this.hideOrphans ? ' is-active' : '') 
        });
        setIcon(orphanBtn, 'eye-off'); 
        orphanBtn.createSpan({ text: 'Clean Orphans' });
        orphanBtn.style.display = this.isMoleculeMode ? 'flex' : 'none';

        // 🌌 MODO 3D (NUEVO)
        const btn3D = this.topBarEl.createEl('button', { 
            title: 'Toggle Holographic 3D View', 
            cls: 'cornell-rhizome-filter-btn' + (this.is3DMode ? ' is-active' : '') 
        });
        setIcon(btn3D, 'box'); 
        btn3D.createSpan({ text: '3D Space' });
        btn3D.style.display = this.isMoleculeMode ? 'flex' : 'none';

        moleculeBtn.onclick = () => {
            this.isMoleculeMode = !this.isMoleculeMode;
            moleculeBtn.classList.toggle('is-active', this.isMoleculeMode);
            orphanBtn.style.display = this.isMoleculeMode ? 'flex' : 'none'; 
            btn3D.style.display = this.isMoleculeMode ? 'flex' : 'none'; 
            this.renderTimeline(); 
        };

        orphanBtn.onclick = () => {
            this.hideOrphans = !this.hideOrphans;
            orphanBtn.classList.toggle('is-active', this.hideOrphans);
            this.renderTimeline(); 
        };

        btn3D.onclick = () => {
            this.is3DMode = !this.is3DMode;
            btn3D.classList.toggle('is-active', this.is3DMode);
            this.renderTimeline(); 
        };

        const refreshBtn = this.topBarEl.createEl('button', { title: 'Rescan Vault', cls: 'cornell-rhizome-filter-btn' });
        setIcon(refreshBtn, 'refresh-cw');
        refreshBtn.onclick = async () => {
            await this.scanVault();
            this.renderTimeline();
            new Notice("Timeline rescanned!");
        };
    }

    async scanVault() {
        const files = this.plugin.app.vault.getMarkdownFiles();
        this.cachedTimelineData = {}; 
        this.allCachedNodes = [];

        // 👇 1. Obtenemos el nombre de la carpeta de logs desde tus Settings
        // (Si por algún motivo no existe, usamos el valor por defecto "Margidoro Logs")
        const logFolder = this.plugin.settings.margidoro?.logFolder || "Margidoro Logs";

        for (const file of files) {
            // Filtro general de carpetas ignoradas
            if (this.plugin.settings.ignoredFolders && file.path.includes(this.plugin.settings.ignoredFolders)) continue;

            // 👇 2. ESCUDO MARGIDORO: Si el archivo pertenece a la carpeta de logs, lo ignoramos por completo
            if (file.path.includes(logFolder)) continue;

            const content = await this.plugin.app.vault.cachedRead(file);
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const regex = /%%[><](.*?)%%/g;
                let match;

                while ((match = regex.exec(line)) !== null) {
                    let rawText = match[1].trim();
                    if (!rawText) continue;
                
                    // Limpieza segura del ID fantasma
                    let tempText = rawText.replace(/\s*\^([a-zA-Z0-9]+)\s*$/, '').trim();    

                    let isFlashcard = false;
                    if (tempText.includes(";;")) {
                        isFlashcard = true;
                        tempText = tempText.replace(";;", "").replace(/\s{2,}/g, ' ').trim();
                    }

                    let color = "var(--text-normal)";
                    for (const tag of this.plugin.settings.tags) {
                        if (tempText.startsWith(tag.prefix)) {
                            color = tag.color; break;
                        }
                    }

                    // 👇 3. MOTOR DE TIEMPO ACTUALIZADO: Usamos 'mtime' (Modificación) en lugar de 'ctime'
                    // Así, si escribes o repasas una nota vieja HOY, aparecerá en la columna de HOY.
                    const date = new Date(file.stat.mtime);
                    const dateString = date.toISOString().split('T')[0];

                    if (!this.cachedTimelineData[dateString]) this.cachedTimelineData[dateString] = [];

                    // Tolerancia para encontrar el ID
                    const blockIdMatch = line.match(/\^([a-zA-Z0-9]+)(?:\s*%%)?\s*$/);
                    const blockId = blockIdMatch ? blockIdMatch[1] : null;

                    const linkRegex = /(?<!!)\[\[(.*?)\]\]/g;
                    const outgoingLinks = [];
                    let linkMatch;
                    while ((linkMatch = linkRegex.exec(rawText)) !== null) {
                        outgoingLinks.push(linkMatch[1]);
                    }
                    // 🧭 EXTRAER ENLACES DE BRÚJULA (Blindado)
                    const compassRegex = /\[(North|South|East|West)::\s*\[\[([\s\S]*?)\]\]\]/gi;
                    const compassLinks = [];
                    let compassMatch;
                    while ((compassMatch = compassRegex.exec(rawText)) !== null) {
                        compassLinks.push({ target: compassMatch[2].trim(), direction: compassMatch[1].toLowerCase() });
                    }

                    // 🧼 Limpiamos el texto para que la etiqueta [West:: ...] desaparezca de la tarjeta visual
                    const cleanCardText = tempText.replace(compassRegex, '').trim();

                    const nodeData = {
                        text: cleanCardText, 
                        color: color,
                        rawText: rawText,
                        file: file,
                        line: i,
                        blockId: blockId,
                        outgoingLinks: outgoingLinks,
                        compassLinks: compassLinks,
                        id: blockId ? blockId : `${file.basename}-L${i}`,
                        isFlashcard: isFlashcard
                    };

                    this.cachedTimelineData[dateString].push(nodeData);
                    this.allCachedNodes.push(nodeData);
                }
            }
        }
    }
    // 🧹 MOTOR DE LIMPIEZA (Garbage Collector)
    // Borra los datos de repaso de las flashcards/notas que el usuario ya eliminó de su bóveda
    async runGarbageCollector() {
        if (!this.plugin.settings.userStats || !this.plugin.settings.userStats.rhizomeReviews) return;

        // 1. Recolectamos todos los IDs de las notas que SÍ existen ahora mismo
        const currentValidIds = new Set(this.allCachedNodes.map(node => node.id));
        let isDirty = false; // Bandera para saber si borramos algo
        let deletedCount = 0;

        // 2. Revisamos la memoria del Heatmap
        for (const savedId in this.plugin.settings.userStats.rhizomeReviews) {
            // Si el ID guardado ya no existe en las notas reales...
            if (!currentValidIds.has(savedId)) {
                delete this.plugin.settings.userStats.rhizomeReviews[savedId]; // Lo exterminamos
                isDirty = true;
                deletedCount++;
            }
        }

        // 3. Si limpiamos basura, guardamos el archivo para que pese menos
        if (isDirty) {
            await this.plugin.saveSettings();
            console.log(`🧹 Rhizome Garbage Collector: Se eliminaron ${deletedCount} registros huérfanos. Tu data.json está optimizado.`);
        }
    }

    renderTimeline(ignoredCanvas?: HTMLElement) {
        // 🌌 ENRUTADOR: Si estamos en modo molécula, cargamos el lienzo espacial
        if (this.isMoleculeMode) {
            return this.renderMoleculeView();
        }

        const canvas = this.canvasEl;
        canvas.empty();

        // 🔍 APLICAR FILTROS EN LA RAM (Instantáneo)
        const timelineData: Record<string, any[]> = {};
        const searchLower = this.searchQuery.toLowerCase();
        const onlyFc = this.showOnlyFlashcards;
        const activeColors = this.activeColorFilters;

        for (const date in this.cachedTimelineData) {
      const filteredNodes = this.cachedTimelineData[date].filter((item) => {
        const matchesSearch = item.text.toLowerCase().includes(searchLower) || item.file.basename.toLowerCase().includes(searchLower);
        const matchesColor = activeColors.size === 0 || activeColors.has(item.color);
        const matchesFc = !onlyFc || item.isFlashcard;
        
        // 🍅 FILTRO MARGIDORO (Oculta las notas que no están pendientes)
        const isPending = this.plugin.settings.userStats.margidoroPending?.includes(item.id);
        const matchesMargidoro = !this.isMargidoroMode || isPending;

        return matchesSearch && matchesColor && matchesFc && matchesMargidoro;
      });
            if (filteredNodes.length > 0) {
                timelineData[date] = filteredNodes;
            }
        }
        
        const allNodes = this.allCachedNodes;

        // 🔍 CONTROLES DE ZOOM Y MODO REVISIÓN
        let currentZoom = 1;
        const zoomControls = canvas.createDiv({ cls: 'cornell-rhizome-zoom-controls' });
        
        const reviewBtn = zoomControls.createEl('button', { 
            text: this.isReviewMode ? '🔥 Heatmap (Review)' : '🧠 Study Mode',
            cls: this.isReviewMode ? 'is-reviewing' : '' 
        });
        reviewBtn.onclick = () => {
            this.isReviewMode = !this.isReviewMode;
            this.renderTimeline(); 
        };
        const margidoroBtn = zoomControls.createEl('button', { 
            text: this.isMargidoroMode ? '🍅 Focus: Pending' : '🍅 Pomodoro Review',
            cls: this.isMargidoroMode ? 'is-reviewing' : '' 
        });
        margidoroBtn.style.marginLeft = '10px';
        margidoroBtn.onclick = () => {
            this.isMargidoroMode = !this.isMargidoroMode;
            if (this.isMargidoroMode) this.isReviewMode = false; // Se apagan entre sí
            this.renderTimeline(); 
        };

        const zoomOutBtn = zoomControls.createEl('button', { text: '-' });
        const zoomResetBtn = zoomControls.createEl('button', { text: '100%' });
        const zoomInBtn = zoomControls.createEl('button', { text: '+' });

        const scrollContainer = canvas.createDiv({ cls: 'cornell-rhizome-scroll' });
        const contentContainer = scrollContainer.createDiv({ cls: 'cornell-rhizome-content' }); 

        const applyZoom = () => {
            contentContainer.style.setProperty('zoom', currentZoom.toString());
            zoomResetBtn.innerText = `${Math.round(currentZoom * 100)}%`;
        };

        zoomInBtn.onclick = () => { currentZoom = Math.min(currentZoom + 0.2, 2.5); applyZoom(); };
        zoomOutBtn.onclick = () => { currentZoom = Math.max(currentZoom - 0.2, 0.2); applyZoom(); };
        zoomResetBtn.onclick = () => { currentZoom = 1; applyZoom(); };

        scrollContainer.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.deltaY < 0) currentZoom = Math.min(currentZoom + 0.1, 2.5);
                else currentZoom = Math.max(currentZoom - 0.1, 0.2);
                applyZoom();
            }
        });

        const svgOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgOverlay.classList.add("cornell-rhizome-svg-overlay");
        contentContainer.appendChild(svgOverlay); 

        const sortedDates = Object.keys(timelineData).sort();
        if (sortedDates.length === 0) {
            contentContainer.createEl("h3", { text: "🔍 No matching notes found.", attr: { style: "margin: auto;"} });
            return;
        }

        const domNodesMap = new Map<string, HTMLElement>();

        for (const date of sortedDates) {
            const dayColumn = contentContainer.createDiv({ cls: 'cornell-rhizome-day-column' });
            dayColumn.createDiv({ cls: 'cornell-rhizome-date-label', text: date });
            const nodesContainer = dayColumn.createDiv({ cls: 'cornell-rhizome-nodes' });

            for (const item of timelineData[date]) {
                const node = nodesContainer.createDiv({ cls: 'cornell-rhizome-node' });
                node.id = item.id; 
                // --- 👽 INICIO MAGIA DRAG & DROP (HACIA EL BOARD) ---
                node.setAttr('draggable', 'true');
                
                node.addEventListener('dragstart', (e: DragEvent) => {
                    console.log("🛸 1. DRAG START: Nota capturada en el Rhizome", item.text);
                    // Empaquetamos los datos del Rhizome al formato que el Pinboard entiende
                    OmniDragManager.payload = {
                        text: item.text.replace(/img:\s*\[\[(.*?)\]\]/gi, '![[$1]]').trim(),
                        rawText: item.text,
                        color: item.color,
                        file: item.file,
                        line: item.line,
                        blockId: item.blockId,
                        outgoingLinks: item.outgoingLinks,
                        indentLevel: 0
                    };
                    
                    node.style.opacity = '0.5'; // Feedback visual
                    
                    if (e.dataTransfer) {
                        e.dataTransfer.effectAllowed = 'copy';
                        e.dataTransfer.setData('text/plain', item.text);
                    }
                });

                node.addEventListener('dragend', (e: DragEvent) => {
                    console.log("💥 4. DRAG END: Vuelo terminado. Destruyendo payload.");
                    node.style.opacity = '1';
                    OmniDragManager.payload = null; // Limpiamos la memoria al soltar
                });
                // --- FIN MAGIA DRAG & DROP ---
                
                if (item.isFlashcard) {
                    const fcIcon = node.createSpan({ text: '⚡ ', title: 'Flashcard' });
                    fcIcon.style.opacity = '0.7';
                    fcIcon.style.fontSize = '1.1em';
                }

                // 🔥 ALGORITMO MAPA DE CALOR
                const reviewData = this.plugin.settings.userStats.rhizomeReviews[item.id] || { lastReviewed: 0, interval: 0, ease: 2.5 };
                const now = Date.now();
                const msInDay = 24 * 60 * 60 * 1000;
                const nextReviewDate = reviewData.lastReviewed + (reviewData.interval * msInDay);
                
                let isDue = false;
                let heatmapColor = "";

                if (reviewData.lastReviewed === 0) {
                    heatmapColor = "#ff4d4d"; 
                    isDue = true;
                } else if (now >= nextReviewDate) {
                    heatmapColor = "#ff9900"; 
                    isDue = true;
                } else {
                    heatmapColor = "#00cc66"; 
                }

                if (this.isReviewMode) {
                    node.style.borderColor = heatmapColor;
                    node.style.boxShadow = `0 4px 15px ${heatmapColor}30`;
                } else {
                    node.style.borderColor = item.color;
                    node.style.boxShadow = `0 4px 15px ${item.color}20`;
                }

                const exactKey = `${item.file.basename}#^${item.blockId}`;
                const fileKey = item.file.basename;
                if (item.blockId) domNodesMap.set(exactKey, node);
                if (!domNodesMap.has(fileKey)) domNodesMap.set(fileKey, node);

                let cleanText = item.text.replace(/^[!?XV-]+\s*/, '');
                const imagesToRender: string[] = [];
                const imgRegex = /img:\s*\[\[(.*?)\]\]/gi;
                const imgMatches = Array.from(cleanText.matchAll(imgRegex)) as RegExpMatchArray[];
                imgMatches.forEach(m => imagesToRender.push(m[1]));
                cleanText = cleanText.replace(imgRegex, '').trim();
                const threadRegex = /(?<!!)\[\[(.*?)\]\]/g;
                cleanText = cleanText.replace(threadRegex, '').trim();

                if (cleanText) {
                    node.createEl("span", { text: cleanText.length > 130 ? cleanText.substring(0, 130) + "..." : cleanText });
                }

                if (imagesToRender.length > 0) {
                    const imgContainer = node.createDiv({ cls: 'cornell-rhizome-images' });
                    imagesToRender.forEach(imgName => {
                        const cleanName = imgName.split('|')[0];
                        const file = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanName, item.file.path);
                        if (file) {
                            const imgSrc = this.plugin.app.vault.getResourcePath(file);
                            const imgEl = imgContainer.createEl('img', { attr: { src: imgSrc } });
                            imgEl.style.maxHeight = '120px';
                            imgEl.style.maxWidth = '100%';
                            imgEl.style.objectFit = 'contain';
                            imgEl.style.borderRadius = '4px';
                            imgEl.style.marginTop = '8px';
                            imgEl.style.display = 'block';
                            imgEl.style.background = 'transparent';
                        }
                    });
                }

                if (this.isReviewMode && isDue) {
                    const gradeContainer = node.createDiv({ cls: 'cornell-srs-controls' });
                    const btnHard = gradeContainer.createEl('button', { text: 'Hard', cls: 'srs-hard' });
                    const btnGood = gradeContainer.createEl('button', { text: 'Good', cls: 'srs-good' });
                    const btnEasy = gradeContainer.createEl('button', { text: 'Easy', cls: 'srs-easy' });

                    const processGrade = async (grade: 'hard' | 'good' | 'easy', e: MouseEvent) => {
                        e.stopPropagation();
                        let { interval, ease } = reviewData;
                        
                        if (grade === 'hard') {
                            interval = Math.max(1, interval * 0.5);
                            ease = Math.max(1.3, ease - 0.2);
                        } else if (grade === 'good') {
                            interval = interval === 0 ? 1 : interval * ease;
                        } else if (grade === 'easy') {
                            interval = interval === 0 ? 4 : interval * ease * 1.3;
                            ease += 0.15;
                        }
                        
                        this.plugin.settings.userStats.rhizomeReviews[item.id] = {
                            lastReviewed: Date.now(),
                            interval: interval,
                            ease: ease
                        };
                        
                        await this.plugin.saveSettings();
                        
                        node.style.borderColor = "#00cc66"; 
                        node.style.boxShadow = `0 4px 15px #00cc6640`;
                        gradeContainer.remove(); 
                        new Notice(`Brain synced! Next review in ${Math.round(interval)} days. 🧠`);
                    };

                    btnHard.onclick = (e) => processGrade('hard', e);
                    btnGood.onclick = (e) => processGrade('good', e);
                    btnEasy.onclick = (e) => processGrade('easy', e);
                }

                // 🛠️ BOTONERA DE ACCIONES (Foco, Cosido y Zoom)
                const actionsDiv = node.createDiv({ cls: 'cornell-rhizome-actions' });

                // 🍅 BOTÓN MASTERED (Solo aparece si estamos en Pomodoro Review)
                if (this.isMargidoroMode && this.plugin.settings.userStats.margidoroPending?.includes(item.id)) {
                    const resolveBtn = actionsDiv.createDiv({ cls: 'cornell-action-btn' });
                    setIcon(resolveBtn, 'check-circle');
                    resolveBtn.title = "Mark as Mastered";
                    resolveBtn.style.background = 'var(--color-green)';
                    resolveBtn.style.color = 'white';
                    resolveBtn.style.padding = '4px';
                    resolveBtn.style.borderRadius = '4px';
                    resolveBtn.style.cursor = 'pointer';
                    // Empujamos este botón un poco a la izquierda para que no choque con los demás
                    resolveBtn.style.marginRight = '5px'; 

                    resolveBtn.onClickEvent(async (ev) => {
                        ev.stopPropagation(); 
                        this.plugin.settings.userStats.margidoroPending = this.plugin.settings.userStats.margidoroPending.filter((id: string) => id !== item.id);
                        await this.plugin.saveSettings();
                        
                        node.style.transition = 'all 0.3s ease';
                        node.style.transform = 'scale(0.8)';
                        node.style.opacity = '0';
                        setTimeout(() => this.renderTimeline(), 300);
                        new Notice("✅ Topic Mastered!");
                    });
                }
                
                // 1. Botón de Cosido
                const stitchBtn = actionsDiv.createDiv({ cls: 'cornell-action-btn' });
                setIcon(stitchBtn, 'link');
                stitchBtn.title = "Stitch (Connect) to another note";
                stitchBtn.onClickEvent((e) => {
                    e.stopPropagation();
                    this.handleStitchClick(item, node, canvas);
                });

                // 2. Botón de Foco
                const focusBtn = actionsDiv.createDiv({ cls: 'cornell-action-btn' });
                setIcon(focusBtn, 'focus'); 
                focusBtn.title = "Focus on semantic cluster";
                focusBtn.onClickEvent((e) => {
                    e.stopPropagation(); 
                    this.activateFocusMode(item.id, allNodes, domNodesMap, canvas);
                });

                // 3. NUEVO: Botón de Zoom (¡Solo aparece si hay imágenes!)
                if (imagesToRender.length > 0) {
                    const zoomBtn = actionsDiv.createDiv({ cls: 'cornell-action-btn' });
                    setIcon(zoomBtn, 'maximize'); // Ícono de expandir
                    zoomBtn.title = "View Doodle in Fullscreen";
                    zoomBtn.onClickEvent((ev) => {
    ev.stopPropagation(); 
    
    const firstImg = imagesToRender[0];
    const cleanName = firstImg.split('|')[0];
    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanName, item.file.path);
    
    if (file) {
        const imgSrc = this.plugin.app.vault.getResourcePath(file);
        
        // Contenedor principal
        const overlay = document.body.createDiv({ cls: 'cornell-lightbox-overlay' });
        overlay.style.position = 'fixed';
        overlay.style.top = '0'; overlay.style.left = '0';
        overlay.style.width = '100vw'; overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.overflow = 'hidden'; // Vital para el paneo

        // 🖼️ Contenedor de la imagen para aplicar transformaciones
        const imgContainer = overlay.createDiv();
        imgContainer.style.transition = "transform 0.1s ease-out";
        imgContainer.style.cursor = "grab";

        const bigImg = imgContainer.createEl('img', { attr: { src: imgSrc, draggable: 'false' } });
        bigImg.style.backgroundColor = 'white'; 
        bigImg.style.padding = '15px'; 
        bigImg.style.borderRadius = '8px'; 
        bigImg.style.maxHeight = '90vh';
        bigImg.style.maxWidth = '90vw';
        bigImg.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';

        if (document.body.classList.contains('theme-dark') && cleanName.includes('doodle_')) {
            bigImg.style.filter = 'invert(1)';
            bigImg.style.opacity = '0.9';
        }

        // 🔍 LÓGICA DE ZOOM Y PANEO
        let scale = 1;
        let isDraggingImg = false;
        let startX = 0, startY = 0;
        let translateX = 0, translateY = 0;

        const updateTransform = () => {
            imgContainer.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        };

        // Rueda del ratón para Zoom
        overlay.addEventListener("wheel", (e) => {
            e.preventDefault();
            if (e.deltaY < 0) scale = Math.min(scale + 0.15, 5); // Acercar (máx 5x)
            else scale = Math.max(scale - 0.15, 0.5);            // Alejar (mín 0.5x)
            updateTransform();
        });

        // Arrastrar para Paneo (Pan)
        imgContainer.addEventListener("mousedown", (e) => {
            e.stopPropagation();
            isDraggingImg = true;
            imgContainer.style.cursor = "grabbing";
            imgContainer.style.transition = "none"; // Quitamos la transición para que el arrastre sea instantáneo
            startX = e.clientX - translateX;
            startY = e.clientY - translateY;
        });

        window.addEventListener("mousemove", (e) => {
            if (!isDraggingImg) return;
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            updateTransform();
        });

        window.addEventListener("mouseup", () => {
            if (isDraggingImg) {
                isDraggingImg = false;
                imgContainer.style.cursor = "grab";
                imgContainer.style.transition = "transform 0.1s ease-out";
            }
        });

        // ❌ Cerrar Lightbox (clic en el fondo negro o presionar Escape)
        overlay.addEventListener("mousedown", (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });

        const escListener = (evKey: KeyboardEvent) => {
            if (evKey.key === 'Escape') { 
                overlay.remove(); 
                document.removeEventListener('keydown', escListener); 
            }
        };
        document.addEventListener('keydown', escListener);
    }
});
                }

                // 🚪 CLIC NORMAL EN LA TARJETA (Abre la nota)
                node.onClickEvent(() => {
                    this.plugin.app.workspace.getLeaf(false).openFile(item.file, { eState: { line: item.line } });
                });

                let hoverTimeout: NodeJS.Timeout | null = null;
                let tooltipEl: HTMLElement | null = null;
                let isHovering = false; 

                const removeTooltip = () => {
                    isHovering = false; 
                    if (hoverTimeout) clearTimeout(hoverTimeout);
                    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
                    document.querySelectorAll('.cornell-hover-tooltip').forEach(el => el.remove());
                };

                node.addEventListener('mouseenter', (e: MouseEvent) => {
                    
                    isHovering = true;
                    hoverTimeout = setTimeout(async () => {
                        if (!isHovering) return; 
                        const content = await this.plugin.app.vault.cachedRead(item.file);
                        if (!isHovering || !document.body.contains(node)) return;
                        const lines = content.split('\n');

                        let startLine = item.line;
                        let endLine = item.line;
                        while (startLine > 0 && lines[startLine - 1].trim() !== '' && !lines[startLine - 1].startsWith('```')) startLine--;
                        while (endLine < lines.length - 1 && lines[endLine + 1].trim() !== '' && !lines[endLine + 1].startsWith('```')) endLine++;

                        removeTooltip(); 

                        const pdfRegex = /!*\[\[(.*?\.(?:pdf).*?)\]\]/i;
                        const mdPdfRegex = /\[.*?\]\((.*?\.(?:pdf).*?)\)/i;
                        let pdfLinkText = null;

                        let match = lines[item.line].match(pdfRegex) || lines[item.line].match(mdPdfRegex);
                        if (match) pdfLinkText = match[1];
                        if (!pdfLinkText && item.line - 1 >= startLine) {
                            match = lines[item.line - 1].match(pdfRegex) || lines[item.line - 1].match(mdPdfRegex);
                            if (match) pdfLinkText = match[1];
                        }
                        if (!pdfLinkText && item.line + 1 <= endLine) {
                            match = lines[item.line + 1].match(pdfRegex) || lines[item.line + 1].match(mdPdfRegex);
                            if (match) pdfLinkText = match[1];
                        }

                        if (pdfLinkText) {
                            const cleanLinkText = pdfLinkText.split('|')[0].trim(); // 🛡️ CRÍTICO: Quitar alias
                            this.plugin.app.workspace.trigger("hover-link", {
                                event: e, source: "preview", hoverParent: node,
                                targetEl: node, linktext: cleanLinkText, sourcePath: item.file.path
                            });
                            return;
                        }

                        let rawBlock = '';
                        let highlightApplied = false;
                        for (let i = startLine; i <= endLine; i++) {
                            let cleanLine = lines[i].replace(/%%[><](.*?)%%/g, '').trim();
                            if (cleanLine.startsWith('```')) continue;
                            if (cleanLine) {
                                if ((i === item.line || (i >= item.line && !highlightApplied)) && !highlightApplied) {
                                    rawBlock += `==${cleanLine}==\n`; highlightApplied = true;
                                } else rawBlock += `${cleanLine}\n`;
                            }
                        }

                        tooltipEl = document.createElement('div');
                        tooltipEl.className = 'popover hover-popover cornell-hover-tooltip markdown-rendered markdown-preview-view'; 
                        tooltipEl.style.position = 'fixed'; 
                        tooltipEl.style.zIndex = '99999';
                        tooltipEl.style.width = '450px'; 
                        tooltipEl.style.maxHeight = '350px'; 
                        tooltipEl.style.overflowY = 'auto'; 
                        tooltipEl.style.backgroundColor = 'var(--background-primary)';
                        tooltipEl.style.border = '1px solid var(--background-modifier-border)';
                        tooltipEl.style.boxShadow = '0 10px 20px rgba(0,0,0,0.3)';
                        tooltipEl.style.borderRadius = '8px';
                        tooltipEl.style.padding = '12px';
                        tooltipEl.style.display = 'flex'; 
                        tooltipEl.style.flexDirection = 'column'; 
                        tooltipEl.style.gap = '8px'; 

                        const styleTag = document.createElement('style');
                        styleTag.innerHTML = `.cornell-hover-tooltip p { margin: 0 0 8px 0 !important; }`;
                        tooltipEl.appendChild(styleTag);
                        
                        const header = tooltipEl.createDiv({ cls: 'cornell-hover-context' });
                        const headerSpan = header.createEl("span", {
    text: `📄 ${item.file.basename} (L${item.line + 1})`,
    attr: { style: "font-size: 1.1em; color: var(--text-normal); font-weight: bold; display: block; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px; width: 100%;" }
});
                        
                        const body = tooltipEl.createDiv();
                        body.style.width = '100%'; 
                        document.body.appendChild(tooltipEl);

                        const rect = node.getBoundingClientRect();
                        let leftPos = rect.right + 20; 
                        if (leftPos + 450 > window.innerWidth) leftPos = rect.left - 470; 
                        if (leftPos < 10) leftPos = 10; 
                        tooltipEl.style.left = `${leftPos}px`;
                        
                        let topPos = rect.top;
                        if (topPos + 350 > window.innerHeight) topPos = window.innerHeight - 360;
                        tooltipEl.style.top = `${Math.max(10, topPos)}px`;

                        const inlineImgRegex = /!\[\[(.*?\.(?:png|jpg|jpeg|gif|bmp|svg))\|?(.*?)\]\]/gi;
                        rawBlock = rawBlock.replace(inlineImgRegex, (match2, filename) => {
                            const file = this.plugin.app.metadataCache.getFirstLinkpathDest(filename.trim(), item.file.path);
                            if (file) {
                                const resourcePath = this.plugin.app.vault.getResourcePath(file);
                                return `<img src="${resourcePath}" style="max-height:220px; max-width:100%; border-radius:6px; display:block; margin:8px auto;">`;
                            }
                            return match2; 
                        });

                        if (!rawBlock.trim()) rawBlock = "*No text context available.*";

                        // @ts-ignore
                        await MarkdownRenderer.renderMarkdown(rawBlock, body, item.file.path, this);

                        requestAnimationFrame(() => {
                            if (tooltipEl) tooltipEl.addClass('is-visible');
                        });
                    }, 500); 
                }); 

                node.addEventListener('mouseleave', removeTooltip);
            }
        }

        setTimeout(() => {
            allNodes.forEach(sourceItem => {
                const sourceNode = document.getElementById(sourceItem.id);
                if (!sourceNode) return; 

                sourceItem.outgoingLinks.forEach((link: string) => {
                    let targetKey = link.split('|')[0].trim(); 
                    let targetNode = domNodesMap.get(targetKey);

                    if (targetNode && targetNode !== sourceNode) {
                        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                        path.setAttribute("fill", "transparent");
                        path.setAttribute("stroke", "var(--interactive-accent)");
                        path.setAttribute("stroke-width", "2");
                        path.classList.add("cornell-semantic-thread");
                        
                        path.setAttribute("data-source", sourceNode.id);
                        path.setAttribute("data-target", targetNode.id);

                        svgOverlay.appendChild(path);
                    }
                });
            });

            this.updatePathCoordinates(contentContainer, scrollContainer);
            
            const allPaths = document.querySelectorAll('.cornell-semantic-thread');
            allPaths.forEach(path => {
                path.classList.remove('is-visible');
            });

            const allDomNodes = document.querySelectorAll('.cornell-rhizome-node');
            allDomNodes.forEach(node => {
                node.addEventListener('mouseenter', () => {
                    const currentId = node.id;
                    node.classList.add('is-hovered');

                    allPaths.forEach(path => {
                        const src = path.getAttribute('data-source');
                        const tgt = path.getAttribute('data-target');

                        if (src === currentId || tgt === currentId) {
                            path.classList.add('is-visible'); 
                            const partnerId = (src === currentId) ? tgt : src;
                            const partnerNode = document.getElementById(partnerId as string);
                            if (partnerNode) partnerNode.classList.add('is-connected');
                        }
                    });
                });

                node.addEventListener('mouseleave', () => {
                    const isFocusMode = document.querySelector('.cornell-focus-banner');
                    if (!isFocusMode) {
                        allPaths.forEach(path => path.classList.remove('is-visible'));
                    }
                    allDomNodes.forEach(n => {
                        n.classList.remove('is-connected');
                        n.classList.remove('is-hovered');
                    });
                });
            });

        }, 300);
    }

    // ======================================================
    // 🌌 MOTOR DEL MODO MOLÉCULA (LIENZO ESPACIAL 3D)
    // ======================================================
    renderMoleculeView() {
        const canvas = this.canvasEl;
        canvas.empty();
        
        const scrollContainer = canvas.createDiv({ cls: 'cornell-rhizome-scroll' });
        scrollContainer.style.overflow = 'auto'; 
        
        const container = scrollContainer.createDiv({ cls: 'cornell-molecule-canvas' });
        container.style.position = 'relative';
        container.style.width = '3000px'; 
        container.style.height = '3000px';
        // 🚀 FIX: Hace que el contenedor gigante no bloquee el ratón
        container.style.pointerEvents = 'none';

        // 🎥 CONTROL DE CÁMARA Y NAVEGACIÓN 3D (VERDADERA ÓRBITA)
        let rotX = 55;
        let rotY = -15; // 🚀 CAMBIO CLAVE: Eje Y en lugar de Z
        let currentZoom = this.is3DMode ? 0.9 : 1;

        const zoomControls = canvas.createDiv({ cls: 'cornell-rhizome-zoom-controls' });
        zoomControls.style.zIndex = '1000'; 
        
        // 🍅 BOTÓN MARGIDORO
        const margidoroBtn = zoomControls.createEl('button', { 
            text: this.isMargidoroMode ? '🍅 Focus: Pending' : '🍅 Pomodoro Review',
            cls: this.isMargidoroMode ? 'is-reviewing' : '' 
        });
        margidoroBtn.style.marginRight = '10px';
        margidoroBtn.onclick = () => {
            this.isMargidoroMode = !this.isMargidoroMode;
            this.renderTimeline(); 
        };

        const zoomOutBtn = zoomControls.createEl('button', { text: '-' });
        const zoomResetBtn = zoomControls.createEl('button', { text: '100%' });
        const zoomInBtn = zoomControls.createEl('button', { text: '+' });

        const applyTransform = (smooth = true) => {
            container.style.transition = smooth ? 'transform 0.8s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
            if (this.is3DMode) {
                // 🚀 Aplicamos rotateY para lograr la perspectiva de profundidad
                container.style.transform = `perspective(2000px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${currentZoom}) translateY(-100px)`;
                container.style.transformStyle = 'preserve-3d';
                container.style.boxShadow = 'inset 0 0 200px rgba(0,0,0,0.5)';
            } else {
                container.style.transform = `perspective(2000px) rotateX(0deg) rotateY(0deg) scale(${currentZoom}) translateY(0px)`;
                container.style.boxShadow = 'none';
            }
        };

        zoomInBtn.onclick = () => { currentZoom = Math.min(currentZoom + 0.2, 2.5); applyTransform(); zoomResetBtn.innerText = `${Math.round(currentZoom * 100)}%`; };
        zoomOutBtn.onclick = () => { currentZoom = Math.max(currentZoom - 0.2, 0.2); applyTransform(); zoomResetBtn.innerText = `${Math.round(currentZoom * 100)}%`; };
        zoomResetBtn.onclick = () => { currentZoom = this.is3DMode ? 0.9 : 1; rotX = 55; rotY = -15; applyTransform(); zoomResetBtn.innerText = '100%'; };

        scrollContainer.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                if (e.deltaY < 0) currentZoom = Math.min(currentZoom + 0.1, 2.5);
                else currentZoom = Math.max(currentZoom - 0.1, 0.2);
                applyTransform();
                zoomResetBtn.innerText = `${Math.round(currentZoom * 100)}%`;
            }
        });

        // --- 2. 🛸 NAVEGACIÓN ORBITAL (ROTACIÓN LIBRE) ---
        scrollContainer.addEventListener('mousedown', (e: MouseEvent) => {
            if (!this.is3DMode) return;
            if ((e.target as HTMLElement).closest('.cornell-rhizome-node, .cornell-action-btn, button, a')) return;

            let startX = e.clientX;
            let startY = e.clientY;
            let startRotX = rotX;
            let startRotY = rotY; // 🚀 Guardamos el eje Y
            
            scrollContainer.style.cursor = 'grabbing';

            const onMouseMove = (moveEvent: MouseEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;

                // 🚀 Eje X del ratón mueve la cámara ALREDEDOR (Órbita Y)
                rotY = startRotY + (dx * 0.4); 
                // Eje Y del ratón inclina la cámara ARRIBA/ABAJO (Órbita X)
                rotX = Math.max(0, Math.min(startRotX - (dy * 0.4), 85)); 

                applyTransform(false); 
            };

            const onMouseUp = () => {
                scrollContainer.style.cursor = 'auto';
                applyTransform(true); 
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        applyTransform();

        // 🕸️ INYECTAR CAPA DE LÍNEAS 3D (REEMPLAZA AL SVG PLANO)
        const linesContainer = container.createDiv({ cls: 'cornell-3d-lines-container' });
        linesContainer.style.position = 'absolute';
        linesContainer.style.top = '0';
        linesContainer.style.left = '0';
        linesContainer.style.width = '100%';
        linesContainer.style.height = '100%';
        linesContainer.style.pointerEvents = 'none'; // Transparente al ratón
        linesContainer.style.transformStyle = 'preserve-3d'; // VITAL: Permite que las líneas existan en la profundidad
        linesContainer.style.zIndex = '0';

        // 🎯 BANNER DE MODO FOCO (Si está activo)
        if (this.focusedClusterId) {
            const focusBanner = scrollContainer.createDiv({ cls: 'cornell-focus-banner' });
            focusBanner.style.position = 'fixed';
            focusBanner.style.top = '20px';
            focusBanner.style.left = '50%';
            focusBanner.style.transform = 'translateX(-50%)';
            focusBanner.style.zIndex = '1000';
            focusBanner.style.background = 'var(--interactive-accent)';
            focusBanner.style.color = 'var(--text-on-accent)';
            focusBanner.style.padding = '10px 20px';
            focusBanner.style.borderRadius = '20px';
            focusBanner.style.boxShadow = '0 5px 15px rgba(0,0,0,0.3)';
            focusBanner.style.display = 'flex';
            focusBanner.style.gap = '10px';
            focusBanner.style.alignItems = 'center';

            focusBanner.innerHTML = `<span>🎯 Focused on Isolated Molecule</span>`;
            const exitFocusBtn = focusBanner.createEl('button', { text: '✖ Exit Focus' });
            exitFocusBtn.style.background = 'transparent';
            exitFocusBtn.style.border = '1px solid white';
            exitFocusBtn.style.color = 'white';
            exitFocusBtn.style.cursor = 'pointer';
            exitFocusBtn.style.borderRadius = '4px';
            
            exitFocusBtn.onclick = () => {
                this.focusedClusterId = null;
                this.renderTimeline();
            };
        }

        // 🧠 ALGORITMO RASTREADOR DE CLÚSTER (BFS Bidireccional)
        const clusterIds = new Set<string>();
        if (this.focusedClusterId) {
            const queue = [this.focusedClusterId];
            clusterIds.add(this.focusedClusterId);
            
            // Mapeamos todas las conexiones del universo
            const network = new Map<string, string[]>();
            this.allCachedNodes.forEach(n => {
                if (!network.has(n.id)) network.set(n.id, []);
                if (n.compassLinks) {
                    n.compassLinks.forEach((l: any) => {
                        const rawT = l.target.split('|')[0].trim().replace('[[', '').replace(']]', '');
                        const match = rawT.match(/#\^([a-zA-Z0-9]+)/);
                        let tId = match ? match[1] : null;
                        if (!tId) {
                            const tNode = this.allCachedNodes.find(xn => xn.file.basename === rawT || xn.text.includes(rawT));
                            if (tNode) tId = tNode.id;
                        }
                        if (tId) {
                            if (!network.has(tId)) network.set(tId, []);
                            network.get(n.id)!.push(tId);
                            network.get(tId)!.push(n.id); // Conexión bidireccional
                        }
                    });
                }
            });

            // Propagación viral para encontrar a toda la familia
            let head = 0;
            while (head < queue.length) {
                const current = queue[head++];
                const neighbors = network.get(current) || [];
                neighbors.forEach(nx => {
                    if (!clusterIds.has(nx)) {
                        clusterIds.add(nx);
                        queue.push(nx);
                    }
                });
            }
        }

        // 🔍 0. APLICAR FILTROS (Búsqueda, Color, Huérfanas y FOCO)
        const searchLower = this.searchQuery.toLowerCase();
        const activeColors = this.activeColorFilters;
        
        const connectedIds = new Set<string>();
        if (this.hideOrphans) {
            // ... (El código que ya tienes de hideOrphans queda intacto aquí adentro)
            this.allCachedNodes.forEach(node => {
                if (node.compassLinks && node.compassLinks.length > 0) {
                    connectedIds.add(node.id); 
                    node.compassLinks.forEach((link: any) => {
                        const rawTarget = link.target.split('|')[0].trim().replace('[[', '').replace(']]', '');
                        const targetIdMatch = rawTarget.match(/#\^([a-zA-Z0-9]+)/);
                        if (targetIdMatch) {
                            connectedIds.add(targetIdMatch[1]); 
                        } else {
                            const targetNode = this.allCachedNodes.find(n => n.file.basename === rawTarget || n.text.includes(rawTarget));
                            if (targetNode) connectedIds.add(targetNode.id); 
                        }
                    });
                }
            });
        }

        const validNodes = this.allCachedNodes.filter(item => {
            const matchesSearch = item.text.toLowerCase().includes(searchLower) || item.file.basename.toLowerCase().includes(searchLower);
            const matchesColor = activeColors.size === 0 || activeColors.has(item.color);
            const matchesOrphan = !this.hideOrphans || connectedIds.has(item.id) || connectedIds.has(item.blockId);
            // 🎯 NUEVO FILTRO: Si hay un foco activo, DEBE pertenecer a esa familia
            const matchesCluster = !this.focusedClusterId || clusterIds.has(item.id);
            
            // 🍅 FILTRO MARGIDORO
            const isPending = this.plugin.settings.userStats.margidoroPending?.includes(item.id);
            const matchesMargidoro = !this.isMargidoroMode || isPending;
            
            return matchesSearch && matchesColor && matchesOrphan && matchesCluster && matchesMargidoro;
        });

        
        // 🚀 AHORA EL MAPA MEMORIZA LAS 3 DIMENSIONES (X, Y, Z)
        const positions = new Map<string, {x: number, y: number, z: number, rx: number, ry: number}>();
        const centerX = 1500; const centerY = 1500; 
        const spacing = 350; 
        
        // 1. FÍSICA Y COORDENADAS ESPACIALES
        validNodes.forEach((node, idx) => {
            if (!positions.has(node.id)) {
                // Asignamos una Z inicial "aleatoria" para que nazcan en distintas alturas si estamos en 3D
                const initZ = this.is3DMode ? ((node.text.length % 200) - 100) : 0;
                positions.set(node.id, { x: centerX + (idx * 50), y: centerY + (idx * 50), z: initZ, rx: 0, ry: 0 });
            }
            
            if (node.compassLinks && node.compassLinks.length > 0) {
                node.compassLinks.forEach((link: any) => {
                    const rawTarget = link.target.split('|')[0].trim().replace('[[', '').replace(']]', '');
                    const targetIdMatch = rawTarget.match(/#\^([a-zA-Z0-9]+)/);
                    let targetNode = null;
                    
                    if (targetIdMatch) {
                        const tId = targetIdMatch[1];
                        targetNode = validNodes.find(n => n.id === tId || n.blockId === tId);
                    } else {
                        targetNode = validNodes.find(n => n.file.basename === rawTarget || n.text.includes(rawTarget));
                    }

                    if (targetNode) {
                        const basePos = positions.get(node.id)!;
                        let dx = 0; let dy = 0;
                        if (link.direction === 'north') dy = -spacing;
                        if (link.direction === 'south') dy = spacing;
                        if (link.direction === 'east') dx = spacing;
                        if (link.direction === 'west') dx = -spacing;
                        
                        // Forzamos la nueva posición X e Y, y le heredamos la profundidad Z de su padre
                        positions.set(targetNode.id, { x: basePos.x + dx, y: basePos.y + dy, z: basePos.z, rx: 0, ry: 0 });
                    }
                });
            }
        });

        // 2. RENDERIZADO DE NODOS
        validNodes.forEach(item => {
            const pos = positions.get(item.id);
            if (!pos) return;

            const node = container.createDiv({ cls: 'cornell-rhizome-node is-molecule-node' });
            node.id = item.id;
            node.style.position = 'absolute';
            node.style.left = `${pos.x}px`;
            node.style.top = `${pos.y}px`;
            node.style.width = '240px';
            node.style.borderColor = item.color;
            node.style.boxShadow = `0 4px 15px ${item.color}20`;
            node.style.zIndex = '1';
            // 🚀 FIX: Le devuelve la fisicalidad a la tarjeta para que detecte el click y hover
            node.style.pointerEvents = 'auto';
           

            // 🚀 LEER LA PROFUNDIDAD Z EXACTA DESDE EL MAPA
         if (this.is3DMode) {
             node.style.transform = `translateZ(${pos.z}px) rotateX(${pos.rx || 0}deg) rotateY(${pos.ry || 0}deg)`;
                const shadowSpread = Math.max(10, 30 + (pos.z * 0.2));
                node.style.boxShadow = `0 ${shadowSpread}px ${shadowSpread + 10}px ${item.color}40`;
            } else {
                node.style.transform = 'translateZ(0px)';
            }

            // --- 🖼️ MAGIA DE IMÁGENES ---
            let cleanText = item.text.replace(/^[!?XV-]+\s*/, '');
            const imagesToRender: string[] = [];
            const imgRegex = /img:\s*\[\[(.*?)\]\]/gi;
            const imgMatches = Array.from(cleanText.matchAll(imgRegex)) as RegExpMatchArray[];
            imgMatches.forEach(m => imagesToRender.push(m[1]));
            cleanText = cleanText.replace(imgRegex, '').trim();
            const threadRegex = /(?<!!)\[\[(.*?)\]\]/g;
            cleanText = cleanText.replace(threadRegex, '').trim();

            if (cleanText) {
                node.createEl("span", { text: cleanText.length > 130 ? cleanText.substring(0, 130) + "..." : cleanText });
            }

            if (imagesToRender.length > 0) {
                const imgContainer = node.createDiv({ cls: 'cornell-rhizome-images' });
                imagesToRender.forEach(imgName => {
                    const cleanName = imgName.split('|')[0];
                    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanName, item.file.path);
                    if (file) {
                        const imgSrc = this.plugin.app.vault.getResourcePath(file);
                        const imgEl = imgContainer.createEl('img', { attr: { src: imgSrc, draggable: 'false' } });
                        imgEl.style.maxHeight = '120px';
                        imgEl.style.maxWidth = '100%';
                        imgEl.style.objectFit = 'contain';
                        imgEl.style.borderRadius = '4px';
                        imgEl.style.marginTop = '8px';
                        imgEl.style.display = 'block';
                    }
                });
            } // 🛡️ AQUÍ CERRAMOS EL BLOQUE DE IMÁGENES PARA NO ATRAPAR LOS BOTONES

            // --- 🛠️ BOTONERA UNIFICADA DE ACCIONES ---
            // Aquí viven Focus, Stitch y Zoom ordenados horizontalmente
            const actionsDiv = node.createDiv({ cls: 'cornell-rhizome-actions' });
            actionsDiv.style.position = 'absolute';
            actionsDiv.style.bottom = '8px';
            actionsDiv.style.right = '8px';
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '6px'; // Separación perfecta entre los botones
            actionsDiv.style.zIndex = '10';

            // 🍅 BOTÓN MASTERED (Solo aparece si estamos en Pomodoro Review)
            if (this.isMargidoroMode && this.plugin.settings.userStats.margidoroPending?.includes(item.id)) {
                const resolveBtn = actionsDiv.createDiv({ cls: 'cornell-action-btn' });
                setIcon(resolveBtn, 'check-circle');
                resolveBtn.title = "Mark as Mastered";
                resolveBtn.style.background = 'var(--color-green)';
                resolveBtn.style.color = 'white';
                resolveBtn.style.padding = '4px';
                resolveBtn.style.borderRadius = '4px';
                resolveBtn.style.cursor = 'pointer';

                resolveBtn.onClickEvent(async (ev) => {
                    ev.stopPropagation(); 
                    // Sacamos el ID de la lista de pendientes y guardamos
                    this.plugin.settings.userStats.margidoroPending = this.plugin.settings.userStats.margidoroPending.filter((id: string) => id !== item.id);
                    await this.plugin.saveSettings();
                    
                    // Efecto visual y recarga
                    node.style.transform = 'scale(0.8)';
                    node.style.opacity = '0';
                    setTimeout(() => this.renderTimeline(), 250);
                    new Notice("✅ Topic Mastered!");
                });
            }

            // 1. Botón de Focus (Clúster Molecular) -> Presente en TODAS
            const focusBtn = actionsDiv.createDiv({ cls: 'cornell-action-btn' });
            setIcon(focusBtn, 'focus');
            focusBtn.title = "Isolate Molecule Cluster";
            focusBtn.style.background = 'var(--background-modifier-border)';
            focusBtn.style.padding = '4px';
            focusBtn.style.borderRadius = '4px';
            focusBtn.style.cursor = 'pointer';

            focusBtn.onClickEvent((ev) => {
                ev.stopPropagation(); 
                this.focusedClusterId = item.id;
                this.renderTimeline(); 
            });

            // 2. Botón de Cosido (Stitch) -> Presente en TODAS
            const stitchBtn = actionsDiv.createDiv({ cls: 'cornell-action-btn' });
            setIcon(stitchBtn, 'link');
            stitchBtn.title = "Stitch (Connect) to another note";
            stitchBtn.style.background = 'var(--background-modifier-border)';
            stitchBtn.style.padding = '4px';
            stitchBtn.style.borderRadius = '4px';
            stitchBtn.style.cursor = 'pointer';

            stitchBtn.onClickEvent((ev) => {
                ev.stopPropagation(); 
                this.handleStitchClick(item, node, canvas);
            });
            
            if (imagesToRender.length > 0) {
                const zoomBtn = actionsDiv.createDiv({ cls: 'cornell-action-btn' });
                setIcon(zoomBtn, 'maximize');
                zoomBtn.title = "View Doodle in Fullscreen";
                zoomBtn.style.background = 'var(--background-modifier-border)';
                zoomBtn.style.padding = '4px';
                zoomBtn.style.borderRadius = '4px';
                zoomBtn.style.cursor = 'pointer';

                zoomBtn.onClickEvent((ev) => {
                    ev.stopPropagation(); 
                    
                    const firstImg = imagesToRender[0];
                    const cleanName = firstImg.split('|')[0];
                    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanName, item.file.path);
                    
                    if (file) {
                        const imgSrc = this.plugin.app.vault.getResourcePath(file);
                        const overlay = document.body.createDiv({ cls: 'cornell-lightbox-overlay' });
                        overlay.style.position = 'fixed';
                        overlay.style.top = '0'; overlay.style.left = '0';
                        overlay.style.width = '100vw'; overlay.style.height = '100vh';
                        overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
                        overlay.style.zIndex = '999999';
                        overlay.style.display = 'flex';
                        overlay.style.justifyContent = 'center';
                        overlay.style.alignItems = 'center';

                        const bigImg = overlay.createEl('img', { attr: { src: imgSrc } });
                        bigImg.style.backgroundColor = 'white'; 
                        bigImg.style.padding = '10px'; 
                        bigImg.style.borderRadius = '8px'; 
                        bigImg.style.maxHeight = '90vh';
                        bigImg.style.maxWidth = '90vw';

                        if (document.body.classList.contains('theme-dark') && cleanName.includes('doodle_')) {
                            bigImg.style.filter = 'invert(1)';
                            bigImg.style.opacity = '0.9';
                        }

                        overlay.onclick = () => overlay.remove();
                        const escListener = (evKey: KeyboardEvent) => {
                            if (evKey.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escListener); }
                        };
                        document.addEventListener('keydown', escListener);
                    }
                });
            }
            

            // --- 🕹️ CONTROL CENTRAL DE EVENTOS (CLIC VS DRAG) ---
            let wasDragged = false;

            // 1. EL CLIC (Protegido)
            node.addEventListener('click', (e: MouseEvent) => {
                // Si el árbitro dice que arrastramos, bloqueamos la apertura de la nota
                if (wasDragged) {
                    e.preventDefault();
                    e.stopPropagation();
                    return; 
                }

                if(this.isStitchingMode) {
                    this.handleStitchClick(item, node, canvas);
                } else {
                    this.plugin.app.workspace.getLeaf(false).openFile(item.file, { eState: { line: item.line } });
                }
            });

            // --- 👁️ MAGIA HOVER TOOLTIP ---
            let hoverTimeout: NodeJS.Timeout | null = null;
            let tooltipEl: HTMLElement | null = null;
            let isHovering = false; 

            const removeTooltip = () => {
                isHovering = false; 
                if (hoverTimeout) clearTimeout(hoverTimeout);
                if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
                document.querySelectorAll('.cornell-hover-tooltip').forEach(el => el.remove());
            };

            node.addEventListener('mouseenter', (e: MouseEvent) => {
                if (wasDragged) return; // 👈 Aquí SÍ va esto porque estamos en 3D
                isHovering = true;
                hoverTimeout = setTimeout(async () => {
                    if (!isHovering) return;
                    const content = await this.plugin.app.vault.cachedRead(item.file);
                    if (!isHovering || !document.body.contains(node)) return;
                    const lines = content.split('\n');

                    let startLine = item.line;
                    let endLine = item.line;
                    while (startLine > 0 && lines[startLine - 1].trim() !== '' && !lines[startLine - 1].startsWith('```')) startLine--;
                    while (endLine < lines.length - 1 && lines[endLine + 1].trim() !== '' && !lines[endLine + 1].startsWith('```')) endLine++;

                    removeTooltip();

                    const pdfRegex = /!*\[\[(.*?\.(?:pdf).*?)\]\]/i;
                    const mdPdfRegex = /\[.*?\]\((.*?\.(?:pdf).*?)\)/i;
                    let pdfLinkText = null;

                    let match = lines[item.line].match(pdfRegex) || lines[item.line].match(mdPdfRegex);
                    if (match) pdfLinkText = match[1];
                    if (!pdfLinkText && item.line - 1 >= startLine) {
                        match = lines[item.line - 1].match(pdfRegex) || lines[item.line - 1].match(mdPdfRegex);
                        if (match) pdfLinkText = match[1];
                    }
                    if (!pdfLinkText && item.line + 1 <= endLine) {
                        match = lines[item.line + 1].match(pdfRegex) || lines[item.line + 1].match(mdPdfRegex);
                        if (match) pdfLinkText = match[1];
                    }

                    if (pdfLinkText) {
                        const cleanLinkText = pdfLinkText.split('|')[0].trim();
                        this.plugin.app.workspace.trigger("hover-link", {
                            event: e, source: "preview", hoverParent: node,
                            targetEl: node, linktext: cleanLinkText, sourcePath: item.file.path
                        });
                        return;
                    }

                    let rawBlock = '';
                    let highlightApplied = false;
                    for (let i = startLine; i <= endLine; i++) {
                        let cleanLine = lines[i].replace(/%%[><](.*?)%%/g, '').trim();
                        if (cleanLine.startsWith('```')) continue;
                        if (cleanLine) {
                            if ((i === item.line || (i >= item.line && !highlightApplied)) && !highlightApplied) {
                                rawBlock += `==${cleanLine}==\n`; highlightApplied = true;
                            } else rawBlock += `${cleanLine}\n`;
                        }
                    }

                    tooltipEl = document.createElement('div');
                    tooltipEl.className = 'popover hover-popover cornell-hover-tooltip markdown-rendered markdown-preview-view';
                    tooltipEl.style.position = 'fixed';
                    tooltipEl.style.zIndex = '99999';
                    tooltipEl.style.width = '450px';
                    tooltipEl.style.maxHeight = '350px';
                    tooltipEl.style.overflowY = 'auto';
                    tooltipEl.style.backgroundColor = 'var(--background-primary)';
                    tooltipEl.style.border = '1px solid var(--background-modifier-border)';
                    tooltipEl.style.boxShadow = '0 10px 20px rgba(0,0,0,0.3)';
                    tooltipEl.style.borderRadius = '8px';
                    tooltipEl.style.padding = '12px';
                    tooltipEl.style.display = 'flex';
                    tooltipEl.style.flexDirection = 'column';
                    tooltipEl.style.gap = '8px';

                    const styleTag = document.createElement('style');
                    styleTag.innerHTML = `.cornell-hover-tooltip p { margin: 0 0 8px 0 !important; }`;
                    tooltipEl.appendChild(styleTag);

                    const header = tooltipEl.createDiv({ cls: 'cornell-hover-context' });
                    const headerSpan = header.createEl("span", {
    text: `📄 ${item.file.basename} (L${item.line + 1})`,
    attr: { style: "font-size: 1.1em; color: var(--text-normal); font-weight: bold; display: block; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px; width: 100%;" }
});
                    const body = tooltipEl.createDiv();
                    body.style.width = '100%';
                    document.body.appendChild(tooltipEl);

                    const rect = node.getBoundingClientRect();
                    let leftPos = rect.right + 20;
                    if (leftPos + 450 > window.innerWidth) leftPos = rect.left - 470;
                    if (leftPos < 10) leftPos = 10;
                    tooltipEl.style.left = `${leftPos}px`;

                    let topPos = rect.top;
                    if (topPos + 350 > window.innerHeight) topPos = window.innerHeight - 360;
                    tooltipEl.style.top = `${Math.max(10, topPos)}px`;

                    const inlineImgRegex = /!\[\[(.*?\.(?:png|jpg|jpeg|gif|bmp|svg))\|?(.*?)\]\]/gi;
                    rawBlock = rawBlock.replace(inlineImgRegex, (match2, filename) => {
                        const file = this.plugin.app.metadataCache.getFirstLinkpathDest(filename.trim(), item.file.path);
                        if (file) {
                            const resourcePath = this.plugin.app.vault.getResourcePath(file);
                            return `<img src="${resourcePath}" style="max-height:220px; max-width:100%; border-radius:6px; display:block; margin:8px auto;">`;
                        }
                        return match2;
                    });

                    if (!rawBlock.trim()) rawBlock = "*No text context available.*";

                    // @ts-ignore
                    await MarkdownRenderer.renderMarkdown(rawBlock, body, item.file.path, this);

                    requestAnimationFrame(() => {
                        if (tooltipEl) tooltipEl.addClass('is-visible');
                    });
                }, 500);
            });

            node.addEventListener('mouseleave', removeTooltip);

            // 2. EL ARRASTRE ESPACIAL (Drag & Drop)
            node.style.cursor = 'grab';
            
            node.addEventListener('mousedown', (e: MouseEvent) => {
                const target = e.target as HTMLElement;
                if (target.closest('button, a')) return;
                
                wasDragged = false; // Reiniciamos el árbitro al tocar la tarjeta
                let startX = e.clientX;
                let startY = e.clientY;
                let initialLeft = parseInt(node.style.left, 10) || 0;
                let initialTop = parseInt(node.style.top, 10) || 0;
                
                node.style.zIndex = '100'; 
                node.style.cursor = 'grabbing';
                node.style.transition = 'none'; 
                removeTooltip(); // Ocultamos el tooltip si empezamos a mover
                
                // Rescatamos la Z inicial al hacer clic
                let initialZ = positions.get(item.id)?.z || 0; 
                let initialRx = positions.get(item.id)?.rx || 0;
                let initialRy = positions.get(item.id)?.ry || 0;
                
                const onMouseMove = (moveEvent: MouseEvent) => {
                    const dx = moveEvent.clientX - startX;
                    const dy = moveEvent.clientY - startY;
                    
                    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                        wasDragged = true;
                    }

                   if (moveEvent.shiftKey && this.is3DMode) {
                     // 🛸 MODO PROFUNDIDAD (EJE Z)
                     const newZ = initialZ - (dy * 1.5); 
                     node.style.transform = `translateZ(${newZ}px) rotateX(${initialRx}deg) rotateY(${initialRy}deg)`;
                     const shadowSpread = Math.max(10, 30 + (newZ * 0.2));
                     node.style.boxShadow = `0 ${shadowSpread}px ${shadowSpread + 10}px ${item.color}40`;
                     positions.set(item.id, { x: initialLeft, y: initialTop, z: newZ, rx: initialRx, ry: initialRy });

                 } else if (moveEvent.altKey && this.is3DMode) {
                     // 🌀 MODO ROTACIÓN (EJE X e Y de la tarjeta)
                     const newRx = initialRx - (dy * 0.5);
                     const newRy = initialRy + (dx * 0.5);
                     node.style.transform = `translateZ(${initialZ}px) rotateX(${newRx}deg) rotateY(${newRy}deg)`;
                     positions.set(item.id, { x: initialLeft, y: initialTop, z: initialZ, rx: newRx, ry: newRy });

                 } else {
                     // 🪐 FÍSICA RELATIVISTA CORREGIDA (Ejes Desacoplados)
                        const radY = rotY * (Math.PI / 180);
                        const radX = rotX * (Math.PI / 180);
                        
                        // Evitamos dividir por cero si la mesa se pone a 90 grados
                        const cosY = Math.abs(Math.cos(radY)) < 0.1 ? 0.1 * Math.sign(Math.cos(radY)) : Math.cos(radY);
                        const cosX = Math.abs(Math.cos(radX)) < 0.1 ? 0.1 * Math.sign(Math.cos(radX)) : Math.cos(radX);

                        // La magia: Dividimos por el coseno para anular la compresión de la perspectiva
                        const localDx = (dx / currentZoom) / cosY;
                        const localDy = (dy / currentZoom) / cosX;

                        const newX = initialLeft + localDx;
                        const newY = initialTop + localDy;
                        
                        node.style.left = `${newX}px`;
                        node.style.top = `${newY}px`;
                        
                        positions.set(item.id, { x: newX, y: newY, z: initialZ, rx: initialRx, ry: initialRy });
                    }
                    
                    // 🕸️ Actualizamos usando el nuevo contenedor
                    this.redrawMoleculeLines(validNodes, positions, linesContainer);
                };

                const onMouseUp = () => {
                    node.style.zIndex = '1';
                    node.style.cursor = 'grab';
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                    
                    // Le damos 50 milisegundos al sistema para procesar el clic antes de bajar la bandera
                    setTimeout(() => { wasDragged = false; }, 50);
                };

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        });

        // 3. DIBUJADO VECTORIAL INICIAL (Primera pasada)
        this.redrawMoleculeLines(validNodes, positions, linesContainer);
        
        setTimeout(() => {
            scrollContainer.scrollLeft = 1000;
            scrollContainer.scrollTop = 1000;
        }, 100);
    }
    // 🎯 MOTOR DEL MODO FOCO SEMÁNTICO
    activateFocusMode(centerNodeId: string, allNodes: any[], domNodesMap: Map<string, HTMLElement>, canvas: HTMLElement) {
        const allDomNodes = document.querySelectorAll('.cornell-rhizome-node');
        const allColumns = document.querySelectorAll('.cornell-rhizome-day-column');
        const allPaths = document.querySelectorAll('.cornell-semantic-thread');
        
        // Referencias a los contenedores para poder medir distancias
        const scrollContainer = canvas.querySelector('.cornell-rhizome-scroll') as HTMLElement;
        const contentContainer = canvas.querySelector('.cornell-rhizome-content') as HTMLElement;
        
        // 1. Encontrar todos los IDs que pertenecen a este clúster (el centro + sus conexiones)
        const clusterIds = new Set<string>();
        clusterIds.add(centerNodeId);

        const centerNodeData = allNodes.find(n => n.id === centerNodeId);
        if (centerNodeData) {
            centerNodeData.outgoingLinks.forEach((link: string) => {
                const targetKey = link.split('|')[0].trim();
                const targetNode = domNodesMap.get(targetKey);
                if (targetNode) clusterIds.add(targetNode.id);
            });
        }

        allNodes.forEach(node => {
            node.outgoingLinks.forEach((link: string) => {
                const targetKey = link.split('|')[0].trim();
                const targetNode = domNodesMap.get(targetKey);
                if (targetNode && targetNode.id === centerNodeId) {
                    clusterIds.add(node.id);
                }
            });
        });

        // 2. Ocultar tarjetas que NO están en el clúster
        allDomNodes.forEach(node => {
            if (!clusterIds.has(node.id)) {
                node.classList.add('is-dimmed');
            } else {
                node.classList.remove('is-dimmed');
            }
        });

        // 3. Ocultar columnas vacías
        allColumns.forEach(col => {
            const visibleNodes = col.querySelectorAll('.cornell-rhizome-node:not(.is-dimmed)');
            if (visibleNodes.length === 0) {
                col.classList.add('is-empty');
            } else {
                col.classList.remove('is-empty');
            }
        });

        // 🚀 MAGIA: Le damos 150ms al navegador para que mueva las columnas y RECALCULAMOS LAS LÍNEAS
        setTimeout(() => {
            this.updatePathCoordinates(contentContainer, scrollContainer);
            
            // 4. Encendemos las líneas correctas después de reubicarlas
            allPaths.forEach(path => {
                const src = path.getAttribute('data-source');
                const tgt = path.getAttribute('data-target');
                if (src && tgt && (clusterIds.has(src) && clusterIds.has(tgt))) {
                    path.classList.add('is-visible');
                } else {
                    path.classList.remove('is-visible');
                }
            });
        }, 150);

        // 5. Crear Banner de Salida
        const existingBanner = canvas.querySelector('.cornell-focus-banner');
        if (existingBanner) existingBanner.remove();

        const banner = canvas.createDiv({ cls: 'cornell-focus-banner' });
        const bannerIcon = banner.createSpan();
        setIcon(bannerIcon, 'network');
        banner.createSpan({ text: `Semantic Cluster (${clusterIds.size} notes)` });
        
        const exitBtn = banner.createEl('button', { cls: 'cornell-focus-exit-btn', title: 'Exit Focus Mode' });
        setIcon(exitBtn, 'x');

        exitBtn.onclick = () => {
            // Restaurar todo a la normalidad
            allDomNodes.forEach(n => n.classList.remove('is-dimmed'));
            allColumns.forEach(c => c.classList.remove('is-empty'));
            allPaths.forEach(p => p.classList.remove('is-visible'));
            banner.remove();

            // 🚀 MAGIA INVERSA: Volvemos a recalcular las líneas a sus posiciones originales
            setTimeout(() => {
                this.updatePathCoordinates(contentContainer, scrollContainer);
            }, 150);
        };
    }

    // 🕸️ MOTOR RE-CALCULADOR DE RUTAS SVG (Calcula la física real en vivo)
    updatePathCoordinates(contentContainer: HTMLElement, scrollContainer: HTMLElement) {
        const svgOverlay = contentContainer.querySelector('.cornell-rhizome-svg-overlay') as SVGSVGElement;
        if (!svgOverlay) return;

        // Recuperamos el valor real del zoom para no distorsionar las líneas
        const currentZoom = parseFloat(contentContainer.style.getPropertyValue('zoom')) || 1;

        svgOverlay.style.width = contentContainer.scrollWidth + "px";
        svgOverlay.style.height = contentContainer.scrollHeight + "px";
        
        const containerRect = scrollContainer.getBoundingClientRect();

        const allPaths = svgOverlay.querySelectorAll('.cornell-semantic-thread');
        allPaths.forEach(path => {
            const srcId = path.getAttribute('data-source');
            const tgtId = path.getAttribute('data-target');
            const sourceNode = document.getElementById(srcId as string);
            const targetNode = document.getElementById(tgtId as string);

            // Si las notas origen y destino están visibles en este momento
            if (sourceNode && targetNode && !sourceNode.classList.contains('is-dimmed') && !targetNode.classList.contains('is-dimmed')) {
                const sRect = sourceNode.getBoundingClientRect();
                const tRect = targetNode.getBoundingClientRect();

                // Matemáticas relativas al contenedor aplicando el nivel de zoom actual
                const sX = ((sRect.right - containerRect.left + scrollContainer.scrollLeft) / currentZoom);
                const sY = ((sRect.top + (sRect.height / 2) - containerRect.top + scrollContainer.scrollTop) / currentZoom);

                const tX = ((tRect.left - containerRect.left + scrollContainer.scrollLeft) / currentZoom);
                const tY = ((tRect.top + (tRect.height / 2) - containerRect.top + scrollContainer.scrollTop) / currentZoom);

                const cp1X = sX + 50;
                const cp1Y = sY;
                const cp2X = tX - 50;
                const cp2Y = tY;

                path.setAttribute("d", `M ${sX} ${sY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${tX} ${tY}`);
                (path as HTMLElement).style.display = 'block'; // Aseguramos que se muestre
            } else {
                (path as HTMLElement).style.display = 'none'; // Ocultamos las líneas que perdieron sus nodos
            }
        });
    }
    // ======================================================
    // ⛓️ MOTOR DE COSIDO EN LA MÁQUINA DEL TIEMPO
    // ======================================================
    handleStitchClick(item: any, nodeEl: HTMLElement, canvas: HTMLElement) {
        if (!this.isStitchingMode) {
            // FASE 1: Seleccionamos el Origen
            this.isStitchingMode = true;
            this.sourceStitchItem = item;
            nodeEl.classList.add('is-stitching-source');
            
            let banner = canvas.querySelector('.cornell-rhizome-stitch-banner');
            if (!banner) {
                banner = canvas.createDiv({ cls: 'cornell-rhizome-stitch-banner' });
            }
            banner.innerHTML = `<span>⛓︎ Step 2: Select destination note to connect with <b>${item.file.basename}</b>...</span>`;
            
            const cancelBtn = banner.createEl('button', { text: 'Cancel', cls: 'cornell-stitch-cancel' });
            cancelBtn.onclick = () => this.cancelStitch(canvas);
            
            new Notice("Step 1: Origin selected. Click the Link icon on the destination note.");
        } else {
            // FASE 2: Seleccionamos el Destino y preguntamos el tipo de vínculo
            if (this.sourceStitchItem.id === item.id) {
                new Notice("Cannot connect a note to itself.");
                this.cancelStitch(canvas);
                return;
            }
            
            const banner = canvas.querySelector('.cornell-rhizome-stitch-banner');
            if (banner) {
                banner.empty();
                banner.innerHTML = `<span>🧭 Select relationship from <b>${this.sourceStitchItem.file.basename}</b> to <b>${item.file.basename}</b>:</span>`;
                
                // Botones dinámicos de la brújula
                const directions = ['Classic', 'North', 'South', 'East', 'West'];
                directions.forEach(dir => {
                    const btn = banner.createEl('button', { text: dir, cls: 'cornell-compass-btn' });
                    btn.style.margin = "0 5px";
                    btn.onclick = (e) => {
                        e.stopPropagation();
                        this.executeStitch(this.sourceStitchItem, item, dir).then(() => {
                            this.cancelStitch(canvas);
                            this.renderTimeline(canvas); 
                        });
                    };
                });
                
                const cancelBtn = banner.createEl('button', { text: 'Cancel', cls: 'cornell-stitch-cancel' });
                cancelBtn.style.marginLeft = "15px";
                cancelBtn.onclick = (e) => { e.stopPropagation(); this.cancelStitch(canvas); };
            }
        }
    }

    cancelStitch(canvas: HTMLElement) {
        this.isStitchingMode = false;
        this.sourceStitchItem = null;
        document.querySelectorAll('.is-stitching-source').forEach(el => el.classList.remove('is-stitching-source'));
        const banner = canvas.querySelector('.cornell-rhizome-stitch-banner');
        if (banner) banner.remove();
    }
//======================================================
    //  MOTOR de cocido!!!!
    // ======================================================
    async executeStitch(source: any, target: any, direction: string = 'Classic') {
        new Notice(`Stitching semantic ${direction} thread... ⏳⛓︎`);

        // 1. Aseguramos que el destino tenga un ID (matrícula) ADENTRO de los %%
        let targetId = target.blockId;
        if (!targetId) {
            targetId = Math.random().toString(36).substring(2, 8);
            await this.plugin.app.vault.process(target.file, (data) => {
                const lines = data.split('\n');
                if (target.line >= 0 && target.line < lines.length) {
                    let line = lines[target.line];
                    // Verificamos si ya tiene un ID (adentro o afuera)
                    if (!line.match(/\^([a-zA-Z0-9]+)(?:\s*%%)?\s*$/)) {
                        const lastPercentIndex = line.lastIndexOf('%%');
                        if (lastPercentIndex !== -1 && lastPercentIndex > 0) {
                            // Lo inyectamos justo antes de que cierre el comentario
                            line = line.substring(0, lastPercentIndex) + ` ^${targetId} ` + line.substring(lastPercentIndex);
                        } else {
                            // Fallback por si la línea está mal formateada
                            line = line + ` ^${targetId}`;
                        }
                        lines[target.line] = line;
                    }
                }
                return lines.join('\n');
            });
        }

        // 2. Inyectamos el enlace silenciosamente según la Brújula en el Origen
        let linkToInject = "";
        if (direction === 'Classic') {
            linkToInject = ` [[${target.file.basename}#^${targetId}]]`;
        } else {
            linkToInject = ` [${direction}:: [[${target.file.basename}#^${targetId}]]]`;
        }
        
        let expectedNewRaw = ""; // 🧠 Creamos una red para atrapar el texto modificado

        await this.plugin.app.vault.process(source.file, (data) => {
            const lines = data.split('\n');
            if (source.line >= 0 && source.line < lines.length) {
                let newRaw = source.rawText;
                
                // 🛠️ EL ARREGLO ESTÁ AQUÍ: Buscar el cierre del %% para meter el enlace ADENTRO
                const lastPercentIndex = newRaw.lastIndexOf('%%');
                
                if (lastPercentIndex !== -1 && lastPercentIndex > 0) {
                    const contentInside = newRaw.substring(0, lastPercentIndex);
                    // Comprobamos si YA hay un ^blockId justo antes del %% final
                    const idMatch = contentInside.match(/(\s*\^[a-zA-Z0-9]+)\s*$/);
                    
                    if (idMatch) {
                        // Inyectamos justo antes del ^blockId para no romperlo
                        newRaw = contentInside.substring(0, idMatch.index) + linkToInject + idMatch[1] + " " + newRaw.substring(lastPercentIndex);
                    } else {
                        // Inyectamos justo antes del %% final
                        newRaw = contentInside + linkToInject + " " + newRaw.substring(lastPercentIndex);
                    }
                } else {
                    // Fallback (si la nota no tiene %%, ej. un título o viñeta normal)
                    const idMatch = newRaw.match(/(\s*\^[a-zA-Z0-9]+)\s*$/);
                    if (idMatch) {
                        newRaw = newRaw.substring(0, idMatch.index) + linkToInject + idMatch[1];
                    } else {
                        newRaw = newRaw + linkToInject;
                    }
                }
                
                expectedNewRaw = newRaw; // 🧠 Atrapamos cómo quedó la nota
                
                // Efectuamos el reemplazo en la línea del documento
                lines[source.line] = lines[source.line].replace(source.rawText, newRaw);
            }
            return lines.join('\n');
        });

        // 🧠 Guardamos el Fantasma en la memoria global (Ahora usa oldRaw y newRaw)
        this.plugin.lastStitchAction = [{ 
            file: source.file, 
            line: source.line, 
            oldRaw: source.rawText, 
            newRaw: expectedNewRaw 
        }];

        new Notice("✨ Conexión semántica establecida! (Press Ctrl+Shift+Z to Undo)");
    }
// ======================================================
    // 🕸️ MOTOR ELÁSTICO 3D: VECTORES MATEMÁTICOS REALES
    // ======================================================
    redrawMoleculeLines(validNodes: any[], positions: Map<string, {x: number, y: number, z: number}>, linesContainer: HTMLElement) {
        linesContainer.empty(); // Limpiamos las líneas viejas de la RAM

        validNodes.forEach(node => {
            if (node.compassLinks && node.compassLinks.length > 0) {
                node.compassLinks.forEach((link: any) => {
                    const rawTarget = link.target.split('|')[0].trim().replace('[[', '').replace(']]', '');
                    const targetIdMatch = rawTarget.match(/#\^([a-zA-Z0-9]+)/);
                    let targetNode = null;
                    
                    if (targetIdMatch) {
                        targetNode = validNodes.find(n => n.id === targetIdMatch[1] || n.blockId === targetIdMatch[1]);
                    } else {
                        targetNode = validNodes.find(n => n.file.basename === rawTarget || n.text.includes(rawTarget));
                    }

                    if (targetNode && positions.has(node.id) && positions.has(targetNode.id)) {
                        const sPos = positions.get(node.id)!;
                        const tPos = positions.get(targetNode.id)!;

                        // 🎯 Coordenadas 3D (Origen y Destino)
                        const startX = sPos.x + 120; 
                        const startY = sPos.y + 40;  
                        const startZ = sPos.z || 0;  

                        const endX = tPos.x + 120;
                        const endY = tPos.y + 40;
                        const endZ = tPos.z || 0;

                        // 📐 Trigonometría 3D (Distancia y Ángulos Euler)
                        const dx = endX - startX;
                        const dy = endY - startY;
                        const dz = endZ - startZ;
                        
                        const dist2D = Math.hypot(dx, dy);
                        const length = Math.hypot(dist2D, dz); // Hipotenusa real 3D
                        
                        // Rotación Z (Apunta en el plano de la mesa)
                        const angleZ = Math.atan2(dy, dx) * (180 / Math.PI);
                        // Rotación Y (Apunta hacia arriba o abajo en profundidad)
                        const angleY = Math.atan2(-dz, dist2D) * (180 / Math.PI);

                        // 🎨 Paleta de colores semánticos
                        const linkColor = link.direction === 'north' ? "var(--color-blue, #4a90e2)" : 
                                          link.direction === 'south' ? "var(--color-green, #50e3c2)" : 
                                          link.direction === 'east' ? "var(--color-orange, #f5a623)" : 
                                          link.direction === 'west' ? "var(--color-red, #d0021b)" : "var(--interactive-accent)";

                        // 🏗️ Inyección del Vector 3D puro
                        const line = linesContainer.createDiv({ cls: 'cornell-3d-line' });
                        line.style.position = "absolute";
                        line.style.left = "0px";
                        line.style.top = "0px";
                        line.style.width = `${length}px`;
                        line.style.height = "3px"; 
                        line.style.transformOrigin = "0 50%"; // Pivote atado al nodo padre
                        // Aplicamos el teletransporte cuántico
                        line.style.transform = `translate3d(${startX}px, ${startY}px, ${startZ}px) rotateZ(${angleZ}deg) rotateY(${angleY}deg)`;
                        line.style.pointerEvents = "none";
                        
                        // Efecto visual: Línea láser punteada
                        line.style.backgroundImage = `linear-gradient(to right, ${linkColor} 50%, transparent 50%)`;
                        line.style.backgroundSize = "15px 3px";
                        line.style.opacity = "0.8";

                        // 🏹 Construcción de la punta de flecha nativa
                        const arrow = line.createDiv();
                        arrow.style.position = "absolute";
                        arrow.style.right = "0";
                        arrow.style.top = "50%";
                        arrow.style.transform = "translate(100%, -50%)"; // Desfasar la flecha justo en la punta de la línea
                        arrow.style.borderTop = "6px solid transparent";
                        arrow.style.borderBottom = "6px solid transparent";
                        arrow.style.borderLeft = `12px solid ${linkColor}`;
                    }
                });
            }
        });
    }
}

export interface UndoRecord {
    file: TFile;
    line: number;
    oldRaw: string;
    newRaw: string;
}

// --- PLUGIN PRINCIPAL ---
export default class CornellMarginalia extends Plugin {
    public lastStitchAction: UndoRecord[] | null = null; // 🧠 Memoria RAM para el Undo
    settings!: CornellSettings;
    public captureManager!: OmniCaptureManager;
    activeRecallMode: boolean = false; 
    ribbonIcon!: HTMLElement;
    // 👇 RESERVAMOS ESPACIO PARA EL ADDON DE GAMIFICACIÓN
    gamificationAddon!: GamificationAddon;
    backgroundAddon!: CustomBackgroundAddon;
    rhizomeAddon!: RhizomeAddon;
    // SUPER DOODLEEEEEEEEEEEEEEEEEEE
    public superDoodleAddon!: SuperDoodleAddon;
    public blurtingAddon!: BlurtingAddon;
    public margidoroAddon!: MargidoroAddon;
    public ankiSyncAddon!: AnkiSyncAddon;
    public zoomDoodleAddon!: ZoomDoodleAddon;
    public activeAddons: any[] = [];
    
   
    // 📁 MOTOR DE CREACIÓN DE CARPETAS
    async ensureFolderExists(folderPath: string) {
        if (!folderPath || folderPath === "/" || folderPath.trim() === "") return;
        const normalizedPath = folderPath.replace(/\\/g, '/');
        const folders = normalizedPath.split('/');
        let currentPath = "";
        for (const folder of folders) {
            if (!folder) continue;
            currentPath = currentPath === "" ? folder : `${currentPath}/${folder}`;
            const folderAbstract = this.app.vault.getAbstractFileByPath(currentPath);
            if (!folderAbstract) {
                await this.app.vault.createFolder(currentPath);
            }
        }
    }
    // 🚀 LECTOR DE CONFIGURACIÓN DE TASKNOTES
    async getTaskNotesConfig(): Promise<{ port: number, token: string }> {
        try {
            // Como estamos en la clase principal (Plugin), usamos this.app directamente
            const configStr = await this.app.vault.adapter.read(".obsidian/plugins/tasknotes/data.json");
            const config = JSON.parse(configStr);
            return {
                port: config.apiPort || 8080,
                token: config.apiAuthToken || "" // Rescatamos el token si existe
            };
        } catch (e) {
            return { port: 8080, token: "" }; // Fallback seguro si no encuentra el archivo
        }
    }

    // 🚀 PUENTE HTTP A TASKNOTES
    async sendToTaskNotes(taskTitle: string, tags: string[] = []) {
        // Usamos tu función auxiliar para obtener puerto y token dinámicamente
        const { port, token } = await this.getTaskNotesConfig();

        try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (token) headers["Authorization"] = `Bearer ${token}`;

            const response = await fetch(`http://localhost:${port}/api/tasks`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ title: taskTitle, tags: tags })
            });

            if (response.ok) {
                new Notice("🚀 Task successfully sent to TaskNotes!");
            } else {
                new Notice(`⚠️ Failed to send task. Is TaskNotes API enabled on port ${port}?`);
            }
        } catch (e) {
            new Notice(`❌ Could not connect to TaskNotes on port ${port}. Is the plugin running?`);
        }
    }
// 📄 MOTOR DE PLANTILLAS AVANZADO (Con soporte para Templater)
async getTemplateContent(templatePath: string, variables: Record<string, string>, targetFile?: TFile): Promise<string> {
    if (!templatePath || templatePath.trim() === "") return "";
    
    // Obtenemos el archivo de la bóveda usando la ruta
    const file = this.app.metadataCache.getFirstLinkpathDest(templatePath, "");
    
    if (file instanceof TFile) {
        let content = await this.app.vault.read(file);
        
        // 1. Reemplazamos tus variables dinámicas nativas ({{text}}, {{source_note}}, etc.)
        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            content = content.replace(regex, value);
        }

        // 2. ⚡ Integración con Templater (Hooks de la API no oficial)
        // Accedemos a la instancia de Templater de forma segura
        const templaterPlugin = (this.app as any).plugins.plugins["templater-obsidian"];
        
        if (templaterPlugin && templaterPlugin.templater) {
            try {
                // Templater necesita un contexto (un archivo) para resolver variables como <% tp.file.title %>
                // Usamos el targetFile si se proporciona, o el archivo activo como fallback
                const activeContextFile = targetFile || this.app.workspace.getActiveFile();
                
                if (activeContextFile) {
                    // Llamamos al motor de Templater para parsear el string en memoria
                    content = await templaterPlugin.templater.parse_template(
                        { target_file: activeContextFile, run_mode: 4 }, // run_mode 4 es para llamadas de API internas
                        content
                    );
                }
            } catch (error) {
                console.warn("Cornell Marginalia: Error al parsear con Templater. Verifique la sintaxis de sus tags <% %>.", error);
                // Si Templater falla, devolvemos el contenido con tus variables nativas resueltas
            }
        }
        
        return content + "\n"; // Aseguramos un salto de línea al final
    }
    
    new Notice(`⚠️ Template not found: ${templatePath}`);
    return "";
}
    async onload() {
        await this.loadSettings();
        this.captureManager = new OmniCaptureManager(this.app, this);
        

        // 👇 INICIALIZAMOS Y CONECTAMOS LOS ADDONS
        this.gamificationAddon = new GamificationAddon(this);
        
        // Revisamos en los settings si el usuario lo tiene "encendido"
        if (this.settings.addons && this.settings.addons["gamification-profile"]) {
            this.gamificationAddon.load();
        }

        this.backgroundAddon = new CustomBackgroundAddon(this);
        if (this.settings.addons && this.settings.addons["custom-background"]) {
            this.backgroundAddon.load();
        }

        // superdoodleee 
        this.superDoodleAddon = new SuperDoodleAddon(this);
        if (this.settings.addons[this.superDoodleAddon.id]) {
            this.superDoodleAddon.load();
        }

        // maquina del tiempo rizomatica
        // 1. Registramos la nueva ventana para que Obsidian sepa dibujarla
        this.registerView(RHIZOME_VIEW_TYPE, (leaf) => new RhizomeView(leaf, this));

        // 2. Encendemos el botón lateral si el usuario activó el addon
        this.rhizomeAddon = new RhizomeAddon(this);
        if (this.settings.addons && this.settings.addons["rhizome-time-machine"]) {
            this.rhizomeAddon.load();
        }

        // Dentro de onload() { ... }
        if (this.settings.enablePdfDoodle) {
        new PdfDoodleAddon(this).load();
        }

        // 👇 bluttering
        this.blurtingAddon = new BlurtingAddon(this);
        if (this.settings.addons && this.settings.addons[this.blurtingAddon.id]) {
            this.blurtingAddon.load();
        }

        // 🍅 MARGIDORO
        this.margidoroAddon = new MargidoroAddon(this);
        if (this.settings.addons && this.settings.addons["margidoro"]) {
            this.margidoroAddon.load();
        }

        this.ankiSyncAddon = new AnkiSyncAddon(this);
    // Revisar si está encendido en settings (asumiendo que agregaste la opción)
    if (this.settings.addons && this.settings.addons["anki-sync"]) {
        this.ankiSyncAddon.load();
    }
    //zoom doodle
    this.zoomDoodleAddon = new ZoomDoodleAddon(this);
        if (this.settings.addons && this.settings.addons["zoom-doodle"]) {
            this.zoomDoodleAddon.load();
        }
    if (this.settings.enableDashboardAddon) {
    const dashboard = new DashboardAddon(this);
    this.activeAddons.push(dashboard);
    dashboard.load();

    
}
        // 👆 FIN DE LA CONEXIÓN DE ADDONS
       

        this.updateStyles(); 
        this.registerView(CORNELL_VIEW_TYPE, (leaf) => new CornellNotesView(leaf, this));

        // 🧠 MOTOR DE DRAG & DROP PARA TEMPLATER (CodeMirror 6 Nativo)
        this.registerEditorExtension(EditorView.domEventHandlers({
            drop: (event: DragEvent, view: EditorView) => {
                // 1. Leemos el texto que estás arrastrando
                const text = event.dataTransfer?.getData('text/plain');
                
                // 2. Si el texto tiene tags de Templater (<%...%>) intervenimos
                if (text && text.includes('<%') && text.includes('%>')) {
                    event.preventDefault(); // 🛑 Bloqueamos la caída nativa (Adiós efecto fantasma)

                    // 3. Calculamos la posición exacta del mouse en el texto
                    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                    if (pos === null) return false;

                    // 4. Mandamos procesar e inyectar
                    this.processTemplaterDrop(text, pos, view);
                    return true; // Le decimos a Obsidian: "Yo me encargo"
                }
                return false; // Si no hay Templater, que caiga normal
            }
        }));

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

        // VISUAL HELPER
        const toggleVisualHelper = async () => {
            this.settings.visualHelper = !this.settings.visualHelper;
            await this.saveSettings();
            new Notice(`Cornell Visual Helper: ${this.settings.visualHelper ? 'Activado 🟢' : 'Desactivado 🔴'}`);
            
            // Fuerza el re-renderizado inmediato de la vista actual
            this.app.workspace.updateOptions();
        };

        // 1. Control mediante Ribbon Icon (Barra lateral izquierda)
        this.addRibbonIcon('map-pin', 'Alternar Visual Helper (Cornell)', toggleVisualHelper);

        // 2. Control mediante Paleta de Comandos
        this.addCommand({
            id: 'toggle-cornell-visual-helper',
            name: 'Alternar Visual Helper (Puntos de anclaje)',
            callback: toggleVisualHelper
        });
        // HASTA ACA

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
            id: 'insert-cornell-block',
            name: 'Insert Cornell Block (Editorial)',
            editorCallback: (editor: Editor) => {
                const selection = editor.getSelection();
                const startPos = editor.getCursor("from"); // Capturamos la posición inicial

                if (selection) {
                    // Empuja el texto seleccionado hacia abajo y deja la marginalia lista arriba
                    editor.replaceSelection(`\`\`\`cornell\n%%>  %%\n${selection}\n\`\`\``);
                } else {
                    // Bloque vacío con marginalia lista
                    editor.replaceSelection(`\`\`\`cornell\n%%>  %%\n\n\`\`\``);
                }
                
                // Mágicamente ponemos el cursor dentro del %%>  %% (Línea + 1, Carácter 4)
                editor.setCursor({ line: startPos.line + 1, ch: 4 });
            }
        });

        this.addCommand({
            id: 'omni-capture',
            name: '⚡ Omni-Capture (Idea, Context & Doodle)',
            callback: () => {
                new OmniCaptureModal(this.app, this).open();
            }
        });

        this.addCommand({
            id: 'cornell-open-sidebar-doodle',
            name: 'Open Sidebar Doodle Canvas',
            hotkeys: [{ modifiers: ['Alt', 'Shift'], key: 'd' }],
            callback: async () => {
                const result = await this.captureManager.openDoodle();
                
                if (result.isInstant) {
                    await this.captureManager.saveCapture({
                        thought: "",
                        destination: this.settings.lastOmniDestination,
                        doodleData: result.data
                    });
                    // Refresca la vista si está abierta
                    this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE).forEach(leaf => {
                        if (leaf.view instanceof CornellNotesView) leaf.view.applyFiltersAndRender();
                    });
                } else {
                    // Si no es instantáneo, inyectamos el doodle en la barra lateral para que siga escribiendo
                    const leaves = this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE);
                    if (leaves.length > 0) {
                        const view = leaves[0].view as CornellNotesView;
                        view.pendingDoodleData = result.data;
                        const doodleBtn = view.containerEl.querySelector('.cornell-qc-btn[title="Attach Doodle"]') as HTMLElement;
                        if (doodleBtn) doodleBtn.style.color = "var(--color-green)";
                        new Notice("🎨 Doodle in memory! Press ⚡ in the sidebar to save.");
                    } else {
                        new Notice("🎨 Doodle captured. Open Sidebar to complete your note.");
                    }
                }
            }
        });

        // 🚀 COMANDOS GLOBALES PARA EL BOARD (Configurables desde Obsidian)
        ['up', 'down', 'left', 'right'].forEach(dir => {
            this.addCommand({
                id: `cornell-pinboard-move-${dir}`,
                name: `Pinboard: Move Item ${dir.charAt(0).toUpperCase() + dir.slice(1)}`,
                // Por defecto les ponemos Alt + Flechas para que no choquen con Outliner
                hotkeys: [{ modifiers: ['Alt'], key: `Arrow${dir.charAt(0).toUpperCase() + dir.slice(1)}` }],
                checkCallback: (checking: boolean) => {
                    const activeEl = document.activeElement as HTMLElement;
                    // Solo se activa si el usuario tiene el foco en un elemento del Board
                    if (activeEl && activeEl.classList.contains('cornell-pinboard-item')) {
                        if (!checking) {
                            // Disparamos un evento fantasma que el Board va a escuchar
                            activeEl.dispatchEvent(new CustomEvent('cornell-move', { detail: dir }));
                        }
                        return true;
                    }
                    return false;
                }
            });
        });

        // 🚀 COMANDO 1: Abrir y hacer Foco en el Explorador
        this.addCommand({
            id: 'cornell-focus-explorer',
            name: 'Open & Focus Marginalia Explorer',
            hotkeys: [{ modifiers: ['Alt'], key: 'e' }], // Alt+E por defecto (Explorer)
            callback: async () => {
                let leaves = this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE);
                if (leaves.length === 0) {
                    const rightLeaf = this.app.workspace.getRightLeaf(false);
                    if (rightLeaf) {
                        await rightLeaf.setViewState({ type: CORNELL_VIEW_TYPE, active: true });
                    }
                    leaves = this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE);
                }
                this.app.workspace.revealLeaf(leaves[0]);

                setTimeout(() => {
                    const view = leaves[0].view as CornellNotesView;
                    const firstItem = view.containerEl.querySelector('.cornell-sidebar-item, .cornell-pinboard-item') as HTMLElement;
                    if (firstItem) firstItem.focus();
                }, 100);
            }
        });
        // 🚀 COMANDO: UNDO LAST STITCH
        this.addCommand({
            id: 'undo-last-stitch',
            name: 'Undo Last Action (Stitch/Group)',
            hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'z' }], 
            callback: async () => {
                if (!this.lastStitchAction || this.lastStitchAction.length === 0) {
                    new Notice("⚠️ No recent action to undo.");
                    return;
                }
                new Notice("⏪ Undoing last action...");
                
                for (const record of this.lastStitchAction) {
                    await this.app.vault.process(record.file, (data) => {
                        const lines = data.split('\n');
                        if (record.line >= 0 && record.line < lines.length) {
                            // 🧼 Magia pura: cambiamos la versión mutada por la versión inmaculada original
                            lines[record.line] = lines[record.line].replace(record.newRaw, record.oldRaw);
                        }
                        return lines.join('\n');
                    });
                }
                
                this.lastStitchAction = null; 
                new Notice("✅ Action undone successfully!");
                this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE).forEach(l => {
                    if (l.view instanceof CornellNotesView) l.view.scanNotes();
                });
            }
        });
        // 🚀 COMANDO 4: Ejecutar Stitch (Cosido) masivo por Teclado
        this.addCommand({
            id: 'cornell-mass-stitch',
            name: 'Execute Mass Stitch (Keyboard Mode)',
            hotkeys: [{ modifiers: ['Alt'], key: 's' }], // Alt + S por defecto
            callback: () => {
                const leaves = this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE);
                
                if (leaves.length > 0) {
                    const view = leaves[0].view as CornellNotesView;
                    
                    // Verificamos que haya seleccionado al menos 2 cosas con la barra espaciadora
                    if (view.selectedForStitch.length < 2) {
                        new Notice("⚠️ Select at least 2 marginalias using Spacebar first.");
                        return;
                    }
                    
                    // 🧠 LÓGICA INTELIGENTE: 
                    // El ÚLTIMO elemento que seleccionaste será tu TARGET (Destino).
                    // TODOS los demás elementos que marcaste antes serán tus SOURCES (Orígenes).
                    const targets = [view.selectedForStitch[view.selectedForStitch.length - 1]];
                    const sources = view.selectedForStitch.slice(0, -1);
                    
                    // 🎯 AQUÍ ESTÁ LA MAGIA: Ahora sí le pasamos los 2 argumentos a la función
                    view.executeMassStitch(sources, targets).then(() => {
                        // Limpiamos la selección al terminar para no arrastrar fantasmas
                        view.selectedForStitch = []; 
                        view.applyFiltersAndRender();
                    });
                } else {
                    new Notice("Open the Marginalia Explorer first.");
                }
            }
        });

        // 🚀 COMANDO 5: Refrescar/Escanear Notas
        this.addCommand({
            id: 'cornell-refresh-explorer',
            name: 'Refresh Explorer',
            hotkeys: [{ modifiers: ['Alt'], key: 'r' }], // Alt+R por defecto
            callback: () => {
                const leaves = this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE);
                if (leaves.length > 0) {
                    const view = leaves[0].view as CornellNotesView;
                    view.scanNotes();
                    new Notice("Marginalias refreshed!");
                }
            }
        });

        // 🚀 COMANDO 6: Buscar en el Explorador (Alt+F)
        this.addCommand({
            id: 'cornell-search-explorer',
            name: 'Focus Search Bar',
            hotkeys: [{ modifiers: ['Alt'], key: 'f' }], 
            callback: () => {
                const leaves = this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE);
                if (leaves.length > 0) {
                    const view = leaves[0].view;
                    const searchInput = view.containerEl.querySelector('.cornell-search-bar') as HTMLInputElement;
                    if (searchInput) {
                        searchInput.focus();
                        searchInput.select(); // Selecciona el texto automáticamente
                    }
                } else {
                    new Notice("Open the Marginalia Explorer first.");
                }
            }
        });    

        // 🚀 COMANDO 7 (ARREGLADO): Foco en el Pinboard (Alt+A)
        this.addCommand({
            id: 'cornell-focus-pinboard-input',
            name: 'Pinboard: Focus Add Text Input',
            hotkeys: [{ modifiers: ['Alt'], key: 'a' }], 
            callback: () => {
                const leaves = this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE);
                if (leaves.length > 0) {
                    const view = leaves[0].view as CornellNotesView;
                    if (view.currentTab !== 'pinboard') {
                        view.currentTab = 'pinboard';
                        view.renderUI();
                        view.applyFiltersAndRender();
                    }
                    setTimeout(() => {
                        // 🩹 Arreglo: Ahora busca el textarea en lugar del viejo input
                        const input = view.containerEl.querySelector('textarea.cornell-qc-textarea') as HTMLTextAreaElement;
                        if (input) input.focus();
                    }, 50);
                } else {
                    new Notice("Open the Marginalia Explorer first.");
                }
            }
        });

        // 🚀 COMANDO 8 (NUEVO): Foco en OmniCapture (Alt+C)
        this.addCommand({
            id: 'cornell-focus-omnicapture-input',
            name: 'Focus Omni-Capture Input (Sidebar)',
            hotkeys: [{ modifiers: ['Alt'], key: 'c' }], 
            callback: () => {
                const leaves = this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE);
                if (leaves.length > 0) {
                    const view = leaves[0].view as CornellNotesView;
                    // Si estamos en el Board, cambiamos a "Current" para ver el OmniCapture de Notas
                    if (view.currentTab === 'pinboard') {
                        view.currentTab = 'current';
                        view.renderUI();
                        view.scanNotes();
                    }
                    setTimeout(() => {
                        const input = view.containerEl.querySelector('textarea.cornell-qc-textarea') as HTMLTextAreaElement;
                        if (input) input.focus();
                    }, 50);
                } else {
                    new Notice("Open the Marginalia Explorer first.");
                }
            }
        });

        // 🚀 COMANDOS DE PESTAÑAS (Alt+1, Alt+2, Alt+3, Alt+4)
        ['Current', 'Vault', 'Threads', 'Board'].forEach((tabName, index) => {
            this.addCommand({
                id: `cornell-switch-tab-${tabName.toLowerCase()}`,
                name: `Switch to Tab: ${tabName}`,
                hotkeys: [{ modifiers: ['Alt'], key: (index + 1).toString() }], // Alt+1, 2, 3, 4
                callback: () => {
                    const leaves = this.app.workspace.getLeavesOfType(CORNELL_VIEW_TYPE);
                    if (leaves.length > 0) {
                        const view = leaves[0].view;
                        
                        // Buscamos todos los botones/divs del panel
                        const elements = Array.from(view.containerEl.querySelectorAll('div, button'));
                        
                        // Encontramos el botón de la pestaña por su texto
                        const tabButton = elements.find(el => {
                            const text = el.textContent?.trim().toLowerCase() || "";
                            // Usamos endsWith para ignorar íconos (como la tuerca o la flecha antes del texto)
                            return text.endsWith(tabName.toLowerCase()) && el.children.length <= 2; 
                        });

                        if (tabButton) {
                            (tabButton as HTMLElement).click();
                            
                            // 🎯 Foco automático instantáneo en la nueva pestaña
                            setTimeout(() => {
                                const firstItem = view.containerEl.querySelector('.cornell-sidebar-item, .cornell-pinboard-item') as HTMLElement;
                                if (firstItem) firstItem.focus();
                            }, 100);
                        } else {
                            new Notice(`⚠️ Could not find the ${tabName} tab.`);
                        }
                    } else {
                        new Notice("Open the Marginalia Explorer first.");
                    }
                }
            });
        });
        this.addCommand({
            id: 'open-doodle-canvas',
            name: 'Draw a Doodle (Margin Image)',
            editorCallback: (editor: Editor) => {
                new DoodleModal(this.app, editor).open();
            }
        });

        this.addCommand({
            id: 'generate-flashcards-sr',
            name: 'Flashcards Generation (Spaced Repetition)',
            editorCallback: (editor: Editor, view: MarkdownView | MarkdownFileInfo ) => { this.generateFlashcards(editor); }
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

       // --- REGISTRO DEL MENÚ DE CLIC DERECHO (CONTEXT MENU) ---
this.registerEvent(
    this.app.workspace.on('editor-menu', (menu, editor, view) => {
        
        // 1. Opción para insertar nota marginal rápida
        menu.addItem((item) => {
            item
                .setTitle("Insert Margin Note")
                .setIcon("quote-glyph") 
                .setSection("insert")   
                .onClick(() => {
                    const selection = editor.getSelection();
                    if (selection) {
                        editor.replaceSelection(`%%> ${selection} %%`);
                    } else {
                        editor.replaceSelection(`%%>  %%`);
                        const cursor = editor.getCursor();
                        editor.setCursor({ line: cursor.line, ch: cursor.ch - 3 });
                    }
                });
        });

        // 2. Opción para abrir el Omni-Capture
        menu.addItem((item) => {
            item
                .setTitle("Omni-Capture Idea")
                .setIcon("zap")        
                .setSection("insert")
                .onClick(() => {
                    new OmniCaptureModal(this.app, this).open();
                });
        });

        // 3. Opción para dibujar un Doodle (Marginalia de imagen)
        menu.addItem((item) => {
            item
                .setTitle("Draw Margin Doodle")
                .setIcon("pencil")     // Ícono de lápiz para dibujo
                .setSection("insert")
                .onClick(() => {
                    // Abrimos el motor de dibujo que ya tienes programado
                    new DoodleModal(this.app, editor).open();
                });
        });
        // 4. Opción para insertar un Bloque Cornell Editorial
        menu.addItem((item) => {
            item
                .setTitle("Insert Cornell Block")
                .setIcon("columns")    // Ícono nativo que representa columnas
                .setSection("insert")
                .onClick(() => {
                    const selection = editor.getSelection();
                    const startPos = editor.getCursor("from");

                    if (selection) {
                        editor.replaceSelection(`\`\`\`cornell\n%%>  %%\n${selection}\n\`\`\``);
                    } else {
                        editor.replaceSelection(`\`\`\`cornell\n%%>  %%\n\n\`\`\``);
                    }
                    
                    // Cursor francotirador dentro del %%>  %%
                    editor.setCursor({ line: startPos.line + 1, ch: 4 });
                });
        });
    })
);




// 🚀 NUEVO MOTOR EDITORIAL: Bloques de código ```cornell
        // 🚀 NUEVO MOTOR EDITORIAL MULTI-MARGINALIA: Bloques de código ```cornell
        this.registerMarkdownCodeBlockProcessor("cornell", async (source, el, ctx) => {
            if (!this.settings.enableReadingView) return;

            // 1. Extraer TODAS las marginalias (Añadimos la Bandera 'g')
            const regex = /%%([><])([\s\S]*?)%%/g;
            const matches = [...source.matchAll(regex)];

            // 2. Limpiar el texto principal y renderizar Visual Helper (Si está activado)
            const cleanSource = source.replace(regex, (match, direction, noteContent) => {
                if (!this.settings.visualHelper) return ''; // Apagado por defecto
                
                let tempNoteContent = noteContent.replace(/\s*\^([a-zA-Z0-9]+)\s*$/, '').trim();
                if (tempNoteContent.includes(";;")) {
                    tempNoteContent = tempNoteContent.replace(";;", "").replace(/\s{2,}/g, ' ').trim();
                }
                
                let matchedColor = 'var(--text-accent)';
                for (const tag of this.settings.tags) {
                    if (tempNoteContent.startsWith(tag.prefix)) {
                        matchedColor = tag.color;
                        break;
                    }
                }
                
                return `<span class="cornell-visual-anchor" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${matchedColor}; margin-right: 4px; vertical-align: middle;"></span>`;
            }).trim();

            // 3. Crear el contenedor padre. ¡La posición relativa es la clave aquí!
            const wrapper = el.createDiv({ cls: 'cornell-reading-container cornell-editorial-wrapper' });
            wrapper.style.position = 'relative';
            wrapper.style.width = '100%';
            el.style.overflow = "visible";
            el.style.contain = "none";

            // Cirugía DOM: Subimos por el árbol liberando restricciones dinámicamente
            setTimeout(() => {
                if (!el.closest('.markdown-source-view')) return;

                let parent = el.parentElement;
                while (parent && !parent.classList.contains('cm-content')) {
                    parent.style.setProperty('overflow', 'visible', 'important');
                    parent.style.setProperty('contain', 'none', 'important');
                    if (parent.classList.contains('cm-line') || parent.classList.contains('cm-embed-block')) {
                        parent.style.setProperty('z-index', '99', 'important');
                        parent.style.setProperty('position', 'relative', 'important');
                    }
                    parent = parent.parentElement;
                }
            }, 50);

            // 4. Renderizar el texto principal de forma nativa
            const contentCol = wrapper.createDiv({ cls: 'cornell-editorial-content' });
            await MarkdownRenderer.renderMarkdown(cleanSource, contentCol, ctx.sourcePath, this);

            // 5. Procesar e inyectar TODAS las marginalias
            if (matches.length > 0) {
                // Tomamos la dirección de la primera nota para alinear la columna
                const isMainLeft = this.settings.alignment === 'left';
                const firstDirection = matches[0][1];
                const isNoteLeft = (isMainLeft && firstDirection === '>') || (!isMainLeft && firstDirection === '<');

                let colClass = isNoteLeft ? 'cornell-col-left' : 'cornell-col-right';
                let column = wrapper.createDiv({ cls: colClass });
                
                // 📐 MAGIA CSS: Columna que abarca el 100% de la altura exacta del bloque
                column.style.setProperty('position', 'absolute', 'important');
                column.style.setProperty('top', '0', 'important');
                column.style.setProperty('bottom', '0', 'important'); 
                column.style.setProperty('width', 'var(--cornell-width)', 'important');
                column.style.setProperty('display', 'flex', 'important');
                column.style.setProperty('flex-direction', 'column', 'important');
                column.style.setProperty('overflow-y', 'auto', 'important'); 
                
                // Ocultar la barra de scroll para mantener la estética minimalista
                column.style.setProperty('scrollbar-width', 'none', 'important');
                column.style.cssText += '::-webkit-scrollbar { display: none; }'; 

                if (isNoteLeft) {
                    column.style.setProperty('left', 'var(--cornell-margin-out)', 'important');
                    column.style.removeProperty('right');
                } else {
                    column.style.setProperty('right', 'var(--cornell-margin-out)', 'important');
                    column.style.removeProperty('left');
                }

                // 🔄 ITERAMOS SOBRE CADA MARGINALIA ENCONTRADA
                for (let i = 0; i < matches.length; i++) {
                    const match = matches[i];
                    const direction = match[1];
                    let noteContent = match[2];
                    
                    let tempNoteContent = noteContent.replace(/\s*\^([a-zA-Z0-9]+)\s*$/, '').trim();
                    const isFlashcard = tempNoteContent.includes(";;");

                    if (isFlashcard) {
                        tempNoteContent = tempNoteContent.replace(";;", "").replace(/\s{2,}/g, ' ').trim();
                        wrapper.classList.add('cornell-flashcard-target');
                    }

                    let matchedColor = null;
                    let finalNoteText = tempNoteContent;

                    for (const tag of this.settings.tags) {
                        if (finalNoteText.startsWith(tag.prefix)) {
                            matchedColor = tag.color;
                            finalNoteText = finalNoteText.substring(tag.prefix.length).trim();
                            break;
                        }
                    }

                    let finalRenderText = finalNoteText;
                    const imagesToRender: string[] = [];
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
                    marginDiv.className = "cm-cornell-margin reading-mode-margin cornell-editorial-margin";

                    if (isFlashcard) {
                        marginDiv.classList.add("is-flashcard");
                    } else {
                        marginDiv.classList.add("is-explanatory");
                    }
                    
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
                        });
                    }

                    if ((isMainLeft && direction === '<') || (!isMainLeft && direction === '>')) {
                        marginDiv.classList.add('cornell-reverse-align');
                    }

                    // 📐 LÓGICA DE LÍNEA CONTINUA (La Magia)
                    marginDiv.style.setProperty('position', 'relative', 'important');
                    marginDiv.style.setProperty('box-sizing', 'border-box', 'important');
                    marginDiv.style.setProperty('margin', '0', 'important'); // Quitamos márgenes externos que rompen la línea
                    
                    // Separamos el contenido interno para que no se peguen las letras
                    if (i < matches.length - 1) {
                        marginDiv.style.setProperty('padding-bottom', '20px', 'important');
                    }

                    // 🏆 Si es la última marginalia (o la única), la forzamos a estirarse hasta el final absoluto del bloque
                    if (i === matches.length - 1) {
                        marginDiv.style.setProperty('flex-grow', '1', 'important');
                    } else {
                        marginDiv.style.setProperty('flex-grow', '0', 'important');
                    }
                    
                    column.appendChild(marginDiv);
                }
            }
        });     
        this.registerMarkdownPostProcessor((el, ctx) => {
            if (!this.settings.enableReadingView) return;

            
            
            // 🛡️ ESCUDO ANTI-DIPLOPIA (Parte 1): Ignoramos contenedores de código ya procesados
            if (el.classList.contains("block-language-cornell") || el.querySelector(".cornell-editorial-wrapper")) {
                return;
            }

            // 🪄 NUEVO: ENVOLTORIO QUIRÚRGICO PARA "ESTO YA NO" (Modo Lectura)
            // Aísla la línea exacta de la flashcard separada por <br> y le aplica la clase de Blur
            const isolateRegex = /(^|<br>)((?:(?!<br>).)*?%%[><][\s\S]*?;;[\s\S]*?%%(?:(?!<br>).)*)/g;
            if (isolateRegex.test(el.innerHTML)) {
                el.innerHTML = el.innerHTML.replace(isolateRegex, (match, br, content) => {
                    return `${br}<span class="cornell-reading-flashcard-target" style="display:block; width:100%;">${content}</span>`;
                });
            }

            // Inyectar Visual Helper en el DOM de Modo Lectura y ocultar la sintaxis %%
            const htmlRegex = /%%([><])([\s\S]*?)%%/g;
            if (htmlRegex.test(el.innerHTML)) {
                el.innerHTML = el.innerHTML.replace(htmlRegex, (match, direction, noteContent) => {
                    if (!this.settings.visualHelper) return ''; // Desaparece el texto y el punto si está apagado
                    
                    // Limpiamos posibles etiquetas HTML por si Obsidian renderizó algo dentro (ej. negritas)
                    let tempContent = noteContent.replace(/<[^>]*>?/gm, ''); 
                    tempContent = tempContent.replace(/\s*\^([a-zA-Z0-9]+)\s*$/, '').trim();
                    if (tempContent.includes(";;")) tempContent = tempContent.replace(";;", "").replace(/\s{2,}/g, ' ').trim();
                    
                    let matchedColor = 'var(--text-accent)';
                    for (const tag of this.settings.tags) {
                        if (tempContent.startsWith(tag.prefix)) {
                            matchedColor = tag.color;
                            break;
                        }
                    }
                    return `<span class="cornell-visual-anchor" style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: ${matchedColor}; margin-right: 4px; vertical-align: middle;"></span>`;
                });
            }

            const sectionInfo = ctx.getSectionInfo(el);
            if (!sectionInfo) return;

            const lines = sectionInfo.text.split('\n');
            const sectionLines = lines.slice(sectionInfo.lineStart, sectionInfo.lineEnd + 1);

            // 🛡️ ESCUDO ANTI-DIPLOPIA (Parte 2): Si la sección en el Markdown original 
            // arranca con "```" (es un bloque de código), abortamos instantáneamente.
            // Esto evita que el PostProcessor dibuje marginalias dobles.
            const firstLine = sectionLines[0]?.trim();
            if (firstLine && (firstLine.startsWith("```") || firstLine.startsWith("~~~"))) {
                return;
            }

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
                    let noteContent = match[2];
                    
                    let tempNoteContent = noteContent.replace(/\s*\^([a-zA-Z0-9]+)\s*$/, '').trim();
                    const isFlashcard = tempNoteContent.includes(";;");

                   // 1. EXTRACTOR DE COLOR, IMÁGENES Y LINKS
                    let matchedColor = null;
                    let finalNoteText = tempNoteContent;

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

                    // 2. CREACIÓN DEL CONTENEDOR (UNA ÚNICA VEZ)
                    const marginDiv = document.createElement("div");
                    marginDiv.className = "cm-cornell-margin reading-mode-margin"; 

                    // 👇 3. CLASIFICADOR INTELIGENTE PARA READING VIEW (DOM HTML)
                    if (isFlashcard) {
                        marginDiv.classList.add("is-flashcard");
                        
                        let textWithoutMarginalia = line.replace(/%%[><](.*?)%%/g, '').replace(/\^[a-zA-Z0-9_-]+$/, '').trim();
                        const isCalloutLine = textWithoutMarginalia.startsWith('>');
                        let cleanTextForStandalone = textWithoutMarginalia;
                        if (isCalloutLine) cleanTextForStandalone = cleanTextForStandalone.replace(/^>\s*/, '').trim();
                        
                        const isStandalone = cleanTextForStandalone === '';
                        let targetToBlur = null; // 👈 Empezamos en null para no difuminar el <p> entero por error

                        if (!isStandalone) {
                            // 🧠 REGLA 1: INLINE 
                            if (isCalloutLine) {
                                // Si es un callout, difuminamos el callout entero
                                const calloutParent = currentTarget.closest('.callout');
                                if (calloutParent) targetToBlur = calloutParent as HTMLElement;
                            } 
                            // Si es prosa normal, YA FUE ENVUELTA por nuestro Regex superior.
                            // Dejamos targetToBlur en null para que "esto ya no" quede a salvo.
                        } else {
                            // 🧠 REGLA 2: STANDALONE
                            let nextEl = currentTarget.nextElementSibling;
                            if (!nextEl && currentTarget.parentElement) {
                                nextEl = currentTarget.parentElement.nextElementSibling;
                            }
                            if (nextEl) targetToBlur = nextEl as HTMLElement;
                        }

                        // 🛡️ CRÍTICO: Usamos TU clase original para que el CSS la detecte
                        if (targetToBlur) {
                            targetToBlur.classList.add("cornell-flashcard-target");
                        }
                    } else {
                        marginDiv.classList.add("is-explanatory");
                    }
                    
                    // 4. APLICAMOS EL COLOR
                    if (matchedColor) {
                        marginDiv.style.setProperty('border-color', matchedColor, 'important');
                        marginDiv.style.setProperty('color', matchedColor, 'important');
                    }

                    // 5. RENDERIZAMOS EL MARKDOWN EN EL CONTENEDOR
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
                        
                        // 🛠️ INYECCIÓN DE LA VARIABLE MAESTRA EN LA COLUMNA
                if (isNoteLeft) {
                    column.style.setProperty('left', 'var(--cornell-margin-out)', 'important');
                    column.style.removeProperty('right');
                } else {
                    column.style.setProperty('right', 'var(--cornell-margin-out)', 'important');
                    column.style.removeProperty('left');
                }
                        
                        currentTarget.appendChild(column); // 👈 RECUPERAMOS ESTA LÍNEA
                    } // 👈 RECUPERAMOS LA LLAVE DE CIERRE QUE FALTABA

                    if ((isMainLeft && direction === '<') || (!isMainLeft && direction === '>')) {
                        marginDiv.classList.add('cornell-reverse-align');
                    }

                    column.appendChild(marginDiv);

                    if (isFlashcard) {
                        currentTarget.classList.add('cornell-flashcard-target');
                        
                        // 🚀 MUTACIÓN DEL DOM: Si la marginalia está arriba, buscamos el Callout debajo y lo difuminamos
                        let tempTextForCallout = line.replace(/%%[><](.*?)%%/g, '').replace(/\^[a-zA-Z0-9_-]+$/, '').trim();
                        if (tempTextForCallout === '') {
                            setTimeout(() => {
                                let nextEl = currentTarget.nextElementSibling;
                                if (nextEl && (nextEl.classList.contains('callout') || nextEl.querySelector('.callout'))) {
                                    nextEl.classList.add('cornell-flashcard-target');
                                } else if (!nextEl && currentTarget.parentElement) {
                                    let parentNext = currentTarget.parentElement.nextElementSibling;
                                    if (parentNext && (parentNext.classList.contains('callout') || parentNext.querySelector('.callout'))) {
                                        parentNext.classList.add('cornell-flashcard-target');
                                    }
                                }
                            }, 50);
                        }
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
    // 🧠 PROCESADOR DE TEMPLATER EN RAM
async processTemplaterDrop(text: string, pos: number, view: EditorView) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        
        // 🛡️ ESCUDO: Sanitizamos el texto que viene de afuera
        let safeText = sanitizeForTemplater(text); 
        let finalContent = safeText;

        if (activeView && activeView.file) {
            const templaterPlugin = (this.app as any).plugins.plugins["templater-obsidian"];
            if (templaterPlugin && templaterPlugin.templater) {
                try {
                    // Ahora es seguro parsearlo
                    finalContent = await templaterPlugin.templater.parse_template(
                        { target_file: activeView.file, run_mode: 4 }, 
                        safeText 
                    );
                } catch (err) {
                    console.warn("Cornell Marginalia: Fallo al compilar Templater", err);
                }
            }
        }
        // ... resto del código ...

        // 2. Inyectamos el resultado limpio en CodeMirror (Mantiene vivo Ctrl+Z)
        view.dispatch({
            changes: { from: pos, insert: finalContent }
        });
        
        // 3. Movemos el cursor al final de la nota que acabas de soltar
        view.dispatch({
            selection: { anchor: pos + finalContent.length }
        });
        view.focus();
    }
    onunload() {
        console.log("Descargando Cornell Marginalia...");
        
        // Si el SuperDoodle estaba encendido, lo apagamos para restaurar el lienzo normal
        if (this.settings.addons && this.settings.addons["super-doodle"]) {
            this.superDoodleAddon.unload();
        }
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
        // 🧠 Método simple: Atrapa el texto base, y todo adentro del %% hasta tocar el primer ;;
        const regex = /^(.*?)\s*%%[><]\s*(.*?);;/; 

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
        let widthValue = `${this.settings.marginWidth}%`; 
        if (this.settings.adaptiveMode) {
            widthValue = `clamp(150px, calc((100vw - var(--file-line-width, 700px)) / 2 - 40px), 400px)`;
        }

        document.body.style.setProperty('--cornell-width', widthValue);
        document.body.style.setProperty('--cornell-offset', `${this.settings.marginOffset}px`);
        
        // 🚀 VARIABLE MAESTRA: Calcula la distancia exacta hacia afuera
        document.body.style.setProperty('--cornell-margin-out', `calc(-1 * var(--cornell-width) - var(--cornell-offset))`);

        document.body.style.setProperty('--cornell-font-size', this.settings.fontSize);
        document.body.style.setProperty('--cornell-font-family', this.settings.fontFamily);
        
        if (this.settings.alignment === 'left') {
            document.body.style.setProperty('--cornell-float', 'left');
            document.body.style.setProperty('--cornell-margin-left', 'var(--cornell-margin-out)');
            document.body.style.setProperty('--cornell-margin-right', '15px');
            document.body.style.setProperty('--cornell-border-r', '2px solid var(--text-accent)');
            document.body.style.setProperty('--cornell-border-l', 'none');
            document.body.style.setProperty('--cornell-text-align', 'right');
            
            // Variables para flecha invertida (%%<)
            document.body.style.setProperty('--cornell-float-rev', 'right');
            document.body.style.setProperty('--cornell-margin-left-rev', '15px');
            document.body.style.setProperty('--cornell-margin-right-rev', 'var(--cornell-margin-out)');
        } else {
            document.body.style.setProperty('--cornell-float', 'right');
            document.body.style.setProperty('--cornell-margin-right', 'var(--cornell-margin-out)');
            document.body.style.setProperty('--cornell-margin-left', '15px');
            document.body.style.setProperty('--cornell-border-l', '2px solid var(--text-accent)');
            document.body.style.setProperty('--cornell-border-r', 'none');
            document.body.style.setProperty('--cornell-text-align', 'left');
            
            // Variables para flecha invertida (%%<)
            document.body.style.setProperty('--cornell-float-rev', 'left');
            document.body.style.setProperty('--cornell-margin-right-rev', '15px');
            document.body.style.setProperty('--cornell-margin-left-rev', 'var(--cornell-margin-out)');
        }

        let dynamicStyle = document.getElementById('cornell-dynamic-styles');
        if (!dynamicStyle) {
            dynamicStyle = document.createElement('style');
            dynamicStyle.id = 'cornell-dynamic-styles';
            document.head.appendChild(dynamicStyle);
        }

        if (this.settings.responsiveMarginalia) {
            document.body.classList.add('cornell-responsive-mode');
            dynamicStyle.innerText = `
                @container editor-container (max-width: ${this.settings.responsiveThreshold}px) {
                    body.cornell-responsive-mode .cm-cornell-margin,
                    body.cornell-responsive-mode .reading-mode-margin {
                        position: relative !important;
                        width: 100% !important;
                        float: none !important;
                        clear: both !important;
                        margin-left: 0 !important;
                        margin-right: 0 !important;
                        left: auto !important;
                        right: auto !important;
                        display: block !important;
                        margin-top: 5px !important;
                        margin-bottom: 15px !important;
                        border-left: 4px solid currentColor !important; 
                        border-right: none !important;
                        text-align: left !important;
                        box-sizing: border-box !important; 
                    }
                    body.cornell-responsive-mode .cornell-col-left,
                    body.cornell-responsive-mode .cornell-col-right {
                        position: relative !important;
                        width: 100% !important;
                        left: auto !important;
                        right: auto !important;
                        display: block !important;
                    }
                    body.cornell-responsive-mode .reading-mode-margin.cornell-reverse-align {
                        margin-left: 0 !important;
                        margin-right: 0 !important;
                        border-left: 4px solid currentColor !important;
                        border-right: none !important;
                        text-align: left !important;
                    }
                }
            `;
        } else {
            document.body.classList.remove('cornell-responsive-mode');
            dynamicStyle.innerText = '';
        }
    if (this.settings.blurExplanatoryMarginalia) {
    document.body.classList.add('cornell-blur-explanatory');
} else {
    document.body.classList.remove('cornell-blur-explanatory');
}
    }
    async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
    async saveSettings() { await this.saveData(this.settings); }

    async prepareForPrint(editor: Editor) {
        let content = editor.getValue();
        let modified = false;

        const activeFile = this.app.workspace.getActiveFile();
        const sourcePath = activeFile ? activeFile.path : "";

        // =========================================================
        // 1. BLOQUES EDITORIALES (```cornell)
        // =========================================================
        const blockRegex = /```cornell\n([\s\S]*?)```/g;

        content = content.replace(blockRegex, (match: string, blockContent: string) => {
            modified = true;
            // 🛡️ Guardamos todo el bloque original en la caja fuerte
            const safeOriginal = btoa(encodeURIComponent(match));
            const uniqueId = "cornell-block-" + Math.random().toString(36).substring(2, 9);

            const noteRegex = /%%([><])(.*?)%%/g;
            let marginaliasHTML = "";
            let cleanText = blockContent;
            let firstColor: string | null = null; // Guardará el color para la línea de todo el bloque

            let noteMatch;
            while ((noteMatch = noteRegex.exec(cleanText)) !== null) {
                const fullNote = noteMatch[0];
                const direction = noteMatch[1];
                let noteContent = noteMatch[2];
                
                // 👇 Limpieza universal de cualquier ID (^id o ^anki-id) y detección de flashcard
                let tempNoteContent = noteContent.replace(/\s*[\^~][a-zA-Z0-9-]+\s*/g, ' ').trim();
                const isFlashcard = tempNoteContent.includes(";;");

                if (isFlashcard) {
                    tempNoteContent = tempNoteContent.replace(";;", "").replace(/\s{2,}/g, ' ').trim();
                }

                let matchedColor = 'var(--text-accent)';
                let noteText = tempNoteContent;

                for (const tag of this.settings.tags) {
                    if (noteText.startsWith(tag.prefix)) {
                        matchedColor = tag.color;
                        noteText = noteText.substring(tag.prefix.length).trim();
                        break;
                    }
                }

                if (!firstColor) firstColor = matchedColor; // Capturamos el color principal

                const imgRegex = /img:\s*\[\[(.*?)\]\]/gi;
                let imgHtml = "";
                noteText = noteText.replace(imgRegex, (imgMatch: string, imgName: string) => {
                    const cleanName = imgName.split('|')[0];
                    const file = this.app.metadataCache.getFirstLinkpathDest(cleanName, sourcePath);
                    if (file) {
                        const imgSrc = this.app.vault.getResourcePath(file);
                        imgHtml += `<img src="${imgSrc}" style="max-width: 100%; border-radius: 4px; margin-top: 5px; display: block;" />`;
                    }
                    return '';
                });

                const compassRegex = /\[(North|South|East|West)::\s*\[\[([\s\S]*?)\]\]\]/gi;
                noteText = noteText.replace(compassRegex, '').trim();
                const threadRegex = /(?<!!)\[\[(.*?)\]\]/g;
                noteText = noteText.replace(threadRegex, '').trim();

                const isMainLeft = this.settings.alignment === 'left';
                const textAlign = isMainLeft ? 'right' : 'left';

                // Inyectamos la nota. Ya no lleva el borde largo aquí, solo color y texto.
                marginaliasHTML += `<div style="margin-bottom: 15px; font-size: 0.85em; opacity: 0.9; color: ${matchedColor}; text-align: ${textAlign};">${noteText}${imgHtml}</div>\n`;
                
                cleanText = cleanText.replace(fullNote, '');
                noteRegex.lastIndex = 0;
            }

            // 🧹 PURIFICADOR: Borramos visualmente los Block IDs de Obsidian (^12345) del texto base
            cleanText = cleanText.replace(/[ \t]*\^[a-zA-Z0-9-]{4,}\s*$/gm, '');

            // 📐 ARQUITECTURA DE COLUMNAS ESTIRADAS (Stretch)
            const isMainLeft = this.settings.alignment === 'left';
            const widthVal = `var(--cornell-width, 25%)`;
            const blockLineColor = firstColor || 'var(--text-accent)';
            
            const borderSide = isMainLeft ? 'border-right' : 'border-left';
            const paddingSide = isMainLeft ? 'padding-right' : 'padding-left';
            const paddingRightSide = isMainLeft ? 'padding-left' : 'padding-right';
            
            // Columna Izquierda: Ahora TOMA el borde y TOMA todo el alto disponible
            const leftColHtml = `
<div class="cornell-print-left" style="width: ${widthVal}; flex-shrink: 0; ${borderSide}: 2px solid ${blockLineColor}; ${paddingSide}: 15px; display: flex; flex-direction: column;">
${marginaliasHTML}
</div>`;
            
            // Columna Derecha: Contiene el markdown
            const rightColHtml = `
<div class="cornell-print-right" style="flex-grow: 1; min-width: 0; ${paddingRightSide}: 15px;">\n\n${cleanText.trim()}\n\n</div>`;

            const firstCol = isMainLeft ? leftColHtml : rightColHtml;
            const secondCol = isMainLeft ? rightColHtml : leftColHtml;

            // 🏗️ ENSAMBLAJE FINAL: align-items: stretch garantiza que la línea baje hasta el final.
            return `
<div id="${uniqueId}" class="cornell-print-block" data-original="${safeOriginal}" style="display: flex; flex-direction: row; align-items: stretch; margin-bottom: 2em; page-break-inside: avoid; break-inside: avoid; width: 100%;">
<style>
#${uniqueId} .cornell-print-right > p:first-child,
#${uniqueId} .cornell-print-right > ul:first-child,
#${uniqueId} .cornell-print-right > ol:first-child,
#${uniqueId} .cornell-print-right > div:first-child > p:first-child,
#${uniqueId} .cornell-print-right > div:first-child > ul:first-child { margin-top: 0 !important; padding-top: 0 !important; }
#${uniqueId} .cornell-print-left > div:first-child { margin-top: 0 !important; padding-top: 0 !important; }
</style>
${firstCol}
${secondCol}
</div>
<div class="cornell-block-end" style="display:none;"></div>`.trim();
        });

        // =========================================================
        // 2. NOTAS INLINE SUELTAS
        // =========================================================
        const docLines = content.split('\n');
        const finalLines = docLines.map(line => {
            if (line.includes('cornell-print-block')) return line;

            const inlineRegex = /%%([><])(.*?)%%/g;
            let match;
            let marginaliasToInject = "";
            let cleanLine = line;
            let lineModified = false;

            while ((match = inlineRegex.exec(cleanLine)) !== null) {
                modified = true;
                lineModified = true;
                const fullMatch = match[0];
                const direction = match[1];
                let noteText = match[2].trim();

                // 🛡️ Caja fuerte
                const safeOriginal = btoa(encodeURIComponent(fullMatch));

                // 👇 Limpieza universal de cualquier ID (^id o ^anki-id) y detección de flashcard
                let tempNoteContent = noteText.replace(/\s*[\^~][a-zA-Z0-9-]+\s*/g, ' ').trim();
                const isFlashcard = tempNoteContent.includes(";;");

                if (isFlashcard) {
                    tempNoteContent = tempNoteContent.replace(";;", "").replace(/\s{2,}/g, ' ').trim();
                }

                let matchedColor = 'var(--text-accent)';
                noteText = tempNoteContent;

                for (const tag of this.settings.tags) {
                    if (noteText.startsWith(tag.prefix)) {
                        matchedColor = tag.color;
                        noteText = noteText.substring(tag.prefix.length).trim();
                        break;
                    }
                }

                const imgRegex = /img:\s*\[\[(.*?)\]\]/gi;
                let imgHtml = "";
                noteText = noteText.replace(imgRegex, (imgMatch: string, imgName: string) => {
                    const cleanName = imgName.split('|')[0];
                    const file = this.app.metadataCache.getFirstLinkpathDest(cleanName, sourcePath);
                    if (file) {
                        const imgSrc = this.app.vault.getResourcePath(file);
                        imgHtml += `<img src="${imgSrc}" style="max-width: 100%; border-radius: 4px; margin-top: 5px; display: block;" />`;
                    }
                    return '';
                });

                // 🧭 LIMPIEZA DE BRÚJULA E HILOS
                const compassRegex = /\[(North|South|East|West)::\s*\[\[([\s\S]*?)\]\]\]/gi;
                noteText = noteText.replace(compassRegex, '').trim();
                const threadRegex = /(?<!!)\[\[(.*?)\]\]/g;
                noteText = noteText.replace(threadRegex, '').trim();

                const borderStyle = direction === '>' ? `border-right: 3px solid ${matchedColor};` : `border-left: 3px solid ${matchedColor};`;

                marginaliasToInject += `<span class="cornell-print-margin" data-original="${safeOriginal}" data-direction="${direction}" style="${borderStyle} color: ${matchedColor};">${noteText}${imgHtml}</span>`;

                cleanLine = cleanLine.replace(fullMatch, '').trim();
                inlineRegex.lastIndex = 0;
            }

            return lineModified ? marginaliasToInject + " " + cleanLine : line;
        });

        content = finalLines.join('\n');

        if (modified) {
            editor.setValue(content);
            new Notice("🖨️ PDF Print Mode: Ready! (Press Restore after exporting)");
        } else {
            new Notice("No marginalias found to prepare.");
        }
    }
    async restoreFromPrint(editor: Editor) {
        let content = editor.getValue();
        let modified = false;

        // 🛡️ 1. Restaurar Bloques Editoriales (Regex blindado con baliza del DOM)
        const blockRegex = /<div[^>]*data-original="([^"]+)"[\s\S]*?<div class="cornell-block-end" style="display:none;"><\/div>/g;
        
        content = content.replace(blockRegex, (match: string, b64Data: string) => {
            modified = true;
            return decodeURIComponent(atob(b64Data));
        });

        // 2. Restaurar Inline sueltas (Regex intacto)
        const inlineRegex = /<span class="cornell-print-margin"[^>]*data-original="([^"]+)"[^>]*>[\s\S]*?<\/span>/g;
        content = content.replace(inlineRegex, (match: string, b64Data: string) => {
            modified = true;
            return decodeURIComponent(atob(b64Data));
        });

        if (modified) {
            editor.setValue(content);
            new Notice("✅ Marginalia restored to original Markdown!");
        } else {
            new Notice("⚠️ No print blocks found to restore.");
        // Apagamos el addon limpiamente al cerrar Obsidian
        if (this.settings.addons && this.settings.addons["zoom-doodle"]) {
            this.zoomDoodleAddon.unload();
        }
    }
}
}
