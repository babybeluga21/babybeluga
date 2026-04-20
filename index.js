/**
 * HTML Ghost — SillyTavern Extension
 * Strips HTML blocks from model context, stores & renders them visually.
 * Also provides a code inspector in the ••• (wand) menu.
 */

import { getContext, extension_settings, saveSettingsDebounced } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";

const EXT_NAME = "html-ghost";
const EXT_DISPLAY = "HTML Ghost";

// ── Default Settings ──────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
    enabled: true,
    stripFromContext: true,
    renderInChat: true,
    showInspector: true,
    highlightTheme: "dark",
};

// ── In-memory store: { messageId → [{ index, html, stripped }] } ─────────────
const htmlStore = new Map();

// ── Regex: match <html>…</html> blocks (case-insensitive, dotall) ─────────────
// Also matches standalone complete HTML snippets wrapped in ```html fences
const HTML_BLOCK_RE = /```html\s*([\s\S]*?)```|(<(?:html|div|table|ul|ol|section|article|header|footer|aside|figure|canvas|svg)[^>]*>[\s\S]*?<\/(?:html|div|table|ul|ol|section|article|header|footer|aside|figure|canvas|svg)>)/gi;

// ── Utility ───────────────────────────────────────────────────────────────────

function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = Object.assign({}, DEFAULT_SETTINGS);
    }
    return extension_settings[EXT_NAME];
}

/**
 * Extract all HTML blocks from text.
 * Returns { cleaned: string, blocks: string[] }
 */
function extractHtmlBlocks(text) {
    const blocks = [];
    const cleaned = text.replace(HTML_BLOCK_RE, (match, fenced, inline) => {
        const html = fenced ?? inline ?? match;
        blocks.push(html.trim());
        return ""; // strip from text
    });
    return { cleaned: cleaned.trim(), blocks };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function storeBlocks(messageId, blocks) {
    if (!htmlStore.has(messageId)) htmlStore.set(messageId, []);
    const entry = htmlStore.get(messageId);
    blocks.forEach((html, i) => {
        entry.push({ index: entry.length, html });
    });
}

function getBlocks(messageId) {
    return htmlStore.get(messageId) ?? [];
}

// ── Render HTML in chat bubble ────────────────────────────────────────────────

function renderBlocksInMessage(mesDiv, blocks) {
    if (!blocks.length) return;

    // Remove old ghost containers for this message
    mesDiv.querySelectorAll(".ghost-html-container").forEach(el => el.remove());

    const wrap = document.createElement("div");
    wrap.className = "ghost-html-container";

    blocks.forEach((b, i) => {
        const frame = document.createElement("div");
        frame.className = "ghost-html-frame";
        frame.dataset.index = i;

        // Sandbox render
        const shadow = frame.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = `
            :host { display:block; width:100%; font-family:inherit; }
            * { box-sizing:border-box; }
        `;
        shadow.appendChild(style);
        const container = document.createElement("div");
        container.innerHTML = b.html;
        shadow.appendChild(container);

        const bar = document.createElement("div");
        bar.className = "ghost-html-bar";
        bar.innerHTML = `<span class="ghost-label">⟨/⟩ HTML Block ${i + 1}</span>
            <button class="ghost-inspect-btn" data-index="${i}">Inspect</button>`;
        bar.querySelector(".ghost-inspect-btn").addEventListener("click", () => {
            openInspector(b.html, `Block ${i + 1}`);
        });

        wrap.appendChild(bar);
        wrap.appendChild(frame);
    });

    // Append after the message text
    const mesText = mesDiv.querySelector(".mes_text");
    if (mesText) mesText.appendChild(wrap);
}

// ── Process a rendered message ─────────────────────────────────────────────────

function processMessage(mesDiv) {
    const settings = getSettings();
    if (!settings.enabled) return;

    const mesId = mesDiv.dataset.mesid;
    if (!mesId) return;

    const mesText = mesDiv.querySelector(".mes_text");
    if (!mesText) return;

    // Already processed?
    if (mesDiv.dataset.ghostProcessed === "1") {
        // Re-render stored blocks
        if (settings.renderInChat) {
            renderBlocksInMessage(mesDiv, getBlocks(mesId));
        }
        return;
    }

    const rawHtml = mesText.innerHTML;
    const { cleaned, blocks } = extractHtmlBlocks(mesText.innerText);

    if (!blocks.length) return;

    storeBlocks(mesId, blocks);
    mesDiv.dataset.ghostProcessed = "1";

    if (settings.renderInChat) {
        renderBlocksInMessage(mesDiv, getBlocks(mesId));
    }
}

// ── Hook: strip HTML from context before sending to model ────────────────────

eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (data) => {
    const settings = getSettings();
    if (!settings.enabled || !settings.stripFromContext) return;

    if (!data?.messages) return;

    data.messages = data.messages.map(msg => {
        if (typeof msg.content !== "string") return msg;
        const { cleaned } = extractHtmlBlocks(msg.content);
        return { ...msg, content: cleaned };
    });
});

// Text-completion equivalent
eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (data) => {
    const settings = getSettings();
    if (!settings.enabled || !settings.stripFromContext) return;

    if (data?.finalPrompt) {
        const { cleaned } = extractHtmlBlocks(data.finalPrompt);
        data.finalPrompt = cleaned;
    }
});

// ── Hook: after message rendered ─────────────────────────────────────────────

eventSource.on(event_types.MESSAGE_RENDERED, (mesId) => {
    const mesDiv = document.querySelector(`.mes[data-mesid="${mesId}"]`);
    if (mesDiv) processMessage(mesDiv);
});

// Also process all existing messages on load / chat switch
function processAllMessages() {
    document.querySelectorAll(".mes").forEach(processMessage);
}

eventSource.on(event_types.CHAT_LOADED, processAllMessages);
eventSource.on(event_types.CHARACTER_SELECTED, processAllMessages);

// ── Inspector panel ───────────────────────────────────────────────────────────

let inspectorEl = null;

function buildInspector() {
    if (document.getElementById("ghost-inspector")) return;

    const panel = document.createElement("div");
    panel.id = "ghost-inspector";
    panel.innerHTML = `
        <div class="ghost-insp-header">
            <span class="ghost-insp-title">⟨/⟩ HTML Ghost — Inspector</span>
            <div class="ghost-insp-actions">
                <button id="ghost-insp-copy" title="Copy source">⎘ Copy</button>
                <button id="ghost-insp-close" title="Close">✕</button>
            </div>
        </div>
        <div class="ghost-insp-tabs">
            <button class="ghost-tab active" data-tab="source">Source</button>
            <button class="ghost-tab" data-tab="preview">Preview</button>
            <button class="ghost-tab" data-tab="analysis">Analysis</button>
        </div>
        <div class="ghost-insp-body">
            <pre id="ghost-insp-source" class="ghost-tab-pane active"></pre>
            <div id="ghost-insp-preview" class="ghost-tab-pane"></div>
            <div id="ghost-insp-analysis" class="ghost-tab-pane"></div>
        </div>
        <div class="ghost-insp-resize" id="ghost-insp-resize"></div>
    `;
    document.body.appendChild(panel);
    inspectorEl = panel;

    // Tab switching
    panel.querySelectorAll(".ghost-tab").forEach(btn => {
        btn.addEventListener("click", () => {
            panel.querySelectorAll(".ghost-tab").forEach(b => b.classList.remove("active"));
            panel.querySelectorAll(".ghost-tab-pane").forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            panel.querySelector(`#ghost-insp-${btn.dataset.tab}`).classList.add("active");
        });
    });

    // Copy
    document.getElementById("ghost-insp-copy").addEventListener("click", () => {
        const src = document.getElementById("ghost-insp-source").textContent;
        navigator.clipboard.writeText(src).then(() => {
            const btn = document.getElementById("ghost-insp-copy");
            btn.textContent = "✓ Copied";
            setTimeout(() => btn.textContent = "⎘ Copy", 1500);
        });
    });

    // Close
    document.getElementById("ghost-insp-close").addEventListener("click", () => {
        panel.classList.remove("open");
    });

    // Draggable
    makeDraggable(panel, panel.querySelector(".ghost-insp-header"));

    // Resizable (vertical) via bottom handle
    makeResizable(panel, document.getElementById("ghost-insp-resize"));
}

function openInspector(html, label = "Block") {
    buildInspector();
    const panel = inspectorEl;

    // Source tab
    document.getElementById("ghost-insp-source").textContent = formatHtml(html);

    // Preview tab (shadow DOM)
    const previewDiv = document.getElementById("ghost-insp-preview");
    previewDiv.innerHTML = "";
    const shadow = previewDiv.attachShadow ? previewDiv.attachShadow({ mode: "open" }) : null;
    if (shadow) {
        shadow.innerHTML = `<style>*{box-sizing:border-box;font-family:sans-serif}</style>${html}`;
    } else {
        previewDiv.innerHTML = html;
    }

    // Analysis tab
    document.getElementById("ghost-insp-analysis").innerHTML = analyzeHtml(html);

    panel.querySelector(".ghost-insp-title").textContent = `⟨/⟩ HTML Ghost — ${label}`;

    // Reset to source tab
    panel.querySelectorAll(".ghost-tab").forEach(b => b.classList.remove("active"));
    panel.querySelectorAll(".ghost-tab-pane").forEach(p => p.classList.remove("active"));
    panel.querySelector("[data-tab='source']").classList.add("active");
    document.getElementById("ghost-insp-source").classList.add("active");

    panel.classList.add("open");
}

// ── HTML Formatter (basic indent) ─────────────────────────────────────────────

function formatHtml(html) {
    let indent = 0;
    return html
        .replace(/></g, ">\n<")
        .split("\n")
        .map(line => {
            line = line.trim();
            if (!line) return "";
            if (line.match(/^<\/[^!]/)) indent = Math.max(0, indent - 1);
            const out = "  ".repeat(indent) + line;
            if (line.match(/^<[^/!][^>]*[^/]>$/) && !line.match(/^<(br|hr|img|input|link|meta|area|base|col|embed|param|source|track|wbr)/i)) {
                indent++;
            }
            return out;
        })
        .filter(Boolean)
        .join("\n");
}

// ── HTML Analyzer ─────────────────────────────────────────────────────────────

function analyzeHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const body = doc.body;

    const tags = {};
    body.querySelectorAll("*").forEach(el => {
        tags[el.tagName.toLowerCase()] = (tags[el.tagName.toLowerCase()] ?? 0) + 1;
    });

    const inlineStyles = body.querySelectorAll("[style]").length;
    const scripts = body.querySelectorAll("script").length;
    const forms = body.querySelectorAll("form,input,button,select,textarea").length;
    const images = body.querySelectorAll("img,svg,canvas").length;
    const links = body.querySelectorAll("a[href]").length;
    const totalEls = body.querySelectorAll("*").length;
    const charCount = html.length;

    const tagList = Object.entries(tags)
        .sort((a, b) => b[1] - a[1])
        .map(([t, c]) => `<span class="ghost-tag-badge">${t} <em>${c}</em></span>`)
        .join(" ");

    const warnings = [];
    if (scripts > 0) warnings.push(`⚠ ${scripts} &lt;script&gt; tag(s) — will execute in preview`);
    if (inlineStyles > 5) warnings.push(`ℹ ${inlineStyles} inline style attributes`);
    if (forms > 0) warnings.push(`ℹ ${forms} form element(s)`);

    return `
        <div class="ghost-analysis">
            <div class="ghost-stat-row">
                <div class="ghost-stat"><span>${totalEls}</span><label>Elements</label></div>
                <div class="ghost-stat"><span>${charCount}</span><label>Characters</label></div>
                <div class="ghost-stat"><span>${images}</span><label>Media</label></div>
                <div class="ghost-stat"><span>${links}</span><label>Links</label></div>
            </div>
            <div class="ghost-section-title">Tags Used</div>
            <div class="ghost-tag-list">${tagList || '<em>none</em>'}</div>
            ${warnings.length ? `<div class="ghost-section-title">Notes</div><ul class="ghost-warnings">${warnings.map(w => `<li>${w}</li>`).join("")}</ul>` : ""}
        </div>
    `;
}

// ── Drag & Resize helpers ─────────────────────────────────────────────────────

function makeDraggable(el, handle) {
    let ox, oy;
    handle.addEventListener("mousedown", e => {
        ox = e.clientX - el.offsetLeft;
        oy = e.clientY - el.offsetTop;
        const move = ev => {
            el.style.left = (ev.clientX - ox) + "px";
            el.style.top = (ev.clientY - oy) + "px";
            el.style.right = "auto";
            el.style.bottom = "auto";
        };
        const up = () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
    });
}

function makeResizable(el, handle) {
    handle.addEventListener("mousedown", e => {
        const startY = e.clientY;
        const startH = el.offsetHeight;
        const move = ev => {
            el.style.height = Math.max(200, startH + (ev.clientY - startY)) + "px";
        };
        const up = () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
    });
}

// ── ••• Wand Menu Button ──────────────────────────────────────────────────────

function injectWandButton() {
    // SillyTavern's extra tools bar (the ••• menu area or #extensionsMenu)
    const target = document.getElementById("extensionsMenu") ?? document.getElementById("options");
    if (!target || document.getElementById("ghost-wand-btn")) return;

    const btn = document.createElement("div");
    btn.id = "ghost-wand-btn";
    btn.className = "list-group-item flex-container flexGap5";
    btn.innerHTML = `<span>⟨/⟩</span><span>HTML Ghost Inspector</span>`;
    btn.title = "Open HTML Ghost Inspector";
    btn.style.cursor = "pointer";
    btn.addEventListener("click", () => {
        buildInspector();
        // Show stored blocks list if inspector has no active block
        showStoreOverview();
        inspectorEl?.classList.add("open");
    });

    target.appendChild(btn);
}

function showStoreOverview() {
    buildInspector();
    const totalBlocks = [...htmlStore.values()].reduce((s, arr) => s + arr.length, 0);
    const msgs = htmlStore.size;

    const overviewHtml = totalBlocks === 0
        ? `<p style="color:#888;padding:1rem">No HTML blocks stored yet.<br>HTML blocks will appear here as they're generated.</p>`
        : [...htmlStore.entries()].map(([id, blocks]) =>
            `<div class="ghost-overview-msg">
                <span class="ghost-overview-id">Message #${id}</span>
                ${blocks.map((b, i) => `
                    <button class="ghost-overview-block" data-mid="${id}" data-bi="${i}">
                        Block ${i + 1} — ${b.html.length} chars
                    </button>`).join("")}
            </div>`
        ).join("");

    document.getElementById("ghost-insp-source").textContent = `${msgs} message(s) with HTML blocks\n${totalBlocks} total blocks stored`;
    document.getElementById("ghost-insp-preview").innerHTML = overviewHtml;
    document.getElementById("ghost-insp-analysis").innerHTML = `<div class="ghost-analysis"><div class="ghost-stat-row">
        <div class="ghost-stat"><span>${msgs}</span><label>Messages</label></div>
        <div class="ghost-stat"><span>${totalBlocks}</span><label>Blocks</label></div>
    </div></div>`;

    // Bind block buttons
    document.getElementById("ghost-insp-preview").querySelectorAll(".ghost-overview-block").forEach(btn => {
        btn.addEventListener("click", () => {
            const blocks = htmlStore.get(btn.dataset.mid) ?? [];
            const b = blocks[parseInt(btn.dataset.bi)];
            if (b) openInspector(b.html, `Msg #${btn.dataset.mid} Block ${parseInt(btn.dataset.bi) + 1}`);
        });
    });

    // Switch to preview tab
    document.querySelectorAll(".ghost-tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".ghost-tab-pane").forEach(p => p.classList.remove("active"));
    document.querySelector("[data-tab='preview']")?.classList.add("active");
    document.getElementById("ghost-insp-preview")?.classList.add("active");

    inspectorEl.querySelector(".ghost-insp-title").textContent = "⟨/⟩ HTML Ghost — Stored Blocks";
}

// ── Settings UI ───────────────────────────────────────────────────────────────

const SETTINGS_HTML = `
<div id="ghost-settings" class="ghost-settings-panel">
    <h4>⟨/⟩ HTML Ghost</h4>
    <label class="ghost-toggle">
        <input type="checkbox" id="ghost-enabled"> Enabled
    </label>
    <label class="ghost-toggle">
        <input type="checkbox" id="ghost-strip"> Strip HTML from model context
    </label>
    <label class="ghost-toggle">
        <input type="checkbox" id="ghost-render"> Render blocks in chat
    </label>
    <div class="ghost-info">Blocks stripped from context are stored in memory and rendered visually in the chat. Use the Inspector (••• menu) to view source &amp; analyze.</div>
</div>
`;

// ── Init ──────────────────────────────────────────────────────────────────────

jQuery(async () => {
    // Inject settings into Extensions panel
    const extPanel = document.getElementById("extensions_settings");
    if (extPanel) {
        extPanel.insertAdjacentHTML("beforeend", SETTINGS_HTML);
        const s = getSettings();
        document.getElementById("ghost-enabled").checked = s.enabled;
        document.getElementById("ghost-strip").checked = s.stripFromContext;
        document.getElementById("ghost-render").checked = s.renderInChat;

        ["ghost-enabled", "ghost-strip", "ghost-render"].forEach(id => {
            document.getElementById(id)?.addEventListener("change", () => {
                const ns = getSettings();
                ns.enabled = document.getElementById("ghost-enabled").checked;
                ns.stripFromContext = document.getElementById("ghost-strip").checked;
                ns.renderInChat = document.getElementById("ghost-render").checked;
                saveSettingsDebounced();
                processAllMessages();
            });
        });
    }

    // Inject wand menu button (retry until menu exists)
    const tryInjectWand = setInterval(() => {
        if (document.getElementById("extensionsMenu") || document.getElementById("options")) {
            injectWandButton();
            clearInterval(tryInjectWand);
        }
    }, 500);

    // Inject CSS
    injectStyles();

    // Process existing messages
    processAllMessages();
});

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles() {
    if (document.getElementById("ghost-styles")) return;
    const style = document.createElement("style");
    style.id = "ghost-styles";
    style.textContent = `
        /* ── Ghost HTML containers in chat ── */
        .ghost-html-container {
            margin-top: 0.6rem;
            display: flex;
            flex-direction: column;
            gap: 0.4rem;
        }
        .ghost-html-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
  
