// /addons/DashboardAddon.ts
import { App, WorkspaceLeaf, setIcon } from "obsidian";
import CornellMarginalia from "../main";
import { CornellAddon } from "./CornellAddon";
import { CornellDashboardView, DASHBOARD_VIEW_TYPE } from "./DashboardView"; // Asumimos que la vista estará en otro archivo

export class DashboardAddon extends CornellAddon {
    id = "ultimate-dashboard";
    name = "Cornell Dashboard 🚀";
    description = "El centro de comando definitivo: Calendario, Rutinas, Margidoro y Repaso Espaciado.";

    constructor(plugin: CornellMarginalia) {
        super(plugin);
    }

    load(): void {
        console.log(`Cargando addon: ${this.name}`);

        // 1. Registrar la vista personalizada en Obsidian
        this.plugin.registerView(
            DASHBOARD_VIEW_TYPE,
            (leaf: WorkspaceLeaf) => new CornellDashboardView(leaf, this.plugin)
        );

        // 2. Añadir un icono en la barra lateral izquierda (Ribbon) para abrir el Dashboard
        this.plugin.addRibbonIcon("layout-dashboard", "Abrir Cornell Dashboard", () => {
            this.activateView();
        });

        // 3. (Opcional) Añadir un comando en la paleta de comandos (Ctrl/Cmd + P)
        this.plugin.addCommand({
            id: 'open-cornell-dashboard',
            name: 'Abrir Dashboard de Estudio',
            callback: () => this.activateView()
        });
    }

    unload(): void {
        console.log(`Descargando addon: ${this.name}`);
        
        // Limpiar todas las hojas (hojas de trabajo) que tengan abierta nuestra vista
        this.plugin.app.workspace.detachLeavesOfType(DASHBOARD_VIEW_TYPE);
    }

    /**
     * Lógica para abrir la vista del dashboard de manera segura.
     * Si ya está abierta, la enfoca. Si no, crea una nueva pestaña.
     */
    async activateView() {
        const { workspace } = this.plugin.app;

        // Verificar si la vista ya está abierta
        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);

        if (leaves.length > 0) {
            // Si ya existe, simplemente la traemos al frente
            leaf = leaves[0];
        } else {
            // Si no existe, creamos una nueva pestaña en el centro
            leaf = workspace.getLeaf(true); // 'true' abre una nueva pestaña
            if (leaf) {
                await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
            }
        }

        // Enfocar la pestaña
        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }
}
