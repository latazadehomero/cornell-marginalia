import { setIcon, Notice } from "obsidian";
import CornellMarginalia from "../main";
import { CornellNotesView } from "../main"; 

function base64ToArrayBuffer(base64: string) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

function getHybridCroppedCanvas(originalCanvas: HTMLCanvasElement, bounds: any, padding: number = 20): HTMLCanvasElement {
    if (bounds.minX === Infinity) return originalCanvas; 

    const ctx = originalCanvas.getContext('2d');
    if (!ctx) return originalCanvas;

    let startX = Math.max(0, Math.floor(bounds.minX) - padding);
    let startY = Math.max(0, Math.floor(bounds.minY) - padding);
    let endX = Math.min(originalCanvas.width, Math.ceil(bounds.maxX) + padding);
    let endY = Math.min(originalCanvas.height, Math.ceil(bounds.maxY) + padding);
    
    const scanW = endX - startX;
    const scanH = endY - startY;

    if (scanW <= 0 || scanH <= 0) return originalCanvas;

    const imageData = ctx.getImageData(startX, startY, scanW, scanH);
    const data = imageData.data;

    let minX = scanW, minY = scanH, maxX = 0, maxY = 0;
    let hasContent = false;

    for (let y = 0; y < scanH; y++) {
        for (let x = 0; x < scanW; x++) {
            const alpha = data[(y * scanW + x) * 4 + 3];
            if (alpha > 0) {
                hasContent = true;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (!hasContent) return originalCanvas; 

    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(scanW, maxX + padding);
    maxY = Math.min(scanH, maxY + padding);

    const croppedWidth = maxX - minX;
    const croppedHeight = maxY - minY;

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = croppedWidth;
    croppedCanvas.height = croppedHeight;
    const croppedCtx = croppedCanvas.getContext('2d');

    if (croppedCtx) {
        croppedCtx.drawImage(
            originalCanvas, 
            startX + minX, startY + minY, croppedWidth, croppedHeight, 
            0, 0, croppedWidth, croppedHeight
        );
    }

    return croppedCanvas;
}

function getOCROptimizedCanvas(originalCanvas: HTMLCanvasElement, bounds: any): HTMLCanvasElement {
    const cropped = getHybridCroppedCanvas(originalCanvas, bounds, 30);
    
    const scale = 2; 
    const ocrCanvas = document.createElement('canvas');
    ocrCanvas.width = cropped.width * scale;
    ocrCanvas.height = cropped.height * scale;
    
    const ctx = ocrCanvas.getContext('2d', { willReadFrequently: true });
    
    if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, ocrCanvas.width, ocrCanvas.height);
        
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(cropped, 0, 0, ocrCanvas.width, ocrCanvas.height);

        const imageData = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i+1];
            const b = data[i+2];
            const alpha = data[i+3];
            
            if (alpha > 20 && (r + g + b) / 3 < 220) {
                data[i] = 0;
                data[i+1] = 0;
                data[i+2] = 0;
                data[i+3] = 255;
            } else {
                data[i] = 255;
                data[i+1] = 255;
                data[i+2] = 255;
                data[i+3] = 255;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }
    return ocrCanvas;
}

async function loadTesseract(): Promise<any> {
    if ((window as any).Tesseract) return (window as any).Tesseract;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.onload = () => resolve((window as any).Tesseract);
        script.onerror = () => reject(new Error("Error cargando Tesseract. Revisa tu conexión a internet."));
        document.head.appendChild(script);
    });
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
    description = "Transform Zen Doodle into an adjustable-size canvas with panoramic navigation, colors, and an advanced selection tool.";

    private originalRenderZenDoodle: Function | null = null;

    load(): void {
        this.originalRenderZenDoodle = CornellNotesView.prototype.renderZenDoodle;
        const addonInstance = this;

        CornellNotesView.prototype.renderZenDoodle = function(container: HTMLElement) {
            const view = this as any; 

            // =====================================================================
            // 🧠 1. CORE ENGINE
            // =====================================================================
            if (!view.zenCanvasEl) {
                
                let currentTool: 'pen' | 'eraser' | 'hand' | 'select' = 'pen';
                let currentColor = '#000000';
                let currentSize = 4;
                
                let isDragging = false;
                let isTempPanning = false;
                let isTempErasing = false;
                let startX = 0, startY = 0;
                let scrollLeftStart = 0, scrollTopStart = 0;

                let selectionPhase: 'none' | 'selecting' | 'floating' = 'none';
                let selX = 0, selY = 0, selW = 0, selH = 0;
                let floatingCanvas: HTMLCanvasElement | null = null; 
                let floatDragStartX = 0, floatDragStartY = 0;
                
                let strokePoints: {x: number, y: number}[] = [];
                let lastOverlayBounds = { x: 0, y: 0, w: 0, h: 0 };
                let drawnBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

                let isDrawingFrameScheduled = false;
                let lastDrawnIndex = 1;

                const updateBounds = (x: number, y: number, r: number) => {
                    if (x - r < drawnBounds.minX) drawnBounds.minX = x - r;
                    if (y - r < drawnBounds.minY) drawnBounds.minY = y - r;
                    if (x + r > drawnBounds.maxX) drawnBounds.maxX = x + r;
                    if (y + r > drawnBounds.maxY) drawnBounds.maxY = y + r;
                };

                view.zenCanvasEl = document.createElement("canvas");
                view.zenCanvasEl.width = 3200; 
                view.zenCanvasEl.height = 4800;
                view.zenCtx = view.zenCanvasEl.getContext("2d")!;
                view.zenCanvasEl.style.backgroundColor = "#ffffff";
                view.zenCanvasEl.style.display = "block";
                view.zenCanvasEl.style.touchAction = "none";

                const overlayCanvas = document.createElement("canvas");
                overlayCanvas.width = view.zenCanvasEl.width;
                overlayCanvas.height = view.zenCanvasEl.height;
                overlayCanvas.style.position = "absolute";
                overlayCanvas.style.top = "0";
                overlayCanvas.style.left = "0";
                overlayCanvas.style.pointerEvents = "none"; 
                const overlayCtx = overlayCanvas.getContext("2d")!;

                const commitFloatingSelection = () => {
                    if (selectionPhase === 'floating' && floatingCanvas && view.zenCtx && overlayCtx) {
                        view.zenCtx.globalCompositeOperation = "source-over";
                        view.zenCtx.drawImage(floatingCanvas, selX, selY);
                        
                        updateBounds(selX, selY, 0);
                        updateBounds(selX + floatingCanvas.width, selY + floatingCanvas.height, 0);

                        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                        selectionPhase = 'none';
                        floatingCanvas = null; 
                    }
                };

                const forceStopAllActions = () => {
                    if (!view.zenCtx || !view.zenCanvasEl || !overlayCtx || !overlayCanvas) return;

                    if (view.zenIsDrawing) {
                        if (strokePoints.length > lastDrawnIndex) {
                            view.zenCtx.beginPath();
                            const p1_start = strokePoints[lastDrawnIndex - 1];
                            const p2_start = strokePoints[lastDrawnIndex];
                            const mid_start = { x: (p1_start.x + p2_start.x) / 2, y: (p1_start.y + p2_start.y) / 2 };
                            view.zenCtx.moveTo(mid_start.x, mid_start.y);

                            for (let i = lastDrawnIndex + 1; i < strokePoints.length; i++) {
                                const p2 = strokePoints[i - 1];
                                const p3 = strokePoints[i];
                                const mid_next = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
                                view.zenCtx.quadraticCurveTo(p2.x, p2.y, mid_next.x, mid_next.y);
                            }
                            view.zenCtx.stroke();
                        }

                        if (strokePoints.length >= 2) {
                            const p1 = strokePoints[strokePoints.length - 2];
                            const p2 = strokePoints[strokePoints.length - 1];
                            const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
                            
                            view.zenCtx.beginPath();
                            view.zenCtx.moveTo(mid.x, mid.y);
                            view.zenCtx.lineTo(p2.x, p2.y);
                            view.zenCtx.stroke();
                        }
                        
                        view.zenIsDrawing = false;
                        strokePoints = [];
                        lastDrawnIndex = 1;
                    }

                    if (currentTool === 'select' && selectionPhase === 'selecting') {
                        const rx = selW < 0 ? selX + selW : selX;
                        const ry = selH < 0 ? selY + selH : selY;
                        const rw = Math.abs(selW);
                        const rh = Math.abs(selH);
                        selX = rx; selY = ry; selW = rw; selH = rh;

                        if (rw > 5 && rh > 5) {
                            selectionPhase = 'floating';
                            const imageData = view.zenCtx.getImageData(selX, selY, selW, selH);
                            view.zenCtx.clearRect(selX, selY, selW, selH);
                            
                            floatingCanvas = document.createElement('canvas');
                            floatingCanvas.width = selW; 
                            floatingCanvas.height = selH;
                            floatingCanvas.getContext('2d')?.putImageData(imageData, 0, 0);

                            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                            overlayCtx.drawImage(floatingCanvas, selX, selY);
                            overlayCtx.setLineDash([5, 5]);
                            overlayCtx.strokeStyle = 'rgba(100, 150, 255, 0.8)';
                            overlayCtx.strokeRect(selX, selY, selW, selH);
                            lastOverlayBounds = { x: selX, y: selY, w: selW, h: selH };
                        } else {
                            selectionPhase = 'none';
                            overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                            lastOverlayBounds = { x: 0, y: 0, w: 0, h: 0 };
                        }
                    }

                    isDragging = false;
isTempPanning = false;
isTempErasing = false; // Reseteamos la goma temporal

// Restablecemos el cursor de forma estricta según la herramienta actual
if (currentTool === 'hand') view.zenCanvasEl.style.cursor = 'grab';
else if (currentTool === 'select') view.zenCanvasEl.style.cursor = 'cell';
else view.zenCanvasEl.style.cursor = 'crosshair'; // <-- FIX: Devuelve el cursor al lápiz/goma normal
                };

                view.doodleAPI = {
                    setTool: (t: any) => { forceStopAllActions(); commitFloatingSelection(); currentTool = t; },
                    getTool: () => currentTool,
                    setColor: (c: string) => { forceStopAllActions(); commitFloatingSelection(); currentColor = c; },
                    getColor: () => currentColor,
                    setSize: (s: number) => { currentSize = s; },
                    getSize: () => currentSize,
                    commitSelection: commitFloatingSelection,
                    getOverlay: () => overlayCanvas,
                    getBounds: () => drawnBounds,
                    forceUpdateBounds: updateBounds,
                    getSelectionPhase: () => selectionPhase,
                    getFloatingCanvas: () => floatingCanvas,
                    getSelectionRect: () => ({ x: selX, y: selY, w: selW, h: selH }),
                    clearSelection: () => {
                        selectionPhase = 'none';
                        floatingCanvas = null;
                        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                    },
                    fillWhiteRect: (x: number, y: number, w: number, h: number) => {
                        view.zenCtx.fillStyle = '#ffffff';
                        view.zenCtx.fillRect(x, y, w, h);
                    },
                    resize: (newW: number, newH: number) => {
                        commitFloatingSelection(); 
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = view.zenCanvasEl.width;
                        tempCanvas.height = view.zenCanvasEl.height;
                        tempCanvas.getContext('2d')?.drawImage(view.zenCanvasEl, 0, 0);
                        
                        view.zenCanvasEl.width = newW;
                        view.zenCanvasEl.height = newH;
                        
                        overlayCanvas.width = newW;
                        overlayCanvas.height = newH;

                        view.zenCtx.drawImage(tempCanvas, 0, 0);
                    },
                    clear: () => {
                        view.zenCtx.clearRect(0, 0, view.zenCanvasEl.width, view.zenCanvasEl.height);
                        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
                        selectionPhase = 'none';
                        drawnBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
                    }
                };

                const getScrollWrapper = () => view.zenCanvasEl.parentElement as HTMLElement;
                const getPointerPos = (e: PointerEvent) => {
                    const rect = view.zenCanvasEl.getBoundingClientRect();
                    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
                };

                view.zenCanvasEl.addEventListener("contextmenu", (e: Event) => e.preventDefault());

                view.zenCanvasEl.addEventListener("pointerdown", (e: PointerEvent) => {
    view.zenCanvasEl!.setPointerCapture(e.pointerId);
    
    isTempPanning = e.ctrlKey || e.metaKey;
    isTempErasing = e.shiftKey && !isTempPanning; // Shift para goma (evita colisiones con paneo)

    if (currentTool === 'hand' || isTempPanning) {
                        isDragging = true;
                        view.zenCanvasEl.style.cursor = 'grabbing';
                        startX = e.clientX;
                        startY = e.clientY;
                        const sw = getScrollWrapper();
                        if (sw) {
                            scrollLeftStart = sw.scrollLeft;
                            scrollTopStart = sw.scrollTop;
                        }
                        return;
                    }

                    const pos = getPointerPos(e);

                    if (currentTool === 'select') {
                        if (selectionPhase === 'floating') {
                            if (pos.x >= selX && pos.x <= selX + selW && pos.y >= selY && pos.y <= selY + selH) {
                                isDragging = true;
                                floatDragStartX = pos.x;
                                floatDragStartY = pos.y;
                            } else {
                                commitFloatingSelection();
                                selectionPhase = 'selecting';
                                selX = pos.x; selY = pos.y; selW = 0; selH = 0;
                            }
                        } else {
                            selectionPhase = 'selecting';
                            selX = pos.x; selY = pos.y; selW = 0; selH = 0;
                        }
                        return;
                    }

                    commitFloatingSelection();
                    view.zenIsDrawing = true;
                    
                    // Determinamos dinámicamente si usamos la goma (ya sea por interfaz o por atajo)
const isEraserActive = currentTool === 'eraser' || isTempErasing;
const activeSize = isEraserActive ? currentSize * 3 : currentSize;

view.zenCtx.lineWidth = activeSize;
view.zenCtx.lineCap = "round";
view.zenCtx.lineJoin = "round";

if (isEraserActive) {
    view.zenCtx.globalCompositeOperation = "destination-out";
    view.zenCtx.strokeStyle = "rgba(0,0,0,1)";
} else {
    view.zenCtx.globalCompositeOperation = "source-over";
    view.zenCtx.strokeStyle = currentColor;
}
                    view.zenCtx.fillStyle = view.zenCtx.strokeStyle;

                    strokePoints = [pos, pos];
                    lastDrawnIndex = 1;
                    updateBounds(pos.x, pos.y, activeSize);

                    view.zenCtx.beginPath();
                    view.zenCtx.arc(pos.x, pos.y, activeSize / 2, 0, Math.PI * 2);
                    view.zenCtx.fill();
                });

                window.addEventListener('blur', forceStopAllActions);
                document.addEventListener('pointerup', (e) => {
                    if (e.target !== view.zenCanvasEl) forceStopAllActions();
                });

                view.zenCanvasEl.addEventListener("pointermove", (e: PointerEvent) => {
    
    // 🛡️ REFUERZO ANTI-BUG: Movido al inicio antes de los 'return'
    // Esto asegura que el cursor se actualice en hover para TODAS las herramientas
    // y evita el error de "Type Narrowing" de TypeScript.
    if (!view.zenIsDrawing && !isDragging) {
        if (e.ctrlKey || e.metaKey) view.zenCanvasEl.style.cursor = 'grab';
        else if (e.shiftKey) view.zenCanvasEl.style.cursor = 'cell'; // Feedback visual de goma
        else if (currentTool === 'hand') view.zenCanvasEl.style.cursor = 'grab';
        else if (currentTool === 'select') view.zenCanvasEl.style.cursor = 'cell';
        else view.zenCanvasEl.style.cursor = 'crosshair';
    }

    if ((currentTool === 'hand' || isTempPanning) && isDragging) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const sw = getScrollWrapper();
        if (sw) {
            sw.scrollLeft = scrollLeftStart - dx;
            sw.scrollTop = scrollTopStart - dy;
        }
        return;
    }

    // Para la selección, el evento principal es suficiente
    if (currentTool === 'select') {
        const pos = getPointerPos(e);
        overlayCtx.clearRect(lastOverlayBounds.x - 10, lastOverlayBounds.y - 10, lastOverlayBounds.w + 20, lastOverlayBounds.h + 20);

        if (selectionPhase === 'selecting') {
            selW = pos.x - selX;
            selH = pos.y - selY;
            
            overlayCtx.setLineDash([5, 5]);
            overlayCtx.strokeStyle = 'var(--interactive-accent)';
            overlayCtx.lineWidth = 2;
            overlayCtx.strokeRect(selX, selY, selW, selH);
            
            lastOverlayBounds = { x: selX, y: selY, w: selW, h: selH };
        } else if (selectionPhase === 'floating' && isDragging && floatingCanvas) {
            const dx = pos.x - floatDragStartX;
            const dy = pos.y - floatDragStartY;
            selX += dx; selY += dy;
            floatDragStartX = pos.x; floatDragStartY = pos.y;
            
            overlayCtx.drawImage(floatingCanvas, selX, selY);
            overlayCtx.setLineDash([5, 5]);
            overlayCtx.strokeStyle = 'rgba(100, 150, 255, 0.8)';
            overlayCtx.strokeRect(selX, selY, floatingCanvas.width, floatingCanvas.height);
            
            lastOverlayBounds = { x: selX, y: selY, w: floatingCanvas.width, h: floatingCanvas.height };
        }
        return; // El return temprano ahora es seguro porque el cursor ya se actualizó.
    }

                    

if (view.zenIsDrawing) {
    // Calculamos el tamaño correcto durante el movimiento
    const isEraserActive = currentTool === 'eraser' || isTempErasing;
    const activeSize = isEraserActive ? currentSize * 3 : currentSize;
                        
                        // 🔥 MAGIA DE HARDWARE: EVENT COALESCING
                        // Extraemos todos los sub-eventos de alta frecuencia que el DOM intentó resumir
                        const coalescedEvents = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
                        
                        for (const coalescedEvent of coalescedEvents) {
                            const pos = getPointerPos(coalescedEvent);
                            strokePoints.push(pos);
                            updateBounds(pos.x, pos.y, activeSize);
                        }

                        if (!isDrawingFrameScheduled) {
                            isDrawingFrameScheduled = true;
                            
                            requestAnimationFrame(() => {
                                isDrawingFrameScheduled = false;
                                
                                if (view.zenIsDrawing && strokePoints.length > lastDrawnIndex) {
                                    view.zenCtx.beginPath();
                                    
                                    const p1_start = strokePoints[lastDrawnIndex - 1];
                                    const p2_start = strokePoints[lastDrawnIndex];
                                    const mid_start = { x: (p1_start.x + p2_start.x) / 2, y: (p1_start.y + p2_start.y) / 2 };
                                    
                                    view.zenCtx.moveTo(mid_start.x, mid_start.y);

                                    for (let i = lastDrawnIndex + 1; i < strokePoints.length; i++) {
                                        const p2 = strokePoints[i - 1];
                                        const p3 = strokePoints[i];
                                        const mid_next = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
                                        
                                        view.zenCtx.quadraticCurveTo(p2.x, p2.y, mid_next.x, mid_next.y);
                                    }
                                    
                                    view.zenCtx.stroke();
                                    lastDrawnIndex = strokePoints.length - 1; 
                                }
                            });
                        }
                    }
                });

                view.zenCanvasEl.addEventListener("pointerup", (e: PointerEvent) => {
                    view.zenCanvasEl!.releasePointerCapture(e.pointerId);
                    forceStopAllActions();
                });
            }

            // =====================================================================
            // 🎨 2. INTERFAZ DE USUARIO 
            // =====================================================================
            const api = view.doodleAPI;

            const zenContainer = container.createDiv({ cls: 'cornell-zen-container' });
            zenContainer.style.display = 'flex';
            zenContainer.style.flexDirection = 'column';
            zenContainer.style.height = '100%';
            zenContainer.style.gap = '15px';
            zenContainer.style.padding = '10px 0';

            const topBar = zenContainer.createDiv();
            topBar.style.display = 'flex';
            topBar.style.justifyContent = 'space-between';
            topBar.style.alignItems = 'center';
            topBar.style.flexWrap = 'wrap';
            topBar.style.gap = '10px';

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

            const selectBtn = leftGrp.createEl('button', { title: 'Lasso / Select Tool' });
            setIcon(selectBtn, "box-select");

            const centerGrp = topBar.createDiv({ attr: { style: 'display:flex; gap:10px; align-items:center;' } });
            
            const canvasSizeSelect = centerGrp.createEl('select', { title: 'Canvas Resolution' });
            canvasSizeSelect.style.background = 'transparent';
            canvasSizeSelect.style.color = 'var(--text-normal)';
            canvasSizeSelect.style.border = '1px solid var(--background-modifier-border)';
            canvasSizeSelect.style.borderRadius = '4px';
            
            canvasSizeSelect.add(new Option("Size: 1x (Normal)", "800x1200"));
            canvasSizeSelect.add(new Option("Size: 2x (Large)", "1600x2400"));
            canvasSizeSelect.add(new Option("Size: 4x (Massive)", "3200x4800", true, true)); 
            canvasSizeSelect.add(new Option("Size: 8x (Insane)", "6400x9600"));
            
            canvasSizeSelect.onchange = (e) => {
                const [newW, newH] = (e.target as HTMLSelectElement).value.split('x').map(Number);
                api.resize(newW, newH);
                new Notice(`📐 Canvas resized to ${newW}x${newH}`);
            };

            const sizeSlider = centerGrp.createEl('input', { type: 'range' });
            sizeSlider.min = "1"; sizeSlider.max = "50"; 
            sizeSlider.value = api.getSize().toString(); 
            sizeSlider.style.width = "80px";
            sizeSlider.oninput = (e) => {
                api.setSize(parseInt((e.target as HTMLInputElement).value));
            };

            const colors = ['#000000', '#ff4d4d', '#3366ff', '#00cc66'];
            const colorBtns: HTMLElement[] = [];
            colors.forEach(c => {
                const cBtn = centerGrp.createDiv();
                cBtn.style.width = '20px'; cBtn.style.height = '20px';
                cBtn.style.borderRadius = '50%';
                cBtn.style.backgroundColor = c;
                cBtn.style.cursor = 'pointer';
                cBtn.style.border = c === api.getColor() ? '2px solid var(--text-normal)' : '2px solid transparent';
                
                cBtn.onclick = () => {
                    api.setColor(c);
                    api.setTool('pen');
                    updateToolUI();
                };
                colorBtns.push(cBtn);
            });

            view.containerEl.addEventListener('cornell-force-red-pen', () => {
                api.setColor('#ff4d4d');
                api.setTool('pen');
                updateToolUI(); 
            });

            const rightGrp = topBar.createDiv({ attr: { style: 'display:flex; gap:10px;' } });
            
            const clearBtn = rightGrp.createEl('button', { title: 'Clear Canvas' });
            setIcon(clearBtn, "trash-2");
            clearBtn.style.boxShadow = 'none';
            clearBtn.onclick = () => {
                api.clear();
            };

            // BOTÓN MÁGICO OCR CON WHITELIST
            const ocrBtn = rightGrp.createEl('button', { text: '🔤 OCR', title: 'Convert handwriting to editable text' });
            ocrBtn.style.backgroundColor = 'var(--background-modifier-success)';
            ocrBtn.style.color = 'var(--text-on-accent)';
            
            ocrBtn.onclick = async () => {
                let ocrTargetCanvas: HTMLCanvasElement;
                let startX = 0, startY = 0, boxWidth = 300, boxHeight = 100;
                let isSelectionMode = false;

                const phase = api.getSelectionPhase();
                const fCanvas = api.getFloatingCanvas();
                const rect = api.getSelectionRect();

                if (phase === 'floating' && fCanvas) {
                    isSelectionMode = true;
                    startX = rect.x; startY = rect.y; boxWidth = rect.w; boxHeight = rect.h;
                    ocrTargetCanvas = getOCROptimizedCanvas(fCanvas, {minX: 0, minY: 0, maxX: fCanvas.width, maxY: fCanvas.height});
                } else {
                    const bounds = api.getBounds();
                    if (bounds.minX === Infinity) {
                        new Notice("¡El lienzo está vacío! Dibuja o selecciona letras primero.");
                        return;
                    }
                    startX = bounds.minX; startY = bounds.minY; boxWidth = bounds.maxX - bounds.minX; boxHeight = bounds.maxY - bounds.minY;
                    ocrTargetCanvas = getOCROptimizedCanvas(view.zenCanvasEl, bounds);
                    api.commitSelection();
                }

                const notice = new Notice("⏳ Iniciando motor OCR... (Puede tardar la primera vez)", 0);
                
                try {
                    const Tesseract = await loadTesseract();
                    const imageData = ocrTargetCanvas.toDataURL("image/png");
                    notice.setMessage("🔍 Analizando trazos...");
                    
                    const worker = await Tesseract.createWorker('spa+eng');
                    await worker.setParameters({
                        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789áéíóúÁÉÍÓÚñÑ.,¿?¡!-() '
                    });
                    
                    const result = await worker.recognize(imageData);
                    const text = result.data.text.trim();
                    await worker.terminate();
                    
                    if (text) {
                        await navigator.clipboard.writeText(text);
                        
                        if (isSelectionMode) api.clearSelection();
                        else api.fillWhiteRect(startX - 10, startY - 10, boxWidth + 20, boxHeight + 20);

                        const input = document.createElement("textarea");
                        input.value = text;
                        input.style.position = "absolute";
                        input.style.left = `${startX}px`;
                        input.style.top = `${startY}px`;
                        input.style.width = `${Math.max(250, boxWidth + 50)}px`;
                        input.style.height = `${Math.max(60, boxHeight + 50)}px`;
                        input.style.background = "#ffffff";
                        input.style.color = api.getColor() === '#ffffff' ? '#000000' : api.getColor();
                        
                        const fontSize = Math.max(24, api.getSize() * 6);
                        input.style.fontSize = `${fontSize}px`;
                        input.style.fontFamily = "sans-serif";
                        input.style.border = "2px dashed var(--interactive-accent)";
                        input.style.borderRadius = "8px";
                        input.style.padding = "10px";
                        input.style.outline = "none";
                        input.style.resize = "both";
                        input.style.zIndex = "1000";
                        
                        scrollWrapper.appendChild(input);
                        input.focus();

                        const finalizeText = () => {
                            const finalStr = input.value;
                            if (finalStr) {
                                const finalX = parseInt(input.style.left) + 10;
                                const finalY = parseInt(input.style.top) + 10;
                                const finalW = parseInt(input.style.width);
                                const finalH = parseInt(input.style.height);

                                api.fillWhiteRect(parseInt(input.style.left), parseInt(input.style.top), finalW, finalH);

                                view.zenCtx.font = `${fontSize}px sans-serif`;
                                view.zenCtx.fillStyle = input.style.color;
                                view.zenCtx.textBaseline = "top";
                                
                                const lines = finalStr.split('\n');
                                let currentY = finalY;
                                const lineHeight = fontSize * 1.2;
                                
                                lines.forEach(line => {
                                    view.zenCtx.fillText(line, finalX, currentY);
                                    api.forceUpdateBounds(finalX, currentY, fontSize * line.length); 
                                    currentY += lineHeight;
                                });
                            }
                            input.remove();
                        };

                        input.onblur = finalizeText;
                        input.onkeydown = (e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                input.blur();
                            }
                        };

                        notice.hide();
                        new Notice(`✅ ¡Texto inyectado! Edítalo y presiona Enter para fijarlo.`, 6000);
                    } else {
                        notice.hide();
                        new Notice("❌ No se reconoció ningún texto claro.");
                    }
                } catch (error) {
                    console.error("OCR Error:", error);
                    notice.hide();
                    new Notice("⚠️ Hubo un error procesando el OCR.");
                }
            };

            const attachBtn = rightGrp.createEl('button', { text: '📌 Attach to Board', title: 'Save and add to Pinboard' });
            attachBtn.onclick = async () => {
                api.commitSelection();
                attachBtn.innerText = '⏳...';
                
                const croppedCanvas = getHybridCroppedCanvas(view.zenCanvasEl, api.getBounds());
                const dataUrl = croppedCanvas.toDataURL("image/png");
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
                api.clear();
                view.applyFiltersAndRender();
            };

            const zapBtn = rightGrp.createEl('button', { text: '⚡ Omni-Capture', cls: 'mod-cta', title: 'Save instantly to Omni-Capture Destination' });
            zapBtn.style.backgroundColor = 'var(--interactive-accent)';
            zapBtn.style.color = 'var(--text-on-accent)';
            
            zapBtn.onclick = async () => {
                api.commitSelection();
                zapBtn.innerText = '⏳ Saving...';
                
                const croppedCanvas = getHybridCroppedCanvas(view.zenCanvasEl, api.getBounds());
                const dataUrl = croppedCanvas.toDataURL("image/png");
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
                    api.clear();
                    view.applyFiltersAndRender();
                    
                } catch (error) {
                    console.error(error);
                    zapBtn.innerText = '⚡ Omni-Capture';
                    new Notice("Error guardando el Doodle. Revisa la consola.");
                }
            };

            const updateToolUI = () => {
                handBtn.removeClass("mod-cta");
                penBtn.removeClass("mod-cta");
                eraserBtn.removeClass("mod-cta");
                selectBtn.removeClass("mod-cta");
                if (view.zenCanvasEl) view.zenCanvasEl.style.cursor = 'crosshair';

                const currentTool = api.getTool();
                if (currentTool === 'hand') {
                    handBtn.addClass("mod-cta");
                    if (view.zenCanvasEl) view.zenCanvasEl.style.cursor = 'grab';
                } else if (currentTool === 'pen') {
                    penBtn.addClass("mod-cta");
                } else if (currentTool === 'eraser') {
                    eraserBtn.addClass("mod-cta");
                } else if (currentTool === 'select') {
                    selectBtn.addClass("mod-cta");
                    if (view.zenCanvasEl) view.zenCanvasEl.style.cursor = 'cell';
                }

                const currentColor = api.getColor();
                colorBtns.forEach(btn => btn.style.border = '2px solid transparent');
                const activeColorBtn = colorBtns.find(b => b.style.backgroundColor === currentColor || b.style.backgroundColor === `rgb(${parseInt(currentColor.slice(1,3), 16)}, ${parseInt(currentColor.slice(3,5), 16)}, ${parseInt(currentColor.slice(5,7), 16)})`);
                if (activeColorBtn) activeColorBtn.style.border = '2px solid var(--text-normal)';
            };

            handBtn.onclick = () => { api.setTool('hand'); updateToolUI(); };
            selectBtn.onclick = () => { api.setTool('select'); updateToolUI(); };
            penBtn.onclick = () => { api.setTool('pen'); updateToolUI(); };
            eraserBtn.onclick = () => { api.setTool('eraser'); updateToolUI(); };

            const scrollWrapper = zenContainer.createDiv();
            scrollWrapper.style.flexGrow = "1";
            scrollWrapper.style.overflow = "auto";
            scrollWrapper.style.border = "2px dashed var(--background-modifier-border)";
            scrollWrapper.style.borderRadius = "8px";
            scrollWrapper.style.backgroundColor = "var(--background-secondary-alt)"; 
            scrollWrapper.style.position = "relative"; 

            scrollWrapper.appendChild(view.zenCanvasEl);
            scrollWrapper.appendChild(api.getOverlay());
            
            updateToolUI();

            setTimeout(() => {
                if (scrollWrapper.scrollLeft === 0 && scrollWrapper.scrollTop === 0) {
                    scrollWrapper.scrollLeft = (view.zenCanvasEl.width - scrollWrapper.clientWidth) / 2;
                    scrollWrapper.scrollTop = (view.zenCanvasEl.height - scrollWrapper.clientHeight) / 2;
                }
            }, 10);
        };
    }

    unload(): void {
        if (this.originalRenderZenDoodle) {
            CornellNotesView.prototype.renderZenDoodle = this.originalRenderZenDoodle as any;
        }
    }
}