// ============================================================
//  HTML Ghost — SillyTavern Extension
//  Strips HTML from bot messages; logs removed tags for review
// ============================================================

(function () {
  'use strict';

  /* ── Constants ─────────────────────────────────────────── */
  const EXT_NAME   = 'HTML Ghost';
  const STORE_KEY  = 'htmlghost_log';
  const MAX_LOG    = 200;          // max entries kept in memory

  /* ── State ──────────────────────────────────────────────── */
  let log = [];          // { id, ts, char, raw, stripped, tags }
  let panelOpen = false;
  let searchQuery = '';

  /* ── Helpers ────────────────────────────────────────────── */
  function stripHtml(html) {
    // Collect every tag removed
    const tags = [];
    const tagRe = /<\/?[a-zA-Z][^>]*>/g;
    let match;
    while ((match = tagRe.exec(html)) !== null) {
      tags.push(match[0]);
    }
    // Decode entities and strip tags
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || '';
    return { text, tags };
  }

  function timestamp() {
    return new Date().toLocaleTimeString('th-TH', { hour12: false });
  }

  function addEntry(entry) {
    log.unshift(entry);
    if (log.length > MAX_LOG) log.pop();
  }

  /* ── Hook into SillyTavern message rendering ────────────── */
  // SillyTavern fires this event after a message is added to the chat
  // We patch the message text node before it renders
  function hookMessages() {
    // Primary hook: MESSAGE_RENDERED event
    if (window.eventSource && window.event_types) {
      const ev = window.event_types;

      // After message received — strip HTML in the message object itself
      eventSource.on(ev.MESSAGE_RECEIVED, (/** @type {number} */ idx) => {
        processMessage(idx);
      });

      // Also handle on render for safety
      eventSource.on(ev.MESSAGE_RENDERED, (/** @type {number} */ idx) => {
        processRenderedMessage(idx);
      });
    }

    // Fallback: MutationObserver on chat area
    observeChat();
  }

  function processMessage(idx) {
    try {
      const chat = window.chat;
      if (!chat || !chat[idx]) return;
      const msg = chat[idx];
      if (msg.is_user) return;                    // only bot messages

      const raw = msg.mes || '';
      const { text, tags } = stripHtml(raw);

      if (tags.length === 0) return;              // nothing to strip

      // Mutate the message in place (SillyTavern re-renders from chat[])
      msg.mes = text;

      addEntry({
        id:       idx,
        ts:       timestamp(),
        char:     msg.name || 'Bot',
        raw:      raw,
        stripped: text,
        tags:     tags,
      });

      updateBadge();
    } catch (e) {
      console.warn(`[${EXT_NAME}] processMessage error:`, e);
    }
  }

  function processRenderedMessage(idx) {
    // Catch anything that slipped through (e.g. loaded history)
    try {
      const el = document.querySelector(`#chat .mes[mesid="${idx}"] .mes_text`);
      if (!el) return;
      const html = el.innerHTML;
      const { text, tags } = stripHtml(html);
      if (tags.length === 0) return;

      el.textContent = text;          // replace with plain text

      // Only log if not already logged
      if (!log.find(e => e.id === idx)) {
        addEntry({
          id:       idx,
          ts:       timestamp(),
          char:     '',
          raw:      html,
          stripped: text,
          tags:     tags,
        });
        updateBadge();
      }
    } catch (e) {
      console.warn(`[${EXT_NAME}] processRenderedMessage error:`, e);
    }
  }

  function observeChat() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) {
      setTimeout(observeChat, 800);
      return;
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mut) => {
        mut.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          const mesEl = node.classList?.contains('mes') ? node
            : node.querySelector?.('.mes');
          if (!mesEl) return;
          if (mesEl.dataset.isUser === 'true') return;

          const textEl = mesEl.querySelector('.mes_text');
          if (!textEl) return;

          const html = textEl.innerHTML;
          const { text, tags } = stripHtml(html);
          if (tags.length === 0) return;

          textEl.textContent = text;

          const idx = parseInt(mesEl.getAttribute('mesid') || '-1');
          if (!log.find(e => e.id === idx)) {
            addEntry({
              id:       idx,
              ts:       timestamp(),
              char:     mesEl.querySelector('.name_text')?.textContent || 'Bot',
              raw:      html,
              stripped: text,
              tags:     tags,
            });
            updateBadge();
          }
        });
      });
    });

    observer.observe(chatEl, { childList: true, subtree: true });
  }

  /* ── Badge (floating icon) ──────────────────────────────── */
  function createBadge() {
    const btn = document.createElement('button');
    btn.id = 'hg-badge';
    btn.innerHTML = `
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" fill="none">
        <path d="M16 2 L18.5 13.5 L30 16 L18.5 18.5 L16 30 L13.5 18.5 L2 16 L13.5 13.5 Z"
              fill="url(#hg-grad)" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
        <defs>
          <linearGradient id="hg-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#a8d8ea"/>
            <stop offset="100%" stop-color="#d4a8ea"/>
          </linearGradient>
        </defs>
      </svg>
      <span id="hg-badge-count" class="hg-hidden">0</span>
    `;
    btn.title = 'HTML Ghost — คลิกดู log';
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);
  }

  function updateBadge() {
    const count = document.getElementById('hg-badge-count');
    if (!count) return;
    if (log.length > 0) {
      count.textContent = log.length > 99 ? '99+' : log.length;
      count.classList.remove('hg-hidden');
    } else {
      count.classList.add('hg-hidden');
    }
  }

  /* ── Panel ──────────────────────────────────────────────── */
  function createPanel() {
    const panel = document.createElement('div');
    panel.id = 'hg-panel';
    panel.classList.add('hg-hidden');
    panel.innerHTML = `
      <div id="hg-panel-header">
        <span id="hg-panel-title">
          <svg width="14" height="14" viewBox="0 0 32 32" fill="none" style="vertical-align:middle;margin-right:6px">
            <path d="M16 2 L18.5 13.5 L30 16 L18.5 18.5 L16 30 L13.5 18.5 L2 16 L13.5 13.5 Z"
                  fill="url(#hg-grad2)"/>
            <defs>
              <linearGradient id="hg-grad2" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#a8d8ea"/>
                <stop offset="100%" stop-color="#d4a8ea"/>
              </linearGradient>
            </defs>
          </svg>HTML Ghost
        </span>
        <button id="hg-close" title="ปิด">✕</button>
      </div>

      <div id="hg-search-wrap">
        <input id="hg-search" type="text" placeholder="ค้นหา tag, ชื่อ, ข้อความ…" autocomplete="off" spellcheck="false"/>
      </div>

      <div id="hg-list-wrap">
        <div id="hg-list"></div>
        <div id="hg-empty">ยังไม่มี HTML ถูกตัดออก</div>
      </div>

      <div id="hg-panel-footer">
        <button id="hg-clear-btn">ล้าง log</button>
        <span id="hg-footer-count">0 รายการ</span>
      </div>
    `;

    document.body.appendChild(panel);

    document.getElementById('hg-close').addEventListener('click', togglePanel);
    document.getElementById('hg-search').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderList();
    });
    document.getElementById('hg-clear-btn').addEventListener('click', () => {
      log = [];
      updateBadge();
      renderList();
    });
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    const panel = document.getElementById('hg-panel');
    const badge = document.getElementById('hg-badge');
    if (panelOpen) {
      panel.classList.remove('hg-hidden');
      panel.classList.add('hg-visible');
      badge.classList.add('hg-active');
      renderList();
    } else {
      panel.classList.add('hg-hidden');
      panel.classList.remove('hg-visible');
      badge.classList.remove('hg-active');
    }
  }

  function renderList() {
    const listEl  = document.getElementById('hg-list');
    const emptyEl = document.getElementById('hg-empty');
    const countEl = document.getElementById('hg-footer-count');
    if (!listEl) return;

    const q = searchQuery.trim();
    const filtered = q
      ? log.filter(e =>
          e.char.toLowerCase().includes(q) ||
          e.raw.toLowerCase().includes(q) ||
          e.tags.some(t => t.toLowerCase().includes(q)) ||
          e.stripped.toLowerCase().includes(q)
        )
      : log;

    countEl.textContent = `${filtered.length} รายการ`;

    if (filtered.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.style.display = 'none';

    listEl.innerHTML = filtered.map(e => `
      <div class="hg-entry" data-id="${e.id}">
        <div class="hg-entry-meta">
          <span class="hg-char">${escHtml(e.char)}</span>
          <span class="hg-ts">${e.ts}</span>
          <span class="hg-tag-count">${e.tags.length} tag${e.tags.length > 1 ? 's' : ''}</span>
        </div>
        <div class="hg-tags">
          ${e.tags.slice(0, 10).map(t => `<code class="hg-tag">${escHtml(t.length > 40 ? t.slice(0,40)+'…' : t)}</code>`).join('')}
          ${e.tags.length > 10 ? `<code class="hg-tag hg-tag-more">+${e.tags.length - 10} more</code>` : ''}
        </div>
        <details class="hg-details">
          <summary>ดู raw HTML</summary>
          <pre class="hg-raw">${escHtml(e.raw)}</pre>
        </details>
      </div>
    `).join('');
  }

  function escHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Init ───────────────────────────────────────────────── */
  function init() {
    createBadge();
    createPanel();
    hookMessages();
    console.log(`[${EXT_NAME}] loaded ✦`);
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);   // give ST a moment to boot
  }

})();
