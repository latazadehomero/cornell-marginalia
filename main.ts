import { Plugin, App, MarkdownRenderer, Component } from 'obsidian';
import { RangeSetBuilder } from '@codemirror/state';
import { 
    EditorView, 
    Decoration, 
    DecorationSet, 
    ViewPlugin, 
    ViewUpdate, 
    WidgetType
} from '@codemirror/view';

// 1. EL WIDGET (Ahora renderiza Markdown real)
class MarginNoteWidget extends WidgetType {
    // Necesitamos recibir la 'app' para poder renderizar links
    constructor(readonly text: string, readonly app: App) { super(); }

    toDOM(view: EditorView): HTMLElement {
        const div = document.createElement("div");
        div.className = "cm-cornell-margin";
        

        MarkdownRenderer.render(
            this.app,
            this.text,
            div,
            "", 
            new Component() 
        );

        // Evitar que el click en la nota active la edición inmediata (opcional)
        // Pero permitimos click en links
        div.onclick = (e) => {
            const target = e.target as HTMLElement;
            // Si el click fue en un link, dejamos que pase. Si no, prevenimos.
            if (target.tagName !== 'A') {
                e.preventDefault();
            }
        };
        
        return div;
    }

    ignoreEvent() { return false; } 
}

// 2. EL PLUGIN DE VISTA (Ahora recibe la 'app')
const createCornellExtension = (app: App) => ViewPlugin.fromClass(class {
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
        const { state } = view;
        const cursorRanges = state.selection.ranges;

        for (const { from, to } of view.visibleRanges) {
            const text = state.doc.sliceString(from, to);
            // Regex para buscar %%> ... %%
            const regex = /%%>(.*?)%%/g;
            let match;

            while ((match = regex.exec(text))) {
                const start = from + match.index;
                const end = start + match[0].length;

                let isCursorInside = false;
                for (const range of cursorRanges) {
                    if (range.from >= start && range.to <= end) {
                        isCursorInside = true;
                        break;
                    }
                }

                if (isCursorInside) continue;

                builder.add(start, end, Decoration.replace({
                    // Pasamos la APP al widget aquí abajo
                    widget: new MarginNoteWidget(match[1], app)
                }));
            }
        }
        return builder.finish();
    }
}, {
    decorations: v => v.decorations
});

// 3. EL PLUGIN PRINCIPAL
export default class CornellMarginalia extends Plugin {
    async onload() {
        console.log("Cornell Marginalia (Rich Text) cargado 🩺");
        // Al registrar la extensión, le pasamos 'this.app'
        this.registerEditorExtension(createCornellExtension(this.app));
    }
}
