// /addons/DashboardView.ts
import { requestUrl, ItemView, WorkspaceLeaf, Notice, setIcon, Modal, App, TFile, MarkdownRenderer, Menu } from "obsidian";
import CornellMarginalia from "../main";

export const DASHBOARD_VIEW_TYPE = "cornell-dashboard-view";

export class CornellDashboardView extends ItemView {
    plugin: CornellMarginalia;
    currentDayMode: string = 'optimal'; // Memoria del nivel de energía de hoy

    constructor(leaf: WorkspaceLeaf, plugin: CornellMarginalia) {
        super(leaf);
        this.plugin = plugin;

        // 🛡️ MOTOR DE INTEGRIDAD DE DATOS (Renombrado Automático)
        // Usamos registerEvent para evitar fugas de memoria (memory leaks)
        this.plugin.registerEvent(
            this.plugin.app.vault.on('rename', async (file, oldPath) => {
                const data = this.plugin.settings.dashboardData as any;
                let changed = false;
                const oldName = oldPath.split('/').pop() || oldPath;

                if (data.subjects) {
                    data.subjects.forEach((subj: any) => {
                        if (subj.syllabus) {
                            subj.syllabus.forEach((topic: any) => {
                                // 1. Actualizar Notas Adjuntas Manuales
                                if (topic.attachedNotes) {
                                    const idx = topic.attachedNotes.indexOf(oldPath);
                                    const nameIdx = topic.attachedNotes.indexOf(oldName);
                                    if (idx !== -1) { topic.attachedNotes[idx] = file.path; changed = true; }
                                    else if (nameIdx !== -1) { topic.attachedNotes[nameIdx] = file.name; changed = true; }
                                }
                                // 2. Actualizar TaskNotes nativos
                                if (topic.taskNoteId && (topic.taskNoteId === oldPath || topic.taskNoteId === oldName.replace('.md', ''))) {
                                    topic.taskNoteId = file.path;
                                    changed = true;
                                }
                            });
                        }
                    });
                }
                // Si encontramos un cambio, guardamos y refrescamos la UI
                if (changed) {
                    await this.plugin.saveSettings();
                    this.onOpen(); 
                }
            })
        );
    }

    // copiar el puerto de tasknote 
    async getTaskNotesConfig(): Promise<{ port: number, token: string }> {
        try {
            // Usar this.app en SubjectEditorModal y this.plugin.app en CornellDashboardView
            const appInstance = (this as any).plugin ? (this as any).plugin.app : (this as any).app;
            const configStr = await appInstance.vault.adapter.read(".obsidian/plugins/tasknotes/data.json");
            const config = JSON.parse(configStr);
            return {
                port: config.apiPort || 8080,
                token: config.apiAuthToken || "" // Rescatamos el token si existe
            };
        } catch (e) {
            return { port: 8080, token: "" };
        }
    }
    //  HASTA AQUÍ 

    getViewType() {
        return DASHBOARD_VIEW_TYPE;
    }

    getDisplayText() {
        return "Smart study";
    }
    async calculateSubjectStats(subject: any, container: HTMLElement) {
        container.empty();
        const files = this.plugin.app.vault.getMarkdownFiles();
        const sources = subject.sources || [];
        
        // Recolectar todas las notas adjuntas de los tópicos
        const allAttachedNotes: string[] = [];
        if (subject.syllabus) {
            subject.syllabus.forEach((t: any) => {
                if (t.attachedNotes) allAttachedNotes.push(...t.attachedNotes);
            });
        }

        const validFiles = files.filter((f: any) => {
            const isSource = sources.some((src: string) => f.path.startsWith(src) || f.path === src || f.name === src);
            const isAttached = allAttachedNotes.some((n: string) => f.path === n || f.name === n || f.name === `${n}.md`);
            return isSource || isAttached;
        });

        // --- MÉTRICAS FLASHCARDS (SRS) ---
        let totalFlashcards = 0;
        let newFlashcards = 0;
        let learningFlashcards = 0;
        let matureFlashcards = 0;

        // --- MÉTRICAS LECTURA (CONFIANZA) ---
        let activeNotesCount = 0;
        let totalConfidenceSum = 0;
        let reviewedNotesCount = 0;

        for (const file of validFiles) {
            const content = await this.plugin.app.vault.cachedRead(file);
            const lines = content.split('\n');
            let hasMarginalia = false;
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].match(/%%[><](.*?)%%/)) {
                    hasMarginalia = true;

                    // 🧲 REGLA DE ORO: Solo contabilizar para Mastery SRS si tiene ';;'
                    if (lines[i].includes(';;')) {
                        totalFlashcards++;
                        const blockIdMatch = lines[i].match(/\^([a-zA-Z0-9]+)\s*$/);
                        const blockId = blockIdMatch ? blockIdMatch[1] : `${file.basename}-L${i}`;
                        
                        const reviewData = this.plugin.settings.userStats?.rhizomeReviews?.[blockId];
                        
                        if (!reviewData || reviewData.lastReviewed === 0) {
                            newFlashcards++;
                        } else if (reviewData.interval >= 21) { 
                            matureFlashcards++;
                        } else {
                            learningFlashcards++;
                        }
                    }
                }
            }
            
            const isAttached = allAttachedNotes.some((n: string) => file.path === n || file.name === n || file.name === `${n}.md`);
            
            // Si la nota tiene marginalias O fue adjuntada, cuenta para Lectura Activa
            if (hasMarginalia || isAttached) {
                activeNotesCount++;
                const readingData = this.plugin.settings.userStats?.activeReading?.[file.path];
                if (readingData && readingData.confidence) {
                    reviewedNotesCount++;
                    totalConfidenceSum += readingData.confidence;
                }
            }
        }

        if (activeNotesCount === 0 && totalFlashcards === 0) {
            container.createDiv({ text: "No active notes or flashcards found.", cls: "text-muted", attr: { style: "font-size: 0.8em; margin-top: 10px;" } });
            return;
        }

        // 1. ETIQUETAS ELEGANTES (Totales)
        container.createDiv({ attr: { style: "display: flex; gap: 15px; margin-bottom: 10px; font-size: 0.9em; background: var(--background-secondary-alt); padding: 8px; border-radius: 6px;" } }).innerHTML = `
            <div title="Notas completas evaluables">📄 <b>${activeNotesCount}</b> Notas</div>
            <div title="Tarjetas estrictas (Pregunta ;; Respuesta)">🗂️ <b>${totalFlashcards}</b> Flashcards</div>
        `;

        // 2. BARRA DE MASTERY (FLASHCARDS SRS)
        if (totalFlashcards > 0) {
            const reviewedFlashcards = totalFlashcards - newFlashcards;
            const progressPct = Math.round((reviewedFlashcards / totalFlashcards) * 100);

            const masteryRow = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; font-size: 0.8em; color: var(--text-muted); align-items: center; margin-top: 5px;" }});
            masteryRow.createSpan({ text: `Mastery (SRS): ${progressPct}%`, attr: { style: "font-weight: bold; color: var(--text-normal);" }});
            
            const badges = masteryRow.createSpan({ attr: { style: "display: flex; gap: 8px; font-family: monospace; font-size: 0.9em;" }});
            if (newFlashcards > 0) badges.createSpan({ text: `🌱 ${newFlashcards}`, title: "New/Unseen" });
            if (learningFlashcards > 0) badges.createSpan({ text: `🔥 ${learningFlashcards}`, title: "Learning" });
            if (matureFlashcards > 0) badges.createSpan({ text: `🌳 ${matureFlashcards}`, title: "Mature (21+ days)" });

            const barWrapper = container.createDiv({ attr: { style: "width: 100%; height: 6px; background: var(--background-modifier-border); border-radius: 4px; margin: 4px 0 10px 0; overflow: hidden; display: flex;" }});
            if (learningFlashcards > 0) {
                const lPct = (learningFlashcards / totalFlashcards) * 100;
                barWrapper.createDiv({ attr: { style: `height: 100%; width: ${lPct}%; background: var(--color-orange);` }});
            }
            if (matureFlashcards > 0) {
                const mPct = (matureFlashcards / totalFlashcards) * 100;
                barWrapper.createDiv({ attr: { style: `height: 100%; width: ${mPct}%; background: var(--color-green);` }});
            }
        } else {
            container.createDiv({ text: "Sin Flashcards SRS configuradas.", cls: "text-muted", attr: { style: "font-size: 0.8em; margin-bottom: 10px;" } });
        }

        // 3. BARRA DE CONFIANZA (LECTURA ACTIVA)
        if (activeNotesCount > 0) {
            const avgConfidence = reviewedNotesCount > 0 ? (totalConfidenceSum / reviewedNotesCount).toFixed(1) : "0.0";
            const confPct = reviewedNotesCount > 0 ? Math.round(((totalConfidenceSum / reviewedNotesCount) / 10) * 100) : 0;
            
            let confColor = "var(--color-red)";
            if (confPct >= 50) confColor = "var(--color-orange)";
            if (confPct >= 80) confColor = "var(--color-green)";

            const confRow = container.createDiv({ attr: { style: "display: flex; justify-content: space-between; font-size: 0.8em; color: var(--text-muted); align-items: center;" }});
            confRow.createSpan({ text: `Confidence (Reading): ${avgConfidence}/10`, attr: { style: "font-weight: bold; color: var(--text-normal);" }});
            confRow.createSpan({ text: `📝 ${reviewedNotesCount}/${activeNotesCount} notes`, attr: { style: "font-size: 0.9em;" }});

            const confBarWrapper = container.createDiv({ attr: { style: "width: 100%; height: 6px; background: var(--background-modifier-border); border-radius: 4px; margin: 4px 0 6px 0; overflow: hidden; display: flex;" }});
            if (confPct > 0) {
                confBarWrapper.createDiv({ attr: { style: `height: 100%; width: ${confPct}%; background: ${confColor};` }});
            }
        }
    }
    renderTimeline(container: HTMLElement) {
        container.empty();
        container.createEl("h2", { text: "⏳ Exam Timeline" });

        const subjects = (this.plugin.settings.dashboardData as any)?.subjects || [];
        const validExams = subjects.filter((s:any) => s.examDate).sort((a:any, b:any) => a.examDate - b.examDate);

        if (validExams.length === 0) {
            container.createEl("p", { text: "No exams scheduled. Add an exam date to your subjects to see the timeline.", cls: "text-muted", attr: { style: "font-style: italic; font-size: 0.9em;" } });
            return;
        }

        // Estilos CSS inyectados para la animación de crecimiento y el scroll oculto
        if (!document.getElementById('cornell-timeline-styles')) {
            const style = document.createElement('style');
            style.id = 'cornell-timeline-styles';
            style.innerHTML = `
                @keyframes growTimelineBar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
                .timeline-scroll-area::-webkit-scrollbar { height: 6px; }
                .timeline-scroll-area::-webkit-scrollbar-thumb { background: var(--background-modifier-border); border-radius: 3px; }
            `;
            document.head.appendChild(style);
        }

        const scrollArea = container.createDiv({ cls: "timeline-scroll-area", attr: { style: "overflow-x: auto; padding-bottom: 15px; margin-top: 15px; width: 100%;" }});
        
        // Matemáticas del tiempo
        const now = new Date();
        const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const msInDay = 1000 * 60 * 60 * 24;

        // Escala del universo (píxeles por día)
        const pxPerDay = 14; 
        const pastDaysToShow = 20; // Cuánto pasado puedes ver al scrollear a la izquierda
        const futureBufferDays = 30; // Cuánto futuro extra después del último examen

        const maxExamMs = validExams[validExams.length - 1].examDate;
        let daysToMax = Math.ceil((maxExamMs - todayMs) / msInDay);
        if (daysToMax < 15) daysToMax = 15; // Escala mínima si el examen es muy pronto

        const trackWidth = (pastDaysToShow + daysToMax + futureBufferDays) * pxPerDay;
        const todayX = pastDaysToShow * pxPerDay;
        const trackHeight = Math.max(100, validExams.length * 40 + 60); // Altura dinámica según cantidad de materias

        const track = scrollArea.createDiv({ attr: { style: `position: relative; width: ${trackWidth}px; height: ${trackHeight}px; min-width: 100%;` }});

        // 🌟 MAGIA 13: PRE-CALCULAR EL HEATMAP DE ESTUDIO
        const dbData = (this.plugin.settings.dashboardData as any) || {};
        const history = dbData.trackerHistory || [];
        const studyHeatmap = new Map<string, number>();

        history.forEach((session: any) => {
            if (!session.timestamp || !session.durationMinutes) return;
            const d = new Date(session.timestamp);
            const dateKey = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
            const currentMins = studyHeatmap.get(dateKey) || 0;
            studyHeatmap.set(dateKey, currentMins + session.durationMinutes);
        });

        // 1. Dibujar Eje de Tiempo (La línea base)
        const axisY = trackHeight - 20;
        track.createDiv({ attr: { style: `position: absolute; top: ${axisY}px; left: 0; right: 0; height: 2px; background: var(--background-modifier-border);` }});

        // 🌟 MAGIA 14: DIBUJAR LOS BLOQUES DEL HEATMAP (ESTILO GITHUB)
        for (let i = -pastDaysToShow; i <= (daysToMax + futureBufferDays); i++) {
            const tickDate = new Date(todayMs + i * msInDay);
            const dateKey = `${tickDate.getFullYear()}-${tickDate.getMonth() + 1}-${tickDate.getDate()}`;
            const totalMins = studyHeatmap.get(dateKey) || 0;

            if (totalMins > 0) {
                const tickX = todayX + (i * pxPerDay);
                let heatColor = "rgba(0, 200, 100, 0.2)"; // < 30 mins
                if (totalMins >= 120) heatColor = "rgba(0, 200, 100, 1.0)"; // Nivel Dios: 2+ horas
                else if (totalMins >= 60) heatColor = "rgba(0, 200, 100, 0.7)"; // Medio: 1-2 horas
                else if (totalMins >= 30) heatColor = "rgba(0, 200, 100, 0.4)"; // Ligero: 30-60 mins

                // Dibujamos un "ladrillito" (12x10px) que descansa justo sobre el eje.
                const heatBlock = track.createDiv({ attr: { style: `position: absolute; left: ${tickX + 1}px; top: ${axisY - 12}px; width: ${pxPerDay - 2}px; height: 10px; background: ${heatColor}; border-radius: 2px; cursor: help; transition: transform 0.2s ease; z-index: 1;` }});
                
                // Tooltip nativo para ver cuánto estudiaste exactamente
                heatBlock.setAttribute("aria-label", `${tickDate.toLocaleDateString()}\\n📚 Estudiado: ${Math.round(totalMins)} mins`);
                heatBlock.setAttribute("data-tooltip-position", "top");

                // Pequeña animación pop al pasar el mouse
                heatBlock.onmouseenter = () => heatBlock.style.transform = "scale(1.3) translateY(-2px)";
                heatBlock.onmouseleave = () => heatBlock.style.transform = "scale(1) translateY(0)";
            }
        }

        // 2. Dibujar Marcas de Semanas en el Eje
        for (let i = -pastDaysToShow; i <= (daysToMax + futureBufferDays); i += 7) {
            if (i === 0) continue; 
            const tickX = todayX + (i * pxPerDay);
            const dateStr = new Date(todayMs + i * msInDay).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            
            // Les añadimos pointer-events: none para que no bloqueen los clicks al heatmap
            track.createDiv({ attr: { style: `position: absolute; left: ${tickX}px; top: ${axisY - 5}px; width: 1px; height: 10px; background: var(--text-muted); pointer-events: none; z-index: 0;` }});
            track.createDiv({ text: dateStr, attr: { style: `position: absolute; left: ${tickX - 15}px; top: ${axisY + 10}px; font-size: 0.65em; color: var(--text-muted); pointer-events: none;` }});
        }

        // 3. Dibujar "El Muro de Hoy" (Today Marker)
        const todayLine = track.createDiv({ attr: { style: `position: absolute; left: ${todayX}px; top: 10px; height: ${trackHeight - 20}px; border-left: 2px dashed var(--interactive-accent); z-index: 0; pointer-events: none;` }});
        todayLine.createDiv({ text: "Hoy", attr: { style: "position: absolute; top: -15px; left: -10px; font-size: 0.75em; color: var(--interactive-accent); font-weight: bold; background: var(--background-primary); padding: 0 4px;" }});
        // FETCH DE TASKNOTES AQUÍ 
        
        
        const tlLayout = dbData.workspaces?.[dbData.activeWorkspaceIndex || 0] || dbData.layout || {};

        if (tlLayout.timelineTaskNotes) {
            (async () => {
                try {
                    const config = await this.getTaskNotesConfig();
                    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
                    if (config.token) reqHeaders['Authorization'] = `Bearer ${config.token}`;

                    // @ts-ignore
                    const timelineTasksRes = await requestUrl({ 
                        url: `http://127.0.0.1:${config.port}/api/tasks/query`,
                        method: 'POST',
                        headers: reqHeaders, // 👈 Cabeceras seguras
                        body: JSON.stringify({
                            type: "group",
                            id: "root",
                            conjunction: "and",
                            children: [ { type: "condition", id: "c1", property: "status", operator: "is", value: "open" } ]
                        })
                    });

                    if (timelineTasksRes.status === 200 && timelineTasksRes.json?.success && timelineTasksRes.json?.data?.tasks) {
                        
                        // 🌟 MAGIA 6: AGRUPAR TAREAS POR DÍA
                        const tasksByDay = new Map<number, any[]>();
                        
                        timelineTasksRes.json.data.tasks.forEach((task: any) => {
                            if (!task.due) return; 
                            
                            // Filtro de tags
                            if (tlLayout.timelineCornellOnly) {
                                if (!task.tags || !task.tags.some((t: string) => t.toLowerCase() === 'cornell')) return;
                            }

                            const taskTimeMs = new Date(task.due).getTime();
                            const daysFromToday = Math.ceil((taskTimeMs - todayMs) / msInDay);
                            
                            if (daysFromToday >= -pastDaysToShow && daysFromToday <= (daysToMax + futureBufferDays)) {
                                // Guardamos las tareas en un "casillero" correspondiente a su día
                                if (!tasksByDay.has(daysFromToday)) tasksByDay.set(daysFromToday, []);
                                tasksByDay.get(daysFromToday)!.push(task);
                            }
                        });

                        // 🌟 MAGIA 7: RENDERIZAR PILAS DE TAREAS (STACKS)
                        tasksByDay.forEach((tasks, daysFromToday) => {
                            const taskX = todayX + (daysFromToday * pxPerDay);
                            
                            // 1. Contenedor principal invisible del grupo para ese día
                            const groupMarker = track.createDiv({ 
                                attr: { style: `position: absolute; left: ${taskX}px; top: ${trackHeight - 40}px; width: 10px; height: 10px; z-index: 3; display: flex; justify-content: center;` }
                            });

                            // 2. Si hay más de 1 tarea, añadimos una pequeña burbuja roja tipo notificación
                            if (tasks.length > 1) {
                                groupMarker.createDiv({
                                    text: `${tasks.length}`,
                                    attr: { style: `position: absolute; top: -14px; left: 6px; font-size: 0.65em; background: var(--color-red); color: white; border-radius: 50%; width: 14px; height: 14px; display: flex; align-items: center; justify-content: center; font-weight: bold; pointer-events: none; z-index: 20; box-shadow: 0 1px 2px rgba(0,0,0,0.4);` }
                                });
                            }

                            // 3. Renderizamos cada rombo de la pila
                            tasks.forEach((task, index) => {
                                const diamondContainer = groupMarker.createDiv({
                                    attr: { style: `position: absolute; bottom: 0; display: flex; flex-direction: column; align-items: center; cursor: pointer; transition: bottom 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), z-index 0s; z-index: ${3 + index};` }
                                });

                                // Rombo visual. Variamos un poco el color si están detrás para dar profundidad
                                const bgBase = index === 0 ? "var(--color-blue)" : "var(--color-cyan)";
                                const diamond = diamondContainer.createDiv({ 
                                    attr: { style: `width: 10px; height: 10px; background: ${bgBase}; transform: rotate(45deg); transition: all 0.2s ease; box-shadow: 0 0 4px rgba(0,0,0,0.5); border: 1px solid var(--background-primary);` }
                                });

                                diamondContainer.setAttribute("aria-label", `📝 ${task.title}\nVence: ${task.due}`);
                                diamondContainer.setAttribute("data-tooltip-position", "top");

                                // 4. LA ANIMACIÓN: Expansión vertical al pasar el mouse por la pila
                                groupMarker.addEventListener('mouseenter', () => {
                                    diamondContainer.style.bottom = `${index * 16}px`; // Se separan 16px hacia arriba cada uno
                                    diamondContainer.style.zIndex = `${10 + index}`;
                                });
                                groupMarker.addEventListener('mouseleave', () => {
                                    diamondContainer.style.bottom = `0px`; // Vuelven a caer a la base
                                    diamondContainer.style.zIndex = `${3 + index}`;
                                });

                                // Animación de latido individual de cada rombo
                                diamondContainer.onmouseenter = () => { 
                                    diamond.style.transform = "rotate(45deg) scale(1.6)"; 
                                    diamond.style.background = "var(--interactive-accent)"; 
                                };
                                diamondContainer.onmouseleave = () => { 
                                    diamond.style.transform = "rotate(45deg) scale(1)"; 
                                    diamond.style.background = bgBase; 
                                };

                                // Evento click con la protección TFile que reparamos antes
                                diamondContainer.onclick = async (e) => {
                                    e.stopPropagation();
                                    if (task.path) {
                                        const file = this.plugin.app.vault.getAbstractFileByPath(task.path);
                                        if (file && file instanceof TFile) {
                                            await this.plugin.app.workspace.getLeaf(false).openFile(file);
                                        } else {
                                            new Notice("⚠️ No se pudo encontrar el archivo físico de la tarea.");
                                        }
                                    }
                                };
                            });
                        });
                    }
                } catch (e) { /* Silencioso */ }
            })();
        }
        // HASTA AQUÍ 
        // 4. Dibujar las Barras y Nodos de Exámenes
        validExams.forEach((exam: any, index: number) => {
            const examDaysFromToday = Math.ceil((exam.examDate - todayMs) / msInDay);
            const examX = todayX + (examDaysFromToday * pxPerDay);
            const yPos = index * 40 + 20; // Apilado vertical
            const color = exam.color || "var(--interactive-accent)";

            const isPast = examDaysFromToday < 0;

            // A) La Barra de Progreso Creciente (Solo para exámenes futuros)
            if (!isPast) {
                const barWidth = examDaysFromToday * pxPerDay;
                track.createDiv({ attr: { style: `position: absolute; left: ${todayX}px; top: ${yPos + 6}px; width: ${barWidth}px; height: 8px; border-radius: 4px; background: ${color}; opacity: 0.3; transform-origin: left; animation: growTimelineBar 0.8s ease-out forwards;` }});
            }

            // B) El Nodo Meta (El examen)
            const marker = track.createDiv({ attr: { style: `position: absolute; left: ${examX}px; top: ${yPos}px; display: flex; align-items: center; gap: 8px; z-index: 1;` }});
            
            // Punto de color
            marker.createDiv({ attr: { style: `width: 14px; height: 14px; border-radius: 50%; background: ${color}; border: 2px solid var(--background-primary); box-shadow: 0 0 0 1px ${color}; opacity: ${isPast ? '0.5' : '1'};` }});
            
            // Texto y días restantes (Con estilos interactivos base)
            const label = marker.createDiv({ 
                attr: { style: `font-size: 0.85em; font-weight: bold; color: var(--text-normal); white-space: nowrap; opacity: ${isPast ? '0.5' : '1'}; cursor: pointer; transition: all 0.2s ease; padding: 2px 6px; border-radius: 4px;` }
            });
            label.innerText = `${exam.name} (${examDaysFromToday === 0 ? 'Today!' : Math.abs(examDaysFromToday) + (isPast ? ' d. ago' : ' d. left')})`;

            // 🌟 MAGIA 8: Click para abrir la nota del Proyecto
            label.onclick = async () => {
                // Replicamos la misma limpieza de nombre que usamos en la Fase 1
                const safeSubjectName = exam.name.replace(/[\\/:*?"<>|]/g, '');
                const projectFileName = `${safeSubjectName}.md`;
                
                // Buscamos la nota en la bóveda
                let file = this.plugin.app.metadataCache.getFirstLinkpathDest(projectFileName, "");
                if (!file) file = this.plugin.app.vault.getAbstractFileByPath(projectFileName) as TFile;

                if (file && file instanceof TFile) {
                    await this.plugin.app.workspace.getLeaf(false).openFile(file);
                } else {
                    new Notice(`⚠️ No se encontró la nota del proyecto: ${projectFileName}`);
                }
            };

            // 🌟 MAGIA 9: Cálculo de Mastery Y Confidence en Timeline
            (async () => {
                const vaultFiles = this.plugin.app.vault.getMarkdownFiles();
                const sources = exam.sources || [];
                
                const allAttachedNotes: string[] = [];
                if (exam.syllabus) {
                    exam.syllabus.forEach((t: any) => {
                        if (t.attachedNotes) allAttachedNotes.push(...t.attachedNotes);
                    });
                }

                const validFiles = vaultFiles.filter((f: any) => {
                    const isSource = sources.some((src: string) => f.path.startsWith(src) || f.path === src || f.name === src);
                    const isAttached = allAttachedNotes.some((n: string) => f.path === n || f.name === n || f.name === `${n}.md`);
                    return isSource || isAttached;
                });
                
                let totalFlashcards = 0;
                let newFlashcards = 0;
                
                let activeNotesCount = 0;
                let totalConfidenceSum = 0;
                let reviewedNotesCount = 0;

                for (const file of validFiles) {
                    const content = await this.plugin.app.vault.cachedRead(file);
                    const lines = content.split('\n');
                    let hasMarginalia = false;

                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].match(/%%[><](.*?)%%/)) {
                            hasMarginalia = true;
                            if (lines[i].includes(';;')) {
                                totalFlashcards++;
                                const blockIdMatch = lines[i].match(/\^([a-zA-Z0-9]+)\s*$/);
                                const blockId = blockIdMatch ? blockIdMatch[1] : `${file.basename}-L${i}`;
                                const reviewData = this.plugin.settings.userStats?.rhizomeReviews?.[blockId];
                                
                                if (!reviewData || reviewData.lastReviewed === 0) {
                                    newFlashcards++;
                                }
                            }
                        }
                    }
                    
                    const isAttached = allAttachedNotes.some((n: string) => file.path === n || file.name === n || file.name === `${n}.md`);
                    if (hasMarginalia || isAttached) {
                        activeNotesCount++;
                        const readingData = this.plugin.settings.userStats?.activeReading?.[file.path];
                        if (readingData && readingData.confidence) {
                            reviewedNotesCount++;
                            totalConfidenceSum += readingData.confidence;
                        }
                    }
                }

                let displayPct = 0;
                let displayLabel = "";

                // Priorizamos mostrar Mastery si hay Flashcards. Si no, mostramos Confidence.
                if (totalFlashcards > 0) {
                    const reviewedNotes = totalFlashcards - newFlashcards;
                    displayPct = Math.round((reviewedNotes / totalFlashcards) * 100);
                    displayLabel = `📊 Mastery: ${displayPct}%\n🗂️ Flashcards: ${reviewedNotes}/${totalFlashcards}`;
                } else if (activeNotesCount > 0) {
                    displayPct = reviewedNotesCount > 0 ? Math.round(((totalConfidenceSum / reviewedNotesCount) / 10) * 100) : 0;
                    displayLabel = `📖 Confidence: ${displayPct}%\n📝 Notes: ${reviewedNotesCount}/${activeNotesCount}`;
                } else {
                    displayLabel = `Sin contenido para evaluar`;
                }

                if (totalFlashcards > 0 || activeNotesCount > 0) {
                    let masteryColor = "var(--color-red)"; 
                    if (displayPct >= 30) masteryColor = "var(--color-orange)";
                    if (displayPct >= 50) masteryColor = "var(--color-yellow)";
                    if (displayPct >= 75) masteryColor = "var(--color-green)"; 
                    if (displayPct >= 90) masteryColor = "var(--color-cyan)"; 

                    label.style.color = masteryColor;
                    label.setAttribute("aria-label", displayLabel);
                    label.setAttribute("data-tooltip-position", "top");

                    label.onmouseenter = () => {
                        label.style.textShadow = `0 0 10px ${masteryColor}`;
                        label.style.transform = "scale(1.05) translateX(5px)";
                        label.style.background = "var(--background-secondary-alt)";
                    };
                    label.onmouseleave = () => {
                        label.style.textShadow = "none";
                        label.style.transform = "scale(1) translateX(0)";
                        label.style.background = "transparent";
                    };
                } else {
                    label.setAttribute("aria-label", displayLabel);
                    label.setAttribute("data-tooltip-position", "top");
                    label.onmouseenter = () => { label.style.transform = "scale(1.05) translateX(5px)"; label.style.color = color; };
                    label.onmouseleave = () => { label.style.transform = "scale(1) translateX(0)"; label.style.color = "var(--text-normal)"; };
                }
            })();
        });
    }

async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();

        // ======================================================
        // 1. MEMORIA DEL GRID Y MIGRACIÓN A WORKSPACES (i3wm style)
        // ======================================================
        const dbData = (this.plugin.settings.dashboardData as any) || {};
        
        // --- MIGRACIÓN SILENCIOSA A MULTI-WORKSPACES ---
        if (!dbData.workspaces || !Array.isArray(dbData.workspaces)) {
            dbData.workspaces = [];
            // Rescatamos tu layout actual (si tenías uno), si no, creamos un default
            let legacyLayout = dbData.layout || { 
                timeline: true, planner: true, subjects: true, tracker: true, dailyNote: false, 
                colOrder: ['planner', 'subjects', 'tracker'], 
                timelinePos: 'top', timelineStart: 0, timelineSpan: 3, editMode: false,
                // OPCIONES DE TASKNOTES (por defecto apagadas)
                plannerTaskNotes: false, timelineTaskNotes: false, subjectsTaskNotes: false
            };
            dbData.workspaces.push(legacyLayout);
            dbData.activeWorkspaceIndex = 0;
        }

        // Seguridad por si borramos de más
        if (dbData.activeWorkspaceIndex === undefined || dbData.activeWorkspaceIndex >= dbData.workspaces.length) {
            dbData.activeWorkspaceIndex = 0;
        }

        // 🪄 MAGIA: El layout que usa el dashboard ahora es simplemente el del workspace activo
        let layout = dbData.workspaces[dbData.activeWorkspaceIndex];
        dbData.layout = layout; // Sincronizamos por compatibilidad hacia atrás

        // --- ENCABEZADO Y BARRA DE WORKSPACES (ESTILO ARCH LINUX) ---
        const headerSection = container.createDiv({ attr: { style: "display: flex; flex-direction: column; margin-bottom: 10px;" } });
        
        const workspaceBar = headerSection.createDiv({ 
            attr: { style: "display: flex; gap: 6px; padding: 4px 6px; background: var(--background-secondary-alt); border: 1px solid var(--background-modifier-border); border-radius: 6px; width: fit-content; align-self: flex-start; margin-bottom: 8px;" } 
        });

        // Dibujar las ventanitas numeradas 1, 2, 3...
        dbData.workspaces.forEach((wsLayout: any, index: number) => {
            const wsBtn = workspaceBar.createEl("button", { text: `${index + 1}` });
            wsBtn.title = `Workspace ${index + 1}\nClick Izquierdo: Cargar\nClick Derecho: Eliminar`;
            wsBtn.style.padding = "2px 10px";
            wsBtn.style.border = "none";
            wsBtn.style.cursor = "pointer";
            wsBtn.style.borderRadius = "4px";
            wsBtn.style.fontFamily = "monospace"; // Estilo terminal/linux
            wsBtn.style.fontWeight = "bold";
            wsBtn.style.fontSize = "0.9em";

            // Estilos del workspace activo
            if (index === dbData.activeWorkspaceIndex) {
                wsBtn.style.background = "var(--interactive-accent)";
                wsBtn.style.color = "var(--text-on-accent)";
                wsBtn.style.boxShadow = "0 2px 4px rgba(0,0,0,0.2)";
            } else {
                wsBtn.style.background = "transparent";
                wsBtn.style.color = "var(--text-muted)";
                wsBtn.onmouseenter = () => wsBtn.style.background = "var(--background-modifier-hover)";
                wsBtn.onmouseleave = () => wsBtn.style.background = "transparent";
            }

            // Cambiar de Workspace (Click Izquierdo)
            wsBtn.onclick = async () => {
                dbData.activeWorkspaceIndex = index;
                await this.plugin.saveSettings();
                this.onOpen();
            };

            // Eliminar Workspace (Click Derecho)
            wsBtn.oncontextmenu = async (e: MouseEvent) => {
                e.preventDefault();
                if (dbData.workspaces.length === 1) {
                    new Notice("No puedes eliminar el último workspace.");
                    return;
                }
                dbData.workspaces.splice(index, 1); // Borramos del array
                // Ajustamos el índice si borramos el activo o uno anterior
                if (dbData.activeWorkspaceIndex >= dbData.workspaces.length) {
                    dbData.activeWorkspaceIndex = Math.max(0, dbData.workspaces.length - 1);
                }
                await this.plugin.saveSettings();
                this.onOpen();
            };
        });

        // Botón "+" para crear un nuevo Workspace
        const addWsBtn = workspaceBar.createEl("button", { title: "Duplicar diseño actual como nuevo Workspace" });
        setIcon(addWsBtn, "plus");
        addWsBtn.style.padding = "2px 6px";
        addWsBtn.style.border = "none";
        addWsBtn.style.background = "transparent";
        addWsBtn.style.color = "var(--text-muted)";
        addWsBtn.style.cursor = "pointer";
        addWsBtn.onmouseenter = () => addWsBtn.style.color = "var(--interactive-accent)";
        addWsBtn.onmouseleave = () => addWsBtn.style.color = "var(--text-muted)";
        
        addWsBtn.onclick = async () => {
            // Clonamos el objeto actual para que no se sobreescriban
            const newLayout = JSON.parse(JSON.stringify(layout)); 
            dbData.workspaces.push(newLayout);
            dbData.activeWorkspaceIndex = dbData.workspaces.length - 1; // Saltamos al nuevo
            await this.plugin.saveSettings();
            this.onOpen();
            new Notice(`Workspace ${dbData.workspaces.length} creado!`);
        };

        // --- BARRA DE HERRAMIENTAS DE WIDGETS ---
        const toolbarRow = headerSection.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; padding-right: 10px;" } });
        toolbarRow.createEl("h1", { text: "Smart study", attr: { style: "margin: 0; font-size: 1.2em; color: var(--text-muted);" } });

        const toolbar = toolbarRow.createDiv({ attr: { style: "display: flex; gap: 8px;" } });
        
        const createToggle = (key: string, icon: string, tooltip: string, isCol: boolean = true) => {
            const btn = toolbar.createEl("button", { title: tooltip, attr: { style: "background: transparent; box-shadow: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: 4px;" } });
            setIcon(btn, icon);
            btn.style.opacity = layout[key] ? "1" : "0.3";
            btn.style.color = layout[key] ? "var(--interactive-accent)" : "var(--text-muted)";
            
            btn.onclick = async () => { 
                if (!layout[key]) {
                    if (isCol && layout.colOrder.length >= 3) {
                        new Notice("⚠️ Maximum 3 column widgets allowed. Deactivate one first.");
                        return;
                    }
                    layout[key] = true;
                    if (isCol) layout.colOrder.push(key);
                } else {
                    layout[key] = false;
                    if (isCol) layout.colOrder = layout.colOrder.filter((k:string) => k !== key);
                }
                await this.plugin.saveSettings(); 
                this.onOpen(); 
            };
        };

        createToggle('timeline', 'git-commit', 'Toggle Timeline', false); 
        createToggle('planner', 'calendar', 'Toggle Daily Planner');
        createToggle('subjects', 'library', 'Toggle Subjects');
        createToggle('tracker', 'bar-chart-2', 'Toggle Tracker');
        createToggle('dailyNote', 'file-edit', 'Toggle Daily Note'); 
        
        const editBtn = toolbar.createEl("button", { title: "Edit Layout", attr: { style: "margin-left: 10px; background: transparent; box-shadow: none; border: none; cursor: pointer; padding: 4px 8px; border-radius: 4px;" } });
        setIcon(editBtn, "layout");
        editBtn.style.color = layout.editMode ? "var(--color-orange)" : "var(--text-muted)";
        editBtn.onclick = async () => { layout.editMode = !layout.editMode; await this.plugin.saveSettings(); this.onOpen(); };

        // ======================================================
        // 2. MOTOR MATEMÁTICO DE COORDENADAS (VIBECODER EDITION)
        // ======================================================
        const dashboardMain = container.createEl("div", { cls: "cornell-ultimate-dashboard" });
        dashboardMain.style.display = "grid";
        dashboardMain.style.gridTemplateColumns = "repeat(3, 1fr)";
        dashboardMain.style.gridTemplateRows = layout.timelinePos === 'top' ? "auto 1fr" : "1fr auto";

        const activeCols = layout.colOrder.filter((id: string) => layout[id] && id !== 'timeline');
        const widgetCoords: Record<string, { colStart: number, colEnd: number, rowStart: number, rowEnd: number }> = {};

        if (activeCols.length >= 3) {
            widgetCoords[activeCols[0]] = { colStart: 1, colEnd: 2, rowStart: 0, rowEnd: 0 };
            widgetCoords[activeCols[1]] = { colStart: 2, colEnd: 3, rowStart: 0, rowEnd: 0 };
            widgetCoords[activeCols[2]] = { colStart: 3, colEnd: 4, rowStart: 0, rowEnd: 0 };
        } else if (activeCols.length === 2) {
            widgetCoords[activeCols[0]] = { colStart: 1, colEnd: 3, rowStart: 0, rowEnd: 0 }; 
            widgetCoords[activeCols[1]] = { colStart: 3, colEnd: 4, rowStart: 0, rowEnd: 0 }; 
        } else if (activeCols.length === 1) {
            widgetCoords[activeCols[0]] = { colStart: 1, colEnd: 4, rowStart: 0, rowEnd: 0 }; 
        }

        const timelineRow = layout.timelinePos === 'top' ? 1 : 2;
        const widgetsBaseRow = layout.timelinePos === 'top' ? 2 : 1;
        const tStart = layout.timelineStart + 1;
        const tEnd = tStart + layout.timelineSpan;

        for (const widgetId of activeCols) {
            const coords = widgetCoords[widgetId];
            coords.rowStart = widgetsBaseRow;
            coords.rowEnd = widgetsBaseRow + 1;

            const overlapsWithTimeline = layout.timeline && (coords.colStart < tEnd && coords.colEnd > tStart);

            if (!overlapsWithTimeline) {
                if (layout.timelinePos === 'top') {
                    coords.rowStart = 1; 
                } else {
                    coords.rowEnd = 3;   
                }
            }
        }

        // ======================================================
        // 3. RENDERIZAR LÍNEA DE TIEMPO (2 BOTONES FLECHA)
        // ======================================================
        const timelineContainer = dashboardMain.createEl("div", { cls: "dashboard-timeline-container" });
        
        if (!layout.timeline) {
            timelineContainer.style.display = 'none';
        } else {
            timelineContainer.style.gridColumn = `${tStart} / ${tEnd}`;
            timelineContainer.style.gridRow = `${timelineRow} / ${timelineRow + 1}`;
            timelineContainer.style.minWidth = "0"; 
        }
        
        if (layout.editMode && layout.timeline) {
            const tlControls = timelineContainer.createEl("div", { 
                attr: { style: "display: flex; gap: 5px; margin-bottom: 5px; background: var(--background-secondary-alt); padding: 4px; border-radius: 4px; align-self: flex-start;" }
            });

            const upBtn = tlControls.createEl("button", { cls: "layout-control-btn", title: "Move Top / Bottom" }); 
            setIcon(upBtn, "arrow-up-down");
            upBtn.onclick = async () => { layout.timelinePos = layout.timelinePos === 'top' ? 'bottom' : 'top'; await this.plugin.saveSettings(); this.onOpen(); };
            
            tlControls.createEl("span", { attr: { style: "width: 1px; background: var(--background-modifier-border); margin: 0 4px;" } }); 
            
            const leftBtn = tlControls.createEl("button", { cls: "layout-control-btn", title: "Hacia la Izquierda" }); 
            setIcon(leftBtn, "arrow-left"); 
            leftBtn.disabled = (layout.timelineStart === 0 && layout.timelineSpan === 1); 
            leftBtn.onclick = async () => { 
                if (layout.timelineStart === 2 && layout.timelineSpan === 1) { 
                    layout.timelineStart = 1; layout.timelineSpan = 2; 
                } else if (layout.timelineStart === 1 && layout.timelineSpan === 2) { 
                    layout.timelineStart = 0; layout.timelineSpan = 3; 
                } else if (layout.timelineStart === 0 && layout.timelineSpan === 3) { 
                    layout.timelineStart = 0; layout.timelineSpan = 2; 
                } else if (layout.timelineStart === 0 && layout.timelineSpan === 2) { 
                    layout.timelineStart = 0; layout.timelineSpan = 1; 
                }
                await this.plugin.saveSettings(); this.onOpen(); 
            };

            const rightBtn = tlControls.createEl("button", { cls: "layout-control-btn", title: "Hacia la Derecha" }); 
            setIcon(rightBtn, "arrow-right"); 
            rightBtn.disabled = (layout.timelineStart === 2 && layout.timelineSpan === 1); 
            rightBtn.onclick = async () => { 
                if (layout.timelineStart === 0 && layout.timelineSpan === 1) { 
                    layout.timelineStart = 0; layout.timelineSpan = 2; 
                } else if (layout.timelineStart === 0 && layout.timelineSpan === 2) { 
                    layout.timelineStart = 0; layout.timelineSpan = 3; 
                } else if (layout.timelineStart === 0 && layout.timelineSpan === 3) { 
                    layout.timelineStart = 1; layout.timelineSpan = 2; 
                } else if (layout.timelineStart === 1 && layout.timelineSpan === 2) { 
                    layout.timelineStart = 2; layout.timelineSpan = 1; 
                }
                await this.plugin.saveSettings(); this.onOpen(); 
            };
            // --- AÑADIR TOGGLE DE TASKNOTES AL TIMELINE ---
            tlControls.createEl("span", { attr: { style: "width: 1px; background: var(--background-modifier-border); margin: 0 4px;" } }); 
            
            const tnToggle = tlControls.createEl("button", { 
                cls: "layout-control-btn", 
                title: "Toggle TaskNotes Integration",
                text: layout.timelineTaskNotes ? "✅ TaskNotes" : "❌ TaskNotes",
                attr: { style: layout.timelineTaskNotes ? "color: var(--color-green);" : "color: var(--text-muted);" }
            });
            
            tnToggle.onclick = async () => { 
                layout.timelineTaskNotes = !layout.timelineTaskNotes; 
                await this.plugin.saveSettings(); 
                this.onOpen(); 
            };
            // BOTÓN DE FILTRO CORNELL 
            tlControls.createEl("span", { attr: { style: "width: 1px; background: var(--background-modifier-border); margin: 0 4px;" } }); 
            
            const cornellToggle = tlControls.createEl("button", { 
                cls: "layout-control-btn", 
                title: "Mostrar SOLO tareas con el tag #cornell",
                text: layout.timelineCornellOnly ? "🎓 Solo Cornell" : "🌐 Todas las Tareas",
                attr: { style: layout.timelineCornellOnly ? "color: var(--color-purple);" : "color: var(--text-muted);" }
            });
            
            cornellToggle.onclick = async () => { 
                layout.timelineCornellOnly = !layout.timelineCornellOnly; 
                await this.plugin.saveSettings(); 
                this.onOpen(); 
            };
            // HASTA AQUÍ 
        }
        
        const timelineCanvas = timelineContainer.createEl("div", { attr: { style: "width: 100%; min-height: 0;" } });
        // @ts-ignore
        this.renderTimeline(timelineCanvas);

        // ======================================================
        // 4. DECLARACIÓN DE COLUMNAS (LO QUE SE HABÍA BORRADO)
        // ======================================================
        const createWidgetCol = (id: string, clsName: string) => {
            const col = dashboardMain.createEl("div", { cls: `dashboard-col ${clsName}` });
            
            if (!layout[id]) {
                col.style.display = 'none';
            } else if (widgetCoords[id]) {
                const coords = widgetCoords[id];
                col.style.gridColumn = `${coords.colStart} / ${coords.colEnd}`;
                col.style.gridRow = `${coords.rowStart} / ${coords.rowEnd}`;
            }
            
            if (layout.editMode && layout[id]) {
                const swapCols = async (idxA: number, idxB: number) => {
                    const temp = layout.colOrder[idxA]; layout.colOrder[idxA] = layout.colOrder[idxB]; layout.colOrder[idxB] = temp;
                    await this.plugin.saveSettings(); this.onOpen();
                };
                
                // NOTA: Cambiamos justify-content a 'space-between' y añadimos fondo
                const ctrlRow = col.createDiv({ attr: { style: "display: flex; justify-content: space-between; gap: 5px; margin-bottom: 5px; background: var(--background-secondary-alt); padding: 4px; border-radius: 4px;" }});
                
                // 1. Zona Izquierda (Integraciones)
                const integrationZone = ctrlRow.createDiv({ attr: { style: "display: flex; gap: 5px;" }});
                if (id === 'planner' || id === 'subjects') {
                    const tnKey = id + 'TaskNotes';
                    const tnToggle = integrationZone.createEl("button", { 
                        cls: "layout-control-btn", 
                        title: "Enable/Disable TaskNotes",
                        text: layout[tnKey] ? "✅ TaskNotes" : "❌ TaskNotes",
                        attr: { style: layout[tnKey] ? "color: var(--color-green); font-size: 0.8em;" : "color: var(--text-muted); font-size: 0.8em;" }
                    });
                    tnToggle.onclick = async () => { 
                        layout[tnKey] = !layout[tnKey]; 
                        await this.plugin.saveSettings(); 
                        this.onOpen(); 
                    };
                }

                // 2. Zona Derecha (Flechas de movimiento original)
                const moveZone = ctrlRow.createDiv({ attr: { style: "display: flex; gap: 5px;" }});
                const idx = layout.colOrder.indexOf(id);
                if (idx > 0) { const lBtn = moveZone.createEl("button", { cls: "layout-control-btn", title: "Move Left" }); setIcon(lBtn, "arrow-left"); lBtn.onclick = () => swapCols(idx, idx - 1); }
                if (idx < layout.colOrder.length - 1) { const rBtn = moveZone.createEl("button", { cls: "layout-control-btn", title: "Move Right" }); setIcon(rBtn, "arrow-right"); rBtn.onclick = () => swapCols(idx, idx + 1); }
            }
            return col;
        };

        const plannerCol = createWidgetCol('planner', 'dashboard-planner');
        const subjectsCol = createWidgetCol('subjects', 'dashboard-subjects');
        const trackerCol = createWidgetCol('tracker', 'dashboard-tracker');
        const dailyNoteCol = createWidgetCol('dailyNote', 'dashboard-dailyNote');

        // ======================================================
        // WIDGET A: DAILY PLANNER
        // ======================================================
        if (layout.planner) {
            const dailyHeader = plannerCol.createDiv({ cls: 'daily-planner-header' });
            dailyHeader.createEl("h2", { text: "Today's Plan" });
            
            const openWeeklyBtn = dailyHeader.createEl("button", { title: "Open Weekly Schedule", cls: "cornell-action-btn" });
            setIcon(openWeeklyBtn, "calendar-days"); 
            // @ts-ignore
            openWeeklyBtn.onclick = () => { new WeeklyPlannerModal(this.plugin.app, this.plugin, () => { this.onOpen(); }).open(); };

            const modeSelector = plannerCol.createDiv({ attr: { style: "display: flex; gap: 5px; margin-bottom: 15px; background: var(--background-secondary-alt); padding: 4px; border-radius: 8px;" }});
            const createModeBtn = (id: string, iconName: string, label: string) => {
                const btn = modeSelector.createEl("button", { attr: { style: "flex-grow: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 0; border-radius: 6px; box-shadow: none; border: none; cursor: pointer;" }});
                const iconSpan = btn.createSpan(); setIcon(iconSpan, iconName);
                btn.createSpan({ text: label, attr: { style: "font-size: 0.85em; font-weight: bold;" }});
                if (this.currentDayMode === id) { btn.style.background = "var(--interactive-accent)"; btn.style.color = "var(--text-on-accent)"; } 
                else { btn.style.background = "transparent"; btn.style.color = "var(--text-muted)"; btn.onmouseenter = () => btn.style.background = "var(--background-modifier-hover)"; btn.onmouseleave = () => btn.style.background = "transparent"; }
                btn.onclick = () => { this.currentDayMode = id; this.onOpen(); };
            };
            createModeBtn('optimal', 'battery-full', 'Optimal');
            createModeBtn('regular', 'battery-medium', 'Regular');
            createModeBtn('survival', 'battery-low', 'Survival');
            createModeBtn('custom', 'sliders', 'Custom'); 

            const dailyTimelineContainer = plannerCol.createDiv({ cls: "daily-timeline-container" });
            const todayDate = new Date();
            const todayDayOfWeek = todayDate.getDay();
            const todayKey = `${todayDate.getFullYear()}-${todayDate.getMonth() + 1}-${todayDate.getDate()}`; 
            
            const allBlocks = dbData.routineBlocks || [];
            if (!dbData.customDays) dbData.customDays = {};
            
            let todaysBlocks: any[] = [];
            if (this.currentDayMode === 'custom') todaysBlocks = dbData.customDays[todayKey] || [];
            else todaysBlocks = allBlocks.filter((b: any) => b.dayOfWeek === todayDayOfWeek && (b.mode === this.currentDayMode || (!b.mode && this.currentDayMode === 'optimal')));

            const activeSubjects = dbData.subjects || [];
            const vaultFiles = this.plugin.app.vault.getMarkdownFiles();
            const nowMs = Date.now();
            const dynamicBlocks: any[] = [];

            for (const subject of activeSubjects) {
                const sources = subject.sources || [];
                const validFiles = vaultFiles.filter((f: any) => sources.some((src: string) => f.path.startsWith(src) || f.path === src || f.name === src));
                
                let overdueCount = 0;
                for (const file of validFiles) {
                    const content = await this.plugin.app.vault.cachedRead(file);
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].match(/%%[><](.*?)%%/)) {
                            const blockIdMatch = lines[i].match(/\^([a-zA-Z0-9]+)\s*$/);
                            const blockId = blockIdMatch ? blockIdMatch[1] : `${file.basename}-L${i}`;
                            const reviewData = this.plugin.settings.userStats.rhizomeReviews?.[blockId];
                            
                            if (!reviewData || reviewData.lastReviewed === 0) overdueCount++; 
                            else if (nowMs >= (reviewData.lastReviewed + (reviewData.interval * 24 * 60 * 60 * 1000))) overdueCount++; 
                        }
                    }
                }
                if (overdueCount > 0) dynamicBlocks.push({ id: `auto-${subject.id}`, dayOfWeek: todayDayOfWeek, startTime: "AUTO", endTime: "SRS", type: 'review', title: `🔥 Review: ${subject.name}`, subtitle: `${overdueCount} pending cards`, isAuto: true, subject: subject });
            }
            // FETCH DE TASKNOTES AQUÍ 
            if (layout.plannerTaskNotes) {
                try {
                    const config = await this.getTaskNotesConfig();
                    const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
                    if (config.token) reqHeaders['Authorization'] = `Bearer ${config.token}`;

                    // @ts-ignore
                    const tasksResponse = await requestUrl({
                        url: `http://127.0.0.1:${config.port}/api/tasks/query`,
                        method: 'POST',
                        headers: reqHeaders, // 👈 Cabeceras seguras
                        body: JSON.stringify({
                            type: "group",
                            id: "root",
                            conjunction: "and",
                            children: [ { type: "condition", id: "c1", property: "status", operator: "is", value: "open" } ]
                        })
                    });

                    if (tasksResponse.status === 200 && tasksResponse.json?.success && tasksResponse.json?.data?.tasks) {
                        const externalTasks = tasksResponse.json.data.tasks;
                        const todayStr = new Date().toISOString().split('T')[0];

                        externalTasks.forEach((task: any) => {
                            // Verificamos si la tarea es para hoy (ya sea por due o scheduled)
                            const isToday = (task.due && task.due.startsWith(todayStr)) || (task.scheduled && task.scheduled.startsWith(todayStr));
                            
                            if (isToday) {
                                let start = "AUTO";
                                let end = "TASK";
                                let isAuto = true;

                                // 🌟 MAGIA 10: Extraer la hora exacta (Ej: de "2024-03-20T14:30" sacamos "14:30")
                                const timeMatch = (task.scheduled || task.due || "").match(/T(\d{2}:\d{2})/);
                                if (timeMatch) {
                                    start = timeMatch[1]; // Ej: "14:30"
                                    
                                    // 1. Extraemos horas y minutos iniciales
                                    const [h, m] = start.split(':').map(Number);
                                    
                                    // 2. Leemos la duración de TaskNotes (si no existe, usamos 60 min por defecto)
                                    // Aseguramos que sea un número válido
                                    const durationMins = task.timeEstimate ? parseInt(task.timeEstimate, 10) : 60;
                                    
                                    // 3. Convertimos todo a minutos desde las 00:00 y sumamos la duración
                                    const totalEndMins = (h * 60) + m + durationMins;
                                    
                                    // 4. Volvemos a convertir a formato Reloj (Horas y Minutos)
                                    // Usamos % 24 por si la tarea cruza la medianoche (ej: 23:30 + 60 min = 00:30)
                                    const endH = Math.floor(totalEndMins / 60) % 24;
                                    const endM = totalEndMins % 60;
                                    
                                    // 5. Formateamos con ceros a la izquierda (ej: "9" -> "09")
                                    end = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
                                    
                                    isAuto = false; // Como tiene hora exacta, lo anclamos al Planner
                                }

                                dynamicBlocks.push({
                                    id: `tasknote-${task.id || Math.random()}`,
                                    dayOfWeek: todayDayOfWeek,
                                    startTime: start,
                                    endTime: end,
                                    type: 'study', 
                                    title: `📝 ${task.title}`,
                                    subtitle: "TaskNotes",
                                    isAuto: isAuto,
                                    isTaskNote: true, // 
                                    subject: null,
                                    path: task.path
                                });
                            }
                        });
                    }
                } catch (error) {
                    console.debug("[Cornell Marginalia] Falló lectura de API TaskNotes para el Planner.");
                }
            }
            // HASTA AQUÍ

            todaysBlocks = [...dynamicBlocks, ...todaysBlocks].sort((a: any, b: any) => (a.isAuto ? "00:00" : a.startTime).localeCompare(b.isAuto ? "00:00" : b.startTime));

            if (todaysBlocks.length === 0) {
                dailyTimelineContainer.createEl("p", { text: "No tasks scheduled for today.", cls: "text-muted", attr: { style: "text-align: center; margin-top: 20px; font-style: italic;" } });
                const demoBtn = dailyTimelineContainer.createEl("button", { text: "🧪 Inject Demo Routine", cls: "mod-cta" });
                demoBtn.onclick = async () => {
                    dbData.routineBlocks = [
                        { id: "1", dayOfWeek: todayDayOfWeek, startTime: "08:00", endTime: "10:00", type: 'class', title: "Anatomy Lecture" },
                        { id: "4", dayOfWeek: todayDayOfWeek, startTime: "18:00", endTime: "19:00", type: 'review', title: "Flashcards SRS" },
                    ];
                    await this.plugin.saveSettings(); this.onOpen(); 
                };
            } else {
                todaysBlocks.forEach((block: any) => {
                    const blockEl = dailyTimelineContainer.createDiv({ cls: `daily-block type-${block.type}` });
                    
                    if (block.isAuto) {
                        blockEl.dataset.startMins = "0"; blockEl.dataset.endMins = "0";
                        blockEl.classList.add('is-current'); 
                        blockEl.style.border = "1px solid var(--color-orange)"; 
                    } else {
                        const [startH, startM] = block.startTime.split(':').map(Number); 
                        const [endH, endM] = block.endTime.split(':').map(Number);
                        blockEl.dataset.startMins = (startH * 60 + startM).toString(); 
                        blockEl.dataset.endMins = (endH * 60 + endM).toString();
                    }

                    // 🌟 MAGIA 11: Lógica de Clicks (TaskNotes vs Tareas Autogeneradas)
                    if (block.path) {
                        // Si tiene path, es una TaskNote (flotante o con horario)
                        blockEl.style.cursor = "pointer";
                        blockEl.onclick = async () => {
                            const file = this.plugin.app.vault.getAbstractFileByPath(block.path);
                            if (file && file instanceof TFile) {
                                await this.plugin.app.workspace.getLeaf(false).openFile(file);
                            }
                        };
                    } else if (block.isAuto) {
                        // Si es autogenerado por Cornell (Repaso SRS), inicia la sesión de estudio
                        blockEl.style.cursor = "pointer";
                        // @ts-ignore
                        blockEl.onclick = () => { new ReviewSessionManager(this.plugin, block.subject, false).start(); };
                    }

                    let blockColor = "var(--interactive-accent)";
                    if (block.type === 'study') blockColor = "var(--color-blue)"; if (block.type === 'review') blockColor = "var(--color-orange)";
                    if (block.type === 'class') blockColor = "var(--color-purple)"; if (block.type === 'break') blockColor = "var(--color-green)";
                    blockEl.style.setProperty('--block-color', blockColor);

                    const timeCol = blockEl.createDiv({ cls: "daily-block-time" });
                    timeCol.createDiv({ text: block.startTime, cls: "time-start", attr: { style: block.isAuto ? "color: var(--color-orange); font-weight: bold;" : "" } });
                    timeCol.createDiv({ text: block.endTime, cls: "time-end" });

                    if (this.currentDayMode === 'custom' && !block.isAuto) {
                        const delBtn = timeCol.createDiv({ text: "×", attr: { style: "color: var(--text-error); cursor: pointer; font-size: 1.2em; text-align: right; margin-top: 5px;" } });
                        delBtn.onclick = async (e: MouseEvent) => { e.stopPropagation(); dbData.customDays[todayKey] = dbData.customDays[todayKey].filter((b: any) => b.id !== block.id); await this.plugin.saveSettings(); this.onOpen(); };
                    }

                    const nodeCol = blockEl.createDiv({ cls: "daily-block-node" });
                    const iconContainer = nodeCol.createDiv({ cls: "daily-block-icon" });
                    
                    // 🌟 MAGIA 12: ESTILOS DE ANIDAMIENTO PARA TASKNOTES
                    if (block.isTaskNote && !block.isAuto) {
                        // Quitamos el marginLeft para no romper la línea de tiempo central
                        blockEl.style.borderLeft = "2px dashed var(--color-blue)"; // Mantenemos el borde distintivo
                        blockEl.style.background = "var(--background-primary)";
                        blockEl.style.boxShadow = "none";
                        
                        // Hacemos el círculo del nodo más pequeño para indicar jerarquía
                        iconContainer.style.width = "20px";
                        iconContainer.style.height = "20px";
                        iconContainer.style.minWidth = "20px";
                        iconContainer.style.padding = "3px"; // Reduce el SVG interno
                        
                        // Ocultamos el tiempo de fin para que se vea más limpio
                        blockEl.classList.add("is-sub-task"); 
                    }

                    let iconName = "check-square";
                    if (block.type === 'study') iconName = "book-open"; 
                    if (block.type === 'review') iconName = "refresh-cw";
                    if (block.type === 'class') iconName = "graduation-cap"; 
                    if (block.type === 'break') iconName = "coffee";
                    if (block.isTaskNote) iconName = "check-circle"; // Ícono específico para TaskNotes
                    if (block.isAuto && !block.isTaskNote) iconName = "zap";
                    if (block.type === 'study') iconName = "book-open"; if (block.type === 'review') iconName = "refresh-cw";
                    if (block.type === 'class') iconName = "graduation-cap"; if (block.type === 'break') iconName = "coffee";
                    if (block.isAuto) iconName = "zap"; 
                    setIcon(iconContainer, iconName);

                    const contentCol = blockEl.createDiv({ cls: "daily-block-content" });
                    contentCol.createDiv({ text: block.title, cls: "daily-block-title" });
                    contentCol.createDiv({ text: block.subtitle ? block.subtitle : (block.type.charAt(0).toUpperCase() + block.type.slice(1) + " Session"), cls: "daily-block-subtitle" });
                });

                const updateTimeline = () => {
                    if (!document.body.contains(dailyTimelineContainer)) return; 
                    const d = new Date(); const currentMins = d.getHours() * 60 + d.getMinutes();
                    dailyTimelineContainer.querySelectorAll('.daily-block').forEach((node: Element) => {
                        const el = node as HTMLElement; 
                        const startTotal = parseInt(el.dataset.startMins || "0"); const endTotal = parseInt(el.dataset.endMins || "0");
                        let progress = 0;
                        if (currentMins >= endTotal) { progress = 100; el.classList.add('is-past'); el.classList.remove('is-current', 'is-future'); } 
                        else if (currentMins < startTotal) { progress = 0; el.classList.add('is-future'); el.classList.remove('is-past', 'is-current'); } 
                        else { progress = ((currentMins - startTotal) / (endTotal - startTotal)) * 100; el.classList.add('is-current'); el.classList.remove('is-past', 'is-future'); }
                        el.style.setProperty('--progress', `${progress}%`);
                    });
                };
                updateTimeline();
                this.plugin.registerInterval(window.setInterval(updateTimeline, 60000));
            }

            if (this.currentDayMode === 'custom') {
                const customActions = dailyTimelineContainer.createDiv({ attr: { style: "display: flex; gap: 10px; margin-top: 15px; justify-content: center;" }});
                if (todaysBlocks.filter((b: any) => !b.isAuto).length === 0) {
                    const cloneBtn = customActions.createEl("button", { text: "Clone Optimal Plan" });
                    cloneBtn.onclick = async () => {
                        const optimalBlocks = allBlocks.filter((b: any) => b.dayOfWeek === todayDayOfWeek && (b.mode === 'optimal' || !b.mode));
                        dbData.customDays[todayKey] = JSON.parse(JSON.stringify(optimalBlocks)).map((b:any) => ({...b, id: Math.random().toString(36).substring(2, 9)}));
                        await this.plugin.saveSettings(); this.onOpen();
                    };
                }
                const addBtn = customActions.createEl("button", { text: "Add Custom Block", cls: "mod-cta" });
                // @ts-ignore
                addBtn.onclick = () => { new CustomBlockModal(this.plugin.app, this.plugin, todayKey, () => this.onOpen()).open(); };
            }
        }

        // ======================================================
        // WIDGET B: SUBJECTS & RESOURCES (Fusión Perfecta 🧬)
        // ======================================================
        if (layout.subjects) {
            const midHeader = subjectsCol.createDiv({ cls: 'daily-planner-header' });
            midHeader.createEl("h2", { text: "📚 Subjects & Resources" });
            const addSubjectBtn = midHeader.createEl("button", { title: "Add Subject", cls: "cornell-action-btn" });
            setIcon(addSubjectBtn, "plus-circle");
            // @ts-ignore
            addSubjectBtn.onclick = () => { new SubjectEditorModal(this.plugin.app, this.plugin, null, () => this.onOpen()).open(); };

            const subjectsContainer = subjectsCol.createDiv({ cls: "subjects-container" });
            const subjectsList = dbData.subjects || [];

            if (subjectsList.length === 0) {
                subjectsContainer.createEl("p", { text: "No subjects yet.", cls: "text-muted", attr: { style: "text-align: center; font-style: italic; margin-top: 20px;" } });
            } else {
                subjectsList.forEach((subject: any) => {
                    const subjCard = subjectsContainer.createDiv({ cls: "subject-card" });
                    subjCard.style.borderLeft = `4px solid ${subject.color || 'var(--interactive-accent)'}`;
                    
                    const subjHeader = subjCard.createDiv({ cls: "subject-header" });
                    subjHeader.createDiv({ cls: "subject-title", text: subject.name });
                    
                    const subjActions = subjHeader.createDiv({ cls: "subject-actions" });
                    const sEditBtn = subjActions.createSpan({ cls: "subject-action-icon", title: "Edit" }); setIcon(sEditBtn, "edit");
                    // @ts-ignore
                    sEditBtn.onclick = () => new SubjectEditorModal(this.plugin.app, this.plugin, subject, () => this.onOpen()).open();
                    
                    const delBtn = subjActions.createSpan({ cls: "subject-action-icon", title: "Delete" }); setIcon(delBtn, "trash");
                    delBtn.onclick = async () => { dbData.subjects = subjectsList.filter((s: any) => s.id !== subject.id); await this.plugin.saveSettings(); this.onOpen(); };

                    const daysLeft = Math.ceil((subject.examDate - new Date().getTime()) / (1000 * 60 * 60 * 24));
                    const countdownEl = subjCard.createDiv({ cls: "subject-countdown", text: daysLeft > 0 ? `⏳ ${daysLeft} days until exam` : (daysLeft === 0 ? "🔥 Exam is TODAY!" : "✅ Exam passed") });
                    if (daysLeft <= 7 && daysLeft > 0) countdownEl.style.color = "var(--color-red)"; 

                    const foldersDiv = subjCard.createDiv({ cls: "subject-folders" });
                    const sourcesArray = [...(subject.sources || subject.resourceFolders || [])].sort((a: string, b: string) => {
                        const getWeight = (path: string) => {
                            const lowerPath = path.toLowerCase();
                            if (lowerPath.endsWith('.pdf')) return 1;
                            if (lowerPath.endsWith('.canvas')) return 2;
                            if (lowerPath.endsWith('.excalidraw') || lowerPath.endsWith('.excalidraw.md')) return 3;
                            if (lowerPath.endsWith('.md')) return 4;
                            return 0; 
                        };
                        const weightA = getWeight(a); const weightB = getWeight(b);
                        return weightA !== weightB ? weightA - weightB : a.localeCompare(b);
                    });

                    sourcesArray.forEach((src: string) => {
                        let iconName = "folder"; let isFile = false; const lowerSrc = src.toLowerCase();
                        if (lowerSrc.endsWith(".pdf")) { iconName = "file-text"; isFile = true; }
                        else if (lowerSrc.endsWith(".canvas")) { iconName = "layout-dashboard"; isFile = true; } 
                        else if (lowerSrc.endsWith(".excalidraw") || lowerSrc.endsWith(".excalidraw.md")) { iconName = "pen-tool"; isFile = true; } 
                        else if (lowerSrc.endsWith(".md")) { iconName = "file"; isFile = true; }

                        const chip = foldersDiv.createSpan({ cls: "folder-chip", attr: { style: "display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px;" } });
                        const iconSpan = chip.createSpan({ attr: { style: "display: flex;" } });
                        setIcon(iconSpan, iconName);
                        const svg = iconSpan.querySelector('svg');
                        if (svg) { svg.style.width = "14px"; svg.style.height = "14px"; }

                        chip.createSpan({ text: src.split('/').pop() || src });
                        if (isFile) {
                            chip.classList.add("is-clickable"); chip.title = "Click to open file";
                            chip.onclick = () => {
                                const file = this.plugin.app.metadataCache.getFirstLinkpathDest(src, "");
                                // @ts-ignore
                                if (file) this.plugin.app.workspace.getLeaf(false).openFile(file);
                                else new Notice(`⚠️ File not found: ${src}`);
                            };
                        }
                    });

                    const statsDiv = subjCard.createDiv({ cls: "subject-stats-container" });
                    this.calculateSubjectStats(subject, statsDiv);

                    const studyActions = subjCard.createDiv({ cls: "subject-study-actions" });
                    
                    // BOTÓN PRINCIPAL: DESPLIEGA EL MENÚ DE DECISIÓN DE ESTUDIO (Lectura vs SRS)
const reviewBtn = studyActions.createEl("button", { cls: "mod-cta", title: "Start study session" });
reviewBtn.style.backgroundColor = subject.color || 'var(--interactive-accent)'; 
reviewBtn.style.color = '#ffffff'; 

const reviewIcon = reviewBtn.createSpan(); 
setIcon(reviewIcon, 'play'); 
reviewIcon.style.marginRight = "6px";
reviewBtn.createSpan({ text: "Review" }); // Reemplazado "Estudiar" por "Review"

reviewBtn.onclick = (event: MouseEvent) => { 
    const menu = new Menu(); 
    menu.addItem((item) => {
        item.setTitle("📖 Active Reading (Holistic)")
            .setIcon("book-open")
            .onClick(() => {
                // Pasamos 'reading' al final
                new ReviewSessionManager(this.plugin, subject, false, null, 'reading').start();
            });
    });
    menu.addItem((item) => {
        item.setTitle("⚡ Flashcards SRS (Strict)")
            .setIcon("zap")
            .onClick(() => {
                // Pasamos 'srs' al final
                new ReviewSessionManager(this.plugin, subject, false, null, 'srs').start();
            });
    });
    menu.showAtMouseEvent(event);
};

                    // BOTÓN CRAM: AHORA CON MENÚ DESPLEGABLE
const cramBtn = studyActions.createEl("button", { title: "Cram Mode (Study regardless of schedule)" });
const cramIcon = cramBtn.createSpan(); 
setIcon(cramIcon, 'zap'); 
cramIcon.style.marginRight = "6px";
cramBtn.createSpan({ text: "Cram" });

cramBtn.onclick = (event: MouseEvent) => { 
    const menu = new Menu();
    menu.addItem((item) => {
        item.setTitle("📖 Active Reading (Cram All)")
            .setIcon("book-open")
            .onClick(() => {
                // true = Cram Mode, 'reading' = Modo Lectura
                new ReviewSessionManager(this.plugin, subject, true, null, 'reading').start();
            });
    });
    menu.addItem((item) => {
        item.setTitle("⚡ Flashcards SRS (Cram All)")
            .setIcon("zap")
            .onClick(() => {
                // true = Cram Mode, 'srs' = Modo Flashcards
                new ReviewSessionManager(this.plugin, subject, true, null, 'srs').start();
            });
    });
    menu.showAtMouseEvent(event);
};

                    // SYLLABUS / TOPICS: INTACTO Y RESTAURADO
                    if (subject.syllabus && subject.syllabus.length > 0) {
                        const syllabusContainer = subjCard.createDiv({ cls: "subject-syllabus-container", attr: { style: "margin-top: 15px; border-top: 1px solid var(--background-modifier-border); padding-top: 10px;" }});
                        const syllabusHeader = syllabusContainer.createDiv({ attr: { style: "display: flex; justify-content: space-between; cursor: pointer; align-items: center;" }});
                        syllabusHeader.createSpan({ text: `📑 Topics (${subject.syllabus.length})`, attr: { style: "font-weight: bold; font-size: 0.9em; color: var(--text-muted);" }});
                        const toggleIcon = syllabusHeader.createSpan({ text: "▼", attr: { style: "font-size: 0.8em; color: var(--text-muted);" }});
                        
                        const topicsList = syllabusContainer.createDiv({ cls: "syllabus-topics-list", attr: { style: "display: none; flex-direction: column; gap: 8px; margin-top: 10px;" }});
                        syllabusHeader.onclick = () => {
                            const isHidden = topicsList.style.display === "none";
                            topicsList.style.display = isHidden ? "flex" : "none";
                            toggleIcon.innerText = isHidden ? "▲" : "▼";
                        };

                        subject.syllabus.forEach((topic: any) => {
                            const topicRow = topicsList.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; background: var(--background-secondary-alt); padding: 6px 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border);" }});
                            const topicInfo = topicRow.createDiv({ attr: { style: "display: flex; flex-direction: column;" }});
                            topicInfo.createSpan({ text: topic.name, attr: { style: "font-size: 0.9em; font-weight: bold; color: var(--text-normal);" }});
                            
                            const ruleSpan = topicInfo.createSpan({ text: `Rule: ${topic.rule} (Scanning...)`, attr: { style: "font-size: 0.75em; color: var(--interactive-accent); font-family: monospace;" }});

                            // --- INICIO NUEVO: Contenedor de notas adjuntas y TaskNote ---
                            const attachmentsDiv = topicInfo.createDiv({ attr: { style: "display: flex; gap: 5px; margin-top: 5px; flex-wrap: wrap; align-items: center;" }});
                            
                            // 1. Mostrar TaskNote si existe y leer su estado (Ciclo de Vida)
                            if (topic.taskNoteId && topic.taskNoteId !== "synced") {
                                const tnChip = attachmentsDiv.createSpan({ cls: "folder-chip", attr: { style: "display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; font-size: 0.75em; background: var(--color-blue); color: white; border-radius: 4px; cursor: pointer; border: 1px solid var(--background-modifier-border); transition: background 0.3s;" }});
                                const iconSpan = tnChip.createSpan();
                                setIcon(iconSpan, "check-circle");
                                const textSpan = tnChip.createSpan({ text: "TaskNote" });
                                
                                // 🔄 Escáner asíncrono súper ligero de estado
                                (async () => {
                                    let pathToOpen = topic.taskNoteId.endsWith('.md') ? topic.taskNoteId : `${topic.taskNoteId}.md`;
                                    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(pathToOpen, "");
                                    if (file && file instanceof TFile) {
                                        const content = await this.plugin.app.vault.cachedRead(file); // Cached read = 0 lag
                                        // Detecta "- [x]" o metadata "status: done"
                                        if (/- \[[xX]\]/.test(content) || /status:\s*done/i.test(content) || /status:\s*completed/i.test(content)) {
                                            tnChip.style.background = "var(--color-green)";
                                            textSpan.innerText = "Done";
                                        }
                                    }
                                })();

                                tnChip.onclick = (e: MouseEvent) => {
                                    e.stopPropagation();
                                    let pathToOpen = topic.taskNoteId.endsWith('.md') ? topic.taskNoteId : `${topic.taskNoteId}.md`;
                                    const file = this.plugin.app.metadataCache.getFirstLinkpathDest(pathToOpen, "");
                                    if (file) this.plugin.app.workspace.getLeaf(false).openFile(file);
                                    else new Notice("⚠️ No se pudo encontrar el archivo de TaskNote.");
                                };
                            }

                            // 2. Mostrar notas adjuntas manualmente
                            if (topic.attachedNotes && topic.attachedNotes.length > 0) {
                                topic.attachedNotes.forEach((notePath: string, idx: number) => {
                                    const nChip = attachmentsDiv.createSpan({ cls: "folder-chip", attr: { style: "display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; font-size: 0.75em; border-radius: 4px; cursor: pointer; background: var(--background-secondary);" }});
                                    setIcon(nChip.createSpan(), "file-text");
                                    nChip.createSpan({ text: notePath.split('/').pop() || notePath });
                                    
                                    const delBtn = nChip.createSpan({ text: "×", attr: { style: "color: var(--text-error); margin-left: 2px; padding: 0 2px;" }});
                                    delBtn.onclick = async (e: MouseEvent) => {
                                        e.stopPropagation();
                                        topic.attachedNotes.splice(idx, 1);
                                        await this.plugin.saveSettings();
                                        this.onOpen(); 
                                    };

                                    nChip.onclick = (e: MouseEvent) => {
                                        e.stopPropagation();
                                        const file = this.plugin.app.metadataCache.getFirstLinkpathDest(notePath, "");
                                        if (file) this.plugin.app.workspace.getLeaf(false).openFile(file);
                                        else new Notice(`⚠️ Nota no encontrada: ${notePath}`);
                                    };
                                });
                            }

                            // 3. Botón "+" para agregar notas (MODAL NATIVO)
                            const addBtn = attachmentsDiv.createSpan({ attr: { style: "cursor: pointer; padding: 2px; color: var(--text-muted); display: flex; align-items: center;" }});
                            setIcon(addBtn, "plus");
                            addBtn.title = "Adjuntar nota a este tema";
                            addBtn.onclick = (e: MouseEvent) => {
                                e.stopPropagation();
                                // Invocamos nuestro nuevo modal nativo en lugar del prompt
                                new AttachNoteModal(this.plugin.app, this.plugin, topic, async (noteName: string) => {
                                    if (!topic.attachedNotes) topic.attachedNotes = [];
                                    topic.attachedNotes.push(noteName);
                                    await this.plugin.saveSettings();
                                    this.onOpen();
                                }).open();
                            };
                            // --- FIN NUEVO ---
                            (async () => {
                                const validFiles = this.plugin.app.vault.getMarkdownFiles();
                                let matchCount = 0; 
                                const ruleLower = topic.rule ? topic.rule.toLowerCase() : "";
                                
                                for (const file of validFiles) {
                                    // Verificamos si la nota fue adjuntada manualmente a este tema
                                    const isAttached = topic.attachedNotes?.some((n: string) => file.path === n || file.name === n || file.name === `${n}.md`);
                                    
                                    const content = await this.plugin.app.vault.cachedRead(file);
                                    const lines = content.split('\n');
                                    for (const line of lines) {
                                        const match = line.match(/%%[><](.*?)%%/);
                                        if (match) {
                                            // La sumamos si fue adjuntada O si coincide la regla de texto
                                            if (isAttached || (ruleLower && match[1].toLowerCase().includes(ruleLower))) {
                                                matchCount++;
                                            }
                                        }
                                    }
                                }
                                ruleSpan.innerText = `Rule: ${topic.rule} 🎯 ${matchCount} notas`;
                                if (matchCount === 0) ruleSpan.style.color = "var(--color-red)"; 
                                else ruleSpan.style.color = "var(--color-green)"; // Feedback positivo
                            })();

                            const playSubBtn = topicRow.createEl("button", { title: `Cram ${topic.name}`, attr: { style: "padding: 4px 8px; height: auto;" }});
                            setIcon(playSubBtn, "zap"); 
                            // @ts-ignore
                            playSubBtn.onclick = (e: MouseEvent) => { 
                                e.stopPropagation(); 
                                // Pasamos el objeto 'topic' COMPLETO en lugar de solo la regla
                                new ReviewSessionManager(this.plugin, subject, true, topic).start(); 
                            };
                        });
                    }
                });
            }
        }

        // ======================================================
        // WIDGET C: TRACKER & REVIEW
        // ======================================================
        if (layout.tracker) {
            trackerCol.createEl("h2", { text: "⏳ Daily Tracker" });
            const koreanTracker = trackerCol.createEl("div", { cls: "korean-tracker" });
            
            const history = dbData.trackerHistory || [];
            const rightNow = new Date();
            const startOfDay = new Date(rightNow.getFullYear(), rightNow.getMonth(), rightNow.getDate()).getTime();
            const todaysSessions = history.filter((s: any) => s.timestamp >= startOfDay);
            
            const totalMinutes = todaysSessions.length * 25; 
            const hours = Math.floor(totalMinutes / 60);
            koreanTracker.createEl("h3", { text: `Total Hoy: ${hours}h ${totalMinutes % 60}m`, cls: "tracker-total" });
            
            const gridEl = koreanTracker.createEl("div", { cls: "korean-grid" });
            
            for (let h = 0; h <= 23; h++) {
                const row = gridEl.createEl("div", { cls: "korean-grid-row" });
                row.createEl("div", { cls: "korean-hour", text: `${h}:00` });
                
                const blocks = row.createEl("div", { cls: "korean-blocks" });
                const sessionsThisHour = todaysSessions.filter((s: any) => new Date(s.timestamp).getHours() === h);
                
                for (let m = 0; m < 6; m++) {
                    const blockEl = blocks.createEl("div", { cls: "korean-block" }); 
                    const isStudied = sessionsThisHour.some((s: any) => {
                        if (s.durationMinutes === undefined || s.durationMinutes < 5) return false; 
                        const startMin = new Date(s.timestamp).getMinutes();
                        const startBlock = Math.floor(startMin / 10); 
                        const blocksToPaint = Math.max(1, Math.ceil(s.durationMinutes / 10));
                        return m >= startBlock && m <= (startBlock + blocksToPaint - 1);
                    });
                    if (isStudied) blockEl.addClass("studied");
                }

                const objectiveEl = row.createEl("div", { cls: "korean-objective" });
                if (sessionsThisHour.length > 0) {
                    const objectives = sessionsThisHour.map((s: any) => s.objective).filter(Boolean);
                    objectiveEl.innerText = objectives.length > 0 ? `🎯 ${objectives.join(" / ")}` : `🎯 Focus Session`;
                }
            }

            trackerCol.createEl("h2", { text: "🧠 Needs Review", attr: { style: "margin-top: 20px;" } });
            const reviewList = trackerCol.createEl("div", { cls: "margidoro-review-list" });
            const pendingIds = this.plugin.settings.userStats?.margidoroPending || [];
            
            if (pendingIds.length === 0) {
                reviewList.createEl("p", { text: "Everything's up to date. Great job! 🎉", cls: "text-muted" });
            } else {
                const renderPendingItems = async () => {
                    const files = this.plugin.app.vault.getMarkdownFiles();
                    
                    for (const id of pendingIds) {
                        let foundItem: any = null;

                        for (const file of files) {
                            const content = await this.plugin.app.vault.cachedRead(file);
                            const lines = content.split('\n');
                            for (let i = 0; i < lines.length; i++) {
                                if (lines[i].includes(`^${id}`)) {
                                    const match = /%%[><](.*?)%%/.exec(lines[i]);
                                    if (match) {
                                        let rawText = match[1].trim();
                                        let color = "var(--color-red)"; 
                                        for (const tag of this.plugin.settings.tags) {
                                            if (rawText.startsWith(tag.prefix)) {
                                                color = tag.color;
                                                rawText = rawText.substring(tag.prefix.length).trim();
                                                break;
                                            }
                                        }
                                        foundItem = { id, text: rawText, color, file, line: i };
                                    }
                                    break;
                                }
                            }
                            if (foundItem) break;
                        }

                        if (!foundItem) continue; 

                        const itemDiv = reviewList.createDiv({ cls: 'cornell-sidebar-item' });
                        itemDiv.style.borderLeftColor = foundItem.color;

                        const textRow = itemDiv.createDiv({ cls: 'cornell-sidebar-item-text', attr: { style: "display: flex; justify-content: space-between; align-items: flex-start;" }});
                        const textSpan = textRow.createSpan({ attr: { style: "word-break: break-word; flex-grow: 1; margin-right: 10px;" }});

                        let cleanText = foundItem.text;
                        const imagesToRender: string[] = [];
                        const imgRegex = /img:\s*\[\[(.*?)\]\]/gi;
                        Array.from(cleanText.matchAll(imgRegex)).forEach((m: any) => imagesToRender.push(m[1]));
                        cleanText = cleanText.replace(imgRegex, '').trim();

                        textSpan.innerText = cleanText.length > 130 ? cleanText.substring(0, 130) + "..." : cleanText;

                        if (imagesToRender.length > 0) {
                            const imgContainer = textSpan.createDiv({ attr: { style: "margin-top: 5px;" }});
                            imagesToRender.forEach(imgName => {
                                const cleanName = imgName.split('|')[0];
                                const imgFile = this.plugin.app.metadataCache.getFirstLinkpathDest(cleanName, foundItem.file.path);
                                if (imgFile) {
                                    imgContainer.createEl('img', { attr: { src: this.plugin.app.vault.getResourcePath(imgFile), style: "max-height: 40px; width: auto; object-fit: contain; border-radius: 3px; display: inline-block;" } });
                                }
                            });
                        }

                        const actionsSpan = textRow.createSpan({ attr: { style: "display: flex; gap: 10px; align-items: center;" }});
                        const getExplorerView = () => {
                            const leaves = this.plugin.app.workspace.getLeavesOfType("cornell-marginalia-view");
                            return leaves.length > 0 ? leaves[0].view as any : null;
                        };

                        const explorerView = getExplorerView();
                        let isAlreadyPinned = explorerView && explorerView.pinboardItems ? explorerView.pinboardItems.some((p: any) => p.rawText === foundItem.text && p.file.path === foundItem.file.path) : false;

                        const pinBtn = actionsSpan.createEl('span', { text: isAlreadyPinned ? '●' : '○', title: 'Send to Pinboard', attr: { style: `cursor: pointer; transition: opacity 0.2s ease, transform 0.2s ease; opacity: ${isAlreadyPinned ? '1' : '0'};` }});
                        itemDiv.addEventListener('mouseenter', () => { if (!isAlreadyPinned) pinBtn.style.opacity = '0.5'; });
                        itemDiv.addEventListener('mouseleave', () => { if (!isAlreadyPinned) pinBtn.style.opacity = '0'; });
                        pinBtn.onmouseenter = () => { pinBtn.style.opacity = '1'; pinBtn.style.transform = 'scale(1.2)'; };
                        pinBtn.onmouseleave = () => { pinBtn.style.transform = 'scale(1)'; if (!isAlreadyPinned) pinBtn.style.opacity = '0.5'; };

                        pinBtn.onclick = (e: MouseEvent) => {
                            e.stopPropagation();
                            const view = getExplorerView();
                            if (!view) return new Notice("⚠️ Open the Marginalia Explorer first to use the Board.");

                            if (isAlreadyPinned) {
                                view.pinboardItems = view.pinboardItems.filter((p: any) => !(p.rawText === foundItem.text && p.file.path === foundItem.file.path));
                                isAlreadyPinned = false; pinBtn.innerText = '○'; pinBtn.style.opacity = '0.5';
                                new Notice("Removed from Board.");
                            } else {
                                view.pinboardItems.push({
                                    text: foundItem.text.replace(/img:\s*\[\[(.*?)\]\]/gi, '![[$1]]').trim(),
                                    rawText: foundItem.text, color: foundItem.color, file: foundItem.file, line: foundItem.line, blockId: foundItem.id, outgoingLinks: [], indentLevel: 0
                                });
                                isAlreadyPinned = true; pinBtn.innerText = '●'; pinBtn.style.opacity = '1';
                                new Notice("📌 Pinned to Board!");
                            }
                            view.applyFiltersAndRender(); 
                        };

                        const resolveBtn = actionsSpan.createDiv({ attr: { style: "cursor: pointer; color: var(--text-muted); opacity: 0; transition: color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;" }});
                        setIcon(resolveBtn, 'check'); resolveBtn.title = "Mark as Mastered";
                        itemDiv.addEventListener('mouseenter', () => { resolveBtn.style.opacity = '0.7'; });
                        itemDiv.addEventListener('mouseleave', () => { resolveBtn.style.opacity = '0'; });
                        resolveBtn.onmouseenter = () => { resolveBtn.style.color = 'var(--color-green)'; resolveBtn.style.opacity = '1'; resolveBtn.style.transform = 'scale(1.2)'; };
                        resolveBtn.onmouseleave = () => { resolveBtn.style.color = 'var(--text-muted)'; resolveBtn.style.opacity = '0.7'; resolveBtn.style.transform = 'scale(1)'; };

                        resolveBtn.onclick = async (e: MouseEvent) => {
                            e.stopPropagation();
                            document.querySelectorAll('.cornell-hover-tooltip').forEach(el => el.remove()); 
                            itemDiv.style.opacity = "0"; setTimeout(() => itemDiv.remove(), 200);

                            const index = this.plugin.settings.userStats.margidoroPending.indexOf(id);
                            if (index > -1) {
                                this.plugin.settings.userStats.margidoroPending.splice(index, 1);
                                await this.plugin.saveSettings();
                            }
                            if (this.plugin.settings.userStats.margidoroPending.length === 0) {
                                reviewList.empty(); reviewList.createEl("p", { text: "Everything's up to date. Great job! 🎉", cls: "text-muted" });
                            }
                        };

                        itemDiv.createDiv({ cls: 'cornell-sidebar-item-meta', text: `${foundItem.file.basename} (L${foundItem.line + 1})` });
                        // @ts-ignore
                        itemDiv.onclick = async () => { await this.plugin.app.workspace.getLeaf(false).openFile(foundItem.file, { eState: { line: foundItem.line } }); };

                        let hoverTimeout: NodeJS.Timeout | null = null;
                        let tooltipEl: HTMLElement | null = null;
                        let isHovering = false; 

                        const removeTooltip = () => {
                            isHovering = false; 
                            if (hoverTimeout) clearTimeout(hoverTimeout);
                            if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
                            document.querySelectorAll('.cornell-hover-tooltip').forEach(el => el.remove());
                        };

                        itemDiv.addEventListener('mouseenter', (e: MouseEvent) => {
                            isHovering = true;
                            hoverTimeout = setTimeout(async () => {
                                if (!isHovering || !document.body.contains(itemDiv)) return; 
                                const fileContent = await this.plugin.app.vault.cachedRead(foundItem.file);
                                const fileLines = fileContent.split('\n');

                                let startLine = foundItem.line; let endLine = foundItem.line;
                                while (startLine > 0 && fileLines[startLine - 1].trim() !== '' && !fileLines[startLine - 1].startsWith('```')) startLine--;
                                while (endLine < fileLines.length - 1 && fileLines[endLine + 1].trim() !== '' && !fileLines[endLine + 1].startsWith('```')) endLine++;

                                removeTooltip(); 

                                // 🎯 ESCÁNER PDF++ BLINDADO (Inyectado desde el Explorer)
                                const pdfRegex = /!*\[\[(.*?\.(?:pdf).*?)\]\]/i;
                                const mdPdfRegex = /\[.*?\]\((.*?\.(?:pdf).*?)\)/i;
                                let pdfLinkText = null;

                                let match = fileLines[foundItem.line].match(pdfRegex) || fileLines[foundItem.line].match(mdPdfRegex);
                                if (match) pdfLinkText = match[1];
                                if (!pdfLinkText && foundItem.line - 1 >= startLine) {
                                    match = fileLines[foundItem.line - 1].match(pdfRegex) || fileLines[foundItem.line - 1].match(mdPdfRegex);
                                    if (match) pdfLinkText = match[1];
                                }
                                if (!pdfLinkText && foundItem.line + 1 <= endLine) {
                                    match = fileLines[foundItem.line + 1].match(pdfRegex) || fileLines[foundItem.line + 1].match(mdPdfRegex);
                                    if (match) pdfLinkText = match[1];
                                }

                                if (pdfLinkText) {
                                    const cleanLinkText = pdfLinkText.split('|')[0].trim(); // 🛡️ CRÍTICO: Quitar alias
                                    this.plugin.app.workspace.trigger("hover-link", {
                                        event: e, source: "preview", hoverParent: itemDiv,
                                        targetEl: itemDiv, linktext: cleanLinkText, sourcePath: foundItem.file.path
                                    });
                                    return; // Salimos temprano para no dibujar el tooltip normal
                                }

                                // -------------------------------------------------------------
                                // SI NO ES PDF, RENDERIZAMOS EL TOOLTIP MARKDOWN NORMAL
                                // -------------------------------------------------------------
                                let rawBlock = ''; let highlightApplied = false;
                                for (let i = startLine; i <= endLine; i++) {
                                    let cleanLine = fileLines[i].replace(/%%[><](.*?)%%/g, '').trim();
                                    if (cleanLine.startsWith('```')) continue;
                                    if (cleanLine) {
                                        if ((i === foundItem.line || (i >= foundItem.line && !highlightApplied)) && !highlightApplied) {
                                            rawBlock += `==${cleanLine}==\n`; highlightApplied = true;
                                        } else rawBlock += `${cleanLine}\n`;
                                    }
                                }

                                tooltipEl = document.createElement('div');
                                tooltipEl.className = 'popover hover-popover cornell-hover-tooltip markdown-rendered markdown-preview-view'; 
                                tooltipEl.style.cssText = 'position: fixed; z-index: 99999; width: 450px; max-height: 350px; overflow-y: auto; background-color: var(--background-primary); border: 1px solid var(--background-modifier-border); box-shadow: 0 10px 20px rgba(0,0,0,0.3); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;';
                                tooltipEl.innerHTML = `<style>.cornell-hover-tooltip p { margin: 0 0 8px 0 !important; }</style><div class="cornell-hover-context"><span style="font-size: 1.1em; color: var(--text-normal); font-weight: bold; display: block; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 6px; width: 100%;">📄 ${foundItem.file.basename} (L${foundItem.line + 1})</span></div>`;
                                
                                const body = tooltipEl.createDiv({ attr: { style: 'width: 100%;' }});
                                document.body.appendChild(tooltipEl);

                                const rect = itemDiv.getBoundingClientRect();
                                let leftPos = rect.right + 20; if (leftPos + 450 > window.innerWidth) leftPos = rect.left - 470; if (leftPos < 10) leftPos = 10; 
                                let topPos = rect.top; if (topPos + 350 > window.innerHeight) topPos = window.innerHeight - 360;
                                tooltipEl.style.left = `${leftPos}px`; tooltipEl.style.top = `${Math.max(10, topPos)}px`;

                                rawBlock = rawBlock.replace(/!\[\[(.*?\.(?:png|jpg|jpeg|gif|bmp|svg))\|?(.*?)\]\]/gi, (match2, filename) => {
                                    const resolvedFile = this.plugin.app.metadataCache.getFirstLinkpathDest(filename.trim(), foundItem.file.path);
                                    return resolvedFile ? `<img src="${this.plugin.app.vault.getResourcePath(resolvedFile)}" style="max-height:220px; max-width:100%; border-radius:6px; display:block; margin:8px auto;">` : match2; 
                                });

                                if (!rawBlock.trim()) rawBlock = "*No text context available.*";

                                // @ts-ignore
                                const { MarkdownRenderer } = require('obsidian');
                                await MarkdownRenderer.renderMarkdown(rawBlock, body, foundItem.file.path, this.plugin);
                                requestAnimationFrame(() => { if (tooltipEl) tooltipEl.addClass('is-visible'); });
                            }, 500); 
                        }); 

                        itemDiv.addEventListener('mouseleave', removeTooltip);
                    }
                };
                renderPendingItems();
            }
        }

        // ======================================================
        // WIDGET D: DAILY NOTE INTEGRATION (ARQUITECTURA HÍBRIDA)
        // ======================================================
        if (layout.dailyNote) {
            const dailyHeader = dailyNoteCol.createDiv({ cls: 'daily-planner-header' });
            dailyHeader.createEl("h2", { text: "📓 Daily Note" });
            
            const dailyContainer = dailyNoteCol.createDiv({ 
                cls: "daily-note-widget-container", 
                attr: { style: "background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 15px; margin-top: 10px; flex-grow: 1; display: flex; flex-direction: column; overflow: hidden;" } 
            });
            
            // 1. Leer la configuración REAL del plugin nativo de Obsidian
            let dailyFolder = "";
            let dailyFormat = "YYYY-MM-DD";
            let dailyTemplate = "";
            
            try {
                // @ts-ignore - API Interna segura para leer configuración
                const configStr = await this.plugin.app.vault.adapter.read(".obsidian/daily-notes.json");
                const config = JSON.parse(configStr);
                if (config.folder) dailyFolder = config.folder;
                if (config.format) dailyFormat = config.format;
                if (config.template) dailyTemplate = config.template;
            } catch (e) {
                // Si falla, usamos los defaults
            }

            // @ts-ignore
            const todayName = window.moment().format(dailyFormat);
            const dailyPath = dailyFolder ? `${dailyFolder}/${todayName}.md` : `${todayName}.md`;
            
            let file = this.plugin.app.vault.getAbstractFileByPath(dailyPath);
            
            if (file && file instanceof TFile) {
                // --- MODO LECTURA NATIVO ---
                // Se verá exactamente igual que el Modo Lectura de Obsidian
                const renderContainer = dailyContainer.createDiv({ 
                    cls: "markdown-preview-view markdown-rendered", 
                    attr: { style: "flex-grow: 1; overflow-y: auto; padding-right: 5px; user-select: text;" } 
                });
                
                const renderDaily = async () => {
                    renderContainer.empty();
                    const content = await this.plugin.app.vault.cachedRead(file as TFile);
                    // @ts-ignore
                    await MarkdownRenderer.renderMarkdown(content, renderContainer, file.path, this.plugin);
                };
                renderDaily();

                // 🪄 MAGIA: Si editas la nota en otro lado, el Dashboard se actualiza SOLO en tiempo real
                const modifyEvent = this.plugin.app.vault.on('modify', (changedFile) => {
                    if (changedFile.path === file?.path) renderDaily();
                });
                this.plugin.registerEvent(modifyEvent);

                // --- CONTROLES DE ESCRITURA Y ACCIÓN ---
                const actionRow = dailyContainer.createDiv({ 
                    attr: { style: "display: flex; gap: 8px; margin-top: 15px; border-top: 1px solid var(--background-modifier-border); padding-top: 10px;" }
                });

                // Input de Captura Rápida (Quick Capture)
                const quickInput = actionRow.createEl("input", { 
                    type: "text", 
                    placeholder: "Añadir a la nota rápida... (Enter)", 
                    attr: { style: "flex-grow: 1; background: var(--background-modifier-form-field); border: 1px solid var(--background-modifier-border); color: var(--text-normal); padding: 5px 10px; border-radius: 4px; font-size: 0.9em;" }
                });

                quickInput.addEventListener("keypress", async (e: KeyboardEvent) => {
                    if (e.key === "Enter" && quickInput.value.trim() !== "") {
                        const textToAppend = `\n- ${quickInput.value.trim()}`;
                        await this.plugin.app.vault.append(file as TFile, textToAppend);
                        quickInput.value = "";
                        // No hace falta llamar a renderDaily(), el evento 'modify' de arriba lo detectará
                    }
                });

                // Botón de Edición Profunda (Live Preview nativo en panel lateral)
                const editBtn = actionRow.createEl("button", { title: "Abrir Editor Completo", cls: "mod-cta", attr: { style: "padding: 5px 12px;" } });
                setIcon(editBtn, "pencil");
                editBtn.onclick = () => {
                    // Abre la nota en un panel dividido a la derecha con TODAS las funciones de Obsidian
                    // @ts-ignore
                    const leaf = this.plugin.app.workspace.getLeaf('split', 'vertical');
                    leaf.openFile(file as TFile);
                };

            } else {
                // --- PANTALLA DE CREACIÓN (SI LA NOTA NO EXISTE) ---
                dailyContainer.createEl("p", { text: `No existe la nota de hoy.`, cls: "text-muted", attr: {style: "text-align: center; margin-top: 20px;"} });
                dailyContainer.createEl("p", { text: `Ruta esperada: ${dailyPath}`, attr: {style: "text-align: center; font-size: 0.8em; color: var(--text-faint); word-break: break-all;"} });
                
                const createBtn = dailyContainer.createEl("button", { text: "Crear Daily Note", cls: "mod-cta", attr: { style: "width: 100%; margin-top: 15px;" }});
                
                createBtn.onclick = async () => {
                    let initialContent = "";
                    
                    if (dailyTemplate) {
                        const templatePath = dailyTemplate.endsWith(".md") ? dailyTemplate : `${dailyTemplate}.md`;
                        const tplFile = this.plugin.app.vault.getAbstractFileByPath(templatePath);
                        if (tplFile && tplFile instanceof TFile) {
                            initialContent = await this.plugin.app.vault.read(tplFile);
                            // @ts-ignore
                            initialContent = initialContent.replace(/{{date}}/g, window.moment().format(dailyFormat));
                            // @ts-ignore
                            initialContent = initialContent.replace(/{{time}}/g, window.moment().format("HH:mm"));
                            initialContent = initialContent.replace(/{{title}}/g, todayName);
                        }
                    }
                    
                    try {
                        if (dailyFolder) {
                            const folderExists = this.plugin.app.vault.getAbstractFileByPath(dailyFolder);
                            if (!folderExists) await this.plugin.app.vault.createFolder(dailyFolder);
                        }
                        await this.plugin.app.vault.create(dailyPath, initialContent);
                        this.onOpen(); 
                    } catch (err: any) {
                        new Notice(`Error creando la nota: ${err.message}`);
                    }
                };
            }
        }

    }}
// ==========================================
// MODAL DEL PLANIFICADOR SEMANAL (MULTICAPA)
// ==========================================
export class WeeklyPlannerModal extends Modal {
    plugin: any;
    onCloseCallback: () => void;
    currentModeView: string = 'optimal'; // Capa de energía actual en la vista
    copiedBlocks: any[] | null = null; // 📋 Portapapeles en memoria para copiar días enteros
    
    // --- INICIO NUEVO: Memoria temporal del formulario ---
    lastSelectedDay: string | null = null;
    lastEndTime: string | null = null;
    // --- FIN NUEVO ---

    constructor(app: App, plugin: any, onCloseCallback: () => void) {
        super(app);
        this.plugin = plugin;
        this.onCloseCallback = onCloseCallback;
    }

    onOpen() {
        this.renderUI();
    }

    // Usamos una función renderUI para poder recargar el modal al cambiar de pestaña
    renderUI() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.style.width = "85vw";
        this.modalEl.style.maxWidth = "1000px";

        // --- CABECERA Y TABS DE CONTINGENCIA ---
        const headerContainer = contentEl.createDiv({ attr: { style: "display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 10px; margin-bottom: 15px;" }});
        
        const titleBox = headerContainer.createDiv();
        titleBox.createEl("h2", { text: "Weekly Routine Builder", attr: { style: "margin: 0;" } });
        titleBox.createEl("p", { text: "Diseña tu semana según tu nivel de energía y contingencia.", cls: "text-muted", attr: { style: "margin: 5px 0 0 0; font-size: 0.9em;" } });

        const tabsBox = headerContainer.createDiv({ attr: { style: "display: flex; gap: 10px;" }});
        
        const createTab = (id: string, label: string) => {
            const btn = tabsBox.createEl("button", { text: label });
            if (this.currentModeView === id) {
                btn.addClass("mod-cta"); // Resaltar el nivel activo
            } else {
                btn.style.background = "var(--background-secondary)";
            }
            btn.onclick = () => {
                this.currentModeView = id;
                this.renderUI(); // Recargamos la UI al cambiar de capa
            };
        };

        createTab('optimal', "Optimal (100%)");
        createTab('regular', "Regular (70%)");
        createTab('survival', "Survival (20%)");

        // --- FORMULARIO PARA AÑADIR BLOQUE ---
        const formContainer = contentEl.createDiv({ cls: "weekly-planner-form" });
        
        const daySelect = formContainer.createEl("select");
        ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].forEach((day, index) => {
            daySelect.createEl("option", { value: index.toString(), text: day });
        });
        
        // 🧠 Memoria: Usar el último día editado o el día actual por defecto
        daySelect.value = this.lastSelectedDay !== null ? this.lastSelectedDay : new Date().getDay().toString();

        // 🧠 Memoria: El inicio será el final del bloque anterior
        let defaultStart = this.lastEndTime || "08:00";
        let defaultEnd = "09:00";
        
        if (this.lastEndTime) {
            const [h, m] = this.lastEndTime.split(':').map(Number);
            const nextH = (h + 1) % 24; // Sumamos 1 hora automáticamente, reseteando a las 00 si pasa de 23
            defaultEnd = `${nextH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        }

        const startInput = formContainer.createEl("input", { type: "time", value: defaultStart });
        const endInput = formContainer.createEl("input", { type: "time", value: defaultEnd });

        const typeSelect = formContainer.createEl("select");
        typeSelect.createEl("option", { value: "study", text: "Study Session" });
        typeSelect.createEl("option", { value: "review", text: "Review / SRS" });
        typeSelect.createEl("option", { value: "class", text: "Class / Lecture" });
        typeSelect.createEl("option", { value: "break", text: "Break / Rest" });

        const titleInput = formContainer.createEl("input", { type: "text", placeholder: "Task name (e.g. Anatomy)" });
        titleInput.style.flexGrow = "1";

        const addBtn = formContainer.createEl("button", { text: "Add Block", cls: "mod-cta" });

        addBtn.onclick = async () => {
            if (!titleInput.value.trim()) {
                new Notice("Please enter a task name.");
                return;
            }
            if (startInput.value >= endInput.value) {
                new Notice("End time must be after start time.");
                return;
            }

            const newBlock = {
                id: Math.random().toString(36).substring(2, 9),
                dayOfWeek: parseInt(daySelect.value),
                startTime: startInput.value,
                endTime: endInput.value,
                type: typeSelect.value,
                title: titleInput.value.trim(),
                mode: this.currentModeView // GUARDADO INTELIGENTE: Hereda la capa en la que estás
            };

            if (!this.plugin.settings.dashboardData.routineBlocks) {
                this.plugin.settings.dashboardData.routineBlocks = [];
            }
            this.plugin.settings.dashboardData.routineBlocks.push(newBlock);
            await this.plugin.saveSettings();
            
            // 🧠 Guardamos los datos en la memoria a corto plazo ANTES de borrar/recargar
            this.lastSelectedDay = daySelect.value;
            this.lastEndTime = endInput.value;

            titleInput.value = ""; 
            this.renderUI(); // Redibujar la UI
            new Notice("Block added to " + this.currentModeView + " plan!");
        };

        // --- LA GRILLA DE LA SEMANA ---
        const gridContainer = contentEl.createDiv({ cls: "weekly-planner-grid" });
        this.renderWeekGrid(gridContainer);
    }

    renderWeekGrid(container: HTMLElement) {
        container.empty();
        const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const blocks = this.plugin.settings.dashboardData.routineBlocks || [];

        days.forEach((dayName, dayIndex) => {
            const dayCol = container.createDiv({ cls: "weekly-day-col" });
            
            // --- INICIO NUEVO: Cabecera con Botones Copiar/Pegar ---
            const headerRow = dayCol.createDiv({ cls: "weekly-day-header", attr: { style: "display: flex; justify-content: space-between; align-items: center;" }});
            headerRow.createSpan({ text: dayName });
            
            const actionsSpan = headerRow.createSpan({ attr: { style: "display: flex; gap: 5px;" }});
            
            // Botón Copiar
            const copyBtn = actionsSpan.createEl("button", { title: "Copiar plan de este día", attr: { style: "padding: 2px 6px; background: transparent; box-shadow: none; cursor: pointer;" }});
            setIcon(copyBtn, "copy");
            copyBtn.onclick = () => {
                // Filtramos solo los bloques que pertenecen a este día y a la capa actual (ej. Optimal)
                const dayBlocksToCopy = blocks.filter((b: any) => b.dayOfWeek === dayIndex && (b.mode === this.currentModeView || (!b.mode && this.currentModeView === 'optimal')));
                
                if (dayBlocksToCopy.length === 0) {
                    new Notice(`⚠️ No hay nada que copiar en ${dayName}.`);
                    return;
                }
                
                // Hacemos una clonación profunda (Deep Clone) para que no haya referencias cruzadas
                this.copiedBlocks = JSON.parse(JSON.stringify(dayBlocksToCopy)); 
                new Notice(`📋 ${dayName} copiado!`);
                this.renderUI(); // Refrescamos para encender visualmente el botón de pegar
            };

            // Botón Pegar
            const pasteBtn = actionsSpan.createEl("button", { title: "Pegar bloques aquí (Sobreescribe el día)", attr: { style: "padding: 2px 6px; background: transparent; box-shadow: none; cursor: pointer; transition: color 0.2s;" }});
            setIcon(pasteBtn, "clipboard-paste");
            
            // UX: Apagamos el botón visualmente si no hay nada en el portapapeles
            if (!this.copiedBlocks || this.copiedBlocks.length === 0) {
                pasteBtn.style.opacity = "0.3";
                pasteBtn.style.cursor = "not-allowed";
            } else {
                pasteBtn.style.color = "var(--interactive-accent)";
            }

            pasteBtn.onclick = async () => {
                if (!this.copiedBlocks || this.copiedBlocks.length === 0) {
                    new Notice("⚠️ Primero copia el contenido de un día.");
                    return;
                }
                
                // 1. BARRIDO (Limpiamos los bloques actuales de este día destino para evitar conflictos/duplicados)
                this.plugin.settings.dashboardData.routineBlocks = this.plugin.settings.dashboardData.routineBlocks.filter((b: any) => 
                    !(b.dayOfWeek === dayIndex && (b.mode === this.currentModeView || (!b.mode && this.currentModeView === 'optimal')))
                );

                // 2. INYECCIÓN (Mapeamos los bloques copiados asignándoles el nuevo día y nuevos IDs aleatorios)
                const newBlocks = this.copiedBlocks.map(b => ({
                    ...b,
                    id: Math.random().toString(36).substring(2, 9), // ID fresco para que el Tracker no se confunda
                    dayOfWeek: dayIndex // Lo asignamos a la columna donde acabamos de pegar
                }));

                // Guardamos en la base de datos
                this.plugin.settings.dashboardData.routineBlocks.push(...newBlocks);
                await this.plugin.saveSettings();
                
                new Notice(`✅ Plan pegado en ${dayName}.`);
                this.renderUI(); // Redibujamos la grilla para ver los cambios mágicamente
            };
            // --- FIN NUEVO ---

            // FILTRO DE CONTINGENCIA:
            // Mostramos los bloques que coinciden con el día Y con el modo actual.
            // (Si un bloque antiguo no tiene 'mode', lo asumimos como 'optimal' para no romper datos viejos).
            const dayBlocks = blocks
                .filter((b: any) => b.dayOfWeek === dayIndex && (b.mode === this.currentModeView || (!b.mode && this.currentModeView === 'optimal')))
                .sort((a: any, b: any) => a.startTime.localeCompare(b.startTime));

            if (dayBlocks.length === 0) {
                dayCol.createDiv({ cls: "weekly-empty", text: "Rest day" });
            } else {
                dayBlocks.forEach((block: any) => {
                    const blockCard = dayCol.createDiv({ cls: `weekly-block-card type-${block.type}` });
                    
                    const timeRow = blockCard.createDiv({ cls: "weekly-block-time" });
                    timeRow.createSpan({ text: `${block.startTime} - ${block.endTime}` });
                    
                    const delBtn = timeRow.createSpan({ text: "×", cls: "weekly-block-del", title: "Delete" });
                    delBtn.onclick = async () => {
                        this.plugin.settings.dashboardData.routineBlocks = this.plugin.settings.dashboardData.routineBlocks.filter((b: any) => b.id !== block.id);
                        await this.plugin.saveSettings();
                        this.renderUI();
                    };

                    blockCard.createDiv({ cls: "weekly-block-title", text: block.title });
                });
            }
        });
    }

    onClose() {
        this.contentEl.empty();
        this.onCloseCallback(); 
    }
}
// ==========================================
// 📚 MODAL GESTOR DE MATERIAS
// ==========================================
export class SubjectEditorModal extends Modal {
    plugin: any;
    subject: any;
    onSave: () => void;

    constructor(app: App, plugin: any, subject: any, onSave: () => void) {
        super(app);
        this.plugin = plugin;
        this.subject = subject;
        this.onSave = onSave;
    }
    // FUNCIÓN LECTORA DE PUERTO 
    async getTaskNotesConfig(): Promise<{ port: number, token: string }> {
        try {
            // Usar this.app en SubjectEditorModal y this.plugin.app en CornellDashboardView
            const appInstance = (this as any).plugin ? (this as any).plugin.app : (this as any).app;
            const configStr = await appInstance.vault.adapter.read(".obsidian/plugins/tasknotes/data.json");
            const config = JSON.parse(configStr);
            return {
                port: config.apiPort || 8080,
                token: config.apiAuthToken || "" // Rescatamos el token si existe
            };
        } catch (e) {
            return { port: 8080, token: "" };
        }
    }
    //  HASTA AQUÍ 
    async syncSyllabusToTaskNotes(subject: any) {
        if (!subject.syllabus || subject.syllabus.length === 0) return;

        let createdCount = 0;
        const config = await this.getTaskNotesConfig(); // 👈 Leemos la nueva config

        // Preparamos los headers de seguridad
        const reqHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (config.token) {
            reqHeaders['Authorization'] = `Bearer ${config.token}`; // 👈 Inyectamos el Token
        }

        const safeSubjectName = subject.name.replace(/[\\/:*?"<>|]/g, ''); 
        const projectFileName = `${safeSubjectName}.md`;
        const projectFile = this.app.vault.getAbstractFileByPath(projectFileName);
        
        if (!projectFile) {
            try {
                await this.app.vault.create(
                    projectFileName, 
                    `---\ntags:\n  - project\n---\n# ${safeSubjectName}\n\nProyecto generado automáticamente por Cornell Marginalia.`
                );
            } catch (e) { /* Silencioso */ }
        }

        for (const topic of subject.syllabus) {
            if (topic.taskNoteId) continue;

            try {
                const response = await requestUrl({
                    url: `http://127.0.0.1:${config.port}/api/tasks`, // 👈 Usamos config.port
                    method: 'POST',
                    headers: reqHeaders, // 👈 Pasamos los headers seguros
                    body: JSON.stringify({
                        title: topic.name,
                        details: `Syllabus rule: ${topic.rule}`,
                        due: new Date(subject.examDate).toISOString().split('T')[0],
                        tags: ["cornell"],
                        contexts: [`@${safeSubjectName.replace(/\s+/g, '')}`],
                        projects: [`[[${safeSubjectName}]]`]
                    })
                });

                if (response.status === 201 || response.status === 200) {
                    topic.taskNoteId = response.json?.data?.id || response.json?.data?.path || "synced"; 
                    createdCount++;
                }
            } catch (error) {
                console.error(`[Cornell Marginalia] Error sincronizando con TaskNotes:`, error);
            }
        }

        if (createdCount > 0) {
            await this.plugin.saveSettings();
            new Notice(`🔗 Sincronizadas ${createdCount} tareas (Secure Mode).`);
        }
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: this.subject ? "✏️ Edit Subject" : "➕ New Subject" });

        const nameInput = contentEl.createEl("input", { type: "text", placeholder: "Subject Name (e.g. Biology)" });
        nameInput.style.width = "100%";
        nameInput.style.marginBottom = "10px";
        if (this.subject) nameInput.value = this.subject.name;

        contentEl.createEl("label", { text: "🎯 Exam Date (Deadline):", attr: { style: "display: block; margin-bottom: 5px; font-weight: bold;" } });
        const dateInput = contentEl.createEl("input", { type: "date" });
        dateInput.style.width = "100%";
        dateInput.style.marginBottom = "10px";
        if (this.subject && this.subject.examDate) {
            const d = new Date(this.subject.examDate);
            dateInput.value = d.toISOString().split('T')[0];
        }

        // --- 🧠 MOTOR DE AUTOCOMPLETADO DE SOURCES ---
        contentEl.createEl("label", { text: "📚 Sources (Folders, Notes, PDFs):", attr: { style: "display: block; margin-bottom: 5px; font-weight: bold;" } });
        
        const inputRow = contentEl.createDiv({ attr: { style: "display: flex; gap: 8px; margin-bottom: 10px;" }});
        const sourceInput = inputRow.createEl("input", { type: "text", placeholder: "Type a folder or file name..." });
        sourceInput.style.flexGrow = "1";
        
        // Creamos la lista de sugerencias nativa
        const datalistId = "subject-sources-list";
        let datalist = document.getElementById(datalistId) as HTMLDataListElement;
        if (!datalist) datalist = document.body.createEl("datalist", { attr: { id: datalistId } });
        else datalist.empty();
        
        // Llenamos la lista con Carpetas, MDs, PDFs, Canvas y Excalidraw
        this.plugin.app.vault.getAllLoadedFiles().forEach((f: any) => {
            const ext = f.extension?.toLowerCase();
            if (ext === undefined || ext === "md" || ext === "pdf" || ext === "canvas" || ext === "excalidraw") {
                datalist.createEl("option", { value: f.path });
            }
        });
        sourceInput.setAttribute("list", datalistId);

        const addSourceBtn = inputRow.createEl("button", { text: "Add" });
        
        // Contenedor visual de las fuentes agregadas
        const chipsContainer = contentEl.createDiv({ cls: "subject-folders", attr: { style: "margin-bottom: 15px; min-height: 30px;" } });
        // Migración al vuelo por si tenías materias viejas con resourceFolders
        let currentSources = this.subject ? (this.subject.sources || this.subject.resourceFolders || []) : [];

        const renderChips = () => {
            chipsContainer.empty();
            currentSources.forEach((src: string, idx: number) => {
                const chip = chipsContainer.createSpan({ cls: "folder-chip" });
                
                // Icono dinámico según lo que sea
                let iconStr = "📁";
                if (src.endsWith(".pdf")) iconStr = "📕";
                else if (src.endsWith(".md")) iconStr = "📄";
                
                chip.innerText = `${iconStr} ${src}`;
                
                const delBtn = chip.createSpan({ text: " ×", attr: { style: "cursor: pointer; color: var(--text-error); margin-left: 4px; font-weight: bold;" }});
                delBtn.onclick = () => { currentSources.splice(idx, 1); renderChips(); };
            });
        };
        renderChips();

        addSourceBtn.onclick = () => {
            const val = sourceInput.value.trim();
            if (val && !currentSources.includes(val)) {
                currentSources.push(val);
                sourceInput.value = "";
                renderChips();
            }
        };
        // Permitir agregar con la tecla Enter
        sourceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); addSourceBtn.click(); }
        });
        // ----------------------------------------------
        // --- 🧠 SYLLABUS BULK IMPORTER (Temario Inteligente) ---
        contentEl.createEl("label", { text: "📑 Smart Syllabus (Paste topics separated by lines or commas):", attr: { style: "display: block; margin-top: 15px; margin-bottom: 5px; font-weight: bold;" } });
        
        const bulkInputRow = contentEl.createDiv({ attr: { style: "display: flex; gap: 8px; margin-bottom: 10px;" }});
        const bulkInput = bulkInputRow.createEl("textarea", { placeholder: "1. Introducción\n2. Células\n3. Tejidos..." });
        bulkInput.style.flexGrow = "1";
        bulkInput.style.height = "60px";
        
        const parseBtn = bulkInputRow.createEl("button", { text: "⚡ Parse" });
        parseBtn.style.height = "60px";

        const topicsContainer = contentEl.createDiv({ cls: "syllabus-topics-editor", attr: { style: "max-height: 200px; overflow-y: auto; background: var(--background-secondary-alt); padding: 10px; border-radius: 6px; border: 1px solid var(--background-modifier-border); margin-bottom: 15px;" }});
        
        let currentTopics: any[] = this.subject && this.subject.syllabus ? [...this.subject.syllabus] : [];

        const renderTopicsEditor = () => {
            topicsContainer.empty();
            if (currentTopics.length === 0) {
                topicsContainer.createEl("span", { text: "No topics yet. Paste a list and click Parse.", cls: "text-muted", attr: { style: "font-size: 0.85em; font-style: italic;" }});
                return;
            }

            currentTopics.forEach((topic, idx) => {
                const topicRow = topicsContainer.createDiv({ attr: { style: "display: flex; gap: 10px; align-items: center; margin-bottom: 8px;" }});
                
                const nameInp = topicRow.createEl("input", { type: "text", value: topic.name, attr: { title: "Topic Name" } });
                nameInp.style.flexGrow = "1";
                nameInp.onchange = () => topic.name = nameInp.value;

                const ruleInp = topicRow.createEl("input", { type: "text", value: topic.rule, placeholder: "Rule (e.g. #cells or tema::cells)", attr: { title: "Capture Rule (Tag or Property)" } });
                ruleInp.style.width = "180px";
                ruleInp.onchange = () => topic.rule = ruleInp.value;

                const delBtn = topicRow.createEl("span", { text: "×", attr: { style: "cursor: pointer; color: var(--text-error); font-weight: bold; padding: 0 5px;", title: "Eliminar tema" }});
                delBtn.onclick = () => { 
                    const topicToDelete = currentTopics[idx];
                    
                    // Función para eliminar el tema de la UI y la data
                    const performDeletion = () => {
                        currentTopics.splice(idx, 1); 
                        renderTopicsEditor();
                    };
                    
                    // 🗑️ Limpieza de Archivo (Usando nuestro Modal Nativo)
                    if (topicToDelete.taskNoteId && topicToDelete.taskNoteId !== "synced") {
                        new ConfirmDeleteModal(
                            this.plugin.app,
                            "🗑️ Eliminar TaskNote",
                            `¿Quieres enviar también el archivo TaskNote "${topicToDelete.name}" a la papelera del sistema?`,
                            async () => {
                                // Si el usuario confirma, borramos el archivo
                                let pathToOpen = topicToDelete.taskNoteId.endsWith('.md') ? topicToDelete.taskNoteId : `${topicToDelete.taskNoteId}.md`;
                                const file = this.plugin.app.metadataCache.getFirstLinkpathDest(pathToOpen, "");
                                if (file) {
                                    await this.plugin.app.vault.trash(file, true); // true = enviar a la papelera del OS
                                    new Notice(`🗑️ TaskNote enviada a la papelera.`);
                                }
                                performDeletion(); // Luego borramos el tema
                            }
                        ).open();
                    } else {
                        // Si no hay TaskNote asociado, simplemente borramos el tema
                        performDeletion();
                    }
                };
            });
        };
        renderTopicsEditor();

        parseBtn.onclick = () => {
            const raw = bulkInput.value.trim();
            if (!raw) return;
            // Divide por salto de línea o coma
            const parts = raw.split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);
            parts.forEach(p => {
                // Auto-genera una regla base con el nombre del tema (limpio de espacios y números)
                const cleanTag = p.replace(/^[0-9.\-]+\s*/, '').replace(/\s+/g, '_').toLowerCase();
                currentTopics.push({ id: Math.random().toString(36).substring(2, 9), name: p, rule: `#${cleanTag}` });
            });
            bulkInput.value = "";
            renderTopicsEditor();
        };
        //----------------------------------------------------

        contentEl.createEl("label", { text: "🎨 Subject Color:", attr: { style: "display: block; margin-bottom: 5px; font-weight: bold;" } });
        const colorInput = contentEl.createEl("input", { type: "color" });
        colorInput.style.marginBottom = "20px";
        colorInput.style.display = "block";
        colorInput.value = this.subject && this.subject.color ? this.subject.color : "#4a90e2";

        const saveBtn = contentEl.createEl("button", { text: "💾 Save Subject", cls: "mod-cta" });
        saveBtn.style.width = "100%";
        
        saveBtn.onclick = async () => {
            if (!nameInput.value.trim() || !dateInput.value) {
                new Notice("⚠️ Name and Exam Date are required.");
                return;
            }

            const inputDate = new Date(dateInput.value);
            const localDate = new Date(inputDate.getTime() + Math.abs(inputDate.getTimezoneOffset() * 60000));

            const newSubject = {
                id: this.subject ? this.subject.id : Math.random().toString(36).substring(2, 9),
                name: nameInput.value.trim(),
                examDate: localDate.getTime(),
                sources: currentSources, // 👈 Guardamos el nuevo array
                syllabus: currentTopics,
                color: colorInput.value
            };

            const data = (this.plugin.settings.dashboardData as any);
            if (!data.subjects) data.subjects = [];

            if (this.subject) {
                const idx = data.subjects.findIndex((s: any) => s.id === this.subject.id);
                if (idx > -1) data.subjects[idx] = newSubject;
            } else {
                data.subjects.push(newSubject);
            }

            await this.plugin.saveSettings();

            // Verificamos si la integración está activa en el layout antes de sincronizar
            if (data.layout && data.layout.subjectsTaskNotes) {
                await this.syncSyllabusToTaskNotes(newSubject);
            }

            this.onSave();
            this.close();
        };
    }

    onClose() { this.contentEl.empty(); }
}
// ==========================================
// 🚀 MOTOR DE REPASO INMERSIVO (SRS FLOTANTE & LECTURA ACTIVA)
// ==========================================
export class ReviewSessionManager {
    plugin: any;
    subject: any;
    isCramMode: boolean;
    topic: any; // 👈 AHORA GUARDAMOS EL TOPIC COMPLETO
    sessionType: 'srs' | 'reading';
    deck: any[] = [];
    currentIndex: number = 0;
    floatingBar: HTMLElement | null = null;

    constructor(plugin: any, subject: any, isCramMode: boolean, topic: any = null, sessionType: 'srs' | 'reading' = 'srs') {
        this.plugin = plugin;
        this.subject = subject;
        this.isCramMode = isCramMode;
        this.topic = topic;
        this.sessionType = sessionType; 
    }

    async start() {
        new Notice("⏳ Assembling Deck...");
        await this.buildDeck();

        if (this.deck.length === 0) {
            new Notice("🎉 You're all caught up! No pending reviews for this subject today.");
            return;
        }

        // Activamos el Blur (Active Recall) SOLO si estamos en modo Flashcard
        if (this.sessionType === 'srs' && !document.body.classList.contains('cornell-active-recall-on')) {
            this.plugin.toggleActiveRecall();
        }

        this.showCurrentCard();
    }

    async buildDeck() {
        const files = this.plugin.app.vault.getMarkdownFiles();
        const sources = this.subject.sources || [];
        const now = Date.now();

        // 👈 INCLUIR LAS NOTAS ADJUNTAS AL TARGET (A NIVEL TEMA Y A NIVEL MATERIA)
        const allAttachedNotes: string[] = [];
        if (!this.topic && this.subject.syllabus) {
            this.subject.syllabus.forEach((t: any) => {
                if (t.attachedNotes) allAttachedNotes.push(...t.attachedNotes);
            });
        }

        const targetFiles = this.topic ? files.filter((f: TFile) => {
            const isSource = sources.some((src: string) => f.path.startsWith(src) || f.path === src || f.name === src);
            const isAttached = this.topic.attachedNotes?.some((n: string) => f.path === n || f.name === n || f.name === `${n}.md`);
            return isSource || isAttached;
        }) : files.filter((f: TFile) => {
            const isSource = sources.some((src: string) => f.path.startsWith(src) || f.path === src || f.name === src);
            const isAttached = allAttachedNotes.some((n: string) => f.path === n || f.name === n || f.name === `${n}.md`);
            return isSource || isAttached;
        });

        // Asegurarnos de que el registro de lectura exista
        if (this.sessionType === 'reading' && !this.plugin.settings.userStats.activeReading) {
            this.plugin.settings.userStats.activeReading = {};
        }

        for (const file of targetFiles) {
            const content = await this.plugin.app.vault.cachedRead(file);
            
            // 📖 LÓGICA MODO LECTURA: Revisamos la nota completa
            if (this.sessionType === 'reading') {
                // Si la nota tiene al menos una marginalia
                if (/%%[><](.*?)%%/.test(content)) {
                    const noteData = this.plugin.settings.userStats.activeReading[file.path] || { nextReview: 0 };
                    
                    if (this.isCramMode || now >= noteData.nextReview) {
                        this.deck.push({
                            file: file,
                            line: 0, // En lectura empezamos desde arriba
                            reviewData: noteData
                        });
                    }
                }
            } 
            // ⚡ LÓGICA MODO FLASHCARD (SRS): Revisamos bloque por bloque
            else {
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const match = lines[i].match(/%%[><](.*?)%%/);
                    if (match) {
                        const rawText = match[1].trim().toLowerCase();
                        
                        // 🧲 REGLA DE ORO: Solo es flashcard si contiene ;;
                        if (!rawText.includes(';;')) {
                            continue; 
                        }

                        // Filtro del Temario (permite que notas adjuntas ignoren la regla de escaneo)
                        const ruleLower = this.topic && this.topic.rule ? this.topic.rule.toLowerCase() : null;
                        const isAttachedToTopic = this.topic && this.topic.attachedNotes?.some((n: string) => file.path === n || file.name === n || file.name === `${n}.md`);
                        
                        if (ruleLower && !isAttachedToTopic && !rawText.includes(ruleLower)) continue;

                        // 🛡️ ESCÁNER UNIVERSAL DE IDs: Atrapa el ID tanto si está afuera (vieja sintaxis) como adentro de los %% (nueva sintaxis)
                        const blockIdMatch = lines[i].match(/\^([a-zA-Z0-9]+)(?:\s*%%)?\s*$/);
                        const blockId = blockIdMatch ? blockIdMatch[1] : `${file.basename}-L${i}`;

                        const reviewData = this.plugin.settings.userStats.rhizomeReviews[blockId] || { lastReviewed: 0, interval: 0, ease: 2.5 };
                        
                        if (reviewData.interval === -1) continue; // Suspendida
                        
                        const msInDay = 24 * 60 * 60 * 1000;
                        const nextReviewDate = reviewData.lastReviewed + (reviewData.interval * msInDay);

                        if (this.isCramMode || now >= nextReviewDate) {
                            this.deck.push({
                                id: blockId,
                                file: file,
                                line: i,
                                reviewData: reviewData
                            });
                        }
                    }
                }
            }
        }
        
        // Mezclamos el mazo aleatoriamente
        this.deck = this.deck.sort(() => Math.random() - 0.5);
    }

    async showCurrentCard() {
        if (this.currentIndex >= this.deck.length) {
            this.endSession();
            new Notice("🏁 Session Complete! Awesome job.");
            return;
        }

        const card = this.deck[this.currentIndex];

        // 1. Configuramos opciones de apertura "limpias"
        const openOptions: any = { active: true };
        
        // 2. FIX: Solo forzamos el modo Preview y la línea exacta si es una Flashcard
        if (this.sessionType === 'srs') {
            openOptions.state = { mode: 'preview' };
            openOptions.eState = { line: card.line };
        }
        // NOTA: Si es 'reading', Obsidian abrirá la nota en el modo que prefiera el usuario
        // y no peleará con el scroll.

        const leaf = this.plugin.app.workspace.getLeaf(false);
        await leaf.openFile(card.file, openOptions);

        this.renderFloatingBar(card);
    }

    renderFloatingBar(card: any) {
        if (!this.floatingBar) {
            this.floatingBar = document.body.createDiv({ cls: 'cornell-srs-floating-bar' });
            
            // FIX CRÍTICO: Forzamos estilos inline para evitar que empuje el body
            // y genere la barra de scroll falsa que causa los rebotes.
            this.floatingBar.style.position = "fixed";
            this.floatingBar.style.bottom = "30px"; // Altura desde abajo
            this.floatingBar.style.left = "50%";
            this.floatingBar.style.transform = "translateX(-50%)";
            this.floatingBar.style.zIndex = "99999";
        }
        this.floatingBar.empty();
        this.floatingBar.style.borderTop = `4px solid ${this.subject.color || 'var(--interactive-accent)'}`;

        const header = this.floatingBar.createDiv({ cls: 'srs-floating-header' });
        
        const titleSpan = header.createSpan();
        const modeTxt = this.isCramMode ? '⚡ Cram' : '🔄 Review';
        const typeTxt = this.sessionType === 'reading' ? '📖 Reading' : '🗂️ Flashcards';
        titleSpan.innerHTML = `<strong>${this.subject.name}</strong> <span style="opacity: 0.6; margin-left: 8px;">${modeTxt} - ${typeTxt} (${this.currentIndex + 1}/${this.deck.length})</span>`;
        
        const toolsSpan = header.createSpan({ attr: { style: "display: flex; gap: 10px;" } });

        // Solo mostrar botón de Blur en modo Flashcard
        if (this.sessionType === 'srs') {
            const blurBtn = toolsSpan.createEl('button', { title: "Toggle Blur (Active Recall)" });
            this.updateBlurIcon(blurBtn);
            blurBtn.onclick = () => {
                this.plugin.toggleActiveRecall();
                this.updateBlurIcon(blurBtn);
            };
        }

        const exitBtn = toolsSpan.createEl('button', { title: "End Session" });
        setIcon(exitBtn, "x");
        exitBtn.onclick = () => {
            this.endSession();
            new Notice("Session paused.");
        };

        const controls = this.floatingBar.createDiv({ cls: 'srs-floating-controls' });

        // ==========================================
        // UI MODO FLASHCARDS (SRS CLÁSICO)
        // ==========================================
        if (this.sessionType === 'srs') {
            const btnSuspend = controls.createEl("button", { text: "Suspend", cls: "srs-btn srs-suspend", title: "Ignore this card forever" });
            const btnHard = controls.createEl("button", { text: "Hard", cls: "srs-btn srs-hard" });
            const btnGood = controls.createEl("button", { text: "Good", cls: "srs-btn srs-good" });
            const btnEasy = controls.createEl("button", { text: "Easy", cls: "srs-btn srs-easy" });

            const processSRSRating = async (rating: 'suspend' | 'hard' | 'good' | 'easy') => {
                const now = Date.now();
                if (!this.isCramMode) {
                    let { interval, ease } = card.reviewData;
                    if (rating === 'suspend') {
                        interval = -1;
                    } else {
                        if (rating === 'hard') {
                            interval = Math.max(1, interval * 0.5);
                            ease = Math.max(1.3, ease - 0.2);
                        } else if (rating === 'good') {
                            interval = interval === 0 ? 1 : interval * ease;
                        } else if (rating === 'easy') {
                            interval = interval === 0 ? 4 : interval * ease * 1.3;
                            ease += 0.15;
                        }

                        const msInDay = 1000 * 60 * 60 * 24;
                        const daysUntilExam = Math.max(1, (this.subject.examDate - now) / msInDay);

                        if (interval >= daysUntilExam) {
                            const compressionFactor = rating === 'easy' ? 0.8 : (rating === 'good' ? 0.6 : 0.3);
                            interval = Math.max(1, daysUntilExam * compressionFactor);
                        }

                        if (interval > 2) {
                            const fuzzFactor = 0.05; 
                            const fuzzRange = interval * fuzzFactor;
                            const fuzzOffset = (Math.random() * 2 * fuzzRange) - fuzzRange;
                            interval = interval + fuzzOffset;
                        }
                    }

                    this.plugin.settings.userStats.rhizomeReviews[card.id] = { lastReviewed: now, interval: interval, ease: ease };
                    await this.plugin.saveSettings();
                }

                this.currentIndex++;
                this.showCurrentCard(); 
            };

            btnSuspend.onclick = () => processSRSRating('suspend');
            btnHard.onclick = () => processSRSRating('hard');
            btnGood.onclick = () => processSRSRating('good');
            btnEasy.onclick = () => processSRSRating('easy');
        } 
        // ==========================================
        // UI MODO LECTURA ACTIVA (SLIDER 1-10)
        // ==========================================
        else {
            controls.style.display = "flex";
            controls.style.gap = "15px";
            controls.style.alignItems = "center";
            controls.style.width = "100%";
            controls.style.justifyContent = "space-between";
            
            const sliderContainer = controls.createDiv({ attr: { style: "display: flex; align-items: center; gap: 10px; flex-grow: 1;" } });
            sliderContainer.createSpan({ text: "Confidence:", attr: { style: "font-size: 0.9em; font-weight: bold; color: var(--text-muted);" } });
            const slider = sliderContainer.createEl("input", { type: "range", attr: { min: "1", max: "10", value: "5", style: "flex-grow: 1; cursor: pointer;" } });
            const valueDisplay = sliderContainer.createDiv({ text: "5/10", attr: { style: "font-size: 1.1em; font-weight: bold; min-width: 45px; text-align: center; color: var(--color-orange);" } });

            slider.oninput = () => {
                valueDisplay.innerText = `${slider.value}/10`;
                if (parseInt(slider.value) <= 3) valueDisplay.style.color = "var(--color-red)";
                else if (parseInt(slider.value) >= 8) valueDisplay.style.color = "var(--color-green)";
                else valueDisplay.style.color = "var(--color-orange)";
            };

            const actionsSpan = controls.createDiv({ attr: { style: "display: flex; gap: 10px;" } });
            const suspendBtn = actionsSpan.createEl("button", { text: "🛑 Suspend", title: "Mastered, ignore forever" });
            const nextBtn = actionsSpan.createEl("button", { text: "Next ➡️", cls: "mod-cta" });

            const processReadingReview = async (confidence: number, suspended: boolean) => {
                const now = Date.now();
                let daysLeft = 30;
                if (this.subject.examDate) {
                    daysLeft = Math.ceil((this.subject.examDate - now) / (1000 * 60 * 60 * 24));
                    if (daysLeft <= 0) daysLeft = 14;
                }

                let nextIntervalDays = 1;
                if (suspended || confidence === 10) {
                    nextIntervalDays = 9999;
                } else if (confidence <= 3) {
                    nextIntervalDays = 1;
                } else {
                    const factor = Math.pow((confidence - 1) / 9, 1.5); 
                    nextIntervalDays = Math.max(1, Math.floor(daysLeft * factor));
                }

                this.plugin.settings.userStats.activeReading[card.file.path] = {
                    lastReview: now,
                    confidence: confidence,
                    nextReview: now + (nextIntervalDays * 24 * 60 * 60 * 1000)
                };
                await this.plugin.saveSettings();

                this.currentIndex++;
                this.showCurrentCard();
            };

            suspendBtn.onclick = () => processReadingReview(10, true);
            nextBtn.onclick = () => processReadingReview(parseInt(slider.value), false);
        }
    }

    updateBlurIcon(btn: HTMLElement) {
        btn.empty();
        if (document.body.classList.contains('cornell-active-recall-on')) {
            setIcon(btn, "eye-off");
            btn.style.color = "var(--interactive-accent)";
        } else {
            setIcon(btn, "eye");
            btn.style.color = "var(--text-muted)";
        }
    }

    endSession() {
        if (this.floatingBar) {
            this.floatingBar.remove();
            this.floatingBar = null;
        }
    }
}
// ==========================================
// MODAL PARA BLOQUES DE DÍA CUSTOM
// ==========================================
export class CustomBlockModal extends Modal {
    plugin: any;
    todayKey: string;
    onSave: () => void;

    constructor(app: App, plugin: any, todayKey: string, onSave: () => void) {
        super(app);
        this.plugin = plugin;
        this.todayKey = todayKey;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Add Block for Today Only" });

        const startInput = contentEl.createEl("input", { type: "time", value: "12:00" });
        startInput.style.marginRight = "10px";
        const endInput = contentEl.createEl("input", { type: "time", value: "13:00" });
        endInput.style.marginBottom = "10px";

        const typeSelect = contentEl.createEl("select");
        typeSelect.style.width = "100%";
        typeSelect.style.marginBottom = "10px";
        typeSelect.createEl("option", { value: "study", text: "Study Session" });
        typeSelect.createEl("option", { value: "review", text: "Review / SRS" });
        typeSelect.createEl("option", { value: "class", text: "Class / Lecture" });
        typeSelect.createEl("option", { value: "break", text: "Break / Rest" });

        const titleInput = contentEl.createEl("input", { type: "text", placeholder: "Task name..." });
        titleInput.style.width = "100%";
        titleInput.style.marginBottom = "20px";

        const saveBtn = contentEl.createEl("button", { text: "Save Override", cls: "mod-cta" });
        saveBtn.style.width = "100%";
        
        saveBtn.onclick = async () => {
            if (!titleInput.value.trim()) {
                new Notice("Title is required.");
                return;
            }
            
            const newBlock = {
                id: Math.random().toString(36).substring(2, 9),
                startTime: startInput.value,
                endTime: endInput.value,
                type: typeSelect.value,
                title: titleInput.value.trim(),
                mode: 'custom'
            };

            const data = this.plugin.settings.dashboardData as any;
            if (!data.customDays) data.customDays = {};
            if (!data.customDays[this.todayKey]) data.customDays[this.todayKey] = [];
            
            data.customDays[this.todayKey].push(newBlock);
            await this.plugin.saveSettings();
            
            this.onSave();
            this.close();
        };
    }
    onClose() { this.contentEl.empty(); }
}

// ==========================================
// 📎 MODAL PARA ADJUNTAR NOTAS MANUALES
// ==========================================
export class AttachNoteModal extends Modal {
    plugin: any;
    topic: any;
    onSave: (noteName: string) => void;

    constructor(app: App, plugin: any, topic: any, onSave: (noteName: string) => void) {
        super(app);
        this.plugin = plugin;
        this.topic = topic;
        this.onSave = onSave;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "📎 Adjuntar Nota" });
        contentEl.createEl("p", { text: `Añade una nota al tema: ${this.topic.name}`, cls: "text-muted" });

        const inputRow = contentEl.createDiv({ attr: { style: "display: flex; gap: 8px; margin-bottom: 20px;" }});
        
        // El input con autocompletado nativo
        const noteInput = inputRow.createEl("input", { type: "text", placeholder: "Ej. Apuntes_Tema1.md" });
        noteInput.style.flexGrow = "1";

        const datalistId = `attach-list-${this.topic.id || Math.random()}`;
        let datalist = document.getElementById(datalistId) as HTMLDataListElement;
        if (!datalist) datalist = document.body.createEl("datalist", { attr: { id: datalistId } });
        else datalist.empty();

        this.plugin.app.vault.getMarkdownFiles().forEach((f: TFile) => {
            datalist.createEl("option", { value: f.path });
        });
        noteInput.setAttribute("list", datalistId);

        const saveBtn = inputRow.createEl("button", { text: "Añadir", cls: "mod-cta" });

        const submitAction = () => {
            const val = noteInput.value.trim();
            if (val) {
                this.onSave(val);
                this.close();
            } else {
                new Notice("⚠️ Escribe el nombre de una nota.");
            }
        };

        saveBtn.onclick = submitAction;
        noteInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") submitAction();
        });
        
        // Auto-enfocar el input al abrir
        setTimeout(() => noteInput.focus(), 50);
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ==========================================
// 🗑️ MODAL DE CONFIRMACIÓN DE BORRADO
// ==========================================
export class ConfirmDeleteModal extends Modal {
    title: string;
    message: string;
    onConfirm: () => void;

    constructor(app: App, title: string, message: string, onConfirm: () => void) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        contentEl.createEl("h2", { text: this.title });
        contentEl.createEl("p", { text: this.message });

        const btnContainer = contentEl.createDiv({ attr: { style: "display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;" }});
        
        const cancelBtn = btnContainer.createEl("button", { text: "Cancelar" });
        cancelBtn.onclick = () => this.close();

        const confirmBtn = btnContainer.createEl("button", { text: "Borrar", cls: "mod-warning" }); // Botón rojo
        confirmBtn.onclick = () => {
            this.onConfirm();
            this.close();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}