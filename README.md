¡Excelente! Tu `README.md` actual es funcional pero muy básico. Ahora que tu plugin tiene **superpoderes** (colores, blur, flashcards, sliders, etc.), necesitamos un README que venda todas esas funcionalidades.

Aquí tienes una propuesta profesional, estructurada y visualmente atractiva para copiar y pegar en tu repositorio. He añadido las insignias (badges), una tabla de características y las instrucciones nuevas.

---

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

### 3. 🙈 Active Recall Mode (Blur)

Toggle the **"Eye" Icon 👁️** in the ribbon to enter Study Mode.

* Any note ending in `;;` will **blur** the paragraph it belongs to.
* **Hover** over the blurred text to reveal the answer.

```markdown
The mitochondria produces energy. %%> What does it produce? ;; %%

```

### 4. 🃏 Flashcard Generator

Turn your margin notes into Anki/Spaced Repetition cards instantly.

1. Write a note ending in `;;`.
2. Run the command **"Flashcards Generation"**.
3. A `### Flashcards` section will be generated at the bottom of your note automatically!

### 5. ⚙️ Full Customization

* **Alignment:** Choose betwen **Left** (Classic Cornell) or **Right** (Modern Textbook).
* **Width:** Adjust the margin width with a slider (15% - 60%).
* **Typography:** Change font size and font family to match your style.

---

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
