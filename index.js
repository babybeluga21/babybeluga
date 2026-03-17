// ═══════════════════════════════════════════════════════════════
//  HTML Code Manager — SillyTavern Extension
//  index.js
//
//  ระบบ:
//  1. ดักจับโค้ด HTML จาก AI response
//  2. เก็บโค้ดไว้ใน codeStore{}
//  3. แทนที่โค้ดด้วย <codeN></codeN> ใน context ที่โมเดลเห็น
//  4. แสดง marker แบบคลิกได้ในหน้า chat สำหรับ user
// ═══════════════════════════════════════════════════════════════

import {
  eventSource,
  event_types,
  saveSettingsDebounced,
} from '../../../../script.js';

import { extension_settings } from '../../../extensions.js';

// ── EXTENSION NAME ──
const EXT_NAME = 'html-code-manager';

// ── DEFAULT SETTINGS ──
const DEFAULT_SETTINGS = {
  enabled:        true,   // เปิด/ปิด extension ทั้งหมด
  replaceInCtx:   true,   // แทนที่โค้ดด้วย <codeN> ใน context
  showPreview:    true,   // แสดง rendered preview ใน popup
  numberedMarkers: true,  // ใช้ <code1>, <code2> (false = ใช้ <code> เดียว)
};

// ── CODE STORE ──
// codeStore[messageId] = [ { id, html, tokens, ts }, ... ]
let codeStore = {};
let globalCodeCounter = 0; // id สะสมข้ามทุก message

// ── SETTINGS ──
function getSettings() {
  if (!extension_settings[EXT_NAME]) {
    extension_settings[EXT_NAME] = { ...DEFAULT_SETTINGS };
  }
  return extension_settings[EXT_NAME];
}

// ══════════════════════════════════════════════════
//  CORE: EXTRACT HTML FROM TEXT
//  รองรับ 3 รูปแบบ:
//  1. ```html ... ```
//  2. ``` ... ``` (ถ้าข้างในเป็น HTML tag)
//  3. <html>...</html> block ทั้งหมด
// ══════════════════════════════════════════════════
const HTML_PATTERNS = [
  /```html\s*([\s\S]*?)```/gi,
  /```\s*(<(?:div|span|section|article|button|form|table|ul|ol|nav|header|footer|main|aside|figure|p|h[1-6]|a|img)[\s\S]*?>[\s\S]*?)\s*```/gi,
  /(<html[\s\S]*?<\/html>)/gi,
];

/**
 * ดึง HTML blocks ออกจากข้อความ
 * @param {string} text - ข้อความจาก AI
 * @returns {{ blocks: string[], cleaned: string }}
 *   blocks  = array ของ HTML string ที่ดึงออกมา
 *   cleaned = ข้อความที่ลบ HTML ออกแล้ว (ยังไม่ใส่ marker)
 */
function extractHtmlBlocks(text) {
  const blocks = [];
  let cleaned = text;

  for (const pattern of HTML_PATTERNS) {
    pattern.lastIndex = 0; // reset regex state
    cleaned = cleaned.replace(pattern, (fullMatch, capture) => {
      const html = (capture || fullMatch).trim();
      if (html && !blocks.includes(html)) {
        blocks.push(html);
      }
      return '\x00PLACEHOLDER\x00'; // ชั่วคราว ก่อนใส่ marker
    });
  }

  return { blocks, cleaned };
}

// ══════════════════════════════════════════════════
//  CORE: STORE & BUILD MARKER
// ══════════════════════════════════════════════════
/**
 * เก็บ HTML block และคืน marker string
 * @param {string} html
 * @param {string} messageId
 * @returns {{ markerId: number, markerTag: string }}
 */
function storeBlock(html, messageId) {
  const s = getSettings();
  globalCodeCounter++;
  const markerId = globalCodeCounter;

  const entry = {
    id:      markerId,
    html:    html,
    tokens:  estimateTokens(html),
    ts:      new Date().toLocaleTimeString('th-TH'),
    msgId:   messageId,
  };

  if (!codeStore[messageId]) codeStore[messageId] = [];
  codeStore[messageId].push(entry);

  const tag = s.numberedMarkers ? `code${markerId}` : 'code';
  // markerTag = สิ่งที่โมเดลจะเห็นใน context แทนโค้ดจริง
  const markerTag = `<${tag}></${tag}>`;

  return { markerId, markerTag };
}

/** ประมาณ token count (1 token ≈ 4 ตัวอักษร) */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ══════════════════════════════════════════════════
//  CORE: PROCESS MESSAGE
//  - รับ text จาก AI
//  - ดึง HTML ออก, เก็บ, ใส่ marker
//  - คืน contextText (ที่โมเดลจะเห็น) กับ displayText (user เห็น)
// ══════════════════════════════════════════════════
function processMessage(text, messageId) {
  const s = getSettings();
  if (!s.enabled) return { contextText: text, displayText: text, count: 0 };

  const { blocks, cleaned } = extractHtmlBlocks(text);
  if (blocks.length === 0) return { contextText: text, displayText: text, count: 0 };

  let contextText = cleaned; // สำหรับโมเดล (มี marker แทนโค้ด)
  let displayText = cleaned; // สำหรับ user (มี clickable marker)

  let placeholderIndex = 0;

  for (const html of blocks) {
    const { markerId, markerTag } = storeBlock(html, messageId);

    if (s.replaceInCtx) {
      // context: แทนด้วย <codeN></codeN>
      contextText = contextText.replace('\x00PLACEHOLDER\x00', markerTag);
    } else {
      contextText = contextText.replace('\x00PLACEHOLDER\x00', '');
    }

    // display: แทนด้วย clickable marker สำหรับ user
    const tag = s.numberedMarkers ? `code${markerId}` : 'code';
    const displayMarker = `<span class="hcm-marker" data-hcm-id="${markerId}" title="คลิกเพื่อดูโค้ด">📄 ${tag}</span>`;
    displayText = displayText.replace('\x00PLACEHOLDER\x00', displayMarker);
  }

  // ล้าง placeholder ที่เหลือ (ถ้ามี)
  contextText = contextText.replace(/\x00PLACEHOLDER\x00/g, '');
  displayText = displayText.replace(/\x00PLACEHOLDER\x00/g, '');

  return { contextText, displayText, count: blocks.length };
}

// ══════════════════════════════════════════════════
//  SILLYTAVERN HOOKS
// ══════════════════════════════════════════════════

/**
 * EVENT: MESSAGE_RECEIVED
 * ทำงานหลังโมเดลตอบกลับมา ก่อนแสดงผลใน chat
 */
eventSource.on(event_types.MESSAGE_RECEIVED, (/** @type {number} */ messageId) => {
  const chat = window.chat; // SillyTavern global chat array
  if (!chat || chat[messageId] === undefined) return;

  const msg = chat[messageId];
  if (!msg || msg.is_user) return; // ประมวลเฉพาะ AI message

  const originalText = msg.mes;
  const { contextText, displayText, count } = processMessage(originalText, String(messageId));

  if (count === 0) return;

  // อัปเดต msg.mes = contextText (สิ่งที่ส่งกลับเป็น context ครั้งต่อไป)
  msg.mes = contextText;

  // เก็บ displayText ไว้แยก เพื่อให้ renderer หน้า chat ใช้
  msg.extra = msg.extra || {};
  msg.extra.hcm_display = displayText;

  // บันทึก settings
  saveSettingsDebounced();

  // อัปเดต UI ของ extension
  refreshPanel();
});

/**
 * EVENT: MESSAGE_RENDERED
 * หลัง DOM render แล้ว → แทน text ใน .mes_text ด้วย display version
 */
eventSource.on(event_types.MESSAGE_RENDERED, (messageId) => {
  const chat = window.chat;
  if (!chat || !chat[messageId]) return;

  const msg = chat[messageId];
  if (!msg?.extra?.hcm_display) return;

  const mesDiv = document.querySelector(`[mesid="${messageId}"] .mes_text`);
  if (!mesDiv) return;

  // แทนที่ HTML ใน DOM (ใส่ marker ที่คลิกได้)
  mesDiv.innerHTML = msg.extra.hcm_display;

  // bind click events บน markers ใหม่ทุกครั้ง
  bindMarkerClicks(mesDiv);
});

/**
 * EVENT: CHAT_CHANGED / ล้างหน้าใหม่
 * reset counter แต่เก็บ store ไว้
 */
eventSource.on(event_types.CHAT_CHANGED, () => {
  globalCodeCounter = 0;
  codeStore = {};
  refreshPanel();
});

// ══════════════════════════════════════════════════
//  MARKER CLICK → SHOW CODE / PREVIEW
// ══════════════════════════════════════════════════
function bindMarkerClicks(container) {
  container.querySelectorAll('.hcm-marker').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(el.dataset.hcmId);
      const entry = findEntryById(id);
      if (!entry) return;

      const s = getSettings();
      if (s.showPreview) {
        showCodePopup(entry);
      } else {
        copyToClipboard(entry.html);
        showToast(`📋 code${id} copied!`);
      }
    });
  });
}

function findEntryById(id) {
  for (const msgId of Object.keys(codeStore)) {
    const found = codeStore[msgId].find(e => e.id === id);
    if (found) return found;
  }
  return null;
}

// ── CODE POPUP ──
function showCodePopup(entry) {
  // ลบ popup เก่า
  document.getElementById('hcm-popup')?.remove();

  const popup = document.createElement('div');
  popup.id = 'hcm-popup';
  popup.style.cssText = `
    position:fixed; inset:0; z-index:20000;
    background:rgba(42,74,107,0.45); backdrop-filter:blur(4px);
    display:flex; align-items:center; justify-content:center;
    font-family:'Quicksand',sans-serif;
    animation: hcm-panel-in 0.3s cubic-bezier(.34,1.56,.64,1);
  `;
  popup.innerHTML = `
    <div style="
      background:#f5fbff; border:2px solid #b8dff7;
      border-radius:20px; width:min(560px,92vw); max-height:80vh;
      display:flex; flex-direction:column;
      box-shadow:0 8px 40px rgba(90,179,232,0.3);
      overflow:hidden;
    ">
      <div style="
        background:linear-gradient(90deg,#b8dff7,#89c9f0);
        padding:12px 16px; display:flex; align-items:center; gap:10px;
      ">
        <span style="font-size:18px;">📄</span>
        <span style="font-family:'Nunito',sans-serif;font-weight:800;font-size:13px;color:#2a4a6b;flex:1;">
          &lt;code${entry.id}&gt; — ~${entry.tokens} tokens
        </span>
        <span id="hcm-popup-copy" style="
          background:white;border:1.5px solid #5ab3e8;border-radius:20px;
          padding:3px 12px;font-size:10px;font-weight:700;color:#5ab3e8;
          cursor:pointer;font-family:'Nunito',sans-serif;
        ">📋 Copy</span>
        <span id="hcm-popup-close" style="
          width:24px;height:24px;background:rgba(255,255,255,0.7);
          border:1.5px solid #5ab3e8;border-radius:50%;
          cursor:pointer;display:flex;align-items:center;justify-content:center;
          font-size:11px;font-weight:700;color:#2a4a6b;
        ">✕</span>
      </div>

      <!-- TABS: Code / Preview -->
      <div style="display:flex;background:#d6eeff;border-bottom:2px solid #b8dff7;padding:0 12px;">
        <div id="hcm-ptab-code" style="
          padding:7px 12px;font-size:11px;font-weight:700;
          color:#5ab3e8;border-bottom:2.5px solid #5ab3e8;
          cursor:pointer;font-family:'Nunito',sans-serif;margin-bottom:-2px;
        ">💻 Source</div>
        <div id="hcm-ptab-preview" style="
          padding:7px 12px;font-size:11px;font-weight:700;
          color:#9bbdd4;border-bottom:2.5px solid transparent;
          cursor:pointer;font-family:'Nunito',sans-serif;margin-bottom:-2px;
        ">✨ Preview</div>
      </div>

      <!-- Source -->
      <div id="hcm-psrc" style="padding:12px;overflow-y:auto;flex:1;">
        <pre style="
          background:#d6eeff;border-radius:10px;padding:10px 12px;
          font-family:'Courier New',monospace;font-size:10.5px;
          color:#2a4a6b;overflow-x:auto;white-space:pre-wrap;
          word-break:break-all;line-height:1.6;margin:0;
        ">${escapeHtml(entry.html)}</pre>
      </div>

      <!-- Preview -->
      <div id="hcm-pprev" style="display:none;padding:12px;overflow-y:auto;flex:1;">
        <div style="
          border:2px dashed #b8dff7;border-radius:12px;
          padding:16px;min-height:100px;
          background:white;
        ">
          ${entry.html}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  // Tab switching
  popup.querySelector('#hcm-ptab-code').addEventListener('click', () => {
    popup.querySelector('#hcm-psrc').style.display = 'block';
    popup.querySelector('#hcm-pprev').style.display = 'none';
    popup.querySelector('#hcm-ptab-code').style.color = '#5ab3e8';
    popup.querySelector('#hcm-ptab-code').style.borderBottomColor = '#5ab3e8';
    popup.querySelector('#hcm-ptab-preview').style.color = '#9bbdd4';
    popup.querySelector('#hcm-ptab-preview').style.borderBottomColor = 'transparent';
  });
  popup.querySelector('#hcm-ptab-preview').addEventListener('click', () => {
    popup.querySelector('#hcm-psrc').style.display = 'none';
    popup.querySelector('#hcm-pprev').style.display = 'block';
    popup.querySelector('#hcm-ptab-preview').style.color = '#5ab3e8';
    popup.querySelector('#hcm-ptab-preview').style.borderBottomColor = '#5ab3e8';
    popup.querySelector('#hcm-ptab-code').style.color = '#9bbdd4';
    popup.querySelector('#hcm-ptab-code').style.borderBottomColor = 'transparent';
  });

  popup.querySelector('#hcm-popup-copy').addEventListener('click', () => {
    copyToClipboard(entry.html);
    popup.querySelector('#hcm-popup-copy').textContent = '✓ Copied!';
    setTimeout(() => { popup.querySelector('#hcm-popup-copy').textContent = '📋 Copy'; }, 1500);
  });
  popup.querySelector('#hcm-popup-close').addEventListener('click', () => popup.remove());
  popup.addEventListener('click', e => { if (e.target === popup) popup.remove(); });
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

// ══════════════════════════════════════════════════
//  UI: BUILD LAUNCHER + PANEL
// ══════════════════════════════════════════════════
function buildUI() {
  // ── Launcher ──
  const launcher = document.createElement('div');
  launcher.id = 'hcm-launcher';
  launcher.innerHTML = `
    <div id="hcm-bubble">
      🌸
      <div id="hcm-notif">0</div>
    </div>
    <div id="hcm-launcher-label">Code Manager</div>
    <div id="hcm-launcher-base"></div>
  `;
  document.body.appendChild(launcher);

  // Drag
  makeDraggable(launcher, document.getElementById('hcm-bubble'));

  // Click toggle
  launcher.querySelector('#hcm-bubble').addEventListener('click', togglePanel);

  // ── Panel ──
  const panel = document.createElement('div');
  panel.id = 'hcm-panel';
  panel.innerHTML = `
    <div id="hcm-header">
      <div class="hcm-header-icon">🌸</div>
      <div class="hcm-header-text">
        <h2>HTML Code Manager</h2>
        <p>✦ SillyTavern Extension ✦</p>
      </div>
      <div id="hcm-close">✕</div>
    </div>

    <div id="hcm-tabs">
      <div class="hcm-tab hcm-active" data-tab="codes">
        🗂 Codes <span class="hcm-tab-badge" id="hcm-count-badge">0</span>
      </div>
      <div class="hcm-tab" data-tab="settings">⚙ Settings</div>
      <div class="hcm-tab" data-tab="about">✦ Info</div>
    </div>

    <div id="hcm-body">

      <!-- ── TAB: CODES ── -->
      <div class="hcm-tab-content hcm-active" id="hcm-tab-codes">

        <div class="hcm-status-bar">
          <div class="hcm-dot on" id="hcm-status-dot"></div>
          <span id="hcm-status-text">Extension active</span>
        </div>

        <div class="hcm-stats-row">
          <div class="hcm-stat-chip">
            <div class="val" id="hcm-stat-total">0</div>
            <div class="lbl">Total</div>
          </div>
          <div class="hcm-stat-chip">
            <div class="val" id="hcm-stat-tokens">~0</div>
            <div class="lbl">Tokens saved</div>
          </div>
        </div>

        <div class="hcm-section-label">✦ Captured Blocks</div>
        <div id="hcm-code-list"></div>

        <div class="hcm-btn-row" style="margin-top:4px;">
          <button class="hcm-btn hcm-btn-secondary" id="hcm-btn-clear" style="flex:1">🗑 Clear</button>
          <button class="hcm-btn hcm-btn-primary" id="hcm-btn-export" style="flex:1">⬇ Export</button>
        </div>
      </div>

      <!-- ── TAB: SETTINGS ── -->
      <div class="hcm-tab-content" id="hcm-tab-settings">

        <div class="hcm-section-label">✦ General</div>

        <div class="hcm-toggle-row">
          <div>
            <div class="hcm-toggle-info">🔍 Auto-detect HTML</div>
            <div class="hcm-toggle-sub">Capture HTML blocks from AI messages</div>
          </div>
          <label class="hcm-toggle">
            <input type="checkbox" id="hcm-set-enabled">
            <span class="hcm-toggle-slider"></span>
          </label>
        </div>

        <div class="hcm-toggle-row">
          <div>
            <div class="hcm-toggle-info">🔁 Replace in context</div>
            <div class="hcm-toggle-sub">Swap code with &lt;codeN&gt; in model memory</div>
          </div>
          <label class="hcm-toggle">
            <input type="checkbox" id="hcm-set-replace">
            <span class="hcm-toggle-slider"></span>
          </label>
        </div>

        <div class="hcm-toggle-row">
          <div>
            <div class="hcm-toggle-info">👁 Show preview popup</div>
            <div class="hcm-toggle-sub">Click marker → render HTML popup</div>
          </div>
          <label class="hcm-toggle">
            <input type="checkbox" id="hcm-set-preview">
            <span class="hcm-toggle-slider"></span>
          </label>
        </div>

        <div class="hcm-toggle-row">
          <div>
            <div class="hcm-toggle-info">🔢 Numbered markers</div>
            <div class="hcm-toggle-sub">Use &lt;code1&gt;, &lt;code2&gt; for multiple blocks</div>
          </div>
          <label class="hcm-toggle">
            <input type="checkbox" id="hcm-set-numbered">
            <span class="hcm-toggle-slider"></span>
          </label>
        </div>

        <div class="hcm-section-label" style="margin-top:4px;">✦ Manual Store</div>
        <div class="hcm-field-group">
          <div class="hcm-field-label">Paste HTML block</div>
          <textarea id="hcm-manual-input" placeholder="<div>...</div>"></textarea>
        </div>
        <button class="hcm-btn hcm-btn-primary" id="hcm-btn-manual">＋ Store Block</button>
      </div>

      <!-- ── TAB: ABOUT ── -->
      <div class="hcm-tab-content" id="hcm-tab-about">
        <div class="hcm-section-label">✦ How it works</div>
        <div class="hcm-alert" style="background:linear-gradient(90deg,#f0f8ff,#e8f6ff);border-color:#b8dff7;color:#2a4a6b;">
          ℹ️
          <span style="line-height:1.6;">
            Extension นี้ดักจับโค้ด HTML จาก AI response แล้วเก็บไว้ใน store
            ใน context ที่โมเดลเห็น จะแสดงแค่ <b>&lt;code1&gt;&lt;/code1&gt;</b>
            แทนโค้ดทั้งหมด ช่วยประหยัด token ได้มาก
          </span>
        </div>
        <div class="hcm-section-label">✦ Marker format</div>
        <div style="background:#d6eeff;border-radius:10px;padding:10px 12px;font-family:'Courier New',monospace;font-size:11px;color:#2a4a6b;line-height:2;">
          AI sees: <b>&lt;code1&gt;&lt;/code1&gt;</b><br>
          You see: <span class="hcm-marker">📄 code1</span><br>
          Multiple: <b>&lt;code1&gt;</b>, <b>&lt;code2&gt;</b>, ...
        </div>
        <div class="hcm-alert">
          ⭐ Detects: <b>```html...```</b> blocks and <b>&lt;html&gt;...&lt;/html&gt;</b> tags automatically.
        </div>
      </div>

    </div>
  `;
  document.body.appendChild(panel);

  // ── Event Bindings ──
  document.getElementById('hcm-close').addEventListener('click', togglePanel);

  // Tabs
  panel.querySelectorAll('.hcm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      panel.querySelectorAll('.hcm-tab').forEach(t => t.classList.remove('hcm-active'));
      panel.querySelectorAll('.hcm-tab-content').forEach(t => t.classList.remove('hcm-active'));
      tab.classList.add('hcm-active');
      document.getElementById(`hcm-tab-${tab.dataset.tab}`).classList.add('hcm-active');
    });
  });

  // Settings toggles
  const settingMap = {
    'hcm-set-enabled':  'enabled',
    'hcm-set-replace':  'replaceInCtx',
    'hcm-set-preview':  'showPreview',
    'hcm-set-numbered': 'numberedMarkers',
  };
  Object.entries(settingMap).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    el.checked = getSettings()[key];
    el.addEventListener('change', () => {
      getSettings()[key] = el.checked;
      saveSettingsDebounced();
      updateStatusBar();
    });
  });

  // Buttons
  document.getElementById('hcm-btn-clear').addEventListener('click', () => {
    codeStore = {};
    globalCodeCounter = 0;
    refreshPanel();
  });
  document.getElementById('hcm-btn-export').addEventListener('click', exportCodes);
  document.getElementById('hcm-btn-manual').addEventListener('click', () => {
    const val = document.getElementByI
