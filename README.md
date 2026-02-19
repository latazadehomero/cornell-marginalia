

# Cornell Marginalia for Obsidian 🩺

A powerful study companion for Obsidian designed for students (Med, Law, Engineering) who use the **Cornell Note-taking System**.

It renders side-notes (cues) in the margin that are fully customizable, color-coded, and interactive for **Active Recall** sessions.

---

## ✨ Features

### 1. 📝 The Core Syntax

Write anywhere in your note using `%%> Text %%`. The plugin renders it in the margin, keeping your main text clean.

```markdown
Mitochondria are membrane-bound cell organelles that 
generate most of the chemical energy. %%> "Powerhouse" of the cell (ATP) %%

```

### 2. 🎨 Semantic Highlighting (New in v2.0)

Start your note with a specific symbol to automatically color-code it. Perfect for categorizing information at a glance.

| Prefix | Meaning | Color (Default) | Example |
| --- | --- | --- | --- |
| `?` | **Question** | 🟠 Orange | `%%> ? What is the powerhouse? %%` |
| `!` | **Important** | 🟡 Yellow | `%%> ! Exam topic! %%` |
| `X-` | **Correction** | 🔴 Red | `%%> X- Wrong definition %%` |
| `V-` | **Verified** | 🟢 Green | `%%> V- Checked with textbook %%` |

> *Note: You can fully customize these prefixes and colors in the settings!*

### 3. 🧭 Marginalia Explorer (Sidebar) [NEW]

Keep track of all your margin notes with a dedicated sidebar view.

    Current Note vs. All Vault: Choose to scan just the active file or your entire vault.

    Smart Grouping: Notes are automatically grouped by their color tags.

    Click-to-Scroll: Click on any note in the sidebar, and Obsidian will instantly open the file and scroll smoothly to the exact line (works natively in both Edit and Reading modes!).

### 4. 📖 Reading View Support [NEW]

Marginalia now renders beautifully in Reading View!

    Perfect for when you want to review a finished document or prepare for exporting.

    Distraction-Free: Prefer a clean view while reading? You can easily toggle Reading View rendering ON/OFF from the settings or right from the Command Palette.

### 5. 🙈 Unified Active Recall Mode (Blur)

Toggle the "Eye" Icon 👁️ in the ribbon to enter Study Mode.

    Any note ending in ;; will blur the paragraph it belongs to.

    Hover over the blurred text to reveal the answer.

    Seamless: Works instantly and flawlessly across both Live Preview and Reading View simultaneously!

Example: 

The mitochondria produces energy. %%> What does it produce? ;; %%

### 6. 🃏 Flashcard Generator

Turn your margin notes into Anki/Spaced Repetition cards instantly.

    Write a note ending in ;;.

    Run the command "Flashcards Generation".

    A ### Flashcards section will be generated at the bottom of your note automatically!

### 7. ⚙️ Full Customization

    Alignment: Choose between Left (Classic Cornell) or Right (Modern Textbook).

    Width: Adjust the margin width with a slider (15% - 60%).

    Typography: Change font size and font family to match your style.

### 8. 🖨️ PDF Export & Printing Support 

Obsidian's native PDF export engine notoriously struggles with floating margin notes. To solve this, Cornell Marginalia includes a dedicated "Print Engine" to guarantee your summaries look perfect and professional on paper or tablets.

**How to export your notes to PDF:**
1. **Prepare:** Open the Command Palette (`Ctrl/Cmd + P`) and run **"Prepare Marginalia for PDF Print"**. Your `%%>` notes will temporarily transform into safe HTML tags. 
2. **Export:** Use Obsidian's native "Export to PDF" feature. Your marginalia will automatically align in a clean, classic left-column Cornell layout, and the main text will wrap perfectly around them.
3. **Restore:** Once your PDF is saved, run **"Restore Marginalia after PDF Print"** to instantly return your text to its original, clean Markdown state.

> ⚠️ **Important:** Always remember to run the *Restore* command after exporting to keep your Markdown files clean and future-proof!

### 9. 🚀 Drag & Drop Integration (Excalidraw & Canvas) [NEW in v2.2.0]

Marginalia is no longer just for reading; it's a tool for connecting ideas! 

You can now click and drag any note directly from the **Marginalia Explorer** sidebar and drop it into an Obsidian Canvas or an Excalidraw drawing. 
* The plugin instantly creates a native, indestructible Block ID link behind the scenes.
* Clicking the dropped node in your canvas will open the source file and scroll you down to the exact paragraph where the note belongs. Perfect for building mind maps from your summaries!

### ⚡ Shortcuts & Commands

You don't need to type %%> manually every time or dig through settings! The plugin includes smart commands to speed up your workflow.
Insert Margin Note

This command intelligently handles the syntax based on your cursor position:

    No selection: Inserts %%>  %% and places your cursor inside, ready to type.

    Text selected: Wraps your selection automatically (e.g., %%> Important Concept %%).

### Toggle & Navigation Commands

    Open Marginalia Explorer: Opens the sidebar to view all your notes.

    Toggle Marginalia in Reading View: Quickly show or hide marginalia when you are in reading mode.

### How to set them up:

    Command Palette: Press Ctrl/Cmd + P and search for Cornell Marginalia.

    Hotkey (Recommended): Go to Settings > Hotkeys, search for "Cornell", and assign your favorite shortcuts (e.g., Ctrl + M to insert a note).

## 📦 Installation

### Method 1: Via BRAT (Recommended)

This is the easiest way to get automatic updates.

1. Install the **BRAT** plugin from the Obsidian Community Plugins (search for "BRAT").
2. Open the command palette (`Ctrl/Cmd + P`) and search for `BRAT: Add a beta plugin for testing`.
3. Paste this repository URL: `https://github.com/latazadehomero/cornell-marginalia`
4. Click "Add Plugin".
5. Enable "Cornell Marginalia" in your Community Plugins list.

### Method 2: Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [Latest Release](https://www.google.com/search?q=https://github.com/latazadehomero/cornell-marginalia/releases/latest).
2. Go to your vault's plugin folder: `.obsidian/plugins/`.
3. Create a folder named `cornell-marginalia`.
4. Paste the downloaded files into that folder.
5. Reload Obsidian and enable the plugin.

---

## 🤝 Support

If you find this plugin useful for your studies, consider buying me a coffee! It helps me keep coding new features 🩺☕

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support%20my%20work-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=white)](https://buymeacoffee.com/latazadehomero)

## Examples

<p align="center">
  <img src="assets/marginalia2.png" width="600" title="Marginalia">
</p>
