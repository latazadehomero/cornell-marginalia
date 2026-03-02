import { Notice, App, Modal, TFile, setIcon } from "obsidian";
import CornellMarginalia from "../main";

export class MargidoroAddon {
    id = "margidoro";
    name = "Margidoro 🍅";
    description = "Knowledge-aware Pomodoro timer.";

    public plugin: CornellMarginalia;

    private statusBarItem: HTMLElement | null = null;
    
    // 🎛️ Sub-elementos de la UI para no redibujar todo por segundo
    private mainToggleEl: HTMLElement | null = null;
    private addBtnEl: HTMLElement | null = null;
    private skipBtnEl: HTMLElement | null = null;
    
    private timerInterval: number | null = null;
    private reminderInterval: number | null = null; 
    private lastRemindedDate: string = "";
    
    private isRunning = false;
    private timeLeft = 0; 
    private mode: 'work' | 'shortBreak' | 'longBreak' = 'work';
    private sessionStartTime: number = 0;
    private completedSessions: number = 0;
    
    public sessionObjective: string = ""; 

    constructor(plugin: CornellMarginalia) {
        this.plugin = plugin;
    }

    load(): void {
        this.statusBarItem = this.plugin.addStatusBarItem();
        
        if (this.statusBarItem) {
            this.statusBarItem.addClass('cornell-margidoro-status');
            this.statusBarItem.style.cursor = 'pointer';
            this.statusBarItem.style.display = "flex";
            this.statusBarItem.style.alignItems = "center";
            this.statusBarItem.style.gap = "6px";

            // 1. Botón Principal (Play/Pause y Reloj)
            this.mainToggleEl = this.statusBarItem.createSpan();
            this.mainToggleEl.onclick = (e) => {
                e.stopPropagation();
                if (this.isRunning) this.pauseTimer();
                else this.startTimer();
            };

            // 2. Botón +5 Minutos (Flexible)
            this.addBtnEl = this.statusBarItem.createSpan({ text: "+5m", title: "Add 5 minutes" });
            this.addBtnEl.style.fontSize = "0.85em";
            this.addBtnEl.style.color = "var(--text-muted)";
            this.addBtnEl.style.padding = "2px 4px";
            this.addBtnEl.style.borderRadius = "4px";
            // Efecto Hover Nátivo
            this.addBtnEl.onmouseenter = () => { if(this.addBtnEl) { this.addBtnEl.style.backgroundColor = "var(--background-modifier-hover)"; this.addBtnEl.style.color = "var(--text-normal)"; } };
            this.addBtnEl.onmouseleave = () => { if(this.addBtnEl) { this.addBtnEl.style.backgroundColor = "transparent"; this.addBtnEl.style.color = "var(--text-muted)"; } };
            this.addBtnEl.onclick = (e) => {
                e.stopPropagation();
                this.timeLeft += 5 * 60;
                this.updateDisplay();
                new Notice("⏱️ Added 5 minutes!");
            };

            // 3. Botón Skip (Saltar de Work a Break o viceversa)
            this.skipBtnEl = this.statusBarItem.createSpan({ text: "⏭", title: "Skip phase" });
            this.skipBtnEl.style.fontSize = "0.9em";
            this.skipBtnEl.style.color = "var(--text-muted)";
            this.skipBtnEl.style.padding = "2px 4px";
            this.skipBtnEl.style.borderRadius = "4px";
            this.skipBtnEl.onmouseenter = () => { if(this.skipBtnEl) { this.skipBtnEl.style.backgroundColor = "var(--background-modifier-hover)"; this.skipBtnEl.style.color = "var(--text-normal)"; } };
            this.skipBtnEl.onmouseleave = () => { if(this.skipBtnEl) { this.skipBtnEl.style.backgroundColor = "transparent"; this.skipBtnEl.style.color = "var(--text-muted)"; } };
            this.skipBtnEl.onclick = (e) => {
                e.stopPropagation();
                this.handleSessionEnd();
            };
        }
        
        this.resetTimer();
        this.updateDisplay();
        this.startReminderDaemon(); 
    }

    unload(): void {
        this.pauseTimer();
        if (this.reminderInterval) window.clearInterval(this.reminderInterval);
        if (this.statusBarItem) {
            this.statusBarItem.remove();
            this.statusBarItem = null;
        }
    }

    private startReminderDaemon() {
        this.reminderInterval = window.setInterval(() => {
            // @ts-ignore
            const now = window.moment().format('HH:mm');
            // @ts-ignore
            const today = window.moment().format('YYYY-MM-DD');

            if (now === this.plugin.settings.margidoro.reviewReminderTime && this.lastRemindedDate !== today) {
                const pendingCount = this.plugin.settings.userStats.margidoroPending?.length || 0;
                if (pendingCount > 0) {
                    new Notice(`🔔 REMINDER: You have ${pendingCount} pending Hard Marginalias! Open the Rhizome to review them.`, 10000);
                    this.lastRemindedDate = today; 
                }
            }
        }, 30000); 
    }

    private startTimer() {
        if (!this.isRunning) {
            if (this.mode === 'work' && this.timeLeft === this.plugin.settings.margidoro.workTime * 60 && !this.sessionObjective) {
                new MargidoroObjectiveModal(this.plugin.app, this, (objective) => {
                    this.sessionObjective = objective;
                    this.executeStartTimer();
                }).open();
            } else {
                this.executeStartTimer();
            }
        }
    }

    private executeStartTimer() {
        this.isRunning = true;
        if (this.mode === 'work' && this.timeLeft === this.plugin.settings.margidoro.workTime * 60) {
            this.sessionStartTime = Date.now();
            new Notice(this.sessionObjective ? `🎯 Focus: ${this.sessionObjective}` : "🍅 Margidoro started! Focus on your Marginalias.");
        }
        
        this.timerInterval = window.setInterval(() => {
            this.timeLeft--;
            this.updateDisplay();

            if (this.timeLeft <= 0) {
                this.handleSessionEnd();
            }
        }, 1000);
        this.updateDisplay();
    }

    private pauseTimer() {
        this.isRunning = false;
        if (this.timerInterval) {
            window.clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.updateDisplay();
    }

    private resetTimer() {
        this.pauseTimer();
        if (this.mode === 'work') this.timeLeft = this.plugin.settings.margidoro.workTime * 60;
        else if (this.mode === 'shortBreak') this.timeLeft = this.plugin.settings.margidoro.shortBreak * 60;
        else this.timeLeft = this.plugin.settings.margidoro.longBreak * 60;
        this.updateDisplay();
    }

    private updateDisplay() {
        if (!this.mainToggleEl) return; 
        
        const minutes = Math.floor(this.timeLeft / 60);
        const seconds = this.timeLeft % 60;
        const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        let icon = this.mode === 'work' ? '🍅' : (this.mode === 'longBreak' ? '🛌' : '☕');
        let state = this.isRunning ? '⏸' : '▶'; // El botón muestra la acción que VA a hacer al darle clic
        let cycle = this.mode === 'work' ? ` [${(this.completedSessions % 4) + 1}/4]` : '';
        
        this.mainToggleEl.innerText = `${icon}${cycle} ${timeStr} ${state}`;
        this.mainToggleEl.style.fontWeight = this.isRunning ? "bold" : "normal";
        this.mainToggleEl.style.color = this.isRunning ? "var(--interactive-accent)" : "inherit";
    }

    private handleSessionEnd() {
        this.pauseTimer();
        
        if (this.mode === 'work') {
            this.completedSessions++; 
            
            if (this.completedSessions > 0 && this.completedSessions % 4 === 0) {
                new Notice("🎉 4 Pomodoros completed! Time for a Long Break. Preparing Review...");
                this.mode = 'longBreak';
            } else {
                new Notice("⏰ Work session finished! Preparing Review...");
                this.mode = 'shortBreak';
            }
            
            new MargidoroReviewModal(this.plugin.app, this.plugin, this.sessionStartTime, this.sessionObjective, this).open();
            
        } else {
            new Notice("🍅 Break over. Back to work!");
            this.mode = 'work';
        }
        
        this.resetTimer();
    }
}

// ==========================================
// 🎯 MODAL DE OBJETIVO (Al inicio)
// ==========================================
export class MargidoroObjectiveModal extends Modal {
    addon: MargidoroAddon;
    onSubmit: (objective: string) => void;

    constructor(app: App, addon: MargidoroAddon, onSubmit: (objective: string) => void) {
        super(app);
        this.addon = addon;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h3", { text: "🎯 Set Session Objective" });
        
        const input = contentEl.createEl("input", { type: "text", placeholder: "What do you want to accomplish?" });
        input.style.width = "100%";
        input.style.marginBottom = "15px";

        const btnRow = contentEl.createDiv({ attr: { style: "display: flex; justify-content: flex-end; gap: 10px;" } });
        
        const skipBtn = btnRow.createEl("button", { text: "Skip" });
        skipBtn.onclick = () => {
            this.onSubmit("");
            this.close();
        };

        const startBtn = btnRow.createEl("button", { text: "▶ Start Focus", cls: "mod-cta" });
        startBtn.style.backgroundColor = "var(--interactive-accent)";
        startBtn.style.color = "var(--text-on-accent)";
        startBtn.onclick = () => {
            this.onSubmit(input.value.trim());
            this.close();
        };

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                this.onSubmit(input.value.trim());
                this.close();
            }
        });

        setTimeout(() => input.focus(), 50);
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ==========================================
// 🧠 MODAL DE EVALUACIÓN DE SESIÓN (Al final)
// ==========================================
interface SessionNote {
    file: TFile;
    text: string;
    id: string;
    isHardAutoTagged: boolean;
    status: 'easy' | 'review' | 'hard' | 'unrated';
}

export class MargidoroReviewModal extends Modal {
    plugin: any;
    sessionStartTime: number;
    sessionObjective: string;
    addon: MargidoroAddon;
    notesCreated: SessionNote[] = [];

    constructor(app: App, plugin: any, sessionStartTime: number, sessionObjective: string, addon: MargidoroAddon) {
        super(app);
        this.plugin = plugin;
        this.sessionStartTime = sessionStartTime;
        this.sessionObjective = sessionObjective;
        this.addon = addon;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.style.width = "70vw";
        this.modalEl.style.maxWidth = "800px";

        contentEl.createEl("h2", { text: "🍅 Session Complete! Let's Review." });
        
        if (this.sessionObjective) {
            contentEl.createEl("p", { text: `🎯 Goal: ${this.sessionObjective}`, attr: { style: "font-weight: bold; color: var(--interactive-accent);" } });
        }

        contentEl.createEl("p", { 
            text: "Here are the marginalias you created during this focus block. How well do you understand them?",
            cls: "text-muted"
        });

        await this.scanSessionNotes();

        if (this.notesCreated.length === 0) {
            contentEl.createEl("h3", { text: "You didn't create any marginalias this session.", attr: { style: "text-align: center; color: var(--text-muted); margin-top: 20px;" } });
            
            const btnRow = contentEl.createDiv({ attr: { style: "display: flex; justify-content: center; margin-top: 20px;" } });
            const closeBtn = btnRow.createEl("button", { text: "Close & Start Break" });
            closeBtn.onclick = () => {
                this.addon.sessionObjective = ""; // Limpiamos para el próximo
                this.close();
            };
            return;
        }

        const listContainer = contentEl.createDiv({ attr: { style: "max-height: 400px; overflow-y: auto; margin-top: 15px; border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 10px;" } });

        this.notesCreated.forEach((note) => {
            const itemRow = listContainer.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid var(--background-modifier-border);" } });
            
            const textCol = itemRow.createDiv({ attr: { style: "flex-grow: 1; margin-right: 15px;" } });
            textCol.createDiv({ text: note.file.basename, attr: { style: "font-size: 0.8em; color: var(--text-muted); margin-bottom: 4px;" } });
            
            let cleanText = note.text.replace(/%%[><](.*?)%%/g, '$1').trim();
            if (cleanText.length > 100) cleanText = cleanText.substring(0, 100) + "...";
            textCol.createDiv({ text: cleanText, attr: { style: "font-weight: 500;" } });

            const evalCol = itemRow.createDiv({ attr: { style: "display: flex; gap: 8px; flex-shrink: 0;" } });
            
            const easyBtn = evalCol.createEl("button", { text: "✅ Easy" });
            const reviewBtn = evalCol.createEl("button", { text: "🤔 Review" });
            const hardBtn = evalCol.createEl("button", { text: "❌ Hard" });

            if (note.isHardAutoTagged) {
                note.status = 'hard';
                hardBtn.style.backgroundColor = "var(--color-red)";
                hardBtn.style.color = "white";
            }

            const resetButtons = () => {
                easyBtn.style.backgroundColor = ""; easyBtn.style.color = "";
                reviewBtn.style.backgroundColor = ""; reviewBtn.style.color = "";
                hardBtn.style.backgroundColor = ""; hardBtn.style.color = "";
            };

            easyBtn.onclick = () => { resetButtons(); easyBtn.style.backgroundColor = "var(--color-green)"; easyBtn.style.color = "white"; note.status = 'easy'; };
            reviewBtn.onclick = () => { resetButtons(); reviewBtn.style.backgroundColor = "var(--color-orange)"; reviewBtn.style.color = "white"; note.status = 'review'; };
            hardBtn.onclick = () => { resetButtons(); hardBtn.style.backgroundColor = "var(--color-red)"; hardBtn.style.color = "white"; note.status = 'hard'; };
        });

        const actionRow = contentEl.createDiv({ attr: { style: "display: flex; justify-content: flex-end; margin-top: 20px;" } });
        const saveBtn = actionRow.createEl("button", { text: "💾 Save Session Log", cls: "mod-cta" });
        saveBtn.style.backgroundColor = "var(--interactive-accent)";
        saveBtn.style.color = "var(--text-on-accent)";
        
        saveBtn.onclick = async () => {
            await this.saveSessionLog();
            this.addon.sessionObjective = ""; // 👈 Limpiamos el objetivo para el próximo pomodoro
            this.close();
            new Notice("🍅 Session Log saved! Enjoy your break.");
        };
    }

    async scanSessionNotes() {
        const files = this.plugin.app.vault.getMarkdownFiles();
        const hardPrefix = this.plugin.settings.margidoro?.hardPrefix || "?";
        
        for (const file of files) {
            if (file.stat.mtime >= this.sessionStartTime || file.stat.ctime >= this.sessionStartTime) {
                const content = await this.plugin.app.vault.cachedRead(file);
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const regex = /%%[><](.*?)%%/g;
                    let match: RegExpExecArray | null;

                    while ((match = regex.exec(line)) !== null) {
                        const fullMatch = match[0];
                        const noteContent = match[1].trim();
                        if (!noteContent) continue;

                        let isHard = false;
                        if (noteContent.startsWith(hardPrefix)) {
                            isHard = true;
                        }

                        const blockIdMatch = line.match(/\^([a-zA-Z0-9]+)\s*$/);
                        const blockId = blockIdMatch ? blockIdMatch[1] : null;
                        const rhizomeId = blockId ? blockId : `${file.basename}-L${i}`;

                        if (!this.notesCreated.some(n => n.text === fullMatch && n.file.path === file.path)) {
                            this.notesCreated.push({
                                file: file,
                                text: fullMatch,
                                id: rhizomeId,
                                isHardAutoTagged: isHard,
                                status: isHard ? 'hard' : 'unrated'
                            });
                        }
                    }
                }
            }
        }
    }

    async saveSessionLog() {
        // @ts-ignore
        const dateStr = window.moment().format('YYYY-MM-DD');
        // @ts-ignore
        const timeStr = window.moment().format('HH:mm');
        
        const folder = this.plugin.settings.margidoro?.logFolder || "Margidoro Logs";
        await this.plugin.ensureFolderExists(folder);

        const fileName = `${folder}/Pomodoro_Log_${dateStr}.md`;
        
        let logContent = `\n## Session at ${timeStr}\n`;
        if (this.sessionObjective) {
            logContent += `**🎯 Objective:** ${this.sessionObjective}\n\n`;
        } else {
            logContent += `\n`;
        }
        
        const easyNotes = this.notesCreated.filter(n => n.status === 'easy');
        const reviewNotes = this.notesCreated.filter(n => n.status === 'review');
        const hardNotes = this.notesCreated.filter(n => n.status === 'hard');

        const pending = [...reviewNotes, ...hardNotes];

        // Inyección de IDs silenciosa solo para notas difíciles
        for (const note of pending) {
            if (!note.text.match(/\^([a-zA-Z0-9]+)\s*$/)) {
                const newId = Math.random().toString(36).substring(2, 8);
                await this.plugin.app.vault.process(note.file, (data: string) => {
                    return data.replace(note.text, `${note.text} ^${newId}`);
                });
                note.id = newId; 
                note.text = `${note.text} ^${newId}`; 
            }
        }

        if (!this.plugin.settings.userStats.margidoroPending) {
            this.plugin.settings.userStats.margidoroPending = [];
        }
        pending.forEach(n => {
            if (!this.plugin.settings.userStats.margidoroPending.includes(n.id)) {
                this.plugin.settings.userStats.margidoroPending.push(n.id);
            }
        });
        await this.plugin.saveSettings();

        if (hardNotes.length > 0) {
            logContent += `### ❌ Needs Urgent Review\n`;
            hardNotes.forEach(n => logContent += `- [[${n.file.basename}]] : ${n.text}\n`);
            logContent += `\n`;
        }

        if (reviewNotes.length > 0) {
            logContent += `### 🤔 Need to Process\n`;
            reviewNotes.forEach(n => logContent += `- [[${n.file.basename}]] : ${n.text}\n`);
            logContent += `\n`;
        }

        if (easyNotes.length > 0) {
            logContent += `### ✅ Mastered Concepts\n`;
            easyNotes.forEach(n => logContent += `- [[${n.file.basename}]] : ${n.text}\n`);
            logContent += `\n`;
        }

        logContent += `---\n`;

        const file = this.plugin.app.vault.getAbstractFileByPath(fileName);
        if (file instanceof TFile) {
            await this.plugin.app.vault.append(file, logContent);
        } else {
            const header = `# 🍅 Margidoro Daily Log: ${dateStr}\n\n`;
            await this.plugin.app.vault.create(fileName, header + logContent);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}