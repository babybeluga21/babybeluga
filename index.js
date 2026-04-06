import { eventSource, event_types } from '../../../../script.js';
import { chat } from '../../../../chat.js';

// พื้นที่เก็บ HTML ที่ถูกตัดออกมา (Key: ID ของข้อความ, Value: HTML Code)
const htmlVault = {};

function initExtension() {
    // 1. สร้าง UI: ปุ่มวงกลมและหน้าต่าง Modal
    const uiHtml = `
        <div id="html-extractor-float-btn" title="ดู HTML ที่ถูกซ่อน">⚡</div>
        <div id="html-extractor-modal">
            <h3 style="margin-top:0; color:#1e40af;">เครื่องมือตรวจสอบ HTML</h3>
            <input type="text" id="html-search-input" placeholder="พิมพ์เลข Message ID เพื่อค้นหา (เช่น 12)...">
            <div id="html-result-display">ผลลัพธ์จะแสดงที่นี่...</div>
            <button id="close-html-modal" style="margin-top:15px; width:100%; padding:8px; cursor:pointer;">ปิดหน้าต่าง</button>
        </div>
    `;
    $('body').append(uiHtml);

    // 2. จัดการ Event เปิด/ปิด หน้าต่าง
    $('#html-extractor-float-btn').on('click', () => {
        $('#html-extractor-modal').fadeIn(200);
    });

    $('#close-html-modal').on('click', () => {
        $('#html-extractor-modal').fadeOut(200);
    });

    // 3. ระบบค้นหา (ไม่ต้องใช้แถบลิสต์ พิมพ์หาแล้วขึ้นเลย)
    $('#html-search-input').on('input', function() {
        const query = $(this).val().trim();
        const display = $('#html-result-display');
        
        if (!query) {
            display.text('ผลลัพธ์จะแสดงที่นี่...');
            return;
        }

        if (htmlVault[query]) {
            display.text(htmlVault[query]);
        } else {
            display.text('ไม่พบ HTML สำหรับข้อความนี้');
        }
    });

    // 4. ระบบดักจับข้อความ (Hook เข้าไปตอนบอทสร้างข้อความเสร็จ)
    eventSource.on(event_types.MESSAGE_RECEIVED, function(mesId) {
        let msg = chat[mesId];
        
        // ข้ามข้อความของ User ไป ทำเฉพาะของบอท
        if (msg.is_user) return; 

        // Regex สำหรับจับ Block HTML (ปรับแก้ได้ตามที่บอทของคุณชอบส่งมา)
        // อันนี้ตั้งไว้ให้จับโค้ดที่อยู่ในบล็อก ```html ... ``` หรือ <tag>...</tag>
        const htmlRegex = /```html\n([\s\S]*?)```|<([A-Z][A-Z0-9]*)\b[^>]*>(.*?)<\/\2>/gi;
        
        let hasHtml = false;
        let extractedBlocks = [];

        // แทนที่ HTML ด้วย "รูปลักษณ์บนจอ" (Placeholder Badge)
        let newText = msg.mes.replace(htmlRegex, (match) => {
            hasHtml = true;
            extractedBlocks.push(match);
            return `\n<span class="html-placeholder-badge">[⚙️ โค้ด HTML ถูกซ่อน - ID: ${mesId}]</span>\n`;
        });

        // ถ้าเจอ HTML ให้บันทึกลง Vault และอัปเดตข้อความในแชท
        if (hasHtml) {
            htmlVault[mesId] = extractedBlocks.join('\n\n---\n\n');
            msg.mes = newText;
            
            // สั่งให้ SillyTavern รีเฟรชข้อความนั้นบนหน้าจอใหม่
            // หมายเหตุ: อาจจะต้องใช้ DOM manipulation เพิ่มเติมหาก ST ไม่รีเฟรชให้ทันที
            $(`.mes[mesid="${mesId}"] .mes_text`).html(msg.mes); 
        }
    });
}

// เรียกใช้ Extension
jQuery(function () {
    initExtension();
});
.
