// ============================================================
//  HTML Ghost v2.1 — SillyTavern Extension
//
//  FLOW:
//  Bot message: "มีกรอบนี้ค่ะ <div class="s">HP: 80</div> ต่อไป..."
//
//  chat[idx].mes (what model sees):
//    "มีกรอบนี้ค่ะ HP: 80 ✦ghost:key✦ ต่อไป..."
//      ↑ plain text from inside HTML stays readable by model
//      ↑ ✦ghost:key✦ = invisible marker so extension knows where to inject widget
//
//  Chat DOM (what user sees):
//    "มีกรอบนี้ค่ะ " + [rendered HTML widget] + " ต่อไป..."
//
//  Extension panel:
//    Browse, edit HTML, live preview, save → DOM updates instantly
// ============================================================

(function () {
  'use strict';

  const EXT = 'HTML Ghost';

  // ── State ────────────────────────────────────────────────────
  const store     = {};   // store[msgId][storeKey] = { html, editedHtml, plainText, blockIdx }
  let panelOpen   = false;
  let searchQuery = '';
  let editTarget  = null;

  // ── Inline tags — leave untouched ───────────────────────────
  const INLINE = new Set([
    'b','i','u','em','strong','span','a','s','del','ins',
    'sup','sub','mark','small','abbr','cite','q','kbd','var',
    'samp','br','wbr','img','input','button','label'
  ]);

  // ── Extract plain text from HTML string ─────────────────────
  function htmlToPlain(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
  }

  // ── Walk & extract block-level HTML from raw message ────────
  // Returns { processed: string, blockKeys: string[] }
  // processed = original text, HTML blocks replaced by:
  //   "<plain text from inside HTML> ✦GHOST:storeKey✦"
  function extractBlocks(raw, msgId) {
    if (!store[msgId]) store[msgId] = {};
    const existing = Object.keys(store[msgId]).length;
    let counter = existing;
    let result  = '';
    let i       = 0;
    const blockKeys = [];

    while (i < raw.length) {
      const ltPos = raw.indexOf('<', i);
      if (ltPos === -1) { result += raw.slice(i); break; }

      // Copy text before tag
      result += raw.slice(i, ltPos);

      // Try parse tag name
      const tagMatch = raw.slice(ltPos).match(/^<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/);
      if (!tagMatch) {
        result += raw[ltPos];
        i = ltPos + 1;
        continue;
      }

      const tagName  = tagMatch[1].toLowerCase();
      const openStr  = tagMatch[0];

      // Leave inline tags as-is
      if (INLINE.has(tagName)) {
        result += openStr;
        i = ltPos + openStr.length;
        continue;
      }

      // Block tag — find matching close (depth-aware)
      const closeStr = `</${tagName}>`;
      let   depth    = 1;
      let   pos      = ltPos + openStr.length;

      while (depth > 0 && pos < raw.length) {
        // Look for same-name open or close tag
        const reOpen  = new RegExp(`<${tagName}[\\s>]`, 'i');
        const nextOpen = (() => {
          const m = raw.slice(pos).search(reOpen);
          return m === -1 ? -1 : pos + m;
        })();
        const nextClose = raw.toLowerCase().indexOf(closeStr.toLowerCase(), pos);

        if (nextClose === -1) { pos = raw.length; break; }

        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 1;
        } else {
          depth--;
          pos = nextClose + closeStr.length;
        }
      }

      const fullBlock = raw.slice(ltPos, pos);
      const plainText = htmlToPlain(fullBlock);
      const storeKey  = `${msgId}_${counter++}`;

      store[msgId][storeKey] = {
        html:       fullBlock,
        editedHtml: fullBlock,
        plainText:  plainText,
        blockIdx:   counter - 1,
        msgId:      parseInt(msgId),
      };
      blockKeys.push(storeKey);

      // What model sees: plain text + invisible marker
      // The marker uses a rare unicode char so it won't appear in normal prose
      result += (plainText ? plainText + ' ' : '') + `\u2B22GHOST:${storeKey}\u2B22`;
      i = pos;
    }

    return { processed: result, blockKeys };
  }

  // ── Process message before ST stores it ─────────────────────
  function processMessage(msgIdx) {
    try {
      const chat = window.chat;
      if (!chat?.[msgIdx]) return;
      const msg = chat[msgIdx];
      if (msg.is_user) return;

      const raw = msg.mes || '';
      if (!/<[a-zA-Z]/.test(raw)) return;

      const { processed, blockKeys } = extractBlocks(raw, msgIdx);
      if (blockKeys.length === 0) return;

      msg.mes = processed;   // model sees plain text + markers
      updateBadge();
    } catch(e) { console.warn(`[${EXT}]`, e); }
  }

  // ── Render: replace ⬢GHOST:key⬢ in DOM with HTML widget ─────
  function renderPlaceholders(msgIdx) {
    try {
      const mesEl = document.querySelector(
        `#chat .mes[mesid="${msgIdx}"] .mes_text`
      );
      if (!mesEl || !store[msgIdx]) return;

      const MARKER = '\u2B22GHOST:';

      // Walk text nodes
      const walker = document.createTreeWalker(mesEl, NodeFilter.SHOW_TEXT);
      const hits   = [];
      let   node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue?.includes(MARKER)) hits.push(node);
      }

      hits.forEach(tn => {
        const parts = tn.nodeValue.split(/(\u2B22GHOST:[^\u2B22]+\u2B22)/g);
        if (parts.length <= 1) return;

        const frag = document.createDocumentFragment();
        parts.forEach(part => {
          const m = part.match(/^\u2B22GHOST:([^\u2B22]+)\u2B22$/);
          if (m) {
            frag.appendChild(buildWidget(m[1], msgIdx));
          } else if (part) {
            frag.appendChild(document.createTextNode(part));
          }
        });
        tn.parentNode.replaceChild(frag, tn);
      });
    } catch(e) { console.warn(`[${EXT}] renderPlaceholders:`, e); }
  }

  // ── Build in-chat widget ─────────────────────────────────────
  function buildWidget(storeKey, msgId) {
    const entry = store[msgId]?.[storeKey];
    const wrap  = document.createElement('div');
    wrap.className    = 'hg-widget';
    wrap.dataset.key  = storeKey;
    wrap.dataset.msgi = String(msgId);

    const box = document.createElement('div');
    box.className = 'hg-widget-box';
    box.innerHTML = entry?.editedHtml
      ?? `<em style="opacity:.4">[HTML Ghost: ${storeKey}]</em>`;

    const bar = document.createElement('div');
    bar.className = 'hg-widget-bar';
    const btn = document.createElement('button');
    btn.className   = 'hg-widget-btn';
    btn.textContent = '✦';
    btn.title       = 'แก้ไข HTML block';
    btn.addEventListener('click', () => openEditor(storeKey, parseInt(msgId)));
    bar.appendChild(btn);

    wrap.appendChild(box);
    wrap.appendChild(bar);
    return wrap;
  }

  function refreshWidget(storeKey, msgId) {
    document.querySelectorAll(
      `.hg-widget[data-key="${storeKey}"][data-msgi="${msgId}"]`
    ).forEach(w => {
      const box   = w.querySelector('.hg-widget-box');
      const entry = store[msgId]?.[storeKey];
      if (box && entry) box.innerHTML = entry.editedHtml;
    });
  }

  // ── SillyTavern hooks ────────────────────────────────────────
  //
  //  CRITICAL: We ONLY read chat[idx].mes (raw bot text, before ST
  //  renders markdown→HTML). We NEVER extract from .mes_text innerHTML
  //  because that already has ST-generated <p> <em> <h1> etc.
  //
  //  Timeline:
  //    MESSAGE_RECEIVED → raw text in chat[idx].mes
  //                     → strip bot's HTML blocks, rewrite mes
  //                     → ST parses clean text + ⬡markers⬡
  //    MESSAGE_RENDERED → DOM painted → inject widgets at markers
  //    MutationObserver → ONLY inject widgets, never re-extract from DOM
  //
  function hookMessages() {
    if (window.eventSource && window.event_types) {
      const ev = window.event_types;

      // Intercept raw message before ST touches it
      eventSource.on(ev.MESSAGE_RECEIVED, idx => {
        processMessage(idx);
      });

      // Streaming done / message updated — only if not yet processed
      if (ev.MESSAGE_UPDATED) {
        eventSource.on(ev.MESSAGE_UPDATED, idx => {
          if (!store[idx]) processMessage(idx);
        });
      }

      // Inject widgets after DOM is painted
      eventSource.on(ev.MESSAGE_RENDERED, idx => {
        if (store[idx]) renderPlaceholders(idx);
      });
    }
    observeChat();
  }

  function observeChat() {
    const chatEl = document.getElementById('chat');
    if (!chatEl) { setTimeout(observeChat, 800); return; }

    new MutationObserver(muts => {
      muts.forEach(mut => {
        mut.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          const mes = node.classList?.contains('mes')
            ? node : node.querySelector?.('.mes');
          if (!mes || mes.dataset.isUser === 'true') return;

          const idx = parseInt(mes.getAttribute('mesid') ?? '-1');
          if (isNaN(idx) || idx < 0) return;

          // !! ONLY inject widgets for already-processed messages !!
          // NEVER extract from innerHTML — that's ST-rendered HTML, not bot HTML
          if (store[idx]) {
            setTimeout(() => renderPlaceholders(idx), 60);
          }
        });
      });
    }).observe(chatEl, { childList: true, subtree: true });
  }

  // ── Badge ────────────────────────────────────────────────────
  function createBadge() {
    const b = document.createElement('button');
    b.id = 'hg-badge';
    b.innerHTML = `
      <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="hg-g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stop-color="#b8e0f7"/>
            <stop offset="100%" stop-color="#c5aee8"/>
          </linearGradient>
        </defs>
        <path d="M16 1 L18.8 12.8 L31 15.5 L18.8 18.2 L16 31
                 L13.2 18.2 L1 15.5 L13.2 12.8 Z"
              fill="url(#hg-g)" stroke="rgba(255,255,255,0.18)" stroke-width="0.4"/>
      </svg>
      <span id="hg-count" class="hg-pip hg-hidden">0</span>`;
    b.title = 'HTML Ghost';
    b.addEventListener('click', togglePanel);
    document.body.appendChild(b);
  }

  function updateBadge() {
    const n  = Object.values(store)
      .reduce((a, m) => a + Object.keys(m).length, 0);
    const el = document.getElementById('hg-count');
    if (!el) return;
    el.textContent = n > 99 ? '99+' : n;
    el.classList.toggle('hg-hidden', n === 0);
    if (panelOpen) renderList();
  }

  // ── Panel ────────────────────────────────────────────────────
  function createPanel() {
    const p = document.createElement('div');
    p.id = 'hg-panel';
    p.classList.add('hg-hidden');
    p.innerHTML = `
      <div id="hg-ph">
        <div id="hg-ph-left">
          <svg width="11" height="11" viewBox="0 0 32 32">
            <path d="M16 1 L18.8 12.8 L31 15.5 L18.8 18.2 L16 31
                     L13.2 18.2 L1 15.5 L13.2 12.8 Z" fill="#a8d8ea"/>
          </svg>
          <span>HTML Ghost</span>
        </div>
        <button id="hg-x" title="ปิด">✕</button>
      </div>

      <div id="hg-search-row">
        <input id="hg-search" type="text"
               placeholder="ค้นหา tag, เนื้อหา…"
               autocomplete="off" spellcheck="false"/>
      </div>

      <div id="hg-body">
        <div id="hg-list"></div>
        <div id="hg-empty">ยังไม่มี HTML block</div>
      </div>

      <div id="hg-foot">
        <button id="hg-clear">ล้าง</button>
        <span id="hg-fc">0 block</span>
      </div>

      <!-- Editor overlay -->
      <div id="hg-ed" class="hg-hidden">
        <div id="hg-ed-hd">
          <span id="hg-ed-title">แก้ไข HTML</span>
          <button id="hg-ed-x">✕</button>
        </div>
        <div id="hg-ed-cols">
          <div class="hg-ed-pane">
            <div class="hg-pane-label">HTML</div>
            <textarea id="hg-ed-code" spellcheck="false" autocomplete="off"></textarea>
          </div>
          <div class="hg-ed-pane">
            <div class="hg-pane-label">Preview</div>
            <div id="hg-ed-prev"></div>
          </div>
        </div>
        <div id="hg-ed-ft">
          <button id="hg-ed-reset">รีเซ็ต</button>
          <div>
            <button id="hg-ed-cancel">ยกเลิก</button>
            <button id="hg-ed-save" class="hg-save-btn">✦ บันทึก</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(p);

    p.querySelector('#hg-x').addEventListener('click', togglePanel);
    p.querySelector('#hg-clear').addEventListener('click', () => {
      Object.keys(store).forEach(k => delete store[k]);
      updateBadge(); renderList();
    });
    p.querySelector('#hg-search').addEventListener('input', e => {
      searchQuery = e.target.value.toLowerCase(); renderList();
    });

    const edCode = p.querySelector('#hg-ed-code');
    const edPrev = p.querySelector('#hg-ed-prev');
    edCode.addEventListener('input', () => { edPrev.innerHTML = edCode.value; });
    p.querySelector('#hg-ed-x').addEventListener('click',      closeEditor);
    p.querySelector('#hg-ed-cancel').addEventListener('click', closeEditor);
    p.querySelector('#hg-ed-save').addEventListener('click',   saveEdit);
    p.querySelector('#hg-ed-reset').addEventListener('click',  () => {
      if (!editTarget) return;
      const e = store[editTarget.msgId]?.[editTarget.storeKey];
      if (!e) return;
      edCode.value = e.html;
      edPrev.innerHTML = e.html;
    });
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    document.getElementById('hg-panel')
      .classList.toggle('hg-hidden', !panelOpen);
    document.getElementById('hg-badge')
      .classList.toggle('hg-active', panelOpen);
    if (panelOpen) renderList();
  }

  function renderList() {
    const list  = document.getElementById('hg-list');
    const empty = document.getElementById('hg-empty');
    const fc    = document.getElementById('hg-fc');
    if (!list) return;

    const all = [];
    Object.entries(store).forEach(([mid, blocks]) => {
      Object.entries(blocks).forEach(([sk, b]) => {
        all.push({ msgId: parseInt(mid), storeKey: sk, ...b });
      });
    });
    all.sort((a, b) => b.msgId - a.msgId || a.blockIdx - b.blockIdx);

    const q  = searchQuery.trim();
    const fl = q
      ? all.filter(e =>
          e.storeKey.includes(q) ||
          e.html.toLowerCase().includes(q) ||
          e.editedHtml.toLowerCase().includes(q) ||
          e.plainText.toLowerCase().includes(q))
      : all;

    fc.textContent = `${fl.length} block`;

    if (fl.length === 0) {
      list.innerHTML = '';
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    list.innerHTML = fl.map(e => {
      const tag      = (e.html.match(/^<([a-zA-Z][a-zA-Z0-9-]*)/) || [])[1] || '?';
      const isEdited = e.html !== e.editedHtml;
      return `
        <div class="hg-entry">
          <div class="hg-entry-top">
            <code class="hg-tag-pill">&lt;${escHtml(tag)}&gt;</code>
            <span class="hg-mid-label">msg ${e.msgId} · #${e.blockIdx}</span>
            ${isEdited ? '<span class="hg-mod-pill">แก้แล้ว</span>' : ''}
            <button class="hg-edit-btn"
              data-key="${e.storeKey}" data-mid="${e.msgId}">✦ แก้ไข</button>
          </div>
          ${e.plainText
            ? `<div class="hg-plain-preview">${escHtml(e.plainText)}</div>`
            : ''}
          <div class="hg-entry-thumb">${e.editedHtml}</div>
        </div>`;
    }).join('');

    list.querySelectorAll('.hg-edit-btn').forEach(btn => {
      btn.addEventListener('click', () =>
        openEditor(btn.dataset.key, parseInt(btn.dataset.mid)));
    });
  }

  // ── Editor ───────────────────────────────────────────────────
  function openEditor(storeKey, msgId) {
    editTarget = { storeKey, msgId };
    const e = store[msgId]?.[storeKey];
    if (!e) return;

    document.getElementById('hg-ed-title').textContent =
      `แก้ไข · msg ${msgId} · block ${e.blockIdx}`;
    const code = document.getElementById('hg-ed-code');
    code.value = e.editedHtml;
    document.getElementById('hg-ed-prev').innerHTML = e.editedHtml;
    document.getElementById('hg-ed').classList.remove('hg-hidden');
  }

  function closeEditor() {
    document.getElementById('hg-ed').classList.add('hg-hidden');
    editTarget = null;
  }

  function saveEdit() {
    if (!editTarget) return;
    const { storeKey, msgId } = editTarget;
    const e = store[msgId]?.[storeKey];
    if (!e) return;
    e.editedHtml = document.getElementById('hg-ed-code').value;
    refreshWidget(storeKey, msgId);
    renderList();
    closeEditor();
  }

  function escHtml(s) {
    return s
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');
  }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    createBadge();
    createPanel();
    hookMessages();
    console.log(`[${EXT}] v2.1 ✦`);
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', init)
    : setTimeout(init, 500);
})();
