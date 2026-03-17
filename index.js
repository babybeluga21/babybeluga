import { getContext, eventSource, event_types } from '../../../extensions.js';

const MODULE_NAME = 'cute-html-extractor';
const context = getContext();

let extractedStore = new Map(); // เก็บสำรอง (optional)

// ====================== ระบบดึง HTML + ประหยัด Token (แก้ไขแล้ว) ======================
function extractHTML(message) {
  let text = message.mes || '';
  const htmlBlocks = [];

  const regex = /(<(?:div|span|table|img|button|form|iframe|svg|canvas)[^>]*>[\s\S]*?<\/\w+>)|```html\s*([\s\S]*?)\s*```/gi;

  const cleanedText = text.replace(regex, (fullMatch, inlineHtml, fencedHtml) => {
    const cleanHtml = (inlineHtml || fencedHtml || fullMatch).trim();
    htmlBlocks.push(cleanHtml);

    const index = htmlBlocks.length - 1;
    return `<code class="st-html-placeholder" data-index="\( {index}"> \){index + 1}</code>`;
  });

  if (htmlBlocks.length > 0) {
    message.mes = cleanedText;                    // สั้นลง = Token เยอะขึ้น!
    message.extractedHtml = htmlBlocks;
    extractedStore.set(message.mesid || Date.now(), htmlBlocks);
    console.log(`[${MODULE_NAME}] Extracted ${htmlBlocks.length} HTML block(s)`);
  }
}

// ====================== แสดงผล HTML จริง (หลัง render) ======================
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (chatIndex) => {
  const message = context.chat[chatIndex];
  if (!message?.extractedHtml?.length) return;

  const mesElement = document.querySelector(`.mes[mesid="${message.mesid}"]`) ||
                     document.querySelector(`[data-message-id="${message.mesid}"]`);
  if (!mesElement) return;

  const placeholders = mesElement.querySelectorAll('code.st-html-placeholder');

  placeholders.forEach((codeEl) => {
    const idx = parseInt(codeEl.getAttribute('data-index'), 10);
    const html = message.extractedHtml[idx];
    if (html) {
      const sanitized = SillyTavern.libs.DOMPurify.sanitize(html);
      codeEl.outerHTML = sanitized;   // แทนที่ด้วย widget น่ารักเลย!
    }
  });
});

// ====================== ดัก AI ตอบ (แก้ payload เป็น index แล้ว) ======================
eventSource.on(event_types.MESSAGE_RECEIVED, (chatIndex) => {
  const message = context.chat[chatIndex];
  if (!message || message.is_user) return;
  extractHTML(message);
});

// ====================== ปุ่มลอยน่ารัก + CSS (ขาวฟ้าเหมือน Love & Deepspace) ======================
eventSource.on(event_types.APP_READY, () => {
  // Inject CSS ก่อน
  if (!document.getElementById('cute-html-style')) {
    const style = document.createElement('style');
    style.id = 'cute-html-style';
    style.textContent = `
      :root {
        --bg: #f8fcff;
        --accent: #81c3f7;
        --accent-dark: #4a9cd6;
        --shadow: 0 8px 20px rgba(129, 195, 247, 0.3);
      }
      #cute-html-button {
        position: fixed; right: 30px; bottom: 120px;
        width: 58px; height: 58px;
        background: var(--bg); border: 4px solid var(--accent);
        border-radius: 50%; box-shadow: var(--shadow);
        display: flex; align-items: center; justify-content: center;
        font-size: 32px; cursor: grab; z-index: 99999;
        transition: all 0.3s; user-select: none;
      }
      #cute-html-button:hover { transform: scale(1.15); box-shadow: 0 12px 30px rgba(129,195,247,0.5); }
      #cute-html-panel {
        position: fixed; right: 30px; bottom: 200px; width: 380px;
        background: var(--bg); border: 6px solid var(--accent);
        border-radius: 20px; box-shadow: var(--shadow); padding: 20px;
        display: none; z-index: 99998; font-family: "Comic Sans MS", cursive; color: #333;
      }
      #cute-html-panel::before {
        content: "📖 Our Cute Widgets 📖"; display: block; text-align: center;
        font-size: 22px; color: var(--accent-dark); margin-bottom: 15px;
        text-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      .widget-list { max-height: 300px; overflow-y: auto; background: #fff; border-radius: 12px; padding: 10px; }
    `;
    document.head.appendChild(style);
  }

  // ปุ่มลอย ⭐📖
  const btn = document.createElement('div');
  btn.id = 'cute-html-button';
  btn.innerHTML = '⭐📖';
  document.body.appendChild(btn);

  // ลากได้ + กลับฐานน่ารัก
  let isDragging = false, offsetX, offsetY;
  btn.addEventListener('mousedown', e => {
    isDragging = true;
    offsetX = e.clientX - btn.getBoundingClientRect().left;
    offsetY = e.clientY - btn.getBoundingClientRect().top;
    btn.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    btn.style.left = `${e.clientX - offsetX}px`;
    btn.style.top = `${e.clientY - offsetY}px`;
    btn.style.right = 'auto'; btn.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    btn.style.cursor = 'grab';
    btn.style.transition = 'all 0.4s';
    btn.style.left = 'auto'; btn.style.right = '30px';
    btn.style.top = 'auto'; btn.style.bottom = '120px';
    setTimeout(() => btn.style.transition = 'all 0.3s', 400);
  });

  btn.addEventListener('click', togglePanel);
});

// ====================== Panel น่ารัก (ดัดแปลงจากภาพ notebook + schedule) ======================
function togglePanel() {
  let panel = document.getElementById('cute-html-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'cute-html-panel';
    panel.innerHTML = `
      <div style="text-align:center; margin-bottom:15px;">
        <h2 style="color:#4a9cd6; font-size:24px;">Our Cute Widgets ✨</h2>
        <p style="color:#666; font-size:14px;">HTML ถูกดึงออกแล้ว → Token เยอะขึ้น!</p>
      </div>
      <div class="widget-list" id="widget-list"></div>
      <div style="text-align:center; margin-top:15px; font-size:12px; color:#81c3f7;">
        ปุ่มลอยขยับได้ • สีขาวฟ้า • น่ารักเหมือน Love & Deepspace
      </div>
    `;
    document.body.appendChild(panel);
  }

  const list = document.getElementById('widget-list');
  list.innerHTML = '';

  context.chat.forEach((msg, i) => {
    if (msg.extractedHtml?.length > 0) {
      const div = document.createElement('div');
      div.style.cssText = 'background:#fff; padding:12px; margin:8px 0; border-radius:12px; border:2px solid #81c3f7; box-shadow:0 2px 8px rgba(129,195,247,0.2);';
      div.innerHTML = `
        <strong>💬 Message ${i} • ${msg.extractedHtml.length} ชิ้น</strong><br>
        <small style="color:#666;">ถูกแทนที่ด้วย <code>1</code> <code>2</code> ... แล้ว</small>
      `;
      list.appendChild(div);
    }
  });

  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
}
