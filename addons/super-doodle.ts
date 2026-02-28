import { setIcon, Notice } from "obsidian";
import CornellMarginalia from "../main";
// Asumiendo que exportas CornellNotesView en main.ts
import { CornellNotesView } from "../main"; 

// Función auxiliar necesaria para guardar la imagen
function base64ToArrayBuffer(base64: string) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

export abstract class CornellAddon {
    abstract id: string;
    abstract name: string;
    abstract description: string;
    constructor(public plugin: CornellMarginalia) {}
    abstract load(): void;
    abstract unload(): void;
}

export class SuperDoodleAddon extends CornellAddon {
    id = "super-doodle";
    name = "Super Doodle 🎨";
    description = "Transforma el Zen Doodle en un lienzo masivo (4x) con navegación panorámica, colores y tamaño de pincel ajustable.";

    // Guardamos el método original para restaurarlo después
    private originalRenderZenDoodle: Function | null = null;

    load(): void {
        this.originalRenderZenDoodle = CornellNotesView.prototype.renderZenDoodle;
        const addonInstance = this;

        // Sobreescribimos el método en el prototipo
        CornellNotesView.prototype.renderZenDoodle = function(container: HTMLElement) {
            // 'this' aquí hace referencia a la instancia de CornellNotesView
            const view = this as any; 

            // Variables de estado del SuperDoodle
            let currentTool: 'pen' | 'eraser' | 'hand' = 'pen';
            let currentColor = '#000000';
            let currentSize = 4;
            let isDragging = false;
            let startX = 0, startY = 0;
            let scrollLeftStart = 0, scrollTopStart = 0;

            const zenContainer = container.createDiv({ cls: 'cornell-zen-container' });
            zenContainer.style.display = 'flex';
            zenContainer.style.flexDirection = 'column';
            zenContainer.style.height = '100%';
            zenContainer.style.gap = '15px';
            zenContainer.style.padding = '10px 0';

            // --- 1. TOP BAR (Botonera) ---
            const topBar = zenContainer.createDiv();
            topBar.style.display = 'flex';
            topBar.style.justifyContent = 'space-between';
            topBar.style.alignItems = 'center';
            topBar.style.flexWrap = 'wrap';
            topBar.style.gap = '10px';

            // GRUPO IZQUIERDO: Herramientas
            const leftGrp = topBar.createDiv({ attr: { style: 'display:flex; gap:6px; align-items:center;' } });
            
            const cancelBtn = leftGrp.createEl('button', { title: 'Return to Board' });
            setIcon(cancelBtn, "arrow-left");
            cancelBtn.style.boxShadow = 'none';
            cancelBtn.onclick = () => {
                view.isZenMode = false;
                view.applyFiltersAndRender();
            };

            const handBtn = leftGrp.createEl('button', { title: 'Hand Tool (Pan)' });
            setIcon(handBtn, "hand");
            
            const penBtn = leftGrp.createEl('button', { cls: 'mod-cta', title: 'Pen' });
            setIcon(penBtn, "pencil");

            const eraserBtn = leftGrp.createEl('button', { title: 'Eraser' });
            setIcon(eraserBtn, "eraser");

            // GRUPO CENTRAL: Colores y Tamaño
            const centerGrp = topBar.createDiv({ attr: { style: 'display:flex; gap:10px; align-items:center;' } });
            
            // Slider de tamaño
            const sizeSlider = centerGrp.createEl('input', { type: 'range' });
            sizeSlider.min = "1"; sizeSlider.max = "50"; sizeSlider.value = "4";
            sizeSlider.style.width = "80px";
            sizeSlider.oninput = (e) => {
                currentSize = parseInt((e.target as HTMLInputElement).value);
                if (currentTool === 'pen' && view.zenCtx) view.zenCtx.lineWidth = currentSize;
            };

            // Paleta de colores
            const colors = ['#000000', '#ff4d4d', '#3366ff', '#00cc66'];
            const colorBtns: HTMLElement[] = [];
            colors.forEach(c => {
                const cBtn = centerGrp.createDiv();
                cBtn.style.width = '20px'; cBtn.style.height = '20px';
                cBtn.style.borderRadius = '50%';
                cBtn.style.backgroundColor = c;
                cBtn.style.cursor = 'pointer';
                cBtn.style.border = c === currentColor ? '2px solid var(--text-normal)' : '2px solid transparent';
                cBtn.onclick = () => {
                    currentColor = c;
                    currentTool = 'pen';
                    if (view.zenCtx) {
                        view.zenCtx.strokeStyle = currentColor;
                        view.zenCtx.globalCompositeOperation = "source-over";
                        view.zenCtx.lineWidth = currentSize;
                    }
                    updateToolUI();
                    colorBtns.forEach(btn => btn.style.border = '2px solid transparent');
                    cBtn.style.border = '2px solid var(--text-normal)';
                };
                colorBtns.push(cBtn);
            });

            // --- GRUPO DERECHO: Acciones ---
            const rightGrp = topBar.createDiv({ attr: { style: 'display:flex; gap:10px;' } });
            
            const clearBtn = rightGrp.createEl('button', { title: 'Clear Canvas' });
            setIcon(clearBtn, "trash-2");
            clearBtn.style.boxShadow = 'none';
            clearBtn.onclick = () => {
                if (view.zenCanvasEl && view.zenCtx) {
                    view.zenCtx.clearRect(0, 0, view.zenCanvasEl.width, view.zenCanvasEl.height);
                }
            };

// 1. BOTÓN ATTACH (Va al Board)
            const attachBtn = rightGrp.createEl('button', { text: '📌 Attach to Board', title: 'Save and add to Pinboard' });
            attachBtn.onclick = async () => {
                if (!view.zenCanvasEl) return;
                attachBtn.innerText = '⏳...';
                
                const dataUrl = view.zenCanvasEl.toDataURL("image/png");
                const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
                const arrayBuffer = base64ToArrayBuffer(base64Data);

                // @ts-ignore
                const dateStr = window.moment().format('YYYYMMDD_HHmmss');
                const fileName = `superdoodle_${dateStr}.png`;
                const folder = addonInstance.plugin.settings.doodleFolder.trim();
                let attachmentPath = fileName;
                
                if (folder) {
                    await addonInstance.plugin.ensureFolderExists(folder);
                    attachmentPath = `${folder}/${fileName}`;
                } else {
                    try {
                        // @ts-ignore
                        attachmentPath = await view.app.fileManager.getAvailablePathForAttachment(fileName, "");
                    } catch (e) { attachmentPath = fileName; }
                }
                
                await view.app.vault.createBinary(attachmentPath, arrayBuffer);
                const actualFileName = attachmentPath.split('/').pop();
                
                view.pinboardItems.push({ 
                    text: `![[${actualFileName}]]`, 
                    rawText: `![[${actualFileName}]]`, 
                    color: 'transparent', 
                    file: null as any, 
                    line: -1, 
                    blockId: null, 
                    outgoingLinks: [], 
                    isCustom: true, 
                    indentLevel: 0
                });
                
                new Notice('🎨 Super Doodle attached to Board!');
                view.isZenMode = false;
                if (view.zenCtx) view.zenCtx.clearRect(0, 0, view.zenCanvasEl.width, view.zenCanvasEl.height);
                view.applyFiltersAndRender();
            };

            // 2. BOTÓN OMNI-CAPTURE (Va al Inbox/Destino)
            const zapBtn = rightGrp.createEl('button', { text: '⚡ Omni-Capture', cls: 'mod-cta', title: 'Save instantly to Omni-Capture Destination' });
            zapBtn.style.backgroundColor = 'var(--interactive-accent)';
            zapBtn.style.color = 'var(--text-on-accent)';
            
            zapBtn.onclick = async () => {
                if (!view.zenCanvasEl) return;
                zapBtn.innerText = '⏳ Saving...';
                
                const dataUrl = view.zenCanvasEl.toDataURL("image/png");
                const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
                const arrayBuffer = base64ToArrayBuffer(base64Data);

                const payload = {
                    thought: "",
                    destination: view.plugin.settings.lastOmniDestination || "Marginalia Inbox",
                    doodleData: arrayBuffer
                };

                try {
                    await view.plugin.captureManager.saveCapture(payload);
                    
                    if (view.plugin.settings.addons && view.plugin.settings.addons["gamification-profile"]) {
                        view.plugin.gamificationAddon.addXp();
                        view.renderUI(); 
                    }

                    view.isZenMode = false;
                    if (view.zenCtx) view.zenCtx.clearRect(0, 0, view.zenCanvasEl.width, view.zenCanvasEl.height);
                    view.applyFiltersAndRender();
                    
                } catch (error) {
                    console.error(error);
                    zapBtn.innerText = '⚡ Omni-Capture';
                    new Notice("Error guardando el Doodle. Revisa la consola.");
                }
            };

            // Lógica de actualización de UI
            const updateToolUI = () => {
                handBtn.removeClass("mod-cta");
                penBtn.removeClass("mod-cta");
                eraserBtn.removeClass("mod-cta");
                if (view.zenCanvasEl) view.zenCanvasEl.style.cursor = 'crosshair';

                if (currentTool === 'hand') {
                    handBtn.addClass("mod-cta");
                    if (view.zenCanvasEl) view.zenCanvasEl.style.cursor = 'grab';
                } else if (currentTool === 'pen') {
                    penBtn.addClass("mod-cta");
                } else if (currentTool === 'eraser') {
                    eraserBtn.addClass("mod-cta");
                }
            };

            handBtn.onclick = () => { currentTool = 'hand'; updateToolUI(); };
            
            penBtn.onclick = () => {
                currentTool = 'pen';
                if (view.zenCtx) {
                    view.zenCtx.globalCompositeOperation = "source-over";
                    view.zenCtx.lineWidth = currentSize;
                    view.zenCtx.strokeStyle = currentColor;
                }
                updateToolUI();
            };

            eraserBtn.onclick = () => {
                currentTool = 'eraser';
                if (view.zenCtx) {
                    view.zenCtx.globalCompositeOperation = "destination-out";
                    view.zenCtx.lineWidth = currentSize * 3; // La goma es más grande
                }
                updateToolUI();
            };

            // --- 2. CONTENEDOR CON SCROLL (LA MAGIA DEL PANEO) ---
            const scrollWrapper = zenContainer.createDiv();
            scrollWrapper.style.flexGrow = "1";
            scrollWrapper.style.overflow = "auto"; // Permite navegar por el lienzo gigante
            scrollWrapper.style.border = "2px dashed var(--background-modifier-border)";
            scrollWrapper.style.borderRadius = "8px";
            scrollWrapper.style.backgroundColor = "var(--background-secondary-alt)"; // Fondo gris detrás del lienzo

            if (!view.zenCanvasEl) {
                view.zenCanvasEl = document.createElement("canvas");
                // ¡LIENZO MASIVO! (3200x4800 es 4x el original)
                view.zenCanvasEl.width = 3200; 
                view.zenCanvasEl.height = 4800;
                
                view.zenCtx = view.zenCanvasEl.getContext("2d")!;
                view.zenCtx.lineCap = "round";
                view.zenCtx.lineJoin = "round";
                
                // Aplicar estado inicial
                view.zenCtx.lineWidth = currentSize;
                view.zenCtx.strokeStyle = currentColor; 
                
                view.zenCanvasEl.style.backgroundColor = "#ffffff";
                view.zenCanvasEl.style.display = "block";
                view.zenCanvasEl.style.touchAction = "none";
                updateToolUI(); // Establecer cursor inicial

                // Como el canvas ahora tiene el tamaño real en píxeles CSS, el cálculo es directo
                const getPointerPos = (e: PointerEvent) => {
                    const rect = view.zenCanvasEl!.getBoundingClientRect();
                    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
                };

                view.zenCanvasEl.addEventListener("pointerdown", (e: PointerEvent) => {
                    if (currentTool === 'hand') {
                        isDragging = true;
                        view.zenCanvasEl!.style.cursor = 'grabbing';
                        startX = e.clientX;
                        startY = e.clientY;
                        scrollLeftStart = scrollWrapper.scrollLeft;
                        scrollTopStart = scrollWrapper.scrollTop;
                    } else {
                        view.zenIsDrawing = true;
                        const pos = getPointerPos(e);
                        view.zenCtx!.beginPath();
                        view.zenCtx!.moveTo(pos.x, pos.y);
                    }
                });

                view.zenCanvasEl.addEventListener("pointermove", (e: PointerEvent) => {
                    if (currentTool === 'hand' && isDragging) {
                        const dx = e.clientX - startX;
                        const dy = e.clientY - startY;
                        scrollWrapper.scrollLeft = scrollLeftStart - dx;
                        scrollWrapper.scrollTop = scrollTopStart - dy;
                    } else if (view.zenIsDrawing) {
                        const pos = getPointerPos(e);
                        view.zenCtx!.lineTo(pos.x, pos.y);
                        view.zenCtx!.stroke();
                    }
                });

                const stopAction = () => {
                    view.zenIsDrawing = false;
                    isDragging = false;
                    if (currentTool === 'hand') view.zenCanvasEl!.style.cursor = 'grab';
                };

                view.zenCanvasEl.addEventListener("pointerup", stopAction);
                view.zenCanvasEl.addEventListener("pointerout", stopAction);
                view.zenCanvasEl.addEventListener("pointercancel", stopAction);
            }
            
            scrollWrapper.appendChild(view.zenCanvasEl);
            
            // Centrar el scroll al abrir (opcional, para empezar a dibujar en el medio)
            setTimeout(() => {
                scrollWrapper.scrollLeft = (3200 - scrollWrapper.clientWidth) / 2;
                scrollWrapper.scrollTop = (4800 - scrollWrapper.clientHeight) / 2;
            }, 10);
        };
    }

    unload(): void {
        // Devolvemos el método a su estado original para no romper nada
        if (this.originalRenderZenDoodle) {
            CornellNotesView.prototype.renderZenDoodle = this.originalRenderZenDoodle as any;
        }
    }
}
