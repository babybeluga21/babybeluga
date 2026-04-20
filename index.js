/**
 * ST HTML Hider
 * ซ่อน HTML block จากบริบทที่ส่งให้ AI แต่ยังแสดงผลในแชทปกติ
 * พร้อม HTML Inspector panel สำหรับดูโค้ดทั้งหมดในแชท
 */

'use strict';

import { eventSource, event_types } from '../../../../script.js';
import { extension_settings, getContext, saveSettingsDebounced } from '../../../extensions.js';

const EXT_NAME    = 'st-html-hider';
const SETTINGS_KEY = 'html_hider';

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = { enabled: true, stripFromUser: false };
if (!extension_settings[SETTINGS_KEY]) {
    extension_settings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
}
const settings = extension_settings[SETTINGS_KEY];

// ── Tag List ──────────────────────────────────────────────────────────────────

const BLOCK_TAGS = [
    'div','section','article','aside','header','footer','nav','main',
    'table','thead','tbody','tfoot',
    'ul','ol',
    'figure','form','details','blockquote','canvas','svg',
];

const BLOCK_TAG_SET  = new Set(BLOCK_TAGS);
const BLOCK_SELECTOR = BLOCK_TAGS.join(',');

const HTML_STRIP_RE = new RegExp(
    `<(?:${BLOCK_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:${BLOCK_TAGS.join('|')})>`,
    'gi',
);

function stripHtml(text) {
    if (typeof text !== 'string') return text;
    return text.replace(HTML_STRIP_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Formatter ─────────────────────────────────────────────────────────────────

function formatHtml(html) {
    let out = '', depth = 0;
    const VOID = /^<(?:br|hr|input|img|meta|link|area|base|col|embed|param|source|track|wbr)/i;
    const parts = html.replace(/>\s*</g, '>\n<').split('\n');
    for (const raw of parts) {
        const line = raw.trim();
        if (!line) continue;
        const isClose = /^<\//.test(line);
        const isOpen  = /^<[^/!?]/.test(line) && !line.endsWith('/>') && !VOID.test(line);
        if (isClose) depth = Math.max(0, depth - 1);
        out += '  '.repeat(depth) + line + '\n';
        if (isOpen && !isClose) depth++;
    }
    return out.trim();
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function getTopTag(html) {
    const m = html.match(/^<([a-z][a-z0-9]*)/i);
    return m ? m[1].toLowerCase() : 'html';
}

// ── DOM Wrapping ──────────────────────────────────────────────────────────────

/** หาเฉพาะ block element ที่อยู่ "บนสุด" (ไม่ถูกห่อโดย block อื่นแล้ว) */
function findTopLevelBlocks(mesText) {
    const result = [];
    mesText.querySelectorAll(BLOCK_SELECTOR).forEach(el => {
        if (el.closest('[data-html-hider]')) return;
        let p = el.parentElement;
        while (p && p !== mesText) {
            if (BLOCK_TAG_SET.has(p.tagName.toLowerCase())) return;
            p = p.parentElement;
        }
        result.push(el);
    });
    return result;
}

function wrapElement(el) {
    if (el.closest('[data-html-hider]')) return;

    const rawHtml   = el.outerHTML;
    const formatted = formatHtml(rawHtml);

    const wrapper = document.createElement('div');
    wrapper.className       = 'hh-wrapper';
    wrapper.dataset.htmlHider = 'true';
    wrapper.dataset.rawHtml   = rawHtml;

    const rendered = document.createElement('div');
    rendered.className = 'hh-rendered';

    const sourcePanel = document.createElement('div');
    sourcePanel.className = 'hh-source-panel';
    sourcePanel.style.display = 'none';

    const pre  = document.createElement('pre');
    const code = document.createElement('code');
    code.className   = 'hh-code';
    code.textContent = formatted;
    pre.appendChild(code);
    sourcePanel.appendChild(pre);

    const footer = document.createElement('div');
    footer.className = 'hh-footer';

    const btn = document.createElement('button');
    btn.className = 'hh-toggle-btn';
    btn.title     = 'แสดง / ซ่อน HTML source code';
    btn.innerHTML =
        `<span class="hh-dots">•••</span>` +
        `<span class="hh-lbl"> HTML Source</span>` +
        `<span class="hh-chevron">▸</span>`;

    let open = false;
    btn.addEventListener('click', () => {
        open = !open;
        sourcePanel.style.display = open ? 'block' : 'none';
        btn.querySelector('.hh-chevron').textContent = open ? '▾' : '▸';
        wrapper.classList.toggle('hh-open', open);
        refreshInspector();
    });

    const badge = document.createElement('span');
    badge.className   = 'hh-badge';
    badge.title       = 'Block นี้ไม่ถูกส่งให้ AI';
    badge.textContent = '🙈 ซ่อนจาก AI';

    footer.append(btn, badge);

    el.before(wrapper);
    rendered.appendChild(el);
    wrapper.append(rendered, footer, sourcePanel);
}

// ── Process Message ───────────────────────────────────────────────────────────

function processMessageEl(mesId, mesEl) {
    if (!settings.enabled) return;
    const ctx = getContext();
    const msg = ctx.chat?.[mesId];
    if (!msg) return;
    if (msg.is_user && !settings.stripFromUser) return;

    const mesText = mesEl.querySelector('.mes_text');
    if (!mesText) return;

    findTopLevelBlocks(mesText).forEach(wrapElement);
}

function processAll() {
    document.querySelectorAll('.mes[mesid]').forEach(mesEl => {
        const id = parseInt(mesEl.getAttribute('mesid'), 10);
        if (!isNaN(id)) processMessageEl(id, mesEl);
    });
}

// ── Inspector Panel ───────────────────────────────────────────────────────────

let inspectorEl = null;

function buildInspector() {
    if (document.getElementById('hh-inspector')) {
        inspectorEl = document.getElementById('hh-inspector');
        return;
    }

    const panel = document.createElement('div');
    panel.id        = 'hh-inspector';
    panel.className = 'hh-inspector';
    panel.innerHTML = `
        <div class="hh-inspector-header">
            <span class="hh-inspector-title">
                <i class="fa-solid fa-code"></i>&nbsp;HTML Inspector
            </span>
            <div class="hh-inspector-actions">
                <button id="hh-insp-refresh" title="รีเฟรช">↺</button>
                <button id="hh-insp-close"   title="ปิด">✕</button>
            </div>
        </div>
        <div class="hh-inspector-body" id="hh-inspector-body">
            <div class="hh-inspector-empty">ยังไม่มี HTML block ในแชทนี้</div>
        </div>
    `;
    document.body.appendChild(panel);
    inspectorEl = panel;

    document.getElementById('hh-insp-close').addEventListener('click', () => {
        panel.classList.remove('hh-inspector-open');
    });
    document.getElementById('hh-insp-refresh').addEventListener('click', () => {
        processAll();
        refreshInspector();
    });

    makeDraggable(panel, panel.querySelector('.hh-inspector-header'));
}

function refreshInspector() {
    if (!inspectorEl || !inspectorEl.classList.contains('hh-inspector-open')) return;
    const body = document.getElementById('hh-inspector-body');
    if (!body) return;
    body.innerHTML = '';

    const wrappers = Array.from(document.querySelectorAll('[data-html-hider]'));
    if (wrappers.length === 0) {
        body.innerHTML = '<div class="hh-inspector-empty">ยังไม่มี HTML block ในแชทนี้</div>';
        return;
    }

    // Counter badge บน header
    const titleEl = inspectorEl.querySelector('.hh-inspector-title');
    if (titleEl) {
        titleEl.innerHTML = `<i class="fa-solid fa-code"></i>&nbsp;HTML Inspector` +
            `<span class="hh-inspector-count">${wrappers.length}</span>`;
    }

    wrappers.forEach((wrapper, idx) => {
        const rawHtml = wrapper.dataset.rawHtml || '';
        const tag     = getTopTag(rawHtml);
        const mesEl   = wrapper.closest('.mes[mesid]');
        const mesId   = mesEl ? mesEl.getAttribute('mesid') : '?';

        const item   = document.createElement('div');
        item.className = 'hh-inspector-item';

        const header = document.createElement('div');
        header.className = 'hh-inspector-item-header';
        header.innerHTML =
            `<span class="hh-inspector-num">#${idx + 1}</span>` +
            `<code class="hh-inspector-tag">&lt;${escHtml(tag)}&gt;</code>` +
            `<span class="hh-inspector-msg">msg&nbsp;${mesId}</span>`;

        const jumpBtn = document.createElement('button');
        jumpBtn.className   = 'hh-inspector-jump';
        jumpBtn.textContent = '↗ ไป';
        jumpBtn.title       = 'เลื่อนไปที่ block นี้';
        jumpBtn.addEventListener('click', () => {
            wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
            wrapper.classList.add('hh-flash');
            setTimeout(() => wrapper.classList.remove('hh-flash'), 1000);
        });
        header.appendChild(jumpBtn);

        const pre  = document.createElement('pre');
        const code = document.createElement('code');
        code.className   = 'hh-inspector-code';
        code.textContent = formatHtml(rawHtml);
        pre.appendChild(code);

        item.append(header, pre);
        body.appendChild(item);
    });
}

function toggleInspector() {
    buildInspector();
    inspectorEl.classList.toggle('hh-inspector-open');
    if (inspectorEl.classList.contains('hh-inspector-open')) refreshInspector();
}

// ── Draggable ─────────────────────────────────────────────────────────────────

function makeDraggable(el, handle) {
    let ox = 0, oy = 0, mx = 0, my = 0;
    handle.style.cursor = 'move';
    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        ox = e.clientX; oy = e.clientY;
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', stop);
    });
    function drag(e) {
        mx = ox - e.clientX; my = oy - e.clientY;
        ox = e.clientX;      oy = e.clientY;
        el.style.top    = (el.offsetTop  - my) + 'px';
        el.style.left   = (el.offsetLeft - mx) + 'px';
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
    }
    function stop() {
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', stop);
    }
}

// ── Context Stripping — Fetch Intercept ───────────────────────────────────────

(function interceptFetch() {
    const _fetch = window.fetch;
    window.fetch = async function(resource, init = {}) {
        if (settings.enabled && init?.body && typeof init.body === 'string') {
            try {
                const body = JSON.parse(init.body);
                if (Array.isArray(body.messages)) {
                    body.messages = body.messages.map(msg => {
                        if (!msg) return msg;
                        if (msg.role === 'user' && !settings.stripFromUser) return msg;
                        const stripped =
                            typeof msg.content === 'string'
                                ? stripHtml(msg.content)
                                : Array.isArray(msg.content)
                                    ? msg.content.map(p =>
                                        p?.type === 'text'
                                            ? { ...p, text: stripHtml(p.text) }
                                            : p
                                      )
                                    : msg.content;
                        return { ...msg, content: stripped };
                    });
                    init = { ...init, body: JSON.stringify(body) };
                }
            } catch { /* ไม่ใช่ messages payload */ }
        }
        return _fetch.call(this, resource, init);
    };
})();

if (event_types.GENERATE_BEFORE_COMBINE_PROMPTS) {
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, chat => {
        if (!settings.enabled || !Array.isArray(chat)) return;
        for (const msg of chat) {
            if (!msg) continue;
            if (msg.role === 'user' && !settings.stripFromUser) continue;
            if (typeof msg.content === 'string') msg.content = stripHtml(msg.content);
        }
    });
}

// ── ST Events ─────────────────────────────────────────────────────────────────

eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, mesId => {
    const el = document.querySelector(`.mes[mesid="${mesId}"]`);
    if (el) { processMessageEl(mesId, el); refreshInspector(); }
});

eventSource.on(event_types.CHAT_CHANGED, () => {
    setTimeout(() => { processAll(); refreshInspector(); }, 400);
});

// MutationObserver fallback
function setupObserver() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) { setTimeout(setupObserver, 500); return; }
    new MutationObserver(mutations => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (!(node instanceof Element)) continue;
                const target = node.matches?.('.mes[mesid]')
                    ? node : node.querySelector?.('.mes[mesid]');
                if (target) {
                    const id = parseInt(target.getAttribute('mesid'), 10);
                    if (!isNaN(id)) setTimeout(() => {
                        processMessageEl(id, target);
                        refreshInspector();
                    }, 150);
                }
            }
        }
    }).observe(chatEl, { childList: true });
}

// ── Init ──────────────────────────────────────────────────────────────────────

jQuery(async () => {
    // ปุ่มใน Extensions dropdown
    $('#extensionsMenuList').append(`
        <div id="hh-menu-btn"
             class="list-group-item flex-container flexGap5 interactable"
             title="เปิด HTML Inspector">
            <i class="fa-solid fa-code fa-fw"></i>
            <span>HTML Inspector</span>
        </div>
    `);
    $('#hh-menu-btn').on('click', () => {
        $('#extensionsMenuButton').trigger('click');
        setTimeout(toggleInspector, 100);
    });

    // Settings panel
    $('#extensions_settings2').append(`
        <div class="hh-settings-panel">
          <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
              <b>🙈 HTML Hider</b>
              <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
              <label class="checkbox_label">
                <input type="checkbox" id="hh_enabled" ${settings.enabled ? 'checked' : ''}>
                <span>เปิดใช้งาน HTML Hider</span>
              </label>
              <label class="checkbox_label">
                <input type="checkbox" id="hh_strip_user" ${settings.stripFromUser ? 'checked' : ''}>
                <span>ซ่อน HTML จากข้อความของ user ด้วย</span>
              </label>
              <button id="hh_open_inspector_btn" class="menu_button menu_button_icon" style="margin-top:8px;">
                <i class="fa-solid fa-code fa-fw"></i>
                <span>เปิด HTML Inspector</span>
              </button>
              <p class="hh-hint">
                HTML block ในข้อความ AI จะแสดงผลปกติ แต่ <b>ไม่ถูกส่งให้ AI</b> ในรอบถัดไป<br>
                กด <b>•••</b> บน block เพื่อดู source code
              </p>
            </div>
          </div>
        </div>
    `);

    $('#hh_enabled').on('change', function() {
        settings.enabled = this.checked; saveSettingsDebounced();
    });
    $('#hh_strip_user').on('change', function() {
        settings.stripFromUser = this.checked; saveSettingsDebounced();
    });
    $('#hh_open_inspector_btn').on('click', toggleInspector);

    buildInspector();
    setupObserver();
    if (document.querySelector('.mes[mesid]')) setTimeout(processAll, 700);

    console.log(`[${EXT_NAME}] โหลดสำเร็จ ✓`);
});

