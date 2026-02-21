<p align="left">
  <img src="assets/marginalia logo.png" width="100" title="Marginalia">
</p>


# Cornell Marginalia for Obsidian 

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
Bidirectional Margins: You can now use the %%< syntax to force a specific note to render on the opposite margin (only Reading View). Perfect for dual-margin workflows!

### 2. 🎨 Semantic Highlighting (New in v2.0)

Start your note with a specific symbol to automatically color-code it. Perfect for categorizing information at a glance.

| Prefix | Meaning | Color (Default) | Example |
| --- | --- | --- | --- |
| `?` | **Question** | 🟠 Orange | `%%> ? What is the powerhouse? %%` |
| `!` | **Important** | 🟡 Yellow | `%%> ! Exam topic! %%` |
| `X-` | **Correction** | 🔴 Red | `%%> X- Wrong definition %%` |
| `V-` | **Verified** | 🟢 Green | `%%> V- Checked with textbook %%` |

> *Note: You can fully customize these prefixes and colors in the settings!*

### 3. 🫥 Grouping Multiple Blocks (The Invisible Callout)

Obsidian treats paragraphs and lists as completely separate blocks. If you add a margin note to a paragraph that is immediately followed by a list, Obsidian might push the list down in Reading View to avoid overlapping.

To fix this and force Obsidian to treat them as a single block, wrap your text in our official invisible callout `> [!cornell]`:


> [!cornell]
>%%> Your margin note here %%
> This is my introductory paragraph:
> - List item 1
> - List item 2

The plugin will automatically hide the callout background, borders, and title. It will look exactly like normal text, but your margin note will perfectly align alongside the entire group!

### 4. 🖼️ Adding Images (Multimedia Support) [NEW]

You can easily embed images directly into your margins to create highly visual notes. To prevent conflicts with Obsidian's core Markdown engine, this plugin uses a special `img:` prefix. 

* **Syntax:** `%%> img:[[your_image.png]] %%`
* **Autocomplete:** As soon as you type `[[`, Obsidian's native file autocomplete will still pop up, meaning you don't have to memorize filenames!
* **Hover Zoom:** Images automatically scale to fit your custom margin width. Simply hover your mouse over any margin image to trigger a magnifying zoom effect, allowing you to see fine details without taking up space in your main text.

### 5. 🧭 Marginalia Explorer (Sidebar) [NEW]

Keep track of all your margin notes with a dedicated sidebar view.

    Current Note vs. All Vault: Choose to scan just the active file or your entire vault.

    Smart Grouping: Notes are automatically grouped by their color tags.

    Click-to-Scroll: Click on any note in the sidebar, and Obsidian will instantly open the file and scroll smoothly to the exact line (works natively in both Edit and Reading modes!).

### 6. 📖 Reading View Support [NEW]

Marginalia now renders beautifully in Reading View!

    Perfect for when you want to review a finished document or prepare for exporting.

    Distraction-Free: Prefer a clean view while reading? You can easily toggle Reading View rendering ON/OFF from the settings or right from the Command Palette.

### 7. 🙈 Unified Active Recall Mode (Blur)

Toggle the "Eye" Icon 👁️ in the ribbon to enter Study Mode.

    Any note ending in ;; will blur the paragraph it belongs to.

    Hover over the blurred text to reveal the answer.

    Seamless: Works instantly and flawlessly across both Live Preview and Reading View simultaneously!

Example: 

The mitochondria produces energy. %%> What does it produce? ;; %%

### 8. 🃏 Flashcard Generator

Turn your margin notes into Anki/Spaced Repetition cards instantly.

    Write a note ending in ;;.

    Run the command "Flashcards Generation".

    A ### Flashcards section will be generated at the bottom of your note automatically!

### 9. ⚙️ Full Customization

    Alignment: Choose between Left (Classic Cornell) or Right (Modern Textbook).

    Width: Adjust the margin width with a slider (15% - 60%).

    Typography: Change font size and font family to match your style.

### 10. 🖨️ PDF Export & Printing Support 

Obsidian's native PDF export engine notoriously struggles with floating margin notes. To solve this, Cornell Marginalia includes a dedicated "Print Engine" to guarantee your summaries look perfect and professional on paper or tablets.

**How to export your notes to PDF:**
1. **Prepare:** Open the Command Palette (`Ctrl/Cmd + P`) and run **"Prepare Marginalia for PDF Print"**. Your `%%>` notes will temporarily transform into safe HTML tags. 
2. **Export:** Use Obsidian's native "Export to PDF" feature. Your marginalia will automatically align in a clean, classic left-column Cornell layout, and the main text will wrap perfectly around them.
3. **Restore:** Once your PDF is saved, run **"Restore Marginalia after PDF Print"** to instantly return your text to its original, clean Markdown state.

> ⚠️ **Important:** Always remember to run the *Restore* command after exporting to keep your Markdown files clean and future-proof!

### 11. 🚀 Drag & Drop Integration (Excalidraw & Canvas) 

Marginalia is no longer just for reading; it's a tool for connecting ideas! 

You can now click and drag any note directly from the **Marginalia Explorer** sidebar and drop it into an Obsidian Canvas or an Excalidraw drawing. 
* The plugin instantly creates a native, indestructible Block ID link behind the scenes.
* Clicking the dropped node in your canvas will open the source file and scroll you down to the exact paragraph where the note belongs. Perfect for building mind maps from your summaries!

### 12. 🧵 Margin Threads (Zettelkasten in the Margins) 

Why limit your connections to main text? You can now stitch your marginalia notes together across your entire vault to create independent, multi-level thought threads.

* **The Stitch Button:** Easily connect a note from one file to a note in another using the Sidebar.
* **Drag & Drop Stitching:** To connect two thoughts, simply click and drag one note, then drop it on top of another note. The plugin will automatically write the code to link them. 
* **Recursive Tree View:** The "Threads" tab automatically renders infinite-level hierarchical trees of your connected notes. Follow a concept down the rabbit hole!
* **Smart Focus & Filters:** Click on a color pill (e.g., Yellow for 'Questions') to instantly filter your threads. The plugin is smart enough to show you the exact parent note your filtered concept came from, preserving your context.
* **Native & Future-Proof:** Threads use hidden, native Obsidian Block IDs (`[[Note#^id]]`). Your connections will survive file renames and will even show up in your native Obsidian Graph View!
* **Hover Peeks:** Whenever a note is part of a thread, a `🔗` button appears inside the marginalia. Hover your mouse over this button to instantly preview the connected note in a native popup, without ever leaving your current reading flow.

### 13. **✏️ The Doodle Engine (True Marginalia):**
* **Native Drawing Canvas:** Trigger the new `Draw a Doodle` command to open a distraction-free floating canvas. Supports both mouse and stylus/drawing tablets.
* **Auto-Injection:** Clicking "Save to Margin" automatically saves your sketch as a PNG in your vault and injects the image syntax into your active note. 

### 14. **⚡ The Omni-Capture Engine:**
* **Global Quick Capture:** Trigger the new `Omni-Capture` command (`Alt+C` recommended) from anywhere in Obsidian. A sleek, distraction-free modal will appear to capture your thoughts instantly.
* **Smart Clipboard & Image Support:** The modal automatically reads your clipboard text to use as context. You can also paste (`Ctrl+V`) screenshots or images directly into the modal, which will generate a live preview and save the image securely to your vault.
* **Integrated Doodle Canvas:** Need to sketch your idea? The Omni-Capture modal includes a hidden drawing canvas. Click "Add Doodle" to sketch with your mouse or tablet and attach it to your thought.
* **Vault Autocomplete & Memory:** The destination input now auto-suggests `.md` files from your vault and remembers your last used destination (e.g., `Marginalia Inbox.md`), ensuring a blazing-fast GTD (Getting Things Done) workflow.

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
  <img src="assets/marginalia final.png" width="600" title="Marginalia">
</p>
