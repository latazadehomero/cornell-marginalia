import { TextFileView, WorkspaceLeaf, Notice, setIcon, MarkdownRenderer, Component } from "obsidian";
import CornellMarginalia from "../main";

import { Modal, Setting, App } from "obsidian"; // Asegúrate de importar Modal y Setting arriba

// ======================================================
// 💬 MODAL PARA ETIQUETAR LA CONEXIÓN (STITCH)
// ======================================================
export class StitchLabelModal extends Modal {
    result: string = "";
    onSubmit: (result: string) => void;

    constructor(app: App, onSubmit: (result: string) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "🔗 Crear Conexión Semántica" });

        new Setting(contentEl)
            .setName("Etiqueta (opcional)")
            .setDesc("¿Cuál es la relación entre estas dos notas?")
            .addText((text) =>
                text
                    .setPlaceholder("Ej: miden lo mismo, contradice a...")
                    .onChange((value) => {
                        this.result = value;
                    })
                    .inputEl.addEventListener("keydown", (e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            this.submitAndClose();
                        }
                    })
            );

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText("Conectar")
                    .setCta()
                    .onClick(() => {
                        this.submitAndClose();
                    })
            );
    }

    submitAndClose() {
        this.onSubmit(this.result);
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export const PINBOARD_VIEW_TYPE = "cornell-pinboard-view";

// ======================================================
// 🎨 MODAL PARA ESTILIZAR FLECHAS (GROSOR, COLOR Y TIPO)
// ======================================================
export class StitchStyleMenuModal extends Modal {
    stitch: any;
    view: PinboardView; // Necesitamos acceso a la vista para redibujar en vivo

    constructor(app: App, stitch: any, view: PinboardView) {
        super(app);
        this.stitch = stitch;
        this.view = view;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "🎨 Personalizar Conexión" });

        // 1. Selector de Color (Feedback en tiempo real)
        new Setting(contentEl)
            .setName("Color de la línea")
            .addColorPicker(color => {
                color.setValue(this.stitch.color || "#a277ff"); 
                color.onChange(value => {
                    this.stitch.color = value;
                    this.view.redrawLines(); // Se actualiza mientras mueves el color
                });
            });

        // 2. Selector de Grosor con Slider
        new Setting(contentEl)
            .setName("Grosor de línea")
            .addSlider(slider => {
                slider.setLimits(1, 15, 1)
                      .setValue(this.stitch.thickness || 3)
                      .onChange(value => {
                          this.stitch.thickness = value;
                          this.view.redrawLines();
                      });
            });

        // 3. Selector de Estilo (Continua, punteada, etc)
        new Setting(contentEl)
            .setName("Estilo de línea")
            .addDropdown(drop => {
                drop.addOption("none", "Continua")
                    .addOption("5,5", "Punteada clásica")
                    .addOption("10,10", "Rayas largas")
                    .addOption("15,5,5,5", "Código Morse")
                    .setValue(this.stitch.dasharray || "5,5")
                    .onChange(value => {
                        this.stitch.dasharray = value;
                        this.view.redrawLines();
                    });
            });

        // 4. Botón destructivo: Romper la conexión
        new Setting(contentEl)
            .addButton(btn => {
                btn.setButtonText("Romper Conexión")
                   .setClass("mod-warning") // Lo pinta de rojo
                   .onClick(() => {
                       // Eliminamos la flecha del archivo
                       this.view.canvasData.stitches = this.view.canvasData.stitches.filter(
                           (s: any) => s !== this.stitch
                       );
                       this.view.redrawLines();
                       this.close();
                   });
            });

        // 5. Botón de Listo
        new Setting(contentEl)
            .addButton(btn => {
                btn.setButtonText("Listo").setCta().onClick(() => this.close());
            });
    }

    onClose() {
        // Al cerrar el modal, mandamos a guardar físicamente los cambios al archivo .cboard
        this.view.requestSave(); 
        this.contentEl.empty();
    }
}

// ======================================================
// 🧠 MODAL DE REPASO DE FLASHCARDS (SPACED REPETITION)
// ======================================================
export class CanvasFlashcardModal extends Modal {
    
    cards: { front: string, back: string, sourcePath: string }[] = [];
    currentIndex: number = 0;
    isFlipped: boolean = false;
    view: Component; // 👈 NUEVO: Aquí guardaremos el componente vivo

    constructor(app: App, cards: { front: string, back: string, sourcePath: string }[], view: Component) { // 👈 NUEVO: Añadimos view al constructor
        super(app);
        this.cards = cards;
        this.view = view; // 👈 Lo guardamos
    }

    onOpen() {
        // Escuchador de teclado para un repaso ultra rápido
        this.scope.register([], 'Enter', (evt: KeyboardEvent) => { evt.preventDefault(); this.handleNextOrFlip(); });
        this.scope.register([], ' ', (evt: KeyboardEvent) => { evt.preventDefault(); this.handleNextOrFlip(); });
        this.scope.register([], 'ArrowRight', (evt: KeyboardEvent) => { evt.preventDefault(); this.handleNextOrFlip(); });
        
        this.renderCard();
    }

    handleNextOrFlip() {
        if (!this.isFlipped) {
            this.isFlipped = true;
            this.renderCard();
        } else {
            if (this.currentIndex < this.cards.length - 1) {
                this.currentIndex++;
                this.isFlipped = false;
                this.renderCard();
            } else {
                new Notice("🎉 ¡Has terminado el repaso de este lienzo!");
                this.close();
            }
        }
    }

    renderCard() {
        this.contentEl.empty();
        const card = this.cards[this.currentIndex];

        // 1. Título y Progreso
        this.contentEl.createEl("h3", { text: `🧠 Repaso Activo (${this.currentIndex + 1} / ${this.cards.length})` });

        // 2. Contenedor de la Tarjeta (Diseño Premium)
        const cardEl = this.contentEl.createDiv();
        cardEl.style.minHeight = "200px";
        cardEl.style.display = "flex";
        cardEl.style.flexDirection = "column";
        cardEl.style.justifyContent = "center";
        cardEl.style.alignItems = "center";
        cardEl.style.background = "var(--background-secondary)";
        cardEl.style.border = "1px solid var(--background-modifier-border)";
        cardEl.style.borderRadius = "12px";
        cardEl.style.padding = "30px";
        cardEl.style.marginBottom = "20px";
        cardEl.style.textAlign = "center";
        cardEl.style.boxShadow = "0 8px 16px rgba(0,0,0,0.1)";

        // 3. Frente (Pregunta)
        const frontEl = cardEl.createDiv();
        frontEl.style.fontSize = "1.3em";
        frontEl.style.fontWeight = "bold";
        frontEl.style.color = "var(--text-normal)";
        MarkdownRenderer.render(this.app, card.front, frontEl, card.sourcePath, this.view); // 

        // 4. Dorso (Respuesta)
        if (this.isFlipped) {
            const divider = cardEl.createEl("hr");
            divider.style.width = "80%";
            divider.style.borderColor = "var(--background-modifier-border)";
            divider.style.margin = "20px 0";

            const backEl = cardEl.createDiv();
            backEl.style.fontSize = "1.1em";
            backEl.style.color = "var(--text-muted)";
            // 🔮 MAGIA PDF++: Le pasamos el sourcePath y aplicamos el parche CSS para que el recorte despierte
            MarkdownRenderer.render(this.app, card.back, backEl, card.sourcePath, this.view).then(() => { // 👈 USAMOS THIS.VIEW
                setTimeout(() => {
                    backEl.querySelectorAll('img, .pdf-cropped-embed, .internal-embed').forEach(el => {
                        const htmlEl = el as HTMLElement;
                        htmlEl.style.maxWidth = '100%';
                        htmlEl.style.height = 'auto';
                        htmlEl.style.borderRadius = '4px';
                        htmlEl.style.display = 'block';
                        htmlEl.style.minHeight = '50px'; // Forzamos que se expanda
                    });
                }, 100);
            });
        }
        

        // 5. Botonera
        const controlsEl = this.contentEl.createDiv();
        controlsEl.style.display = "flex";
        controlsEl.style.justifyContent = "space-between";
        controlsEl.style.gap = "10px";

        const prevBtn = controlsEl.createEl("button", { text: "⬅️ Anterior" });
        prevBtn.disabled = this.currentIndex === 0;
        prevBtn.onclick = () => {
            this.currentIndex--;
            this.isFlipped = false;
            this.renderCard();
        };

        const flipBtn = controlsEl.createEl("button", { 
            text: this.isFlipped ? "Siguiente ➡️" : "👁️ Mostrar Respuesta (Espacio)", 
            cls: "mod-cta" 
        });
        flipBtn.style.flexGrow = "1";
        flipBtn.onclick = () => this.handleNextOrFlip();
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ======================================================
// ⚠️ MODAL DE CONFIRMACIÓN PARA LIMPIAR EL LIENZO
// ======================================================
export class ConfirmClearModal extends Modal {
    onConfirm: () => void;

    constructor(app: App, onConfirm: () => void) {
        super(app);
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "🧹 Limpiar Lienzo Espacial" });
        contentEl.createEl("p", { 
            text: "¿Estás seguro de que quieres borrar TODAS las notas y conexiones de este lienzo? Esta acción no eliminará tus notas de Obsidian, pero sí destruirá este mapa visual. No se puede deshacer." 
        });

        const btnContainer = contentEl.createDiv({ attr: { style: "display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;" }});
        
        const cancelBtn = btnContainer.createEl("button", { text: "Cancelar" });
        cancelBtn.onclick = () => this.close();

        // Al usar 'mod-warning', Obsidian pinta el botón de rojo automáticamente
        const confirmBtn = btnContainer.createEl("button", { text: "Borrar Todo", cls: "mod-warning" }); 
        confirmBtn.onclick = () => {
            this.onConfirm();
            this.close();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

export class PinboardView extends TextFileView {
    plugin: CornellMarginalia;
    canvasEl!: HTMLElement;
    scrollWrapper!: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: CornellMarginalia) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return PINBOARD_VIEW_TYPE; }
    getDisplayText() { return "Lienzo Espacial"; }
    getIcon() { return "map"; }

    svgOverlay!: SVGSVGElement; // Variable a nivel de clase

    // 💾 MEMORIA DE ARCHIVO INDIVIDUAL (Reemplaza a los settings globales)
    canvasData: { nodes: Record<string, any>, stitches: any[], doodleDataUrl?: string } = { nodes: {}, stitches: [] };

    // 📥 Obsidian llama a esto cuando necesita guardar el archivo
    getViewData(): string {
        return JSON.stringify(this.canvasData, null, 2);
    }

    // 📤 Obsidian llama a esto al abrir un archivo para entregarte el texto
    // 📤 Obsidian llama a esto al abrir un archivo para entregarte el texto
    async setViewData(data: string, clear: boolean) {
        if (clear) {
            // Limpiamos la UI sin guardar
            const htmlNodes = this.canvasEl?.querySelectorAll('.cornell-pinboard-node');
            htmlNodes?.forEach(n => n.remove());
            if (this.svgOverlay) this.svgOverlay.innerHTML = '';
            // 🧹 Limpiamos también el cristal del lápiz si cambiamos de archivo
            if (this.doodleCtx) this.doodleCtx.clearRect(0, 0, 5000, 5000); 
        }
        
        try {
            this.canvasData = data ? JSON.parse(data) : { nodes: {}, stitches: [] };
            if (!this.canvasData.nodes) this.canvasData.nodes = {};
            if (!this.canvasData.stitches) this.canvasData.stitches = [];
        } catch (e) {
            console.error("Error cargando el archivo de lienzo:", e);
            this.canvasData = { nodes: {}, stitches: [] };
        }

        // 🎨 1. RESTAURAMOS EL DIBUJO Y APLICAMOS TINTA INTELIGENTE
        if (this.canvasData.doodleDataUrl && this.doodleCtx) {
            const img = new Image();
            img.onload = () => {
                this.doodleCtx.drawImage(img, 0, 0);
                this.applySmartInk(); // 👈 Detecta el tema y corrige los colores
            };
            img.src = this.canvasData.doodleDataUrl;
        }

        await this.renderSavedNodes();
        this.redrawLines();
    }

    // 🧹 MÉTODO OBLIGATORIO DE TextFileView (Cuando se cierra el archivo)
    clear() {
        this.canvasData = { nodes: {}, stitches: [], doodleDataUrl: "" }; // 👈 Agregamos doodleDataUrl
        
        if (this.canvasEl) {
            const htmlNodes = this.canvasEl.querySelectorAll('.cornell-pinboard-node');
            htmlNodes.forEach(node => node.remove());
        }
        if (this.svgOverlay) this.svgOverlay.innerHTML = '';
        if (this.doodleCtx) this.doodleCtx.clearRect(0, 0, 5000, 5000); // 👈 Limpiamos el cristal de dibujo
    }

    // 🧹 NUEVO MOTOR DE LIMPIEZA TOTAL
    clearCanvas() {
        const htmlNodes = this.canvasEl.querySelectorAll('.cornell-pinboard-node');
        htmlNodes.forEach(node => node.remove());
        if (this.svgOverlay) this.svgOverlay.innerHTML = '';

        this.canvasData = { nodes: {}, stitches: [] };
        
        // En lugar de saveSettings, le pedimos a Obsidian que guarde el archivo físico
        this.requestSave(); 
        new Notice("✨ El lienzo ha quedado en blanco.");
    }

    async onOpen() {
        //  1. INYECTAMOS EL BOTÓN EN LA BARRA SUPERIOR DE OBSIDIAN
        this.addAction('trash', 'Limpiar todo el lienzo', () => {
            new ConfirmClearModal(this.plugin.app, () => {
                this.clearCanvas();
            }).open();
        });
        this.addAction('camera', 'Exportar a Imagen (PNG)', () => {
            this.exportToImage();
        });
        this.addAction('brain-circuit', 'Repasar Flashcards del Lienzo', () => {
            this.openFlashcardReview();
        });
        this.addAction('sticky-note', 'Añadir Tarjeta de Texto', () => {
            // Calculamos el centro exacto de tu pantalla actual, compensando el zoom
            const rect = this.scrollWrapper.getBoundingClientRect();
            const centerX = (this.scrollWrapper.scrollLeft + rect.width / 2) / this.zoomLevel;
            const centerY = (this.scrollWrapper.scrollTop + rect.height / 2) / this.zoomLevel;
            
            this.addCustomTextNode(centerX - 150, centerY - 50); // Lo centramos un poco
        });
        
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        
        this.scrollWrapper = container.createDiv({ cls: 'cornell-pinboard-viewport' });
        this.scrollWrapper.style.overflow = 'auto';
        this.scrollWrapper.style.width = '100%';
        this.scrollWrapper.style.height = '100%';
        this.scrollWrapper.style.position = 'relative';
        this.scrollWrapper.style.backgroundColor = 'var(--background-primary-alt)';
        
        this.canvasEl = this.scrollWrapper.createDiv({ cls: 'cornell-pinboard-canvas' });
        this.canvasEl.style.position = 'absolute';
        this.canvasEl.style.width = '5000px';
        this.canvasEl.style.height = '5000px';
        this.canvasEl.style.backgroundImage = 'radial-gradient(var(--background-modifier-border) 1px, transparent 1px)';
        this.canvasEl.style.backgroundSize = '20px 20px';

        // 🎯 VITAL PARA EL ZOOM: El origen debe ser la esquina superior izquierda
        this.canvasEl.style.transformOrigin = "0 0";
        this.canvasEl.style.transition = "transform 0.1s ease-out"; // Suavizado opcional para trackpads
        
        // 👇 AQUÍ INYECTAMOS EL ESCUCHADOR DE LA RUEDA DEL RATÓN
        this.scrollWrapper.addEventListener('wheel', this.handleZoom.bind(this), { passive: false });

        // 👇 INYECTAMOS EL CRISTAL SVG PARA LAS FLECHAS
        this.svgOverlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        this.svgOverlay.style.position = 'absolute';
        this.svgOverlay.style.top = '0';
        this.svgOverlay.style.left = '0';
        this.svgOverlay.style.width = '100%';
        this.svgOverlay.style.height = '100%';
        this.svgOverlay.style.pointerEvents = 'none'; // Para que los clics lo traspasen
        this.svgOverlay.style.zIndex = '0';
        this.canvasEl.appendChild(this.svgOverlay);

        // 🔲 Creamos la caja física de selección múltiple (ESTO MATA EL ERROR DE LA CONSOLA)
        this.selectionBoxEl = this.scrollWrapper.createDiv();
        this.selectionBoxEl.style.position = 'absolute';
        this.selectionBoxEl.style.border = '1px dashed var(--interactive-accent)';
        this.selectionBoxEl.style.backgroundColor = 'rgba(var(--text-accent), 0.1)';
        this.selectionBoxEl.style.zIndex = '999';
        this.selectionBoxEl.style.display = 'none';
        this.selectionBoxEl.style.pointerEvents = 'none';

        this.setupMarqueeSelection(); // Iniciamos los escuchadores del fondo
        this.setupKeyboardShortcuts(); // 👈 ¡NUEVO! Encendemos el teclado
        this.setupPanning();
        this.setupDropZone();

        setTimeout(() => {
            this.scrollWrapper.scrollLeft = 2500 - (this.scrollWrapper.clientWidth / 2);
            this.scrollWrapper.scrollTop = 2500 - (this.scrollWrapper.clientHeight / 2);
        }, 50);

        
        // 🚩 Banner de información para el Stitching (oculto por defecto)
        this.stitchBannerEl = container.createDiv({ cls: 'cornell-focus-banner' }); // Reutilizamos tu clase CSS
        this.stitchBannerEl.style.position = 'absolute';
        this.stitchBannerEl.style.top = '20px';
        this.stitchBannerEl.style.left = '50%';
        this.stitchBannerEl.style.transform = 'translateX(-50%)';
        this.stitchBannerEl.style.zIndex = '1000';
        this.stitchBannerEl.style.display = 'none';

        // 🛑 Cancelar la costura si el usuario hace clic en el fondo del lienzo
        this.canvasEl.addEventListener('mousedown', (e: MouseEvent) => {
            if (this.isStitchingMode && e.target === this.canvasEl) {
                this.cancelStitch();
                new Notice("Conexión cancelada.");
            }
        });
    // -----------------------------------------------------
        // 🎨 INYECTAR INTERFAZ Y CAPA DE DIBUJO LIBRE (DOODLE)
        // -----------------------------------------------------
        
        // 1. Creamos el lienzo de cristal para pintar (5000x5000 igual que el fondo)
        this.doodleCanvasEl = this.canvasEl.createEl("canvas");
        this.doodleCanvasEl.width = 5000;
        this.doodleCanvasEl.height = 5000;
        this.doodleCanvasEl.style.position = 'absolute';
        this.doodleCanvasEl.style.top = '0';
        this.doodleCanvasEl.style.left = '0';
        this.doodleCanvasEl.style.zIndex = '5'; // Debajo de las tarjetas (z:10) y encima del cristal de flechas (z:0)
        
        // Magia: El lienzo de dibujo ignora los clics a menos que tengamos un lápiz en la mano
        this.doodleCanvasEl.style.pointerEvents = 'none'; 
        
        this.doodleCtx = this.doodleCanvasEl.getContext("2d")!;
        this.doodleCtx.lineCap = "round";
        this.doodleCtx.lineJoin = "round";

        

        // 2. Creamos la barra de herramientas flotante
        const toolbar = container.createDiv({ cls: 'cornell-doodle-toolbar' });
        toolbar.style.position = 'absolute';
        toolbar.style.bottom = '20px';
        toolbar.style.left = '50%';
        toolbar.style.transform = 'translateX(-50%)';
        toolbar.style.zIndex = '2000';
        toolbar.style.display = 'flex';
        toolbar.style.gap = '10px';
        toolbar.style.padding = '8px 12px';
        toolbar.style.backgroundColor = 'var(--background-primary)';
        toolbar.style.border = '1px solid var(--background-modifier-border)';
        toolbar.style.borderRadius = '12px';
        toolbar.style.boxShadow = '0 8px 24px rgba(0,0,0,0.2)';
        
        const updateToolbarUI = () => {
            Array.from(toolbar.children).forEach(child => child.classList.remove('is-active', 'mod-cta'));
            if (this.currentTool === 'hand') handBtn.classList.add('is-active', 'mod-cta');
            if (this.currentTool === 'pen') penBtn.classList.add('is-active', 'mod-cta');
            if (this.currentTool === 'eraser') eraserBtn.classList.add('is-active', 'mod-cta');

            // Encendemos/apagamos el cristal táctil del lienzo de dibujo
            this.doodleCanvasEl.style.pointerEvents = this.currentTool !== 'hand' ? 'auto' : 'none';
        };

        const handBtn = toolbar.createEl('button', { title: "Modo Mano (Arrastrar/Seleccionar)" });
        setIcon(handBtn, "hand");
        handBtn.onclick = () => { this.currentTool = 'hand'; this.isDrawingMode = false; updateToolbarUI(); };

        const penBtn = toolbar.createEl('button', { title: "Lápiz" });
        setIcon(penBtn, "pencil");
        penBtn.onclick = () => { this.currentTool = 'pen'; this.isDrawingMode = true; updateToolbarUI(); };

        const eraserBtn = toolbar.createEl('button', { title: "Goma de borrar" });
        setIcon(eraserBtn, "eraser");
        eraserBtn.onclick = () => { this.currentTool = 'eraser'; this.isDrawingMode = true; updateToolbarUI(); };

        // Paleta de colores y grosor
        const colorGrp = toolbar.createDiv({ attr: { style: 'display:flex; gap:8px; margin-left: 10px; border-left: 1px solid var(--background-modifier-border); padding-left: 12px; align-items: center;' } });
        
        // ⚪ Añadimos el blanco (#ffffff)
        // 🧠 'smart' es el color que se adapta, además dejamos algunos estáticos
        const colors = ['smart', '#a277ff', '#ff4d4d', '#00cc66'];
        colors.forEach(c => {
            const cBtn = colorGrp.createDiv();
            cBtn.style.width = '24px'; cBtn.style.height = '24px';
            cBtn.style.borderRadius = '50%'; 
            cBtn.style.cursor = 'pointer';
            
            // Botón bicolor para representar la inteligencia
            if (c === 'smart') {
                cBtn.style.background = 'linear-gradient(135deg, #ffffff 50%, #000000 50%)';
                cBtn.style.border = '1px solid var(--background-modifier-border)';
                cBtn.title = "Tinta Inteligente (Se adapta al tema)";
            } else {
                cBtn.style.backgroundColor = c;
            }

            const highlightSelection = () => {
                Array.from(colorGrp.children).forEach((btn: Element) => {
                    if (btn.tagName.toLowerCase() !== 'input') (btn as HTMLElement).style.boxShadow = 'none';
                });
                cBtn.style.boxShadow = '0 0 0 2px var(--background-primary), 0 0 0 4px var(--text-normal)';
            };

            cBtn.onclick = () => {
                this.currentColor = c;
                this.currentTool = 'pen';
                this.isDrawingMode = true;
                updateToolbarUI();
                highlightSelection();
            };

            if (c === this.currentColor) highlightSelection();
        });

        // 🎚️ SLIDER DE GROSOR (Para Lápiz y Goma)
        const sizeSlider = colorGrp.createEl('input', { 
            type: 'range', 
            attr: { min: '1', max: '40', value: this.currentPenSize.toString() } 
        });
        sizeSlider.style.width = '80px';
        sizeSlider.style.marginLeft = '10px';
        sizeSlider.style.cursor = 'pointer';
        sizeSlider.title = "Grosor del trazo/goma";
        
        sizeSlider.oninput = (e) => {
            this.currentPenSize = parseInt((e.target as HTMLInputElement).value);
        };

        updateToolbarUI(); // Estado inicial
        this.setupDoodleEngine(); // Llamamos al motor lógico
        // 🔄 Escuchamos el botón de Tema de Obsidian en vivo
        this.plugin.registerEvent(this.plugin.app.workspace.on('css-change', () => {
            this.applySmartInk();
        }));
    }
    
    // 🕸️ MOTOR DE GEOMETRÍA: Dibuja las líneas en vivo
    redrawLines() {
        if (!this.svgOverlay || !this.canvasData.stitches) return;
        this.svgOverlay.innerHTML = ''; // Limpiamos el lienzo de cristal

        const stitches = this.canvasData.stitches || [];

        for (const stitch of stitches) {
            const sourceNode = document.getElementById(stitch.sourceId);
            const targetNode = document.getElementById(stitch.targetId);

            // Solo dibujamos si ambas tarjetas existen en el lienzo
            if (sourceNode && targetNode) {
                
                // 🚀 MAGIA ANTI-ZOOM: Usamos offsetLeft/Width en lugar de getBoundingClientRect.
                // Estas coordenadas SIEMPRE son exactas sin importar si el zoom está al 10% o al 300%.
                const sX = sourceNode.offsetLeft + (sourceNode.offsetWidth / 2);
                const sY = sourceNode.offsetTop + (sourceNode.offsetHeight / 2);

                const tX = targetNode.offsetLeft + (targetNode.offsetWidth / 2);
                const tY = targetNode.offsetTop + (targetNode.offsetHeight / 2);

                // 📐 Curva de Bézier (Hacemos que la curva se adapte a la distancia)
                const distanceX = Math.abs(tX - sX);
                const controlPointOffset = Math.max(50, distanceX * 0.3); // Curva dinámica

                const pathData = `M ${sX} ${sY} C ${sX + controlPointOffset} ${sY}, ${tX - controlPointOffset} ${tY}, ${tX} ${tY}`;

                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", pathData);
                path.setAttribute("fill", "transparent");
                
                // 🎨 1. CARGAMOS LOS ESTILOS DINÁMICOS
                const strokeColor = stitch.color || "var(--interactive-accent)";
                const strokeWidth = stitch.thickness || 3;
                const dashArray = stitch.dasharray || "5,5";

                path.setAttribute("stroke", strokeColor);
                path.setAttribute("stroke-width", strokeWidth.toString());
                if (dashArray !== "none") {
                    path.setAttribute("stroke-dasharray", dashArray);
                }

                // 🖱️ 2. MAGIA UX: Hacer la línea interactiva sin bloquear el fondo
                path.style.pointerEvents = "visibleStroke"; 
                path.style.cursor = "pointer";

                // 🎡 3. EVENTO SCROLL: Cambiar grosor con la rueda del ratón sobre la línea
                path.addEventListener('wheel', (e: WheelEvent) => {
                    e.preventDefault(); // Evitamos que la pantalla haga zoom
                    e.stopPropagation();

                    // Detectamos si la rueda va arriba o abajo
                    let newThickness = (stitch.thickness || 3) + (e.deltaY > 0 ? -1 : 1);
                    newThickness = Math.max(1, Math.min(newThickness, 15)); // Límite de 1px a 15px

                    stitch.thickness = newThickness;
                    path.setAttribute("stroke-width", newThickness.toString());
                    
                    // Guardamos silenciosamente
                    this.requestSave(); 
                });

                // 🎨 4. EVENTO CLIC: Abrir menú de estilos
                path.addEventListener('click', (e: MouseEvent) => {
                    e.stopPropagation(); // Evitamos que se des-seleccione todo
                    new StitchStyleMenuModal(this.plugin.app, stitch, this).open();
                });

                this.svgOverlay.appendChild(path);

                // 🏷️ DIBUJAR ETIQUETA (Stitch Text)
                if (stitch.label) {
                    const midX = (sX + tX) / 2;
                    const midY = (sY + tY) / 2;

                    const textBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
                    textBg.setAttribute("x", (midX - 30).toString());
                    textBg.setAttribute("y", (midY - 10).toString());
                    textBg.setAttribute("width", "60");
                    textBg.setAttribute("height", "20");
                    textBg.setAttribute("fill", "var(--background-primary)");
                    textBg.setAttribute("rx", "5");

                    const textNode = document.createElementNS("http://www.w3.org/2000/svg", "text");
                    textNode.setAttribute("x", midX.toString());
                    textNode.setAttribute("y", (midY + 4).toString());
                    textNode.setAttribute("fill", "var(--text-muted)");
                    textNode.setAttribute("font-size", "10px");
                    textNode.setAttribute("text-anchor", "middle");
                    textNode.textContent = stitch.label;

                    this.svgOverlay.appendChild(textBg);
                    this.svgOverlay.appendChild(textNode);
                }
            }
        }
    }

    // 🧵 Memoria de Costura (Stitching)
    isStitchingMode: boolean = false;
    sourceStitchId: string | null = null;
    stitchBannerEl!: HTMLElement;
    
    // 🔍 MOTOR DE ZOOM
    zoomLevel: number = 1;

    // 🎨 MOTOR DE DIBUJO LIBRE (SUPER-DOODLE EN EL LIENZO)
    doodleCanvasEl!: HTMLCanvasElement;
    doodleCtx!: CanvasRenderingContext2D;
    currentTool: 'hand' | 'pen' | 'eraser' = 'hand'; 
    currentColor: string = 'smart'; // 🧠 Tinta Inteligente por defecto
    currentPenSize: number = 4;
    isDrawingMode: boolean = false; // Flag maestro para evitar cruces con Drag&Drop
    isDoodling: boolean = false;
    strokePoints: {x: number, y: number}[] = [];
    lastDrawnIndex: number = 1;
    isDrawingFrameScheduled: boolean = false;

    // 🗺️ MOTOR DE PANEO (NAVEGACIÓN)
    isPanning: boolean = false;
    isSpaceDown: boolean = false;
    panStartX: number = 0;
    panStartY: number = 0;
    scrollStartX: number = 0;
    scrollStartY: number = 0;

    // 🔍 LÓGICA DE ZOOM AL CURSOR
    handleZoom(e: WheelEvent) {
        // Solo hacemos zoom si el usuario mantiene presionado Ctrl (Windows) o Cmd (Mac)
        if (!e.ctrlKey && !e.metaKey) return;

        e.preventDefault(); // Bloqueamos el scroll nativo

        const zoomSensitivity = 0.001; 
        const minZoom = 0.1; // 10%
        const maxZoom = 3.0; // 300%
        
        let zoomDelta = -e.deltaY * zoomSensitivity;
        let newZoom = this.zoomLevel * (1 + zoomDelta);
        newZoom = Math.min(Math.max(minZoom, newZoom), maxZoom);

        if (newZoom === this.zoomLevel) return;

        const rect = this.scrollWrapper.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const currentScrollX = this.scrollWrapper.scrollLeft;
        const currentScrollY = this.scrollWrapper.scrollTop;
        
        const canvasMouseX = (currentScrollX + mouseX) / this.zoomLevel;
        const canvasMouseY = (currentScrollY + mouseY) / this.zoomLevel;

        this.zoomLevel = newZoom;
        this.canvasEl.style.transform = `scale(${this.zoomLevel})`;

        this.scrollWrapper.scrollLeft = (canvasMouseX * this.zoomLevel) - mouseX;
        this.scrollWrapper.scrollTop = (canvasMouseY * this.zoomLevel) - mouseY;
    }

    // 🗺️ LÓGICA DE PANEO (ARRASTRAR EL LIENZO) - 🛡️ PARCHE DE FUGA DE MEMORIA
    setupPanning() {
        this.containerEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.code === 'Space' && !this.isSpaceDown) {
                e.preventDefault();
                this.isSpaceDown = true;
                this.canvasEl.style.cursor = 'grab';
            }
        });

        this.containerEl.addEventListener('keyup', (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                this.isSpaceDown = false;
                if (!this.isPanning) this.canvasEl.style.cursor = 'default';
            }
        });

        // Eventos extraídos para poder destruirlos
        const onPanMove = (e: MouseEvent) => {
            if (!this.isPanning) return;
            const dx = e.clientX - this.panStartX;
            const dy = e.clientY - this.panStartY;
            this.scrollWrapper.scrollLeft = this.scrollStartX - dx;
            this.scrollWrapper.scrollTop = this.scrollStartY - dy;
        };

        const onPanUp = (e: MouseEvent) => {
            if (!this.isPanning) return;
            if (e.button === 1 || e.button === 0) {
                this.isPanning = false;
                this.canvasEl.style.cursor = this.isSpaceDown ? 'grab' : 'default';
                // 🛡️ DESTRUIMOS LOS EVENTOS GLOBALES AL SOLTAR EL RATÓN
                document.removeEventListener('mousemove', onPanMove);
                document.removeEventListener('mouseup', onPanUp);
            }
        };

        this.scrollWrapper.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button === 1 || (e.button === 0 && this.isSpaceDown)) {
                e.preventDefault();
                this.isPanning = true;
                this.canvasEl.style.cursor = 'grabbing';
                
                this.panStartX = e.clientX;
                this.panStartY = e.clientY;
                this.scrollStartX = this.scrollWrapper.scrollLeft;
                this.scrollStartY = this.scrollWrapper.scrollTop;

                // 🛡️ CREAMOS LOS EVENTOS GLOBALES SOLO CUANDO HACEMOS CLIC
                document.addEventListener('mousemove', onPanMove);
                document.addEventListener('mouseup', onPanUp);
            }
        });
    }

    // 🔲 LÓGICA DE DIBUJO DEL RECTÁNGULO DE SELECCIÓN
    setupMarqueeSelection() {
        this.canvasEl.addEventListener('mousedown', (e: MouseEvent) => {
            // Solo actuar si hacemos clic en el fondo del lienzo (no en una tarjeta)
            if (e.target !== this.canvasEl && e.target !== this.svgOverlay) return;

            // Si estamos haciendo paneo o usando espacio, NO iniciamos el rectángulo
            if (this.isSpaceDown || e.button === 1) return;

            if (e.button !== 0 || this.isStitchingMode) return; // Solo clic izquierdo

            this.isSelecting = true;
            
            // Si no mantenemos pulsado Shift, limpiamos la selección anterior
            if (!e.shiftKey) this.clearSelection();

            // 🎯 Matemáticas Anti-Zoom: Dónde empezó el clic en el mundo real del canvas
            const rect = this.scrollWrapper.getBoundingClientRect();
            this.selectStartX = (e.clientX - rect.left + this.scrollWrapper.scrollLeft) / this.zoomLevel;
            this.selectStartY = (e.clientY - rect.top + this.scrollWrapper.scrollTop) / this.zoomLevel;

            this.selectionBoxEl.style.left = `${this.selectStartX}px`;
            this.selectionBoxEl.style.top = `${this.selectStartY}px`;
            this.selectionBoxEl.style.width = '0px';
            this.selectionBoxEl.style.height = '0px';
            this.selectionBoxEl.style.display = 'block';
        });

        this.canvasEl.addEventListener('mousemove', (e: MouseEvent) => {
            if (!this.isSelecting) return;

            const rect = this.scrollWrapper.getBoundingClientRect();
            const currentX = (e.clientX - rect.left + this.scrollWrapper.scrollLeft) / this.zoomLevel;
            const currentY = (e.clientY - rect.top + this.scrollWrapper.scrollTop) / this.zoomLevel;

            const left = Math.min(this.selectStartX, currentX);
            const top = Math.min(this.selectStartY, currentY);
            const width = Math.abs(currentX - this.selectStartX);
            const height = Math.abs(currentY - this.selectStartY);

            this.selectionBoxEl.style.left = `${left}px`;
            this.selectionBoxEl.style.top = `${top}px`;
            this.selectionBoxEl.style.width = `${width}px`;
            this.selectionBoxEl.style.height = `${height}px`;
        });

        this.canvasEl.addEventListener('mouseup', () => {
            if (!this.isSelecting) return;
            this.isSelecting = false;
            this.selectionBoxEl.style.display = 'none';

            // Evitamos selecciones fantasma si fue solo un clic normal al fondo
            if (parseFloat(this.selectionBoxEl.style.width) < 5) return;

            // 💥 CALCULAR COLISIONES (AABB Bounding Box)
            const box = {
                left: parseFloat(this.selectionBoxEl.style.left),
                top: parseFloat(this.selectionBoxEl.style.top),
                right: parseFloat(this.selectionBoxEl.style.left) + parseFloat(this.selectionBoxEl.style.width),
                bottom: parseFloat(this.selectionBoxEl.style.top) + parseFloat(this.selectionBoxEl.style.height)
            };

            const nodes = this.canvasEl.querySelectorAll('.cornell-pinboard-node');
            
            // 👇 SOLUCIÓN TYPESCRIPT: Recibimos un 'Element' y lo casteamos a 'HTMLElement'
            nodes.forEach((el: Element) => {
                const node = el as HTMLElement; 
                
                const n = {
                    left: node.offsetLeft, top: node.offsetTop,
                    right: node.offsetLeft + node.offsetWidth, bottom: node.offsetTop + node.offsetHeight
                };

                // Si se tocan, lo añadimos al grupo
                if (!(box.right < n.left || box.left > n.right || box.bottom < n.top || box.top > n.bottom)) {
                    this.selectNode(node.id, node);
                }
            });
        });
    }

    clearSelection() {
        this.selectedNodes.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.boxShadow = '0 4px 10px rgba(0,0,0,0.15)'; // Sombra original
        });
        this.selectedNodes.clear();
    }

    // ⌨️ MOTOR DE ATAJOS DE TECLADO
    setupKeyboardShortcuts() {
        // 1. Hacemos que la vista completa sea enfocable (focusable)
        this.containerEl.tabIndex = -1;
        
        // 2. Al hacer clic en el fondo del lienzo, aseguramos que la vista gane el foco
        this.canvasEl.addEventListener('mousedown', () => {
            this.containerEl.focus();
        });

        // 3. Escuchamos el teclado a nivel de la vista
        this.containerEl.addEventListener('keydown', (e: KeyboardEvent) => {
            // 🛡️ ESCUDO: No borrar si estamos escribiendo en un input real
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.selectedNodes.size === 0) return;

                e.preventDefault();
                e.stopPropagation(); // 🛡️ Evita que Obsidian use la tecla para otra cosa (ej. ir atrás)

                const count = this.selectedNodes.size;

                this.selectedNodes.forEach(nodeId => {
                    // A. Destruir el elemento físico
                    const nodeEl = document.getElementById(nodeId);
                    if (nodeEl) nodeEl.remove();

                    // B. Borrar de la memoria principal
                    delete this.canvasData.nodes[nodeId];

                    // C. Destruir las flechas conectadas
                    this.canvasData.stitches = this.canvasData.stitches.filter((s: any) => 
                        s.sourceId !== nodeId && s.targetId !== nodeId
                    );
                });

                // D. Limpiar y guardar
                this.selectedNodes.clear();
                this.requestSave();
                this.redrawLines();

                new Notice(`🗑️ ${count} elemento(s) eliminado(s).`);
            }
        });
    }

    selectNode(id: string, el: HTMLElement) {
        this.selectedNodes.add(id);
        el.style.boxShadow = '0 0 0 4px var(--color-blue)'; // Resplandor de selección
    }

    // 🔲 MOTOR DE SELECCIÓN MÚLTIPLE
    selectionBoxEl!: HTMLElement;
    isSelecting: boolean = false;
    selectStartX: number = 0;
    selectStartY: number = 0;
    selectedNodes: Set<string> = new Set(); // Guarda los IDs de las tarjetas seleccionadas

    // 🛸 MOTOR DE DRAG & DROP
    setupDropZone() {
        this.canvasEl.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault(); // 🛡️ Vital: sin esto, no se puede soltar
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });

        this.canvasEl.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            
            // @ts-ignore
            const payload = window.OmniDragManager?.payload;
            if (!payload) return;

            const rect = this.canvasEl.getBoundingClientRect();
            const dropX = e.clientX - rect.left;
            const dropY = e.clientY - rect.top;

            // 🌟 MODO GRUPO / HILO (Cajas Padre)
            if (payload.type === 'group') {
                
                // 1. Crear Nodo Padre
                const parentId = `group-${Date.now()}`;
                const parentItem = {
                    text: `# ${payload.title}`, // Formato de título
                    color: 'var(--interactive-accent)',
                    file: null
                };
                this.saveNodeToSettings(parentId, parentItem, dropX, dropY);
                this.drawNode(parentId, parentItem, dropX, dropY);

                // Mapa para recordar qué BlockId de Obsidian se convirtió en qué NodeId del Canvas
                const idTranslationMap = new Map<string, string>();

                // 2. Desplegar los Hijos
                payload.items.forEach((childItem: any, index: number) => {
                    const childNodeId = `pin-${Date.now()}-${index}`;
                    
                    // Si la nota tiene blockId nativo, lo guardamos en el traductor
                    if (childItem.blockId) {
                        idTranslationMap.set(childItem.blockId, childNodeId);
                    }

                    // Matemáticas para acomodar a los hijos (Columna a la derecha del padre)
                    const childX = dropX + 280; 
                    const childY = dropY + (index * 130);

                    this.saveNodeToSettings(childNodeId, childItem, childX, childY);
                    this.drawNode(childNodeId, childItem, childX, childY);

                    // 3. Coser Hijo al Padre
                    this.canvasData.stitches.push({
                        sourceId: parentId,
                        targetId: childNodeId,
                        label: "Incluye"
                    });
                });

                // 4. 🧠 RECONSTRUCCIÓN SEMÁNTICA (El cerebro de las flechas)
                payload.items.forEach((childItem: any) => {
                    if (childItem.semanticStitches && childItem.blockId) {
                        const sourceNodeId = idTranslationMap.get(childItem.blockId);
                        
                        childItem.semanticStitches.forEach((stitch: any) => {
                            // El stitch.target viene como "[[Nota#^u9h2aj]]". Extraemos el ID.
                            const match = stitch.target.match(/#\\^([a-zA-Z0-9]+)/);
                            if (match && sourceNodeId) {
                                const targetBlockId = match[1];
                                const targetNodeId = idTranslationMap.get(targetBlockId);
                                
                                // Si el destino también se materializó en este grupo, los conectamos
                                if (targetNodeId) {
                                    this.canvasData.stitches.push({
                                        sourceId: sourceNodeId,
                                        targetId: targetNodeId,
                                        label: stitch.reason // Ej: "miden lo mismo"
                                    });
                                }
                            }
                        });
                    }
                });

                this.requestSave();
                this.redrawLines();
                new Notice(`📦 Grupo '${payload.title}' materializado con sus hilos.`);

            } else {
                // 🌟 MODO NOTA INDIVIDUAL (Lo que ya tenías)
                const nodeId = `pin-${Date.now()}`;
                this.saveNodeToSettings(nodeId, payload, dropX, dropY);
                this.drawNode(nodeId, payload, dropX, dropY);
                new Notice("📌 ¡Marginalia materializada!");
            }
        });
    }

    // 🎨 RENDERIZADO FÍSICO DE LA TARJETA
    drawNode(nodeId: string, item: any, x: number, y: number) {

        const existingNode = this.canvasEl.querySelector(`#${nodeId}`) as HTMLElement;
        if (existingNode) {
            // Si la tarjeta ya existe en el lienzo, abortamos su creación.
            // Solo actualizamos su posición (útil para cuando sincronizas entre dispositivos)
            if (existingNode.style.cursor !== 'grabbing') {
                existingNode.style.left = `${x}px`;
                existingNode.style.top = `${y}px`;
            }
            return; 
        }

        const node = this.canvasEl.createDiv({ cls: 'cornell-pinboard-node' });
        node.id = nodeId;
        node.style.position = 'absolute';
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        node.style.minWidth = '300px';    // Tamaño mínimo para notas de texto
        node.style.width = 'fit-content'; // 👈 MAGIA: Crece para ajustarse a su contenido (el PDF)
        node.style.maxWidth = '800px';    // Límite máximo para que textos muy largos no crucen toda la pantalla
        node.style.padding = '12px';
        node.style.backgroundColor = 'var(--background-primary)'; 
        node.style.border = '1px solid var(--background-modifier-border)';
        node.style.borderLeft = `4px solid ${item.color || 'var(--text-accent)'}`;
        node.style.borderRadius = '6px';
        node.style.boxShadow = '0 4px 10px rgba(0,0,0,0.15)';
        node.style.zIndex = '10';
        
        const markdownContainer = node.createDiv({ cls: 'cornell-pinboard-markdown markdown-rendered markdown-preview-view markdown-reading-view' });
        markdownContainer.style.maxHeight = '400px'; 
        markdownContainer.style.overflowY = 'auto';
        markdownContainer.style.overflowX = 'hidden';
        
        // 🔮 MAGIA 1: Limpiamos los comentarios %% para aislar el enlace de PDF++
        let cleanText = (item.text || "").replace(/%%[\s\S]*?%%/g, '').trim();
        cleanText += "\n"; // Forzamos un salto de línea para que Obsidian procese bien los bloques

        // 🔮 MAGIA 2: Usamos la API Moderna de Obsidian. 
        // Pasamos 'this' (la vista entera) para que PDF++ sepa que debe inyectar la imagen
        MarkdownRenderer.render(
            this.plugin.app,
            cleanText,
            markdownContainer,
            item.file?.path || "",
            this
        ).then(() => {
            // Parche CSS para asegurar que los recortes grandes no rompan la tarjeta
            setTimeout(() => {
                markdownContainer.querySelectorAll('img, .pdf-cropped-embed, .internal-embed').forEach(el => {
                    const htmlEl = el as HTMLElement;
                    htmlEl.style.maxWidth = '750px';
                    htmlEl.style.height = 'auto';
                    htmlEl.style.borderRadius = '4px';
                    htmlEl.style.display = 'block';
                });
            }, 100);
        });

        // --- Metadatos y Modo Edición ---
        if (item.file) {
            const meta = node.createDiv({ text: `📄 ${item.file.basename}` });
            meta.style.fontSize = '0.8em';
            meta.style.color = 'var(--text-muted)';
            meta.style.marginTop = '8px';
            meta.style.borderTop = '1px dashed var(--background-modifier-border)';
            meta.style.paddingTop = '4px';
        } else if (item.isCustomText) {
            const meta = node.createDiv({ text: `✏️ Doble clic para editar` });
            meta.style.fontSize = '0.8em';
            meta.style.color = 'var(--text-muted)';
            meta.style.marginTop = '8px';
            meta.style.borderTop = '1px dashed var(--background-modifier-border)';
            meta.style.paddingTop = '4px';

            // ✏️ LÓGICA DE DOBLE CLIC PARA EDITAR
            node.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (node.querySelector('textarea')) return; // Ya estamos editando

                markdownContainer.style.display = 'none'; // Ocultamos el markdown renderizado
                
                const textarea = node.createEl('textarea');
                textarea.value = item.text || "";
                textarea.style.width = '100%';
                textarea.style.minHeight = '150px';
                textarea.style.background = 'transparent';
                textarea.style.color = 'var(--text-normal)';
                textarea.style.border = '1px solid var(--interactive-accent)';
                textarea.style.borderRadius = '4px';
                textarea.style.padding = '8px';
                textarea.style.resize = 'vertical';
                textarea.style.fontFamily = 'inherit';
                textarea.style.fontSize = 'inherit';
                
                textarea.focus();

                const saveEdit = () => {
                    const newText = textarea.value;
                    item.text = newText;
                    
                    if (this.canvasData.nodes[nodeId]) {
                        this.canvasData.nodes[nodeId].text = newText;
                        this.requestSave(); // Guardar en el disco
                    }

                    textarea.remove();
                    markdownContainer.style.display = 'block';
                    markdownContainer.empty();
                    
                    // Volver a renderizar como Markdown
                    MarkdownRenderer.render(this.plugin.app, newText + "\n", markdownContainer, "", this);
                };

                // Guardar al hacer clic fuera o presionar Ctrl+Enter
                textarea.addEventListener('blur', saveEdit);
                textarea.addEventListener('keydown', (evt) => {
                    if (evt.key === 'Enter' && (evt.ctrlKey || evt.metaKey)) {
                        evt.preventDefault();
                        saveEdit();
                    }
                });
            });
        }

        // --- 🕹️ FÍSICA DE MOVIMIENTO EN GRUPO (MULTI-DRAG) ---
        node.style.cursor = 'grab';
        let isDragging = false;
        let startX = 0, startY = 0;
        
        // Memoria temporal para mover a todos los seleccionados juntos
        let draggedNodesData = new Map<string, { initialLeft: number, initialTop: number, el: HTMLElement }>();
        let animationFrameId: number | null = null; 

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            
            // 🎯 Matemáticas: Mover el ratón 10px con zoom x2 equivale a mover el canvas 5px.
            const dx = (e.clientX - startX) / this.zoomLevel;
            const dy = (e.clientY - startY) / this.zoomLevel;
            
            if (!animationFrameId) {
                animationFrameId = requestAnimationFrame(() => {
                    // Mover TODAS las tarjetas en la selección usando GPU
                    draggedNodesData.forEach(data => {
                        data.el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
                    });
                    animationFrameId = null;
                });
            }
        };

        const onMouseUp = (e: MouseEvent) => {
            if (!isDragging) return;
            isDragging = false;
            
            const dx = (e.clientX - startX) / this.zoomLevel;
            const dy = (e.clientY - startY) / this.zoomLevel;

            draggedNodesData.forEach((data, id) => {
                const finalLeft = data.initialLeft + dx;
                const finalTop = data.initialTop + dy;

                data.el.style.transform = 'none';
                data.el.style.left = `${finalLeft}px`;
                data.el.style.top = `${finalTop}px`;
                data.el.style.zIndex = '10';
                data.el.style.willChange = 'auto'; 
                
                const mdContainer = data.el.querySelector('.markdown-rendered') as HTMLElement;
                if(mdContainer) mdContainer.style.pointerEvents = 'auto'; 

                // Guardar nuevas posiciones
                if (this.canvasData.nodes[id]) {
                    this.canvasData.nodes[id].x = finalLeft;
                    this.canvasData.nodes[id].y = finalTop;
                }
            });

            this.requestSave();
            this.redrawLines();

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        node.addEventListener('mousedown', (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('button, a, .internal-link, .internal-embed, .pdf-embed, .pdf-cropped-embed, img')) return;
            
            //  ESCUDO: No permitir arrastrar la tarjeta si estamos navegando con Espacio o Clic central
            if (this.isSpaceDown || e.button === 1) return;

            e.stopPropagation();

            // 👇 NUEVO: Forzamos el foco en el contenedor general para "encender" el teclado
            this.containerEl.focus();
            
            // 1. Si la nota NO estaba seleccionada, limpiamos el resto y la seleccionamos sola.
            if (!this.selectedNodes.has(nodeId)) {
                if (!e.shiftKey) this.clearSelection();
                this.selectNode(nodeId, node);
            }

            // 2. Preparar el arrastre de TODAS las seleccionadas
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            draggedNodesData.clear();

            this.selectedNodes.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    draggedNodesData.set(id, {
                        initialLeft: parseInt(el.style.left, 10) || 0,
                        initialTop: parseInt(el.style.top, 10) || 0,
                        el: el
                    });
                    el.style.zIndex = '100'; 
                    el.style.willChange = 'transform';
                    
                    const mdContainer = el.querySelector('.markdown-rendered') as HTMLElement;
                    if(mdContainer) mdContainer.style.pointerEvents = 'none';
                }
            });
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        // --- 🛠️ BOTONERA RESTAURADA (Con iconos reales) ---
        const actionsDiv = node.createDiv();
        actionsDiv.style.position = 'absolute';
        actionsDiv.style.bottom = '8px';
        actionsDiv.style.right = '8px';
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '4px';
        actionsDiv.style.zIndex = '20'; 

        // Botón Borrar
        const delBtn = actionsDiv.createEl('button', { title: "Remove from Canvas" });
        setIcon(delBtn, 'trash'); 
        this.styleMiniButton(delBtn, 'var(--text-muted)');
        delBtn.onclick = (e) => {
            e.stopPropagation();
            node.remove();
            delete this.canvasData.nodes[nodeId];
            this.canvasData.stitches = this.canvasData.stitches.filter((s: any) => s.sourceId !== nodeId && s.targetId !== nodeId);
            this.requestSave();
            this.redrawLines();
        };

        // Botón Conectar (Stitch)
        const stitchBtn = actionsDiv.createEl('button', { title: "Connect to another note" });
        setIcon(stitchBtn, 'link'); 
        this.styleMiniButton(stitchBtn, 'var(--color-blue)'); 
        stitchBtn.onclick = (e) => {
            e.stopPropagation();
            this.handleStitchClick(nodeId, node);
        };

        // Botón Expandir (Contexto)
        const expandBtn = actionsDiv.createEl('button', { title: "Expand Context" });
        setIcon(expandBtn, 'quote'); 
        this.styleMiniButton(expandBtn, 'var(--color-purple)');
        expandBtn.onclick = (e) => {
            e.stopPropagation();
            
            if (!item.context) {
                new Notice("No hay contexto adicional para esta nota.");
                return;
            }

            const currentX = parseInt(node.style.left, 10);
            const currentY = parseInt(node.style.top, 10);
            const contextX = currentX + 340; 
            const contextY = currentY;
            const contextNodeId = `ctx-${Date.now()}`;

            let formattedContext = item.context.trim();
            // Agregamos la cita sin romper enlaces multilínea
            if (!formattedContext.startsWith('>')) {
                formattedContext = formattedContext.split('\n').map((l: string) => `> ${l}`).join('\n');
            }

            const contextItem = {
                text: formattedContext, 
                color: 'var(--text-muted)',
                file: item.file, 
                line: item.line,
                context: null 
            };

            this.saveNodeToSettings(contextNodeId, contextItem, contextX, contextY);
            this.drawNode(contextNodeId, contextItem, contextX, contextY);

            if (!this.canvasData.stitches) this.canvasData.stitches = [];
            this.canvasData.stitches.push({
                sourceId: nodeId,
                targetId: contextNodeId,
                label: "Contexto"
            });
            
            this.requestSave();
            this.redrawLines();
        };
    }

    // ======================================================
    // ⛓️ LÓGICA DE CONEXIÓN (STITCHING)
    // ======================================================
    handleStitchClick(nodeId: string, nodeEl: HTMLElement) {
        if (!this.isStitchingMode) {
            // 📍 FASE 1: Seleccionar Origen
            this.isStitchingMode = true;
            this.sourceStitchId = nodeId;
            
            // Efecto visual en la tarjeta origen
            nodeEl.style.boxShadow = '0 0 0 4px var(--color-blue)';
            nodeEl.classList.add('is-stitching-source');

            // Mostrar Banner
            this.stitchBannerEl.style.display = 'flex';
            this.stitchBannerEl.style.backgroundColor = 'var(--color-blue)';
            this.stitchBannerEl.style.color = 'white';
            this.stitchBannerEl.innerHTML = `<span>⛓️ Paso 2: Haz clic en la nota de DESTINO (Clic en el fondo para cancelar)</span>`;
            
        } else {
            // 📍 FASE 2: Seleccionar Destino
            if (this.sourceStitchId === nodeId) {
                new Notice("⚠️ No puedes conectar una nota consigo misma.");
                this.cancelStitch();
                return;
            }

            const targetId = nodeId;
            const sourceId = this.sourceStitchId;

            // Abrimos el Modal para preguntar la razón
            new StitchLabelModal(this.plugin.app, (label) => {
                // Aseguramos que exista el array
                if (!this.canvasData.stitches) {
                    this.canvasData.stitches = [];
                }
                
                // Guardamos la conexión
                this.canvasData.stitches.push({
                    sourceId: sourceId,
                    targetId: targetId,
                    label: label
                });
                
                this.requestSave();
                this.redrawLines(); // 🎨 Dibujamos la flecha inmediatamente
                this.cancelStitch(); // Limpiamos la UI
                new Notice("✨ ¡Conexión establecida!");
                
            }).open();
        }
    }

    cancelStitch() {
        this.isStitchingMode = false;
        this.sourceStitchId = null;
        this.stitchBannerEl.style.display = 'none';
        
        // Quitamos el aura azul de la tarjeta origen
        const sourceNode = this.canvasEl.querySelector('.is-stitching-source') as HTMLElement;
        if (sourceNode) {
            sourceNode.style.boxShadow = '0 4px 10px rgba(0,0,0,0.15)'; // Restauramos sombra original
            sourceNode.classList.remove('is-stitching-source');
        }
    }

    styleMiniButton(btn: HTMLElement, color: string) {
        btn.style.width = '24px';
        btn.style.height = '24px';
        btn.style.padding = '4px';
        btn.style.borderRadius = '50%';
        btn.style.backgroundColor = 'var(--background-primary)';
        btn.style.border = `1px solid ${color}`;
        btn.style.color = color;
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    }

    // 💾 MEMORIA PERSISTENTE
    saveNodeToSettings(nodeId: string, item: any, x: number, y: number) {
        if (!this.canvasData.nodes) this.canvasData.nodes = {};
        
        this.canvasData.nodes[nodeId] = {
            id: nodeId,
            x: x,
            y: y,
            text: item.text,
            color: item.color,
            filePath: item.file ? item.file.path : null,
            line: item.line,
            context: item.context,
            isCustomText: item.isCustomText // 👈 VITAL: Recordar que es una nota libre
        };
        
        this.requestSave();
    }

    async renderSavedNodes() {
        if (!this.canvasData.nodes) return;
        
        const nodes = this.canvasData.nodes;
        for (const key in nodes) {
            const n = nodes[key];
            
            let fileObj = null;
            if (n.filePath) {
                fileObj = this.plugin.app.vault.getAbstractFileByPath(n.filePath);
            }

            const mockItem = {
                text: n.text,
                color: n.color,
                file: fileObj,
                line: n.line,
                context: n.context,
                isCustomText: n.isCustomText // 👈 Cargamos si es nota libre
            };

            this.drawNode(n.id, mockItem, n.x, n.y);
        }
    }
    // ======================================================
    // 📝 MOTOR DE TARJETAS DE TEXTO LIBRES (POST-ITS)
    // ======================================================
    addCustomTextNode(x: number, y: number) {
        const nodeId = `text-${Date.now()}`;
        const item = {
            text: "Haz doble clic para editar...",
            color: "var(--color-yellow)", // Color Post-it por defecto
            file: null,
            isCustomText: true
        };
        
        this.saveNodeToSettings(nodeId, item, x, y);
        this.drawNode(nodeId, item, x, y);
        new Notice("📝 Tarjeta de texto añadida");
    }
    // ======================================================
    // 🎨 MOTOR CORE DE DIBUJO Y GOMA (Acelerado por GPU + Cero Lag)
    // ======================================================
    saveDoodleTimeout: any = null; // Variable para el Anti-Freeze

    setupDoodleEngine() {
        let cachedRect: DOMRect | null = null; // 🚀 MEMORIA CACHÉ PARA EVITAR LAYOUT THRASHING

        const getPointerPos = (e: PointerEvent) => {
            // Si tenemos el rect en memoria, lo usamos. Es 1000x más rápido que recalcular.
            const rect = cachedRect || this.canvasEl.getBoundingClientRect();
            return { 
                x: (e.clientX - rect.left) / this.zoomLevel, 
                y: (e.clientY - rect.top) / this.zoomLevel 
            };
        };

        const commitStroke = () => {
            if (!this.isDoodling) return;
            
            if (this.strokePoints.length > this.lastDrawnIndex) {
                this.doodleCtx.beginPath();
                const p1 = this.strokePoints[this.lastDrawnIndex - 1];
                const p2 = this.strokePoints[this.lastDrawnIndex];
                const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                this.doodleCtx.moveTo(mid.x, mid.y);
                for (let i = this.lastDrawnIndex + 1; i < this.strokePoints.length; i++) {
                    const pt2 = this.strokePoints[i - 1];
                    const pt3 = this.strokePoints[i];
                    const mid_next = { x: (pt2.x + pt3.x) / 2, y: (pt2.y + pt3.y) / 2 };
                    this.doodleCtx.quadraticCurveTo(pt2.x, pt2.y, mid_next.x, mid_next.y);
                }
                this.doodleCtx.stroke();
            }
            
            this.isDoodling = false;
            this.strokePoints = [];
            this.lastDrawnIndex = 1;
            cachedRect = null; // Limpiamos la caché geométrica
            
            // 🚀 GUARDADO DIFERIDO (DEBOUNCE ANTI-FREEZE)
            // Codificar 5000x5000 px tarda milisegundos preciosos. 
            // Esperamos a que lleves 1 segundo sin dibujar para guardar, evitando tirones.
            if (this.saveDoodleTimeout) clearTimeout(this.saveDoodleTimeout);
            this.saveDoodleTimeout = setTimeout(() => {
                this.canvasData.doodleDataUrl = this.doodleCanvasEl.toDataURL("image/png");
                this.requestSave();
            }, 1000); 
        };

        this.doodleCanvasEl.addEventListener("pointerdown", (e: PointerEvent) => {
            if (this.currentTool === 'hand' || e.button !== 0) return;
            
            this.doodleCanvasEl.setPointerCapture(e.pointerId);
            this.isDoodling = true;
            
            // 🚀 Guardamos las coordenadas una sola vez al tocar la pantalla
            cachedRect = this.canvasEl.getBoundingClientRect(); 
            
            const isEraser = this.currentTool === 'eraser';
            this.doodleCtx.lineWidth = isEraser ? this.currentPenSize * 4 : this.currentPenSize;
            
            if (isEraser) {
                this.doodleCtx.globalCompositeOperation = "destination-out";
                this.doodleCtx.strokeStyle = "rgba(0,0,0,1)";
            } else {
                this.doodleCtx.globalCompositeOperation = "source-over";
                if (this.currentColor === 'smart') {
                    this.doodleCtx.strokeStyle = document.body.classList.contains('theme-dark') ? '#ffffff' : '#000000';
                } else {
                    this.doodleCtx.strokeStyle = this.currentColor;
                }
            }

            const pos = getPointerPos(e);
            this.strokePoints = [pos, pos];
            this.lastDrawnIndex = 1;

            this.doodleCtx.fillStyle = this.doodleCtx.strokeStyle;
            this.doodleCtx.beginPath();
            this.doodleCtx.arc(pos.x, pos.y, this.doodleCtx.lineWidth / 2, 0, Math.PI * 2);
            this.doodleCtx.fill();
        });

        this.doodleCanvasEl.addEventListener("pointermove", (e: PointerEvent) => {
            if (!this.isDoodling) return;

            const coalescedEvents = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
            for (const ev of coalescedEvents) {
                this.strokePoints.push(getPointerPos(ev));
            }

            if (!this.isDrawingFrameScheduled) {
                this.isDrawingFrameScheduled = true;
                requestAnimationFrame(() => {
                    this.isDrawingFrameScheduled = false;
                    
                    if (this.isDoodling && this.strokePoints.length > this.lastDrawnIndex) {
                        this.doodleCtx.beginPath();
                        
                        const p1 = this.strokePoints[this.lastDrawnIndex - 1];
                        const p2 = this.strokePoints[this.lastDrawnIndex];
                        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                        
                        this.doodleCtx.moveTo(mid.x, mid.y);

                        for (let i = this.lastDrawnIndex + 1; i < this.strokePoints.length; i++) {
                            const pt2 = this.strokePoints[i - 1];
                            const pt3 = this.strokePoints[i];
                            const mid_next = { x: (pt2.x + pt3.x) / 2, y: (pt2.y + pt3.y) / 2 };
                            this.doodleCtx.quadraticCurveTo(pt2.x, pt2.y, mid_next.x, mid_next.y);
                        }
                        
                        this.doodleCtx.stroke();
                        this.lastDrawnIndex = this.strokePoints.length - 1; 
                    }
                });
            }
        });

        this.doodleCanvasEl.addEventListener("pointerup", (e: PointerEvent) => {
            this.doodleCanvasEl.releasePointerCapture(e.pointerId);
            commitStroke();
        });

        window.addEventListener('blur', () => { if (this.isDoodling) commitStroke(); });
    }
    // ======================================================
    // 🧠 MOTOR DE TINTA INTELIGENTE (Procesamiento de Píxeles)
    // ======================================================
    applySmartInk() {
        if (!this.doodleCtx || !this.doodleCanvasEl) return;
        
        const isDark = document.body.classList.contains('theme-dark');
        const imgData = this.doodleCtx.getImageData(0, 0, this.doodleCanvasEl.width, this.doodleCanvasEl.height);
        const data = imgData.data;
        let modified = false;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
            if (a === 0) continue; // Ignoramos píxeles totalmente transparentes
            
            // Detectamos si el píxel es blanco, negro o gris
            const isGrayscale = Math.abs(r - g) < 20 && Math.abs(g - b) < 20;
            
            if (isGrayscale) {
                const brightness = (r + g + b) / 3;
                
                // Si estamos en Tema Oscuro y el trazo es Negro (lo invertimos a Blanco)
                if (isDark && brightness < 100) { 
                    data[i] = 255 - r; data[i+1] = 255 - g; data[i+2] = 255 - b;
                    modified = true;
                } 
                // Si estamos en Tema Claro y el trazo es Blanco (lo invertimos a Negro)
                else if (!isDark && brightness > 150) { 
                    data[i] = 255 - r; data[i+1] = 255 - g; data[i+2] = 255 - b;
                    modified = true;
                }
            }
        }
        
        if (modified) {
            this.doodleCtx.putImageData(imgData, 0, 0);
            this.canvasData.doodleDataUrl = this.doodleCanvasEl.toDataURL("image/png");
            this.requestSave(); // Guardamos el nuevo archivo con los colores corregidos
        }
    }
    // ======================================================
    // 📸 UTILIDAD: Convertidor de Imagen a Archivo Físico
    // ======================================================
    private base64ToArrayBuffer(base64: string) {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
    // ======================================================
    // 📸 MOTOR DE EXPORTACIÓN A IMAGEN (Cero Dependencias)
    // ======================================================
    async exportToImage() {
        const notice = new Notice("📸 Revelando fotografía del lienzo... esto puede tardar un momento.", 0);
        
        try {
            // 1. Encontrar los límites geográficos de todo lo que has dibujado/puesto
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            const nodes = Array.from(this.canvasEl.querySelectorAll('.cornell-pinboard-node')) as HTMLElement[];
            
            nodes.forEach(n => {
                minX = Math.min(minX, n.offsetLeft);
                minY = Math.min(minY, n.offsetTop);
                maxX = Math.max(maxX, n.offsetLeft + n.offsetWidth);
                maxY = Math.max(maxY, n.offsetTop + n.offsetHeight);
            });

            // Si solo hay un dibujo sin tarjetas, usamos un área por defecto
            if (minX === Infinity) { minX = 0; minY = 0; maxX = 2500; maxY = 2500; }

            // Le damos un "margen" o padding para que la foto respire
            const padding = 100;
            minX = Math.max(0, minX - padding);
            minY = Math.max(0, minY - padding);
            maxX += padding;
            maxY += padding;
            
            const exportWidth = maxX - minX;
            const exportHeight = maxY - minY;

            // 2. Crear la película fotográfica (Lienzo virtual)
            const finalCanvas = document.createElement("canvas");
            finalCanvas.width = exportWidth;
            finalCanvas.height = exportHeight;
            const ctx = finalCanvas.getContext("2d")!;

            // 3. Pintar el fondo dinámico según el tema de Obsidian
            ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--background-primary-alt').trim() || '#1e1e1e';
            ctx.fillRect(0, 0, exportWidth, exportHeight);

            // 4. Inyectar el dibujo libre (Doodle)
            if (this.doodleCanvasEl) {
                // Como las coordenadas del doodle siempre parten de 0,0, restamos los márgenes de la cámara
                ctx.drawImage(this.doodleCanvasEl, -minX, -minY);
            }

            // 5. Inyectar las flechas (SVG)
            // 5. Dibujar las flechas matemáticamente directo en el Canvas (Cero fallos)
            const stitches = this.canvasData.stitches || [];
            stitches.forEach(stitch => {
                const sourceNode = document.getElementById(stitch.sourceId);
                const targetNode = document.getElementById(stitch.targetId);

                if (sourceNode && targetNode) {
                    // Matemáticas compensando el encuadre de la cámara (- minX, - minY)
                    const sX = sourceNode.offsetLeft + (sourceNode.offsetWidth / 2) - minX;
                    const sY = sourceNode.offsetTop + (sourceNode.offsetHeight / 2) - minY;
                    const tX = targetNode.offsetLeft + (targetNode.offsetWidth / 2) - minX;
                    const tY = targetNode.offsetTop + (targetNode.offsetHeight / 2) - minY;

                    const distanceX = Math.abs(tX - sX);
                    const controlPointOffset = Math.max(50, distanceX * 0.3);

                    ctx.beginPath();
                    ctx.moveTo(sX, sY);
                    ctx.bezierCurveTo(
                        sX + controlPointOffset, sY,
                        tX - controlPointOffset, tY,
                        tX, tY
                    );

                    // 🧠 Inteligencia: Traducir variables CSS a colores reales Hex/RGB para la cámara
                    let strokeColor = stitch.color || "var(--interactive-accent)";
                    if (strokeColor.includes('var(')) {
                        const varMatch = strokeColor.match(/var\((.*?)\)/);
                        if (varMatch) {
                            strokeColor = getComputedStyle(document.body).getPropertyValue(varMatch[1]).trim() || '#a277ff';
                        }
                    }

                    ctx.strokeStyle = strokeColor;
                    ctx.lineWidth = stitch.thickness || 3;

                    // Procesar estilo punteado o continuo
                    if (stitch.dasharray && stitch.dasharray !== "none") {
                        const dashValues = stitch.dasharray.split(',').map(Number);
                        ctx.setLineDash(dashValues);
                    } else {
                        ctx.setLineDash([]);
                    }

                    ctx.stroke();
                    ctx.setLineDash([]); // Resetear para no afectar otras cosas
                    
                    // Si la flecha tiene etiqueta de texto, la dibujamos en el centro
                    if (stitch.label) {
                        const midX = (sX + tX) / 2;
                        const midY = (sY + tY) / 2;
                        
                        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || '#2d2d2d';
                        // Simulamos el rectangulito de fondo
                        ctx.fillRect(midX - 30, midY - 10, 60, 20);
                        
                        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#aaaaaa';
                        ctx.font = "10px sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText(stitch.label, midX, midY); 
                    }
                }
            });
            // 6. Inyectar las Tarjetas (Versión Plano / Blueprint)
            nodes.forEach(n => {
                const x = n.offsetLeft - minX;
                const y = n.offsetTop - minY;
                const w = n.offsetWidth;
                const h = n.offsetHeight;

                // Sombra y fondo de tarjeta
                ctx.shadowColor = "rgba(0,0,0,0.2)";
                ctx.shadowBlur = 10;
                ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--background-primary').trim() || '#2d2d2d';
                ctx.fillRect(x, y, w, h);
                ctx.shadowBlur = 0; // Apagar sombra
                
                // Borde de color de la tarjeta (Toma el color de la marginalia real)
                ctx.strokeStyle = n.style.borderLeftColor || '#a277ff';
                ctx.lineWidth = 6;
                ctx.strokeRect(x, y, w, h);

                // Texto Preview
                ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#aaaaaa';
                ctx.font = "14px sans-serif";
                ctx.textBaseline = "top";
                
                // Extraemos un resumen del texto para la foto
                // --- 🧠 MOTOR DE AJUSTE DE TEXTO INTELIGENTE ---
                // Apuntamos la cámara SOLO al texto real, ignorando el metadato 📄 del archivo y los botones
                const markdownEl = n.querySelector('.cornell-pinboard-markdown') as HTMLElement;
                const rawText = markdownEl ? markdownEl.innerText.trim() : n.innerText.trim();
                const paddingLeft = 20;
                const paddingRight = 20;
                const maxWidthText = w - (paddingLeft + paddingRight); // Ancho útil para el texto
                const lineHeight = 22;
                let textY = y + 25; // Punto de partida vertical

                // Separamos por párrafos reales primero (\n)
                const paragraphs = rawText.split('\n');
                let linesDrawn = 0;
                const maxLinesInPhoto = 14; // Límite de líneas por tarjeta en la foto

                ctx.textAlign = "left"; // Aseguramos alineación izquierda

                for (let i = 0; i < paragraphs.length; i++) {
                    if (linesDrawn >= maxLinesInPhoto) break;

                    const words = paragraphs[i].split(' ');
                    let currentLine = '';

                    for (let n = 0; n < words.length; n++) {
                        if (linesDrawn >= maxLinesInPhoto) break;

                        // Probamos añadir la siguiente palabra
                        const testLine = currentLine + words[n] + ' ';
                        
                        // 📐 MEDIMOS EL ANCHO REAL EN PÍXELES DE LA LÍNEA DE PRUEBA
                        const metrics = ctx.measureText(testLine);
                        const testWidth = metrics.width;

                        // Si se pasa del ancho útil y no es la primera palabra, pintamos la línea actual y saltamos
                        if (testWidth > maxWidthText && n > 0) {
                            ctx.fillText(currentLine, x + paddingLeft, textY);
                            currentLine = words[n] + ' '; // La palabra que sobró empieza la nueva línea
                            textY += lineHeight;
                            linesDrawn++;
                        } else {
                            // Si cabe, seguimos acumulando palabras
                            currentLine = testLine;
                        }
                    }

                    // Pintamos la última línea del párrafo (o el párrafo entero si cupo en una línea)
                    if (linesDrawn < maxLinesInPhoto && currentLine.trim() !== '') {
                        ctx.fillText(currentLine, x + paddingLeft, textY);
                        textY += lineHeight;
                        linesDrawn++;
                    }
                }
                // --- FIN DEL MOTOR DE TEXTO ---
            });

            // 7. Revelar y Guardar en la bóveda
            const base64 = finalCanvas.toDataURL("image/png");
            const arrayBuffer = this.base64ToArrayBuffer(base64.replace(/^data:image\/png;base64,/, ""));
            
            // @ts-ignore
            const fileName = `Lienzo_Exportado_${window.moment().format('YYYYMMDD_HHmmss')}.png`;
            await this.plugin.app.vault.createBinary(fileName, arrayBuffer);
            
            notice.hide();
            new Notice(`✅ ¡Fotografía exitosa!\nGuardada en tu bóveda como: ${fileName}`, 6000);

        } catch (error) {
            console.error(error);
            notice.hide();
            new Notice("❌ Error al exportar el lienzo.");
        }
    }
    // ======================================================
    // 🧠 MOTOR DE REPASO: Escáner de Flashcards (Visión de Rayos X)
    // ======================================================
    async openFlashcardReview() {
        const flashcards: { front: string, back: string, sourcePath: string }[] = [];
        const notice = new Notice("🔍 Escaneando archivos originales en el disco...", 0);

        // Escaneamos todos los nodos de la memoria del lienzo
        const nodes = Object.values(this.canvasData.nodes);
        
        for (const node of nodes) {
            // Necesitamos la ruta del archivo y la línea para ir a leer el original
            if (node.filePath && node.line !== undefined) {
                // @ts-ignore
                const file = this.plugin.app.vault.getAbstractFileByPath(node.filePath);
                
                if (file) {
                    // 📖 Leemos el texto crudo y real del archivo físico
                    // Le juramos a TypeScript que es un archivo (TFile) y no una carpeta
                    const content = await this.plugin.app.vault.read(file as any);
                    const lines = content.split('\n');
                    
                    if (node.line >= 0 && node.line < lines.length) {
                        const originalLine = lines[node.line];
                        
                        // Buscamos la marginalia cruda (%%> ... %%) en esa línea específica
                        const marginaliaRegex = /%%[><]([\s\S]*?)%%/;
                        const match = originalLine.match(marginaliaRegex);
                        
                        // Revisamos si ESA marginalia original contiene el ';;' que fue filtrado en la UI
                        // Revisamos si ESA marginalia original contiene el ';;'
                        if (match && match[1].includes(";;")) {
                            
                            // 1. LA PREGUNTA (Frente): 
                            // Cortamos exactamente en el ';;'. Todo lo que haya después (IDs de Anki, links raros) se va a la basura.
                            let question = match[1].split(";;")[0].trim();
                            
                            // 2. LA RESPUESTA (Dorso): El texto nativo (citation), sin el bloque %%
                            let answer = originalLine.replace(/%%[\s\S]*?%%/g, '').trim();

                            // Por si acaso, borramos IDs de bloque de Obsidian (^12345) que queden al final de la respuesta
                            answer = answer.replace(/\s*\^[a-zA-Z0-9_-]+$/, '').trim();

                            // Si la respuesta nativa es muy corta o está vacía, usamos tu context expandido
                            if (!answer && node.context) {
                                answer = node.context.trim();
                            }

                            if (question) {
                                flashcards.push({ 
                                    front: question, 
                                    back: answer || "*(Sin contexto de respuesta)*",
                                    sourcePath: file.path // 👈 CLAVE MAESTRA PARA QUE PDF++ FUNCIONE EN EL MODAL
                                });
                            }
                        }
                    }
                }
            }
        }

        notice.hide();

        if (flashcards.length === 0) {
            new Notice("⚠️ No se encontraron flashcards.\nAsegúrate de tener tarjetas cuyas notas originales incluyan el separador ';;'.");
            return;
        }

        // ¡Abrimos el teatro mental! Y le pasamos 'this' (el componente vivo del lienzo)
        new CanvasFlashcardModal(this.plugin.app, flashcards, this).open();
    }
}