// ============================================================
//  HTML Ghost v2 — SillyTavern Extension
//
//  Syntax that bots should use:
//    <code:N>
//      [HTML lines — displayed in chat, NOT sent to model]
//      [plain text lines — sent to model as context]
//    </code:N>
//
//  Behaviour:
//  • Extracts every <code:N>…</code:N> from bot messages
//  • Renders HTML in-place in the chat (sandboxed div)
//  • Sends only the plain-text lines back to the model
//  • Stores all blocks → searchable + live-editable via panel
//  • Edits update the rendered HTML instantly in chat
// ============================================================

(function () {
  'use strict';

  const EXT_NAME = 'HTML Ghost v2';

  /* ── State ──────────────────────────────────────────────── */
  // store[codeId] = { codeId, mesIdx, blockKey, charName, ts, rawHtml, plainText }
  const store = {};
  let panelOpen    = false;
  let searchQuery  = '';
  let activeEditId = null;

  /* ═══════════════════════════════════════════════════════════
     PARSING
  ═══════════════════════════════════════════════════════════ */

  // Matches <code:KEY>…</code:KEY>  (KEY = alphanumeric / _ / -)
  function makeCodeRe() {
    return /<code:([a-zA-Z0-9_-]+)>([\s\S]*?)<\/code:\1>/gi;
  }

  /**
   * Split inner block content into:
   *   html      — lines that look like HTML (for display)
   *   plainText — everything else (for model context)
   *
   * Heuristic: a line is "HTML" if it contains an HTML tag.
   * If no plain text found, assume the whole inner is HTML.
   */
  function separateContent(inner) {
    const lines     = inner.split('\n');
    const htmlLines = [];
    const txtLines  = [];

    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (/<\/?[a-zA-Z][^>]*>/.test(t)) {
        htmlLines.push(line);
      } else {
        txtLines.push(line);
      }
    }

    return {
      html:      htmlLines.join('\n') || inner,
      plainText: txtLines.join('\n'),
    };
  }

  /**
   * Process a raw message string.
   * Returns:
   *   modelText  — only plain text; what goes to the LLM
   *   blocks     — [{ key, html, plainText, fullMatch }]
   */
  function parseMessage(raw) {
    const re     = makeCodeRe();
    const blocks = [];
    let   modelText = raw;
    let   match;

    while ((match = re.exec(raw)) !== null) {
      const key       = match[1];
      const inner     = match[2];
      const fullMatch = match[0];
      const { html, plainText } = separateContent(inner);

      blocks.push({ key, html, plainText, fullMatch });

      // Model sees only plain text
      modelText = modelText.replace(fullMatch, plainText.trim());
    }

    return { modelText, blocks };
  }

  /* ═══════════════════════════════════════════════════════════
     SILLYTAVERN HOOKS
  ═══════════════════════════════════════════════════════════ */

  function hookST() {
    if (!window.eventSource || !window.event_types) {
      setTimeout(hookST, 600);
      return;
    }
    const ev = window.event_types;

    // Step 1: intercept BEFORE model sees it
    eventSource.on(ev.MESSAGE_RECEIVED, onMessageReceived);

    // Step 2: inject rendered HTML after DOM update
    eventSource.on(ev.MESSAGE_RENDERED, onMessageRendered);

    // Step 3: MutationObserver fallback (streaming / history load)
    observeChat();

    console.log(`[${EXT_NAME}] ✦ ready`);
  }

  /* Called when a new bot message lands in chat[] */
  function onMessageReceived(idx) {
    try {
      const chat = window.chat;
      if (!chat?.[idx] || chat[idx].is_user) return;

      const msg = chat[idx];
      const raw = msg.mes || '';

      const re = makeCodeRe();
      if (!re.test(raw)) return;   // nothing to parse

      const { modelText, blocks } = parseMessage(raw);

      // Save blocks
      for (const b of blocks) {
        const codeId = `${idx}_${b.key}`;
        store[codeId] = {
          codeId,
          mesIdx:    idx,
          blockKey:  b.key,
          charName:  msg.name || 'Bot',
          ts:        nowStr(),
          rawHtml:   b.html,
          plainText: b.plainText,
        };
      }

      // What the model will receive next turn: plain text only
      msg.mes = modelText;

      // Tag so onMessageRendered knows to patch this message
      msg._hg_blocks = blocks.map(b => b.key);

      updateBadge();
    } catch (e) {
      console.warn(`[${EXT_NAME}] onMessageReceived:`, e);
    }
  }

  /* Called after ST updates the DOM for message idx */
  function onMessageRendered(idx) {
    try {
      const mesEl = document.querySelector(`#chat .mes[mesid="${idx}"]`);
      if (!mesEl) return;

      const textEl = mesEl.querySelector('.mes_text');
      if (!textEl) return;

      const chat = window.chat;
      const msg  = chat?.[idx];

      // ── Case A: we processed this message in onMessageReceived ──
      if (msg?._hg_blocks?.length) {
        // Insert render widgets at the end of the message text
        for (const key of msg._hg_blocks) {
          const codeId = `${idx}_${key}`;
          const entry  = store[codeId];
          if (!entry) continue;
          // Only inject if not already there
          if (!textEl.querySelector(`.hg-render-wrap[data-id="${codeId}"]`)) {
            textEl.appendChild(buildRenderEl(entry));
          }
        }
        return;
      }

      // ── Case B: raw <code:N> tags slipped into the DOM ──
      const html = textEl.innerHTML;
      if (!makeCodeRe().test(html)) return;

      const { modelText, blocks } = parseMessage(html);

      // Replace the DOM content with plain text
      textEl.innerHTML = escHtml(modelText);

      for (const b of blocks) {
        const codeId = `${idx}_${b.key}`;
        if (!store[codeId]) {
          store[codeId] = {
            codeId, mesIdx: idx, blockKey: b.key,
            charName: '', ts: nowStr(),
            rawHtml: b.html, plainText: b.plainText,
          };
        }
        textEl.appendChild(buildRenderEl(store[codeId]));
      }
      updateBadge();
    } catch (e) {
      console.warn(`[${EXT_NAME}] onMessageRendered:`, e);
    }
  }

  /* MutationObserver: catches messages added outside of events */
  function observeChat() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) { setTimeout(observeChat, 700); return; }

    new MutationObserver(muts => {
      for (const mut of muts) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;
          const mes = node.classList?.contains('mes') ? node : node.querySelector?.('.mes');
          if (!mes || mes.dataset.isUser === 'true') continue;
          const idx = parseInt(mes.getAttribute('mesid') ?? '-1');
          if (idx < 0) continue;
          setTimeout(() => onMessageRendered(idx), 120);
        }
      }
    }).observe(chatEl, { childList: true, subtree: true });
  }

  /* ═══════════════════════════════════════════════════════════
     RENDER WIDGET (in-chat)
  ═══════════════════════════════════════════════════════════ */

  function buildRenderEl(entry) {
    const wrap = document.createElement('div');
    wrap.className  = 'hg-render-wrap';
    wrap.dataset.id = entry.codeId;

    // ── Label bar ──
    wrap.innerHTML = `
      <div class="hg-render-bar">
        <span class="hg-render-label">
          <svg width="10" height="10" viewBox="0 0 32 32" fill="none" style="vertical-align:middle;margin-right:4px">
            <path d="M16 2 L18.5 13.5 L30 16 L18.5 18.5 L16 30 L13.5 18.5 L2 16 L13.5 13.5 Z"
                  fill="url(#hgr-${escAttr(entry.codeId)})"/>
            <defs>
              <linearGradient id="hgr-${escAttr(entry.codeId)}" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#a8d8ea"/>
                <stop offset="100%" stop-color="#c9b8e8"/>
              </linearGradient>
            </defs>
          </svg>
          <code class="hg-render-key">${escHtml(entry.blockKey)}</code>
        </span>
        <button class="hg-render-edit-btn" data-id="${escAttr(entry.codeId)}">แก้ไข</button>
      </div>
      <div class="hg-render-content" data-id="${escAttr(entry.codeId)}"></div>
    `;

    // Set HTML content safely
    wrap.querySelector('.hg-render-content').innerHTML = entry.rawHtml;

    wrap.querySelector('.hg-render-edit-btn').addEventListener('click', () => {
      openPanelOnEntry(entry.codeId);
    });

    return wrap;
  }

  /* ═══════════════════════════════════════════════════════════
     PANEL
  ═══════════════════════════════════════════════════════════ */

  function createBadge() {
    const btn = document.createElement('button');
    btn.id    = 'hg-badge';
    btn.title = 'HTML Ghost';
    btn.innerHTML = `
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 2 L18.5 13.5 L30 16 L18.5 18.5 L16 30 L13.5 18.5 L2 16 L13.5 13.5 Z"
              fill="url(#hg-badge-g)" stroke="rgba(255,255,255,0.2)" stroke-width="0.5"/>
        <defs>
          <linearGradient id="hg-badge-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#a8d8ea"/>
            <stop offset="100%" stop-color="#d4a8ea"/>
          </linearGradient>
        </defs>
      </svg>
      <span id="hg-badge-count" class="hg-hidden">0</span>
    `;
    btn.addEventListener('click', () => togglePanel());
    document.body.appendChild(btn);
  }

  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'hg-panel';
    panel.className = 'hg-hidden';
    panel.innerHTML = `
      <div id="hg-panel-header">
        <span id="hg-panel-title">
          <svg width="12" height="12" viewBox="0 0 32 32" fill="none" style="vertical-align:middle;margin-right:5px">
            <path d="M16 2 L18.5 13.5 L30 16 L18.5 18.5 L16 30 L13.5 18.5 L2 16 L13.5 13.5 Z"
                  fill="url(#hg-ph)"/>
            <defs>
              <linearGradient id="hg-ph" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#a8d8ea"/>
                <stop offset="100%" stop-color="#d4a8ea"/>
              </linearGradient>
            </defs>
          </svg>HTML Ghost
        </span>
        <button id="hg-close">✕</button>
      </div>

      <div id="hg-search-wrap">
        <input id="hg-search" type="text"
               placeholder="ค้นหา key, ชื่อ, HTML, ข้อความ…"
               autocomplete="off" spellcheck="false"/>
      </div>

      <div id="hg-panel-body">

        <!-- LIST VIEW -->
        <div id="hg-list-view">
          <div id="hg-list"></div>
          <div id="hg-empty">ยังไม่มี code block</div>
        </div>

        <!-- EDIT VIEW -->
        <div id="hg-edit-view" class="hg-hidden">
          <div id="hg-edit-topbar">
            <button id="hg-back">← กลับ</button>
            <span id="hg-edit-title"></span>
          </div>
          <div class="hg-section-label">Preview</div>
          <div id="hg-edit-preview"></div>
          <div class="hg-section-label">HTML</div>
          <textarea id="hg-edit-textarea" spellcheck="false"></textarea>
          <div id="hg-edit-btns">
            <button id="hg-apply-btn">✓ Apply</button>
            <button id="hg-reset-btn">↺ Reset</button>
          </div>
        </div>

      </div>

      <div id="hg-panel-footer">
        <button id="hg-clear-btn">ล้าง log</button>
        <span id="hg-footer-count">0 blocks</span>
      </div>
    `;
    document.body.appendChild(panel);

    // Events
    panel.querySelector('#hg-close').addEventListener('click', () => togglePanel(false));
    panel.querySelector('#hg-back').addEventListener('click', showList);
    panel.querySelector('#hg-search').addEventListener('input', e => {
      searchQuery = e.target.value.toLowerCase();
      renderList();
    });
    panel.querySelector('#hg-clear-btn').addEventListener('click', () => {
      Object.keys(store).forEach(k => delete store[k]);
      updateBadge();
      renderList();
    });
    panel.querySelector('#hg-edit-textarea').addEventListener('input', e => {
      panel.querySelector('#hg-edit-preview').innerHTML = e.target.value;
    });
    panel.querySelector('#hg-apply-btn').addEventListener('click', applyEdit);
    panel.querySelector('#hg-reset-btn').addEventListener('click', () => {
      if (!activeEditId || !store[activeEditId]) return;
      const ta  = document.getElementById('hg-edit-textarea');
      const pre = document.getElementById('hg-edit-preview');
      ta.value  = store[activeEditId].rawHtml;
      pre.innerHTML = store[activeEditId].rawHtml;
    });
  }

  /* ── Toggle panel ───────────────────────────────────────── */
  function togglePanel(force) {
    panelOpen = force !== undefined ? force : !panelOpen;
    const panel = document.getElementById('hg-panel');
    const badge = document.getElementById('hg-badge');
    if (panelOpen) {
      panel.classList.remove('hg-hidden');
      badge.classList.add('hg-active');
      showList();
    } else {
      panel.classList.add('hg-hidden');
      badge.classList.remove('hg-active');
    }
  }

  function openPanelOnEntry(codeId) {
    panelOpen = true;
    document.getElementById('hg-panel').classList.remove('hg-hidden');
    document.getElementById('hg-badge').classList.add('hg-active');
    renderList();
    showEdit(codeId);
  }

  /* ── List view ──────────────────────────────────────────── */
  function showList() {
    document.getElementById('hg-list-view').classList.remove('hg-hidden');
    document.getElementById('hg-edit-view').classList.add('hg-hidden');
    activeEditId = null;
    renderList();
  }

  function renderList() {
    const listEl  = document.getElementById('hg-list');
    const emptyEl = document.getElementById('hg-empty');
    const countEl = document.getElementById('hg-footer-count');
    if (!listEl) return;

    const entries  = Object.values(store);
    const q        = searchQuery.trim();
    const filtered = q
      ? entries.filter(e =>
          e.blockKey.toLowerCase().includes(q) ||
          e.charName.toLowerCase().includes(q) ||
          e.rawHtml.toLowerCase().includes(q) ||
          e.plainText.toLowerCase().includes(q)
        )
      : entries;

    filtered.sort((a, b) => b.mesIdx - a.mesIdx);

    countEl.textContent = `${filtered.length} block${filtered.length !== 1 ? 's' : ''}`;
    emptyEl.style.display = filtered.length ? 'none' : 'block';

    listEl.innerHTML = filtered.map(e => `
      <div class="hg-entry">
        <div class="hg-entry-meta">
          <span class="hg-char">${escHtml(e.charName)}</span>
          <code class="hg-block-key">${escHtml(e.blockKey)}</code>
          <span class="hg-ts">${e.ts}</span>
        </div>
        ${e.plainText
          ? `<div class="hg-plain-preview">${escHtml(e.plainText.slice(0,100))}${e.plainText.length>100?'…':''}</div>`
          : ''}
        <div class="hg-entry-btns">
          <button class="hg-edit-btn" data-id="${escAttr(e.codeId)}">แก้ไข HTML</button>
          <button class="hg-goto-btn" data-idx="${e.mesIdx}">↗ แชท</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.hg-edit-btn').forEach(b =>
      b.addEventListener('click', () => showEdit(b.dataset.id))
    );
    listEl.querySelectorAll('.hg-goto-btn').forEach(b =>
      b.addEventListener('click', () => {
        const el = document.querySelector(`#chat .mes[mesid="${b.dataset.idx}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        togglePanel(false);
      })
    );
  }

  /* ── Edit view ──────────────────────────────────────────── */
  function showEdit(codeId) {
    activeEditId = codeId;
    const entry  = store[codeId];
    if (!entry) return;

    document.getElementById('hg-list-view').classList.add('hg-hidden');
    document.getElementById('hg-edit-view').classList.remove('hg-hidden');
    document.getElementById('hg-edit-title').textContent = `block "${entry.blockKey}"`;
    document.getElementById('hg-edit-textarea').value    = entry.rawHtml;
    document.getElementById('hg-edit-preview').innerHTML = entry.rawHtml;
  }

  function applyEdit() {
    if (!activeEditId || !store[activeEditId]) return;
    const newHtml = document.getElementById('hg-edit-textarea').value;
    store[activeEditId].rawHtml = newHtml;

    // Update every in-chat render for this block
    document.querySelectorAll(`.hg-render-content[data-id="${activeEditId}"]`)
      .forEach(el => { el.innerHTML = newHtml; });

    const btn = document.getElementById('hg-apply-btn');
    btn.textContent = '✓ Applied!';
    setTimeout(() => { btn.textContent = '✓ Apply'; }, 1400);
  }

  /* ── Badge ──────────────────────────────────────────────── */
  function updateBadge() {
    const el = document.getElementById('hg-badge-count');
    if (!el) return;
    const n = Object.keys(store).length;
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('hg-hidden', n === 0);
  }

  /* ── Utils ──────────────────────────────────────────────── */
  function nowStr() {
    return new Date().toLocaleTimeString('th-TH', { hour12: false });
  }
  function escHtml(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(s) { return escHtml(s); }

  /* ═══════════════════════════════════════════════════════════
     BOOT
  ═══════════════════════════════════════════════════════════ */
  function init() {
    createBadge();
    createPanel();
    hookST();
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : setTimeout(init, 500);

})();
