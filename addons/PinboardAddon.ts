import { WorkspaceLeaf } from "obsidian";
import { CornellAddon } from "./CornellAddon"; // Tu clase abstracta
import CornellMarginalia from "../main";
import { PinboardView, PINBOARD_VIEW_TYPE } from "./PinboardView";

export class PinboardAddon extends CornellAddon {
    id = "spatial-pinboard";
    name = "Lienzo Espacial 🌌";
    description = "Un lienzo infinito de forma libre para arrastrar, conectar y materializar marginalias.";

    constructor(plugin: CornellMarginalia) {
        super(plugin);
    }

    load(): void {
        console.log(`[Cornell] Encendiendo Addon: ${this.name}`);

        // 1. Le enseñamos a Obsidian qué es un "PinboardView"
        //this.plugin.registerView(
        //    PINBOARD_VIEW_TYPE,
        //    (leaf: WorkspaceLeaf) => new PinboardView(leaf, this.plugin)
        //);

        // 2. Agregamos un comando para abrirlo (Ctrl/Cmd + P)
        this.plugin.addCommand({
            id: 'open-pinboard-view',
            name: 'Abrir Lienzo Espacial (Whiteboard)',
            callback: () => this.activateView()
        });

        // 3. (Opcional) Agregamos un botón en la barra lateral
        this.plugin.addRibbonIcon("map", "Abrir Lienzo Espacial", () => {
            this.activateView();
        });
    }

    unload(): void {
        console.log(`[Cornell] Apagando Addon: ${this.name}`);
        // Cerramos todas las pestañas del lienzo si el usuario apaga el addon
        this.plugin.app.workspace.detachLeavesOfType(PINBOARD_VIEW_TYPE);
    }

    // Método de utilidad para enfocar o crear la pestaña
    async activateView() {
        const { workspace } = this.plugin.app;
        
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(PINBOARD_VIEW_TYPE);

        if (leaves.length > 0) {
            // Si ya está abierto, lo traemos al frente
            leaf = leaves[0];
        } else {
            // Si no, abrimos una nueva pestaña principal
            leaf = workspace.getLeaf(true); 
            if (leaf) {
                await leaf.setViewState({ type: PINBOARD_VIEW_TYPE, active: true });
            }
        }

        if (leaf) workspace.revealLeaf(leaf);
    }
}
