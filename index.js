// ====================== ปุ่มลอยน่ารัก แบบลูกแก้ว (กลางจอชั่วคราว + glassmorphism) ======================
eventSource.on(event_types.APP_READY, () => {
  // Inject CSS ก่อน (อัปเดตใหม่ทั้งหมด)
  if (!document.getElementById('cute-html-style')) {
    const style = document.createElement('style');
    style.id = 'cute-html-style';
    style.textContent = `
      :root {
        --bg: rgba(248, 252, 255, 0.75);
        --accent: #81c3f7;
        --accent-dark: #4a9cd6;
        --glass-border: 1px solid rgba(129, 195, 247, 0.4);
        --glass-shadow: 0 12px 40px rgba(129, 195, 247, 0.35),
                        inset 0 2px 10px rgba(255,255,255,0.6);
        --blur: blur(12px);
      }

      #cute-html-button {
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 90px;
        height: 90px;
        background: var(--bg);
        border: var(--glass-border);
        border-radius: 50%;
        box-shadow: var(--glass-shadow);
        backdrop-filter: var(--blur);
        -webkit-backdrop-filter: var(--blur);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 42px;
        cursor: grab;
        z-index: 99999;
        transition: all 0.35s ease;
        user-select: none;
        color: var(--accent-dark);
      }

      #cute-html-button:hover {
        transform: translate(-50%, -50%) scale(1.18);
        box-shadow: 0 20px 60px rgba(129, 195, 247, 0.5),
                    inset 0 4px 15px rgba(255,255,255,0.8);
      }

      #cute-html-button:active {
        transform: translate(-50%, -50%) scale(0.95);
      }

      #cute-html-panel {
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: 420px;
        max-height: 80vh;
        background: var(--bg);
        border: 2px solid rgba(129, 195, 247, 0.5);
        border-radius: 24px;
        box-shadow: var(--glass-shadow);
        backdrop-filter: var(--blur);
        -webkit-backdrop-filter: var(--blur);
        padding: 24px;
        display: none;
        z-index: 99998;
        font-family: "Comic Sans MS", cursive, sans-serif;
        color: #333;
        overflow-y: auto;
      }

      #cute-html-panel::before {
        content: "✨ Our Cute Widgets ✨";
        display: block;
        text-align: center;
        font-size: 26px;
        color: var(--accent-dark);
        margin-bottom: 18px;
        text-shadow: 0 2px 6px rgba(74,156,214,0.3);
      }

      .widget-list {
        max-height: 420px;
        overflow-y: auto;
        background: rgba(255,255,255,0.4);
        border-radius: 16px;
        padding: 12px;
      }

      .widget-item {
        background: rgba(255,255,255,0.6);
        padding: 12px 16px;
        margin: 10px 0;
        border-radius: 14px;
        border: 1px solid rgba(129,195,247,0.3);
      }
    `;
    document.head.appendChild(style);
  }

  // สร้างปุ่มลูกแก้ว
  const btn = document.createElement('div');
  btn.id = 'cute-html-button';
  btn.innerHTML = '🌟📖';   // หรือจะเปลี่ยนเป็น '💎✨' ก็ได้
  document.body.appendChild(btn);

  // ลากย้ายได้ (ตอนนี้เริ่มจากกลางจอ)
  let isDragging = false;
  let offsetX, offsetY;

  btn.addEventListener('mousedown', e => {
    isDragging = true;
    const rect = btn.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    btn.style.cursor = 'grabbing';
    btn.style.transition = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    btn.style.left = `${e.clientX - offsetX}px`;
    btn.style.top = `${e.clientY - offsetY}px`;
    btn.style.transform = 'none';  // ปิด translate ชั่วคราวตอนลาก
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    btn.style.cursor = 'grab';
    btn.style.transition = 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)'; // เด้งน่ารัก
    // ไม่ snap กลับกลางแล้ว → ให้อยู่ที่ปล่อยมือ
    // ถ้าอยาก snap กลับกลาง ให้ uncomment ด้านล่าง
    // btn.style.left = '50%';
    // btn.style.top = '50%';
    // btn.style.transform = 'translate(-50%, -50%)';
  });

  btn.addEventListener('click', togglePanel);
});

// Panel ยังเหมือนเดิม แต่ปรับให้อยู่กลางจอด้วย (ตอนแรก)
function togglePanel() {
  let panel = document.getElementById('cute-html-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'cute-html-panel';
    panel.innerHTML = `
      <div style="text-align:center; margin-bottom:20px;">
        <h2 style="color:#4a9cd6; font-size:28px; margin:0;">Our Cute Widgets ✨</h2>
        <p style="color:#555; font-size:15px; margin:8px 0 0;">HTML ถูกเก็บไว้แล้ว → ประหยัด Token!</p>
      </div>
      <div class="widget-list" id="widget-list"></div>
      <div style="text-align:center; margin-top:20px; font-size:13px; color:#81c3f7;">
        ลูกแก้วขาวฟ้า • ลากได้ • น่ารักเหมือนในเกม
      </div>
    `;
    document.body.appendChild(panel);
  }

  const list = document.getElementById('widget-list');
  list.innerHTML = '';

  context.chat.forEach((msg, i) => {
    if (msg.extractedHtml?.length > 0) {
      const item = document.createElement('div');
      item.className = 'widget-item';
      item.innerHTML = `
        <strong>💬 ข้อความ ${i+1} • ${msg.extractedHtml.length} ชิ้น</strong><br>
        <small style="color:#666;">แทนที่ด้วย <code>1</code> <code>2</code> ...</small>
      `;
      list.appendChild(item);
    }
  });

  // Toggle แสดง/ซ่อน
  panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
}
