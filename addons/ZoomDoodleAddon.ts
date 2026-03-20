import CornellMarginalia from "../main";

export abstract class CornellAddon {
    abstract id: string;
    abstract name: string;
    abstract description: string;
    constructor(public plugin: CornellMarginalia) {}
    abstract load(): void;
    abstract unload(): void;
}

export class ZoomDoodleAddon extends CornellAddon {
    id = "zoom-doodle";
    name = "🔍 Zoom & Pan Doodles";
    description = "Haz clic en cualquier imagen o doodle en tus marginalias para expandirla a pantalla completa con controles de zoom y paneo.";

    // Definimos el manejador como una Arrow Function para conservar el contexto 'this'
    private clickHandler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        
        // 1. Verificamos si el usuario hizo clic en una imagen
        if (target.tagName === 'IMG') {
            // 2. Verificamos si la imagen está dentro de una nota marginal o en la barra lateral
            const isInsideMarginalia = target.closest('.cm-cornell-margin') || 
                                       target.closest('.cornell-sidebar-item') || 
                                       target.closest('.cornell-pinboard-item');
            
            if (isInsideMarginalia) {
                e.preventDefault();
                e.stopPropagation();
                
                // Ejecutamos la lógica de pantalla completa
                this.openLightbox(target as HTMLImageElement);
            }
        }
    };

    load(): void {
        // Al encender el Addon, delegamos la escucha de clics a nivel global
        document.body.addEventListener('click', this.clickHandler);
    }

    unload(): void {
        // Al apagar el Addon, limpiamos la memoria retirando el evento
        document.body.removeEventListener('click', this.clickHandler);
    }

    // --- 🖼️ MOTOR DE PANTALLA COMPLETA (LIGHTBOX) ---
    private openLightbox(imgEl: HTMLImageElement) {
        const imgSrc = imgEl.src;

        // 1. Contenedor principal oscuro
        const overlay = document.body.createDiv({ cls: 'cornell-lightbox-overlay' });
        overlay.style.position = 'fixed';
        overlay.style.top = '0'; 
        overlay.style.left = '0';
        overlay.style.width = '100vw'; 
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.justifyContent = 'center';
        overlay.style.alignItems = 'center';
        overlay.style.overflow = 'hidden';

        // 2. Contenedor de la imagen para aplicar transformaciones de física (Zoom/Pan)
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

        // 3. Inversión de color inteligente (soporte para temas oscuros)
        if (document.body.classList.contains('theme-dark') && imgSrc.includes('doodle_')) {
            bigImg.style.filter = 'invert(1)';
            bigImg.style.opacity = '0.9';
        }

        // --- 🔍 LÓGICA DE ZOOM Y PANEO ---
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
            imgContainer.style.transition = "none"; // Desactivar transición para arrastre instantáneo
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

        // --- ❌ CERRAR LIGHTBOX ---
        const closeLightbox = () => {
            overlay.remove();
            document.removeEventListener('keydown', escListener);
        };

        // Clic fuera de la imagen (en el fondo negro) cierra la vista
        overlay.addEventListener("mousedown", (e) => {
            if (e.target === overlay) closeLightbox();
        });

        // Esc cierra la vista
        const escListener = (evKey: KeyboardEvent) => {
            if (evKey.key === 'Escape') closeLightbox();
        };
        document.addEventListener('keydown', escListener);
    }
}
