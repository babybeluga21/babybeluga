/**
 * ST HTML Hider
 * Renders HTML blocks from AI messages visually,
 * but strips them before sending to the AI model.
 */

'use strict';

import { eventSource, event_types } from '../../../../script.js';
import { extension_settings, getContext, saveSettingsDebounced } from '../../../extensions.js';

const EXT_NAME = 'st-html-hider';
const SETTINGS_KEY = 'html_hider';

// ── Settings ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  enabled: true,
  stripFromUser: false,
};

if (!extension_settings[SETTINGS_KEY]) {
  extension_settings[SETTINGS_KEY] = { ...DEFAULT_SETTINGS };
}
const settings = extension_settings[SETTINGS_KEY];

// ── HTML Detection ────────────────────────────────────────────────────────────

// Block-level HTML tags we intercept
const BLOCK_TAGS = [
  'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
  'table', 'thead', 'tbody', 'tfoot',
  'ul', 'ol',
  'figure', 'form', 'details', 'blockquote', 'canvas', 'svg',
];

// CSS selector for direct block-level children inside .mes_text
const CHILD_BLOCK_SELECTOR = BLOCK_TAGS.map(t => `:scope > ${t}`).join(',');

// Regex for stripping HTML from raw text (used in fetch intercept)
const HTML_STRIP_RE = new RegExp(
  `<(?:${BLOCK_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:${BLOCK_TAGS.join('|')})>`,
  'gi',
);

function stripHtml(text) {
  if (typeof text !== 'string') return text;
  return text.replace(HTML_STRIP_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Source Formatter ──────────────────────────────────────────────────────────

function formatHtml(html) {
  let out = '';
  let depth = 0;
  const SELF_CLOSING = /^<(?:br|hr|input|img|meta|link|area|base|col|embed|param|source|track|wbr)/i;
  const parts = html
    .replace(/>\s*</g, '>\n<')   // newline between adjacent tags
    .split('\n');

  for (const raw of parts) {
    const line = raw.trim();
    if (!line) continue;

    const isClose   = /^<\//.test(line);
    const isOpen    = /^<[^/!]/.test(line) && !SELF_CLOSING.test(line) && !line.endsWith('/>');
    const isSingle  = !isOpen || line.endsWith('/>') || SELF_CLOSING.test(line);

    if (isClose) depth = Math.max(0, depth - 1);
    out += '  '.repeat(depth) + line + '\n';
    if (isOpen && !isClose) depth++;
  }
  return out.trim();
}

// ── DOM Wrapping ──────────────────────────────────────────────────────────────

function wrapElement(el) {
  // Skip if already inside a wrapper
  if (el.closest('[data-html-hider]')) return;

  const rawHtml = el.outerHTML;

  // ── Build DOM structure ──
  const wrapper = document.createElement('div');
  wrapper.className = 'hh-wrapper';
  wrapper.dataset.htmlHider = 'true';

  // Rendered visual area
  const renderedBox = document.createElement('div');
  renderedBox.className = 'hh-rendered';

  // Source code panel (hidden by default)
  const sourcePanel = document.createElement('div');
  sourcePanel.className = 'hh-source-panel';
  sourcePanel.hidden = true;

  const pre  = document.createElement('pre');
  const code = document.createElement('code');
  code.className = 'hh-code';
  code.textContent = formatHtml(rawHtml);
  pre.appendChild(code);
  sourcePanel.appendChild(pre);

  // Footer bar
  const footer = document.createElement('div');
  footer.className = 'hh-footer';

  // ••• toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'hh-toggle-btn';
  toggleBtn.title = 'Inspect HTML source code';
  toggleBtn.innerHTML = `
    <span class="hh-dots">•••</span>
    <span class="hh-lbl">HTML Source</span>
    <span class="hh-chevron">▸</span>
  `;
  toggleBtn.addEventListener('click', () => {
    sourcePanel.hidden = !sourcePanel.hidden;
    toggleBtn.querySelector('.hh-chevron').textContent =
      sourcePanel.hidden ? '▸' : '▾';
    wrapper.classList.toggle('hh-open', !sourcePanel.hidden);
  });

  // "Hidden from AI" badge
  const badge = document.createElement('span');
  badge.className = 'hh-badge';
  badge.title = 'This HTML block is NOT sent to the AI model';
  badge.textContent = '🙈 Hidden from AI';

  footer.append(toggleBtn, badge);

  // Assemble: move el inside wrapper, then append footer + sourcePanel
  el.before(wrapper);
  renderedBox.appendChild(el);
  wrapper.append(renderedBox, footer, sourcePanel);
}

// ── Message Processing ────────────────────────────────────────────────────────

function processMessageEl(mesId, mesEl) {
  if (!settings.enabled) return;

  const ctx = getContext();
  const msg = ctx.chat?.[mesId];
  if (!msg) return;
  if (msg.is_user && !settings.stripFromUser) return;

  const mesText = mesEl.querySelector('.mes_text');
  if (!mesText) return;

  // Wrap each direct block-level child
  mesText.querySelectorAll(CHILD_BLOCK_SELECTOR).forEach(wrapElement);
}

function processAll() {
  document.querySelectorAll('.mes[mesid]').forEach(mesEl => {
    const id = parseInt(mesEl.getAttribute('mesid'), 10);
    if (!isNaN(id)) processMessageEl(id, mesEl);
  });
}

// ── Context Stripping — Fetch Intercept ───────────────────────────────────────
// Strips HTML blocks from the outgoing messages[] payload before it reaches
// the AI API. The original chat save file is left untouched.

(function interceptFetch() {
  const _fetch = window.fetch;

  window.fetch = async function (resource, init = {}) {
    if (settings.enabled && init.body && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);

        if (Array.isArray(body.messages)) {
          body.messages = body.messages.map(msg => {
            if (!msg) return msg;

            // Skip user messages if setting is off
            if (msg.role === 'user' && !settings.stripFromUser) return msg;

            const stripped = typeof msg.content === 'string'
              ? stripHtml(msg.content)
              : Array.isArray(msg.content)
                ? msg.content.map(p =>
                    p?.type === 'text' ? { ...p, text: stripHtml(p.text) } : p
                  )
                : msg.content;

            return { ...msg, content: stripped };
          });

          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // Not a JSON messages payload — pass through unchanged
      }
    }

    return _fetch.call(this, resource, init);
  };
})();

// ── Context Stripping — ST Event Fallback ─────────────────────────────────────
// Catches non-OpenAI backends that go through SillyTavern's own pipeline

eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, (chat) => {
  if (!settings.enabled || !Array.isArray(chat)) return;

  for (const msg of chat) {
    if (!msg) continue;
    if (msg.role === 'user' && !settings.stripFromUser) continue;

    // OpenAI-style content field
    if (typeof msg.content === 'string') {
      msg.content = stripHtml(msg.content);
    }
  }
});

// ── Event Hooks ───────────────────────────────────────────────────────────────

// Process newly rendered AI messages
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesId) => {
  const mesEl = document.querySelector(`.mes[mesid="${mesId}"]`);
  if (mesEl) processMessageEl(mesId, mesEl);
});

// Re-process on chat load / switch
eventSource.on(event_types.CHAT_CHANGED, () => {
  setTimeout(processAll, 400);
});

// ── Settings Panel ────────────────────────────────────────────────────────────

jQuery(async () => {
  const html = `
    <div class="hh-settings-panel">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>🙈 HTML Hider</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">

          <label class="checkbox_label" title="Toggle the extension on or off">
            <input type="checkbox" id="hh_enabled" ${settings.enabled ? 'checked' : ''}>
            <span>Enable HTML Hider</span>
          </label>

          <label class="checkbox_label" title="Also strip HTML from your own messages before sending">
            <input type="checkbox" id="hh_strip_user" ${settings.stripFromUser ? 'checked' : ''}>
            <span>Strip HTML from user messages too</span>
          </label>

          <p class="hh-hint">
            HTML blocks in AI messages are rendered visually in chat,
            but are <strong>not sent to the AI</strong>.
            Click <strong>••• HTML Source</strong> on any block to inspect its code.
          </p>

        </div>
      </div>
    </div>
  `;

  $('#extensions_settings2').append(html);

  $('#hh_enabled').on('change', function () {
    settings.enabled = this.checked;
    saveSettingsDebounced();
  });

  $('#hh_strip_user').on('change', function () {
    settings.stripFromUser = this.checked;
    saveSettingsDebounced();
  });

  // Catch any messages already rendered on load
  if (document.querySelector('.mes[mesid]')) {
    setTimeout(processAll, 600);
  }

  console.log(`[${EXT_NAME}] loaded ✓`);
});

