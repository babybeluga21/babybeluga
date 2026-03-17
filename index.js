import { getContext, eventSource, event_types } from '../../../extensions.js';

const MODULE_NAME = 'cute-html-extractor';
const context = getContext();

let extractedStore = new Map(); // เก็บ HTML ตาม message id

// ====================== ระบบดึง HTML + ประหยัด Token ======================
function extractHTML(message) {
  let text = message.mes || '';
  const htmlBlocks = [];
  
  // ดักโค้ด HTML (ทั้ง raw และ fenced) ให้ครอบคลุมภาพทุกแบบ
  const regex = /(<(?:div|span|table|img|button|form|iframe|svg|canvas)[^>]*>[\s\S]*?<\/\w+>)|```html\s*([\s\S]*?)\s*```/gi;
  
  let match;
  let index = 0;
  
  while ((match = regex.exec(text)) !== null) {
    const fullBlock = match[0];
    const cleanHtml = match[1] || match[2] || fullBlock;
    
    htmlBlocks.push(cleanHtml.trim());
    
    // แทนที่ด้วย <code> ตามที่ต้องการ (middle เป็นตัวเลขล้วนๆ)
    const placeholder = `<code class="st-html-placeholder" data-index="\( {index}"> \){index + 1}</code>`;
    text = text.replace(fullBlock, placeholder);
    
    index++;
  }
  
  if (htmlBlocks.length > 0) {
    message.mes = text;                    // ประวัติสั้นลง = Token 节省
    message.extractedHtml = htmlBlocks;    // เก็บโค้ดจริง
    extractedStore.set(message.mesid || Date.now(), htmlBlocks);
  }
}

// ====================== แสดงผลในแชท (แทนที่ <code> ด้วย HTML จริง) ======================
eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (message) => {
  if (!message.extractedHtml || message.extractedHtml.length === 0) return;
  
  const mesElement = document.querySelector(`.mes[mesid="${message.mesid}"]`) ||
                     document.querySelector(`[data-message-id="${message.mesid}"]`);
  
  if (!mesElement) return;
  
  const placeholders = mesElement.querySelectorAll('code.st-html-placeholder');
  
  placeholders.forEach((code) => {
    const idx = parseInt(code.getAttribute('data-index'));
    const html = message.extractedHtml[idx];
    if (html) {
      const sanitized = SillyTavern.libs.DOMPurify.sanitize(html);
      code.outerHTML = sanitized;   // แสดงผลน่ารักตามภาพเลย!
    }
  });
});

// ====================== ดักตอน AI ตอบ ======================
eventSource.on(event_types.MESSAGE_RECEIVED, (message) => {
  if (message.is_user) return;
  extractHTML(message);
});

// ====================== ปุ่มลอยน่ารัก (ขยับได้ + ฐาน) ======================
eventSource.on(event_types.APP_READY, () => {
  // ปุ่มหลัก (ดาว + สมุด)
  const btn = document.createElement('div');
  btn.id = 'cute-html-button';
  btn.innerHTML = '⭐📖';
  document.body.appendChild(btn);

  // ลากได้
  let isDragging = false;
  let offsetX, offsetY;
  
  btn.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - btn.getBoundingClientRect().left;
    offsetY = e.clientY - btn.getBoundingClientRect().top;
    btn.style.cursor = 'grabbing';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    btn.style.right = 'auto';
    btn.style.left = `${e.clientX - offsetX}px`;
    btn.style.bottom = 'auto';
    btn.style.top = `${e.clientY - offsetY}px`;
  });
  
  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    btn.style.cursor = 'grab';
    
    // ฐานหยุด (ดึงกลับขวาแบบน่ารัก)
    btn.style.transition = 'all 0.4s';
    btn.style.left = 'auto';
    btn.style.right = '30px';
    btn.style.top = 'auto';
    btn.style.bottom = '120px';
    setTimeout(() => btn.style.transition = 'all 0.3s', 400);
  });

  // คลิกเปิด Panel
  btn.addEventListener('click', togglePanel);
});

// ====================== Panel ภายใน (ดัดแปลงจากภาพทั้ง 5 ภาพ) ======================
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
      <div class="widget-list" id="widget-list">
        <!-- รายการจะโผล่ตรงนี้ -->
      </div>
      <div style="text-align:center; margin-top:15px; font-size:12px; color:#81c3f7;">
        ปุ่มลอยขยับได้ • สีขาวฟ้า • น่ารักเหมือน Love & Deepspace
      </div>
    `;
    document.body.appendChild(panel);
  }
  
  const list = document.getElementById('widget-list');
  list.innerHTML = '';
  
  // แสดง widgets ที่มีในแชทปัจจุบัน (น่ารักแบบ image 1+5)
  context.chat.forEach(msg => {
    if (msg.extractedHtml && msg.extractedHtml.length > 0) {
      const div = document.createElement('div');
      div.style.cssText = 'background:#fff; padding:10px; margin:8px 0; border-radius:12px; border:2px solid #81c3f7;';
      div.innerHTML = `
        <strong>Widget ${msg.extractedHtml.length} ชิ้น</strong><br>
        <small style="color:#666;">ถูกแทนที่ด้วย <code>1</code> <code>2</code> ... แล้ว</small>
      `;
      list.appendChild(div);
    }
  });
  
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
}
