import { App, Plugin, PluginSettingTab, Setting, MarkdownRenderer, Component, Editor, Notice, MarkdownView, ItemView, WorkspaceLeaf, TFile, Modal, MarkdownFileInfo, HoverPopover, setIcon } from 'obsidian';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
// 👇 IMPORTAMOS NUESTRO NUEVO ADDON
import { GamificationAddon } from "./addons/GamificationAddon";
import { CustomBackgroundAddon } from "./addons/CustomBackgroundAddon";
import { RhizomeAddon, RHIZOME_VIEW_TYPE } from "./addons/RhizomeAddon";
import { PdfDoodleAddon } from "./addons/PdfDoodleAddon";
import { SuperDoodleAddon } from "./addons/super-doodle";


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

        let cleanDestName = rawDestInput.replace(/^\d{12,14}\s*-\s*/, '').trim();
        if (!cleanDestName) cleanDestName = "Marginalia Inbox";
        let finalDestName = cleanDestName;

        if (this.plugin.settings.zkMode) {
            // @ts-ignore
            const zkId = window.moment().format('YYYYMMDDHHmmss');
            finalDestName = (cleanDestName !== "Marginalia Inbox") ? `${zkId} - ${cleanDestName}` : zkId;
        }

        // 1. AUTO-LECTURA DEL PORTAPAPELES
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

        // 3. ENSAMBLAJE DE MARKDOWN
        let marginaliaContent = thought ? `${thought} ` : ""; 
        if (doodleSyntax) marginaliaContent += `${doodleSyntax}`;

        let finalMd = "\n";
        if (marginaliaContent.trim()) finalMd += `%%> ${marginaliaContent.trim()} %%\n`;
        if (context) finalMd += `${context}\n`;
        if (contextImageSyntax) finalMd += `${contextImageSyntax}\n`;
        finalMd += `\n---\n`;

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
            const header = this.plugin.settings.zkMode ? `# 🗃️ ${finalDestName}\n` : `# 📥 ${finalDestName}\n`; 
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
    // 👇 NUEVA MEMORIA PARA LA MÁQUINA DEL TIEMPO
    rhizomeReviews: Record<string, { 
        lastReviewed: number; // Fecha en milisegundos
        interval: number;     // Días hasta la próxima revisión
        ease: number;         // Factor de facilidad (Algoritmo SM-2 de Anki)
    }>;
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
    lastOmniDestination: string;
    extractHighlights: boolean;
    ignoredHighlightFolders: string;
    ignoredHighlightTexts: string;
    zkMode: boolean;
    zkFolder: string;
    doodleFolder: string;
    canvasFolder: string;
    pinboardFolder: string;
    omniCaptureFolder: string;
    addons: Record<string, boolean>; 
    userStats: UserStats;
    enablePdfDoodle: boolean;
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
   
}

 // 🌉 EL PUENTE: Memoria estática para cruzar datos entre vistas (Drag & Drop)
    export class OmniDragManager {
    static payload: MarginaliaItem | null = null;
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
    outgoingLinks: [],
    lastOmniDestination: 'Marginalia Inbox',
    extractHighlights: false,
    ignoredHighlightFolders: 'Excalidraw',
    ignoredHighlightTexts: '⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠', 
    zkMode: false,
    zkFolder: 'Zettelkasten',
    doodleFolder: 'Marginalia Attachments',
    canvasFolder: 'Evidence Boards',
    pinboardFolder: 'Pinboards',
    omniCaptureFolder: '',
    // 👇 LOS VALORES POR DEFECTO PARA LOS NUEVOS USUARIOS
    addons: {
        "gamification-profile": false, // Por defecto viene apagado
        "custom-background": false,
        "rhizome-time-machine": false,
        "super-doodle": false // 🎨
    },
    userStats: {
        xp: 0,
        level: 1,
        marginaliasCreated: 0,
        colorUsage: {},
        profileImage: "", quote: "Stay curious.",
        customBackground: "", bgBlur: 5, bgOpacity: 0.8,
        rhizomeReviews: {}
    },
    enablePdfDoodle: false,
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
        let rawDestInput = this.destinationInput.value.trim() || "Marginalia Inbox";
        
        let cleanDestName = rawDestInput.replace(/^\d{12,14}\s*-\s*/, '').trim();
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

                const header = this.plugin.settings.zkMode ? `# 🗃️ ${finalDestName}\n` : `# 📥 ${finalDestName}\n`; 
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
    currentTab: 'current' | 'vault' | 'threads' | 'pinboard' = 'current';
    // 🧠 Memoria para el Cosido por Teclado
    selectedForStitch: MarginaliaItem[] = [];
    
    isStitchingMode: boolean = false;
    sourceStitchItem: MarginaliaItem | null = null;

    searchQuery: string = '';
    activeColorFilters: Set<string> = new Set();
    cachedItems: MarginaliaItem[] = []; 

    // 🚀 NUEVA MEMORIA RAM (Caché de Bóveda)
    private vaultCache: Map<string, { mtime: number, items: MarginaliaItem[] }> = new Map();

    // 📚 MEMORIA ZOTLIKE
    isZotlikeMode: boolean = false;
    activePdfName: string = "";

    draggedSidebarItems: MarginaliaItem[] | null = null; 
    isGroupedByContent: boolean = false; 

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
        cancelBtn.onclick = () => {
            this.isZenMode = false;
            this.applyFiltersAndRender();
        };

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

        
        // ⬇️ A partir de aquí tu código sigue normal:
        // saveBtn.onclick = async () => { ... }

        const saveBtn = rightGrp.createEl('button', { text: '💾 Attach', cls: 'mod-cta', title: 'Save and add to Board' });
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
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('cornell-sidebar-container');

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
        
        const actionControlsDiv = container.createDiv({ cls: 'cornell-sidebar-controls' });
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
                    filesToScan.push(activeFile);
                }
            } else {
                contentDiv.createEl('p', { text: 'No active file.', cls: 'cornell-sidebar-empty' });
                return;
            }
        } else {
            filesToScan = this.plugin.app.vault.getMarkdownFiles();
            const ignoredPaths = this.plugin.settings.ignoredFolders.split(',').map(s => s.trim()).filter(s => s.length > 0);
            filesToScan = filesToScan.filter(f => !ignoredPaths.some(p => f.path.startsWith(p)));
        }

        const baseEncoded = activePdfBasename.replace(/ /g, '%20');
        const nameEncoded = this.activePdfName.replace(/ /g, '%20');

        for (const file of filesToScan) {
            // 🎯 EL FILTRO ZOTLIKE DEFINITIVO: Evaluamos TODA la nota
            if (this.isZotlikeMode) {
                const fullContent = await this.plugin.app.vault.cachedRead(file);
                // Si la nota entera NO menciona el PDF, la ignoramos sin procesarla
                if (!fullContent.includes(this.activePdfName) && 
                    !fullContent.includes(nameEncoded) && 
                    !fullContent.includes(`[[${activePdfBasename}`) && 
                    !fullContent.includes(`[[${baseEncoded}`)) {
                    continue; 
                }
            }

            // 🚀 1. CONSULTAR CACHÉ (Acelerador)
            const cachedData = this.vaultCache.get(file.path);
            if (cachedData && cachedData.mtime === file.stat.mtime) {
                allItemsFlat.push(...cachedData.items);
                continue;
            }

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
                    if (noteContent.endsWith(';;')) noteContent = noteContent.slice(0, -2).trim();

                    const rawTextForStitching = noteContent;
                    let cleanText = noteContent;

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

                    const blockIdMatch = line.match(/\^([a-zA-Z0-9]+)\s*$/);
                    const existingBlockId = blockIdMatch ? blockIdMatch[1] : null;

                    fileItems.push({
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
            
            // 💾 3. GUARDAR EN MEMORIA
            this.vaultCache.set(file.path, { mtime: file.stat.mtime, items: fileItems });
            allItemsFlat.push(...fileItems);
        }
        
        // 🌉 EL PUENTE 
        this.cachedItems = allItemsFlat; 
        this.applyFiltersAndRender();
    }

    applyFiltersAndRender() {
        // 🧹 CAZAFANTASMAS 1: Destruye cualquier tooltip huérfano antes de redibujar la barra
        document.querySelectorAll('.cornell-hover-tooltip').forEach(el => el.remove());
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
            itemWrapper.addEventListener('dragstart', (e) => { draggedIndex = currentIndex; itemWrapper.style.opacity = '0.4'; e.stopPropagation(); });
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
            itemWrapper.addEventListener('dragend', () => { itemWrapper.style.opacity = '1'; draggedIndex = null; });
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

    async exportPinboard() {
        if (this.pinboardItems.length === 0) return;
        // @ts-ignore
        const dateStr = window.moment().format('YYYY-MM-DD_HH-mm-ss');
        const folder = this.plugin.settings.pinboardFolder.trim();
        await this.plugin.ensureFolderExists(folder);
        const fileName = folder ? `${folder}/Pinboard_${dateStr}.md` : `Pinboard_${dateStr}.md`;
        // @ts-ignore
        let content = `# ● Pinboard Session\n*Exported on: ${window.moment().format('YYYY-MM-DD HH:mm')}*\n\n---\n\n`;

        for (const item of this.pinboardItems) {
            if (item.isTitle) {
                const text = item.text.startsWith('#') ? item.text : `## ${item.text}`;
                content += `${text}\n\n`;
                continue; 
            }
            if (item.isCustom) {
                // 🦴 NODO ESQUELETO
                const indentSpaces = "  ".repeat(item.indentLevel || 0);
                content += `${indentSpaces}- ${item.text}\n\n`;
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
            
        } catch (error) {
            new Notice('Error creating Pinboard file. Check console.');
        }
    }
// 🌳 NUEVA FUNCIÓN: Exportador al Portapapeles para Mindmaps (Excalidraw)
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
                // Creamos los espacios de sangría base según el nivel en el corcho
                const indentSpaces = "\t".repeat(item.indentLevel || 0);
                
                let targetId = item.blockId;
                if (!targetId) {
                    targetId = Math.random().toString(36).substring(2, 8);
                    item.blockId = targetId;
                    await this.injectBackgroundBlockId(item.file, item.line, targetId);
                }

                // 🧠 DESACOPLAMIENTO DE IMÁGENES PARA EXCALIDRAW
                const imgRegex = /img:\s*\[\[(.*?)\]\]/i;
                const match = item.rawText.match(imgRegex);
                const cleanText = item.rawText.replace(imgRegex, '').trim();

                if (match) {
                    const imageName = match[1]; // Extraemos solo el nombre (ej. doodle.png|180)
                    
                    if (cleanText.length > 0) {
                        // 1. Tiene texto e imagen: El texto es el padre (con link), la imagen la hija pura
                        content += `${indentSpaces}- [[${item.file.basename}#^${targetId}|${cleanText}]]\n`;
                        content += `${indentSpaces}\t- ![[${imageName}]]\n`;
                    } else {
                        // 2. 🎯 SOLO IMAGEN: Imprimimos la imagen directamente como nodo, SIN link y SIN texto fantasma
                        content += `${indentSpaces}- ![[${imageName}]]\n`;
                    }
                } else {
                    // 3. Es solo texto normal
                    content += `${indentSpaces}- [[${item.file.basename}#^${targetId}|${item.rawText}]]\n`;
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
    // 🎨 NUEVO MOTOR: Generador Automático de Canvas (Tablero de Evidencia)
    async exportCanvas() {
        if (this.pinboardItems.length === 0) return;

        // @ts-ignore
        const dateStr = window.moment().format('YYYY-MM-DD_HH-mm-ss');
        const folder = this.plugin.settings.canvasFolder.trim();
        await this.plugin.ensureFolderExists(folder);
        const fileName = folder ? `${folder}/EvidenceBoard_${dateStr}.canvas` : `EvidenceBoard_${dateStr}.canvas`;

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
                const titleText = item.text.startsWith('#') ? item.text : `# ${item.text}`;
                nodes.push({ id: nodeId, type: "text", text: titleText, x: 0, y: currentY, width: 350, height: 100, color: "1" }); 
                lastTitleId = nodeId;
                parentAtLevel = {}; 
                parentAtLevel[-1] = nodeId; 
                currentY += 150; 
            } else if (item.isCustom) {
                // 🦴 NODO ESQUELETO: Una caja de texto simple
                const indent = item.indentLevel || 0;
                const baseX = (indent + 1) * 450;
                nodes.push({ id: nodeId, type: "text", text: `**${item.text}**`, x: baseX, y: currentY, width: 250, height: 60, color: "5" }); // Color 5 = Azul claro
                
                const parentId = parentAtLevel[indent - 1] || lastTitleId;
                if (parentId) edges.push({ id: genId(), fromNode: parentId, fromSide: "right", toNode: nodeId, toSide: "left" });
                parentAtLevel[indent] = nodeId;
                
                currentY += 100; // Ocupa menos espacio
            } else {
                const indent = item.indentLevel || 0;
                const baseX = (indent + 1) * 450; // Calculamos la posición X (Sangría)

                let targetId = item.blockId;
                if (!targetId) {
                    targetId = Math.random().toString(36).substring(2, 8);
                    item.blockId = targetId;
                    await this.injectBackgroundBlockId(item.file, item.line, targetId);
                }

                // 🧠 MAGIA DE IMÁGENES: Rescatamos el texto real y lo convertimos
                let canvasNoteContent = item.rawText;
                const hasImage = /img:\s*\[\[(.*?)\]\]/gi.test(canvasNoteContent);
                
                // Convertimos img:[[archivo.png]] a ![[archivo.png]] para que Canvas lo dibuje
                canvasNoteContent = canvasNoteContent.replace(/img:\s*\[\[(.*?)\]\]/gi, '![[$1]]');

                // 📌 1. NODO MARGINALIA
                const noteText = `**Marginalia:**\n${canvasNoteContent}\n\n[[${item.file.basename}#^${targetId}|🔗 Origin]]`;
                
                // Si la nota tiene un doodle, hacemos la tarjeta más alta para que quepa bien
                const nodeHeight = hasImage ? 320 : 140;
                
                nodes.push({ id: nodeId, type: "text", text: noteText, x: baseX, y: currentY, width: 300, height: nodeHeight, color: "4" }); // Color 4 = Verde

                // 🧵 2. CONECTAR CON SU PADRE
                const parentId = parentAtLevel[indent - 1] || lastTitleId;
                if (parentId) {
                    edges.push({ id: genId(), fromNode: parentId, fromSide: "right", toNode: nodeId, toSide: "left" });
                }
                parentAtLevel[indent] = nodeId;

                // 📚 3. EXTRAER EL TEXTO DEL HOVER
                const fileContent = await this.plugin.app.vault.cachedRead(item.file);
                const lines = fileContent.split('\n');
                const startLine = Math.max(0, item.line - 1);
                const endLine = Math.min(lines.length - 1, item.line + 1);
                
                let contextText = '';
                for (let i = startLine; i <= endLine; i++) {
                    let cleanLine = lines[i].replace(/%%[><](.*?)%%/g, '').trim();
                    if (cleanLine) contextText += cleanLine + '\n';
                }
                contextText = contextText.trim();

                // 📄 4. NODO CONTEXTO
                if (contextText) {
                    const contextNodeId = genId();
                    nodes.push({ id: contextNodeId, type: "text", text: `> ${contextText}`, x: baseX + 400, y: currentY - 20, width: 450, height: Math.max(180, nodeHeight) });
                    edges.push({ id: genId(), fromNode: nodeId, fromSide: "right", toNode: contextNodeId, toSide: "left" });
                }

                // Bajamos el cursor según si pusimos una imagen grande o una nota pequeña
                currentY += hasImage ? 360 : 220; 
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

        // 1. Creamos el contenedor vacío para el texto/imagen
        const textSpan = textRow.createSpan();
        textSpan.style.wordBreak = 'break-word';
        textSpan.style.flexGrow = '1';
        textSpan.style.marginRight = '10px';

        // 🎨 NUEVO: PRE-PROCESADOR DE IMÁGENES (La Bala de Plata)
        // Como Obsidian falla al renderizar ![[imagen]] en la barra lateral, 
        // lo convertimos temporalmente a HTML puro solo para dibujarlo.
        // 🎨 NUEVO: PRE-PROCESADOR DE IMÁGENES (Optimizado con Caché y Tamaño Mini)
        let textToRender = item.text;
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
        pinBtn.style.flexShrink = '0'; // 🛡️ Evita que el botón sea aplastado o empujado fuera
        pinBtn.style.cursor = 'pointer';
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

        // 🛡️ MOTOR DE VISIÓN DE RAYOS X (Estabilidad Absoluta + Integración PDF++)
        let hoverTimeout: NodeJS.Timeout | null = null;
        let tooltipEl: HTMLElement | null = null;
        let tooltipComponent: Component | null = null;
        let isHovering = false; 

        const removeTooltip = () => {
            isHovering = false; 
            if (hoverTimeout) clearTimeout(hoverTimeout);
            
            // 🧹 SALVAVIDAS: Descargamos el componente de forma segura para liberar a PDF++
            if (tooltipComponent) {
                tooltipComponent.unload();
                tooltipComponent = null;
            }

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

                

                removeTooltip(); 


                // Extraemos todo el texto del bloque primero para analizarlo

                let rawBlock = '';

                for (let i = startLine; i <= endLine; i++) {

                    let cleanLine = lines[i].replace(/%%[><](.*?)%%/g, '').trim();

                    if (cleanLine) {

                        if (i === item.line) {

                            rawBlock += `==${cleanLine}==\n`; 

                        } else {

                            rawBlock += `${cleanLine}\n`;

                        }

                    }

                }


                // 🎯 ESCÁNER DE PDF BLINDADO (Busca en todo el bloque)

                const pdfRegex = /!*\[\[(.*?\.(?:pdf).*?)\]\]/i;

                const pdfMatch = rawBlock.match(pdfRegex);


                if (pdfMatch) {

                    const pdfLinkText = pdfMatch[1]; 

                    

                    // Disparamos el Popover NATIVO con el source 'preview' para que PDF++ lo intercepte 100%

                    this.plugin.app.workspace.trigger('hover-link', {

                        event: e,

                        source: 'preview', 

                        hoverParent: itemDiv,

                        targetEl: itemDiv,

                        linktext: pdfLinkText,

                        sourcePath: item.file.path

                    });

                    

                    return; // ⛔ Cortamos acá si es PDF

                }


                // 🧱 JAULA DE TITANIO (Si NO es un PDF)

                tooltipEl = document.createElement('div');

                tooltipEl.className = 'popover hover-popover cornell-hover-tooltip markdown-rendered markdown-preview-view'; 

                

                // 🎨 ARREGLO DE DISPOSICIÓN Y CSS

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

                tooltipEl.style.display = 'flex'; // Fuerza el diseño de caja flexible

                tooltipEl.style.flexDirection = 'column'; // Apila título arriba y cuerpo abajo

                tooltipEl.style.gap = '8px'; // Espacio entre título y contenido


                const styleTag = document.createElement('style');

                styleTag.innerHTML = `

                    .cornell-hover-tooltip p { margin: 0 0 8px 0 !important; }

                `;

                tooltipEl.appendChild(styleTag);

                

                const header = tooltipEl.createDiv({ cls: 'cornell-hover-context' });

                // Letra más grande, en negrita y bloque completo

                header.innerHTML = `<span style="font-size: 1.1em; color: var(--text-normal); font-weight: bold; display: block; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px; width: 100%;">📄 ${item.file.basename} (L${item.line + 1})</span>`;

                

                const body = tooltipEl.createDiv();

                body.style.width = '100%'; // Asegura que el cuerpo ocupe todo el ancho disponible


                document.body.appendChild(tooltipEl);


                // POSICIONAMIENTO

                const rect = itemDiv.getBoundingClientRect();

                let leftPos = rect.left - 470; 

                if (leftPos < 10) leftPos = rect.right + 20; 

                tooltipEl.style.left = `${leftPos}px`;

                

                let topPos = rect.top;

                if (topPos + 350 > window.innerHeight) topPos = window.innerHeight - 360;

                tooltipEl.style.top = `${Math.max(10, topPos)}px`;


                // BALA DE PLATA para imágenes nativas

                const imgRegex = /!\[\[(.*?\.(?:png|jpg|jpeg|gif|bmp|svg))\|?(.*?)\]\]/gi;

                rawBlock = rawBlock.replace(imgRegex, (match, filename) => {

                    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(filename.trim(), item.file.path);

                    if (file) {

                        const resourcePath = this.plugin.app.vault.getResourcePath(file);

                        return `<img src="${resourcePath}" style="max-height:220px; max-width:100%; border-radius:6px; display:block; margin:8px auto;">`;

                    }

                    return match; 

                });


                if (!rawBlock.trim()) rawBlock = "*No text context available.*";


                await MarkdownRenderer.renderMarkdown(

                    rawBlock, 

                    body, 

                    item.file.path, 

                    this 

                );


                requestAnimationFrame(() => {

                    if (tooltipEl) tooltipEl.addClass('is-visible');

                });

            }, 500); 

        }); 

        itemDiv.addEventListener('mouseleave', removeTooltip);
        
        if (!isPinboardView) {
        itemDiv.setAttr('draggable', 'true');
        itemDiv.addEventListener('dragstart', (event: DragEvent) => {
            
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
            // 🛡️ SANITIZADOR DE ALIAS: Transforma la miniatura en texto seguro solo para el enlace
            let safeAlias = item.text.replace(/!\[\[(.*?)\]\]/g, '🖼️ [Image]').trim();
            if (!safeAlias) safeAlias = "Marginalia Doodle";

            const dragPayload = `[[${item.file.basename}#^${targetId}|${safeAlias}]]`;
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

        // ======================================================
        // ⚙️ ADVANCED & EXCLUSIONS
        // ======================================================
        containerEl.createEl('h3', { text: '⚙️ Advanced & Exclusions' });
        
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
    }
}



// --- 🕰️ LIENZO DE LA MÁQUINA DEL TIEMPO (RHIZOME) ---
// ... (Tus importaciones y settings arriba quedan igual)

export class RhizomeView extends ItemView {
    plugin: CornellMarginalia;
    isReviewMode: boolean = false; 
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
            this.plugin.settings.userStats = { xp: 0, level: 1, marginaliasCreated: 0, colorUsage: {}, profileImage: "", quote: "Stay curious.", customBackground: "", bgBlur: 5, bgOpacity: 0.8, rhizomeReviews: {} };
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

        for (const file of files) {
            if (this.plugin.settings.ignoredFolders && file.path.includes(this.plugin.settings.ignoredFolders)) continue;

            const content = await this.plugin.app.vault.cachedRead(file);
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const regex = /%%[><](.*?)%%/g;
                let match;

                while ((match = regex.exec(line)) !== null) {
                    let rawText = match[1].trim();
                    if (!rawText) continue;

                    let isFlashcard = false;
                    if (rawText.endsWith(";;")) {
                        isFlashcard = true;
                        rawText = rawText.slice(0, -2).trim();
                    }

                    let color = "var(--text-normal)";
                    for (const tag of this.plugin.settings.tags) {
                        if (rawText.startsWith(tag.prefix)) {
                            color = tag.color; break;
                        }
                    }

                    const date = new Date(file.stat.ctime);
                    const dateString = date.toISOString().split('T')[0];

                    if (!this.cachedTimelineData[dateString]) this.cachedTimelineData[dateString] = [];

                    const blockIdMatch = line.match(/\^([a-zA-Z0-9]+)\s*$/);
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
                    const cleanCardText = rawText.replace(compassRegex, '').trim();

                    const nodeData = {
                        text: cleanCardText, // 👈 Pasamos el texto limpio
                        color: color,
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
            const filteredNodes = this.cachedTimelineData[date].filter(item => {
                const matchesSearch = item.text.toLowerCase().includes(searchLower) || item.file.basename.toLowerCase().includes(searchLower);
                const matchesColor = activeColors.size === 0 || activeColors.has(item.color);
                const matchesFc = !onlyFc || item.isFlashcard;
                return matchesSearch && matchesColor && matchesFc;
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
                    zoomBtn.onClickEvent((e) => {
                        e.stopPropagation(); // Evita abrir la nota de fondo
                        
                        const firstImg = imagesToRender[0];
                        const cleanName = firstImg.split('|')[0];
                        const file = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanName, item.file.path);
                        
                        if (file) {
                            const imgSrc = this.plugin.app.vault.getResourcePath(file);
                            const overlay = document.body.createDiv({ cls: 'cornell-lightbox-overlay' });
                            const bigImg = overlay.createEl('img', { attr: { src: imgSrc } });
                            
                            // 👇 --- corrijo el fondo --- 
                            bigImg.style.backgroundColor = 'white'; // Dar fondo blanco
                            bigImg.style.padding = '10px'; // Dar un poco de espacio
                            bigImg.style.borderRadius = '8px'; // Suavizar bordes
                            // ------------------------------------

                            // Inversión inteligente de colores
                            if (document.body.classList.contains('theme-dark') && cleanName.includes('doodle_')) {
                                bigImg.style.filter = 'invert(1)';
                                bigImg.style.opacity = '0.9';
                            }

                            overlay.onclick = () => overlay.remove();
                            const escListener = (ev: KeyboardEvent) => {
                                if (ev.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escListener); }
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
                        const startLine = Math.max(0, item.line - 1);
                        const endLine = Math.min(lines.length - 1, item.line + 1);
                        
                        removeTooltip(); 

                        let rawBlock = '';
                        for (let i = startLine; i <= endLine; i++) {
                            let cleanLine = lines[i].replace(/%%[><](.*?)%%/g, '').trim();
                            if (cleanLine) {
                                if (i === item.line) rawBlock += `==${cleanLine}==\n`; 
                                else rawBlock += `${cleanLine}\n`;
                            }
                        }

                        const pdfRegex = /!*\[\[(.*?\.(?:pdf).*?)\]\]/i;
                        const pdfMatch = rawBlock.match(pdfRegex);
                        if (pdfMatch) {
                            this.plugin.app.workspace.trigger('hover-link', {
                                event: e, source: 'preview', hoverParent: node,
                                targetEl: node, linktext: pdfMatch[1], sourcePath: item.file.path
                            });
                            return; 
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

                        const header = tooltipEl.createDiv({ cls: 'cornell-hover-context' });
                        header.innerHTML = `<span style="font-size: 1.1em; color: var(--text-normal); font-weight: bold; display: block; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px; width: 100%;">📄 ${item.file.basename} (L${item.line + 1})</span>`;
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
                        rawBlock = rawBlock.replace(inlineImgRegex, (match, filename) => {
                            const file = this.plugin.app.metadataCache.getFirstLinkpathDest(filename.trim(), item.file.path);
                            if (file) {
                                const resourcePath = this.plugin.app.vault.getResourcePath(file);
                                return `<img src="${resourcePath}" style="max-height:220px; max-width:100%; border-radius:6px; display:block; margin:8px auto;">`;
                            }
                            return match; 
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
            
            return matchesSearch && matchesColor && matchesOrphan && matchesCluster;
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

            // 3. Botón de Zoom (Fullscreen) -> Presente SOLO si hay imágenes
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
                if (wasDragged) return; // No mostrar tooltip si estamos arrastrando a toda velocidad
                isHovering = true;
                hoverTimeout = setTimeout(async () => {
                    if (!isHovering) return; 
                    const content = await this.plugin.app.vault.cachedRead(item.file);
                    if (!isHovering || !document.body.contains(node)) return;

                    const lines = content.split('\n');
                    const startLine = Math.max(0, item.line - 1);
                    const endLine = Math.min(lines.length - 1, item.line + 1);
                    
                    removeTooltip(); 

                    let rawBlock = '';
                    for (let i = startLine; i <= endLine; i++) {
                        let cleanLine = lines[i].replace(/%%[><](.*?)%%/g, '').trim();
                        if (cleanLine) {
                            if (i === item.line) rawBlock += `==${cleanLine}==\n`; 
                            else rawBlock += `${cleanLine}\n`;
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

                    const header = tooltipEl.createDiv({ cls: 'cornell-hover-context' });
                    header.innerHTML = `<span style="font-size: 1.1em; color: var(--text-normal); font-weight: bold; display: block; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px; width: 100%;">📄 ${item.file.basename} (L${item.line + 1})</span>`;
                    
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
                    rawBlock = rawBlock.replace(inlineImgRegex, (match, filename) => {
                        const file = this.plugin.app.metadataCache.getFirstLinkpathDest(filename.trim(), item.file.path);
                        if (file) {
                            const resourcePath = this.plugin.app.vault.getResourcePath(file);
                            return `<img src="${resourcePath}" style="max-height:220px; max-width:100%; border-radius:6px; display:block; margin:8px auto;">`;
                        }
                        return match; 
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

    async executeStitch(source: any, target: any, direction: string = 'Classic') {
        new Notice(`Stitching semantic ${direction} thread... ⏳⛓︎`);

        // 1. Aseguramos que el destino tenga un ID (matrícula)
        let targetId = target.blockId;
        if (!targetId) {
            targetId = Math.random().toString(36).substring(2, 8);
            await this.plugin.app.vault.process(target.file, (data) => {
                const lines = data.split('\n');
                if (target.line >= 0 && target.line < lines.length) {
                    if (!lines[target.line].match(/\^([a-zA-Z0-9]+)\s*$/)) {
                        lines[target.line] = lines[target.line] + ` ^${targetId}`;
                    }
                }
                return lines.join('\n');
            });
        }

        // 2. Inyectamos el enlace silenciosamente según la Brújula
        let linkToInject = "";
        if (direction === 'Classic') {
            linkToInject = ` [[${target.file.basename}#^${targetId}]]`;
        } else {
            linkToInject = ` [${direction}:: [[${target.file.basename}#^${targetId}]]]`;
        }
        
        await this.plugin.app.vault.process(source.file, (data) => {
            const lines = data.split('\n');
            if (source.line >= 0 && source.line < lines.length) {
                lines[source.line] = lines[source.line].replace(source.text, source.text + linkToInject);
            }
            return lines.join('\n');
        });

        new Notice("✨ Conexión semántica establecida con éxito!");
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


// --- PLUGIN PRINCIPAL ---
export default class CornellMarginalia extends Plugin {
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
        // 👆 FIN DE LA CONEXIÓN DE ADDONS

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
        this.registerMarkdownCodeBlockProcessor("cornell", async (source, el, ctx) => {
            if (!this.settings.enableReadingView) return;

            // 1. Buscar la marginalia dentro de todo el bloque
            const regex = /%%([><])([\s\S]*?)%%/;
            let match = regex.exec(source);

            // 2. Limpiar el texto principal (le quitamos la sintaxis de la marginalia)
            const cleanSource = source.replace(regex, '').trim();

            // 3. Crear el contenedor padre. ¡La posición relativa es la clave aquí!
            const wrapper = el.createDiv({ cls: 'cornell-reading-container cornell-editorial-wrapper' });
            wrapper.style.position = 'relative';
            wrapper.style.width = '100%';

            // 4. Renderizar el texto principal de forma nativa
            const contentCol = wrapper.createDiv({ cls: 'cornell-editorial-content' });
            await MarkdownRenderer.renderMarkdown(cleanSource, contentCol, ctx.sourcePath, this);

            // 5. Procesar e inyectar la marginalia lateral
            if (match) {
                const direction = match[1];
                let noteContent = match[2].trim();
                const isFlashcard = noteContent.endsWith(";;");
                if (isFlashcard) noteContent = noteContent.slice(0, -2).trim();

                let matchedColor = null;
                let finalNoteText = noteContent;
                for (const tag of this.settings.tags) {
                    if (finalNoteText.startsWith(tag.prefix)) {
                        matchedColor = tag.color;
                        finalNoteText = finalNoteText.substring(tag.prefix.length).trim();
                        break;
                    }
                }

                // Limpiar imágenes y links como en tu post-procesador original
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

                // Crear la caja de la marginalia
                const marginDiv = document.createElement("div");
                marginDiv.className = "cm-cornell-margin reading-mode-margin cornell-editorial-margin";
                
                if (matchedColor) {
                    marginDiv.style.setProperty('border-color', matchedColor, 'important');
                    marginDiv.style.setProperty('color', matchedColor, 'important');
                }

                MarkdownRenderer.render(this.app, finalRenderText, marginDiv, ctx.sourcePath, this);

                // Agregar imágenes si las hay
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

                // Agregar enlaces de hilos
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

                // Lógica para saber de qué lado va la nota
                const isMainLeft = this.settings.alignment === 'left';
                const isNoteLeft = (isMainLeft && direction === '>') || (!isMainLeft && direction === '<');

                let colClass = isNoteLeft ? 'cornell-col-left' : 'cornell-col-right';
                let column = wrapper.createDiv({ cls: colClass });
                
                // 📏 AQUÍ ESTÁ LA MAGIA DE LA ALTURA: Usamos top:0 y bottom:0 para que se estire
                column.style.setProperty('position', 'absolute', 'important');
                column.style.setProperty('top', '0', 'important');
                column.style.setProperty('bottom', '0', 'important'); 
                column.style.setProperty('width', 'var(--cornell-width)', 'important');

                if (isNoteLeft) {
                    column.style.setProperty('left', 'var(--cornell-margin-left)', 'important');
                } else {
                    column.style.setProperty('right', 'calc(-1 * var(--cornell-width) - 20px)', 'important');
                }

                if ((isMainLeft && direction === '<') || (!isMainLeft && direction === '>')) {
                    marginDiv.classList.add('cornell-reverse-align');
                }

                // Estiramos también el div interno para que la línea de color cubra todo el espacio
                marginDiv.style.setProperty('height', '100%', 'important');
                marginDiv.style.setProperty('min-height', '100%', 'important');
                marginDiv.style.setProperty('box-sizing', 'border-box', 'important');
                
                column.appendChild(marginDiv);

                if (isFlashcard) {
                    wrapper.classList.add('cornell-flashcard-target');
                }
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
                let noteText = noteMatch[2].trim();
                
                if (noteText.endsWith(';;')) noteText = noteText.slice(0, -2).trim();

                let matchedColor = 'var(--text-accent)';
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

            // 🧹 PURIFICADOR: Borramos visualmente los Block IDs de Obsidian (^12345)
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

                if (noteText.endsWith(';;')) noteText = noteText.slice(0, -2).trim();

                let matchedColor = 'var(--text-accent)';
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
        }
    }
}
