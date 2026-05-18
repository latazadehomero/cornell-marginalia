import { App, Notice, Modal, TFile, getAllTags } from "obsidian";
import { CornellAddon } from "./CornellAddon";
import type CornellMarginalia from "../main";
import { sanitizeAnkiDeckName } from "../main";

export class AnkiSyncAddon extends CornellAddon {
    id = "anki-sync";
    name = "Anki Advanced Sync";
    description = "Syncs marginalias to Anki with bidirectional support, native images, and PDF++ crops.";

    recentDecks: string[] = [];

    load(): void {
        // 1. Comando Individual (Nota Activa)
        this.plugin.addCommand({
            id: 'sync-cornell-to-anki',
            name: 'Sync Flashcards to Anki (Current Note)',
            callback: () => this.startSyncProcess()
        });

        // 2. Comando Masivo (Bóveda Completa)
        this.plugin.addCommand({
            id: 'sync-vault-to-anki',
            name: 'Sync ALL Vault Flashcards to Anki (Tag-Mapped)',
            callback: () => this.syncAllVaultCards()
        });
    }

    unload(): void {}

    async invokeAnki(action: string, params: any = {}): Promise<any> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const response = await fetch('http://localhost:8765', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, version: 6, params }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            const data = await response.json();
            if (data.error) throw new Error(`Anki API Error: ${data.error}`);
            
            return data.result;
        } catch (error) {
            console.error("AnkiConnect connection failed:", error);
            throw new Notice("⚠️ Could not connect to Anki. Is Anki open with AnkiConnect installed?");
        }
    }

    async startSyncProcess() {
        const activeFile = this.plugin.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("⚠️ Open a note first.");
            return;
        }
        new AnkiDeckModal(this.plugin.app, this, activeFile).open();
    }

    async syncAllVaultCards() {
        const mappings = this.plugin.settings.ankiTagToDeck;
        if (!mappings || Object.keys(mappings).length === 0) {
            new Notice("⚠️ No routes configured. Go to plugin settings and map tags to Anki decks.");
            return;
        }

        new Notice("🚀 Scanning the entire vault... This may take a few seconds.");
        const files = this.plugin.app.vault.getMarkdownFiles();
        
        let totalAdded = 0;
        let totalUpdated = 0;
        let processedFiles = 0;

        for (const file of files) {
            const cache = this.plugin.app.metadataCache.getFileCache(file);
            if (!cache) continue;
            
            const tags = getAllTags(cache) || [];
            
            let targetDeck: string | null = null;
            for (const tag of tags) {
                if (mappings[tag]) {
                    targetDeck = mappings[tag];
                    break;
                }
            }

            if (targetDeck) {
                try {
                    const result = await this.syncSingleFileCore(file, targetDeck);
                    if (result.added > 0 || result.updated > 0) {
                        totalAdded += result.added;
                        totalUpdated += result.updated;
                        processedFiles++;
                    }
                } catch (e: any) {
                    console.error(`Error sincronizando ${file.basename}:`, e);
                }
            }
        }

        new Notice(`✅ Bulk Sync Completed!\n📄 Notes processed: ${processedFiles}\n✨ New Cards: ${totalAdded}\n🔄 Updated: ${totalUpdated}`);
    }

    async extractPdfRegionAsBase64(pdfFilename: string, pageNum: number, rect: number[]): Promise<string | null> {
        try {
            const pdfFile = this.plugin.app.metadataCache.getFirstLinkpathDest(pdfFilename, "");
            if (!pdfFile) return null;

            const arrayBuffer = await this.plugin.app.vault.readBinary(pdfFile);
            const bufferClone = arrayBuffer.slice(0);
            
            // @ts-ignore
            const pdf = await window.pdfjsLib.getDocument({ data: bufferClone }).promise;
            const page = await pdf.getPage(pageNum);
            
            const scale = 2.0; 
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if(!ctx) return null;

            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            await page.render({ canvasContext: ctx, viewport }).promise;

            const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle(rect);
            const x = Math.min(vx1, vx2);
            const y = Math.min(vy1, vy2);
            const w = Math.abs(vx2 - vx1);
            const h = Math.abs(vy2 - vy1);

            const padding = 10; 
            const finalX = Math.max(0, x - padding);
            const finalY = Math.max(0, y - padding);
            const finalW = Math.min(canvas.width - finalX, w + (padding * 2));
            const finalH = Math.min(canvas.height - finalY, h + (padding * 2));

            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = finalW;
            cropCanvas.height = finalH;
            
            const cropCtx = cropCanvas.getContext('2d');
            if (cropCtx) {
                cropCtx.fillStyle = "#ffffff";
                cropCtx.fillRect(0, 0, finalW, finalH);
                cropCtx.drawImage(canvas, finalX, finalY, finalW, finalH, 0, 0, finalW, finalH);
            }

            const dataUrl = cropCanvas.toDataURL('image/png');
            return dataUrl.replace(/^data:image\/png;base64,/, "");
        } catch (e) {
            console.error("Error procesando PDF++:", e);
            return null;
        }
    }

    async processMediaInText(text: string): Promise<string> {
        let processedText = text;

        const pdfRegex = /!\[\[([\s\S]*?\.pdf)#page=(\d+)&rect=([\d.,\s]+).*?\]\]/gis;
        let pdfMatch;
        while ((pdfMatch = pdfRegex.exec(processedText)) !== null) {
            const filename = pdfMatch[1].replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
            const page = parseInt(pdfMatch[2]);
            const cleanRectStr = pdfMatch[3].replace(/\s+/g, ''); 
            const rect = cleanRectStr.split(',').map(Number); 

            const base64Data = await this.extractPdfRegionAsBase64(filename, page, rect);
            if (base64Data) {
                const ankiFilename = `pdf_extract_${Date.now()}.png`;
                await this.invokeAnki('storeMediaFile', { filename: ankiFilename, data: base64Data });
                processedText = processedText.replace(pdfMatch[0], `<img src="${ankiFilename}">`);
            }
        }

        // Regex para capturar imágenes incrustadas nativas
        const imgRegex = /!\[\[(.*?\.(?:png|jpg|jpeg|gif|svg))\]\]/gi;
        let imgMatch;
        while ((imgMatch = imgRegex.exec(processedText)) !== null) {
            // OPTIMIZACIÓN: Limpiamos barras inclinadas iniciales '/' que hereda de Zotflow
            const filenameRaw = imgMatch[1].trim();
            const filename = filenameRaw.replace(/^\/+/, ""); 

            const file = this.plugin.app.metadataCache.getFirstLinkpathDest(filename, "");
            if (file) {
                const arrayBuffer = await this.plugin.app.vault.readBinary(file);
                // @ts-ignore
                const base64Data = Buffer.from(arrayBuffer).toString('base64');
                await this.invokeAnki('storeMediaFile', { filename, data: base64Data });
                processedText = processedText.replace(imgMatch[0], `<img src="${filename}">`);
            }
        }

        return processedText;
    }

    /**
     * Resuelve enlaces de bloques e incorpora un pipeline estricto de limpieza
     * para remover la sintaxis de metadatos generada por Zotflow.
     */
    async resolveBlockEmbeds(text: string, sourceFile: TFile): Promise<string> {
        const blockEmbedRegex = /!\[\[([^#\]|]+)#\^([a-zA-Z0-9-]+)\]\]/g;
        let processedText = text;
        
        const matches = Array.from(text.matchAll(blockEmbedRegex));
        
        for (const match of matches) {
            const [fullMatch, linkPath, blockId] = match;
            
            let targetFile = this.plugin.app.metadataCache.getFirstLinkpathDest(linkPath.trim(), sourceFile.path);
            
            if (!targetFile) {
                const cleanPath = linkPath.trim();
                targetFile = this.plugin.app.vault.getAbstractFileByPath(cleanPath) as TFile ||
                             this.plugin.app.vault.getAbstractFileByPath(cleanPath + ".md") as TFile;
            }

            if (targetFile instanceof TFile) {
                const cache = this.plugin.app.metadataCache.getFileCache(targetFile);
                const blockData = cache?.blocks?.[blockId.toLowerCase()] || cache?.blocks?.[blockId];
                
                let extractedText = "";

                if (blockData) {
                    const content = await this.plugin.app.vault.read(targetFile);
                    extractedText = content.substring(blockData.position.start.offset, blockData.position.end.offset);
                } else {
                    const content = await this.plugin.app.vault.read(targetFile);
                    const lines = content.split("\n");
                    const targetLine = lines.find(l => l.includes(`^${blockId}`));
                    if (targetLine) extractedText = targetLine;
                }

                if (extractedText) {
                    // --- PIPELINE DE LIMPIEZA ESTRICTA (ZOTFLOW & CALLOUTS) ---
                    
                    // 1. Quitar el ID de bloque al final (ej: ^AFXXIY55)
                    let cleanText = extractedText.replace(new RegExp(`\\^${blockId}`, "gi"), "");

                    // 2. Eliminar cabeceras de callout de Zotflow (ej: [!zotflow-highlight-#e56eee])
                    cleanText = cleanText.replace(/\[!zotflow-[^\]]+\]/gi, "");

                    // 3. Eliminar links a PDFs del tipo [[archivo.pdf...|display]] sin romper los embeds de imagen ![[...]]
                    // Se usa un Lookbehind Negativo (?<!!) para asegurar que si hay un '!' antes, no lo toque.
                    cleanText = cleanText.replace(/(?<!!)\[\[.*?\]\]/g, "");

                    // 4. Limpiar caracteres '>' remanentes de bloques de cita y formatear espacios
                    cleanText = cleanText
                        .replace(/>/g, "") // Remueve selectivamente todos los símbolos de cita remanentes
                        .trim();
                    
                    processedText = processedText.replace(fullMatch, cleanText);
                }
            } else {
                console.warn(`AnkiSync: No se pudo encontrar el archivo de cita: ${linkPath}`);
            }
        }
        return processedText;
    }

    async processAndSendCards(file: TFile, deckName: string) {
        new Notice(`⏳ Syncing ${file.basename} with Anki...`);
        try {
            const result = await this.syncSingleFileCore(file, deckName);
            if (result.added === 0 && result.updated === 0) {
                new Notice("⚠️ No flashcards found.");
            } else {
                new Notice(`✅ Anki Sync: ${result.added} created, ${result.updated} updated in "${deckName}".`);
            }
        } catch (error: any) {
            new Notice(`❌ Anki Error: ${error.message}`);
        }
    }

    async syncSingleFileCore(file: TFile, deckName: string): Promise<{added: number, updated: number}> {
        const decks = await this.invokeAnki('deckNames');
        if (!decks.includes(deckName)) {
            await this.invokeAnki('createDeck', { deck: deckName });
        }

        const models = await this.invokeAnki('modelNames');
        let modelName = "Basic";
        if (!models.includes("Basic")) {
            if (models.includes("Básico")) modelName = "Básico";
            else modelName = models[0]; 
        }

        const modelFields = await this.invokeAnki('modelFieldNames', { modelName });
        if (modelFields.length < 2) throw new Error(`The Anki model "${modelName}" doesn't have enough fields.`);
        const frontField = modelFields[0]; 
        const backField = modelFields[1];  

        let content = await this.plugin.app.vault.read(file);
        const cache = this.plugin.app.metadataCache.getFileCache(file);
        const noteTags = cache ? (getAllTags(cache)?.map(t => t.replace('#', '')) || []) : [];

        const flashcardRegex = /%%([><])\s*([\s\S]*?)\s*; Nano\s*([\s\S]*?)%%/g;
        // Ajuste preventivo del Regex general por si cambia delimitador, manteniendo fallback estándar:
        const standardRegex = /%%([><])\s*([\s\S]*?)\s*;;\s*([\s\S]*?)%%/g;
        const activeRegex = content.match(standardRegex) ? standardRegex : flashcardRegex;

        let match;
        let added = 0, updated = 0;
        const replacements: { start: number, end: number, text: string }[] = [];

        while ((match = activeRegex.exec(content)) !== null) {
            const fullMatch = match[0];
            const direction = match[1];
            const questionRaw = match[2].trim(); 
            const trailingData = match[3] || ""; 

            const ankiIdMatch = trailingData.match(/[\^~]anki-(\d+)/);
            const existingAnkiId = ankiIdMatch ? ankiIdMatch[1] : null;

            let blockStart = content.lastIndexOf('\n\n', match.index);
            blockStart = blockStart === -1 ? 0 : blockStart + 2;

            let blockEnd = content.indexOf('\n\n', match.index + fullMatch.length);
            blockEnd = blockEnd === -1 ? content.length : blockEnd;

            const fullBlock = content.substring(blockStart, blockEnd);

            let answerRaw = fullBlock.replace(fullMatch, ''); 
            
            // 1. Resolver e inyectar el texto limpio de Zotflow
            answerRaw = await this.resolveBlockEmbeds(answerRaw, file);

            // 2. Procesar conversiones de Medios a etiquetas HTML de Anki
            const questionHtml = await this.processMediaInText(questionRaw);
            const answerHtml = await this.processMediaInText(answerRaw);

            // 3. Limpieza final de IDs huérfanos
            let finalAnswer = answerHtml
                .replace(/^---[\s\S]*?---\s*/, '') 
                .replace(/(?<!#)[\^~“][a-zA-Z0-9-]{5,}/g, '') 
                .trim();

            const noteParams = {
                deckName: deckName,
                modelName: modelName,
                fields: { [frontField]: questionHtml, [backField]: finalAnswer },
                options: { allowDuplicate: false }, 
                tags: noteTags
            };

            let finalAnkiId = existingAnkiId;

            if (existingAnkiId) {
                try {
                    await this.invokeAnki('updateNoteFields', { 
                        note: { id: parseInt(existingAnkiId, 10), fields: noteParams.fields } 
                    });
                    updated++;
                } catch (e: any) {
                    finalAnkiId = await this.invokeAnki('addNote', { note: noteParams });
                    added++;
                }
            } else {
                try {
                    finalAnkiId = await this.invokeAnki('addNote', { note: noteParams });
                    added++;
                } catch (e: any) {
                    if (e.message && e.message.includes("duplicate")) {
                        const safeQuery = questionHtml.replace(/"/g, '\\"');
                        const foundIds = await this.invokeAnki('findNotes', { query: `"${frontField}:${safeQuery}"` });
                        
                        if (foundIds && foundIds.length > 0) {
                            finalAnkiId = foundIds[0].toString();
                            await this.invokeAnki('updateNoteFields', { 
                                note: { id: parseInt(finalAnkiId as string, 10), fields: noteParams.fields } 
                            });
                            updated++;
                        }
                    } else {
                        throw e; 
                    }
                }
            }

            if (finalAnkiId) {
                let newTrailingData = trailingData;
                if (existingAnkiId) {
                    newTrailingData = newTrailingData.replace(/[\^~]anki-\d+/, `^anki-${finalAnkiId}`);
                } else {
                    newTrailingData = `^anki-${finalAnkiId} ` + newTrailingData;
                }
                
                const updatedMatch = activeRegex === standardRegex 
                    ? `%%${direction} ${questionRaw} ;; ${newTrailingData.trim()} %%`
                    : `%%${direction} ${questionRaw} ; ${newTrailingData.trim()} %%`;

                replacements.push({
                    start: match.index,
                    end: match.index + fullMatch.length,
                    text: updatedMatch
                });
            }
        }

        if (replacements.length > 0) {
            replacements.sort((a, b) => b.start - a.start);
            for (const rep of replacements) {
                content = content.substring(0, rep.start) + rep.text + content.substring(rep.end);
            }
            await this.plugin.app.vault.modify(file, content);
        }

        return { added, updated };
    }
}

class AnkiDeckModal extends Modal {
    addon: AnkiSyncAddon;
    file: TFile;
    deckInput!: HTMLInputElement;

    constructor(app: App, addon: AnkiSyncAddon, file: TFile) {
        super(app);
        this.addon = addon;
        this.file = file;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "🧠 Sync with Anki" });

        const inputDiv = contentEl.createDiv({ attr: { style: "margin-bottom: 15px;" }});
        inputDiv.createEl("label", { text: "Deck Name (e.g. Med::Cardio): ", attr: { style: "display:block; margin-bottom:5px;" }});
        
        this.deckInput = inputDiv.createEl("input", { type: "text", placeholder: "Deck::Subdeck" });
        this.deckInput.style.width = "100%";
        
        if (this.addon.recentDecks && this.addon.recentDecks.length > 0) {
            this.deckInput.value = this.addon.recentDecks[0];
        }

        if (this.addon.recentDecks && this.addon.recentDecks.length > 0) {
            const historyDiv = contentEl.createDiv({ attr: { style: "margin-bottom: 20px; display: flex; gap: 5px; flex-wrap: wrap;" }});
            historyDiv.createEl("span", { text: "Recientes:", attr: { style: "font-size: 0.85em; color: var(--text-muted); align-self: center;" }});
            
            this.addon.recentDecks.forEach(deck => {
                const pill = historyDiv.createEl("button", { text: deck });
                pill.style.padding = "2px 8px";
                pill.style.fontSize = "0.8em";
                pill.onclick = () => { this.deckInput.value = deck; };
            });
        }

        const btnContainer = contentEl.createDiv({ attr: { style: "display: flex; justify-content: flex-end; gap: 10px;" }});
        const cancelBtn = btnContainer.createEl("button", { text: "Cancelar" });
        cancelBtn.onclick = () => this.close();

        const syncBtn = btnContainer.createEl("button", { text: "🚀 Sync", cls: "mod-cta" });
        syncBtn.onclick = async () => {
            const rawDeckName = this.deckInput.value;
            const safeDeckName = sanitizeAnkiDeckName(rawDeckName);

            if (!safeDeckName) {
                new Notice("⚠️ Invalid deck name.");
                return;
            }

            if (!this.addon.recentDecks) this.addon.recentDecks = [];
            this.addon.recentDecks = [safeDeckName, ...this.addon.recentDecks.filter(d => d !== safeDeckName)].slice(0, 5);
            
            this.close();
            await this.addon.processAndSendCards(this.file, safeDeckName);
        };
        
        this.deckInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") syncBtn.click();
        });
        
        setTimeout(() => this.deckInput.focus(), 50);
    }

    onClose() {
        this.contentEl.empty();
    }
}