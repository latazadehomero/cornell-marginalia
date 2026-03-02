import CornellMarginalia from "../main";
import { CornellAddon } from "./CornellAddon"; 
import { App, Modal, Notice } from "obsidian";

// 1. LA CLASE DEL ADDON (¡Esta es la que se había borrado!)
export class BlurtingAddon extends CornellAddon {
    id = "blurting-mode";
    name = "🧠 Blurting Mode (1-3-7)";
    description = "Turn your Marginalia Explorer into a Spaced Repetition study deck.";

    constructor(public plugin: CornellMarginalia) {
        super(plugin);
    }

    load(): void {
        console.log("🧠 Blurting Mode Addon enabled");
    }

    unload(): void {
        console.log("🛑 Blurting Mode Addon disabled");
    }
}

// 2. EL MODAL DE DECISIÓN CONECTADO A LA VISTA
export class BlurtingSetupModal extends Modal {
    view: any; // 👈 Añadimos espacio para guardar la vista
    deck: any[];

    // 👈 Añadimos 'view' como segundo parámetro en el constructor
    constructor(app: App, view: any, deck: any[]) {
        super(app);
        this.view = view;
        this.deck = deck; 
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: "🧠 Start Blurting Session" });
        contentEl.createEl("p", { 
            text: `You are about to test your memory on a deck of ${this.deck.length} marginalias. Choose your output format:`,
            attr: { style: "color: var(--text-muted); margin-bottom: 20px;"}
        });

        const btnContainer = contentEl.createDiv({ attr: { style: "display: flex; gap: 15px; justify-content: center;" } });

        const visualBtn = btnContainer.createEl("button", { text: "🎨 Visual (ZenCanvas)", cls: "mod-cta" });
        visualBtn.style.backgroundColor = "var(--color-purple)";
        visualBtn.onclick = () => this.startSession("visual");

        const textBtn = btnContainer.createEl("button", { text: "📝 Textual (ZK Note)", cls: "mod-cta" });
        textBtn.style.backgroundColor = "var(--interactive-accent)";
        textBtn.onclick = () => this.startSession("textual");
    }

    startSession(format: "visual" | "textual") {
        new Notice(`Starting ${format} blurting session! 🚀`);
        
        // 👈 LA MAGIA: Le decimos a la vista que encienda el escudo y abra la nota/canvas
        this.view.startBlurtingSession(this.deck, format);
        
        this.close();
    }

    onClose() { this.contentEl.empty(); }
}