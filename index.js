import { extension_settings, getContext } from "../../../extensions.js";
import { eventSource, event_types } from "../../../../script.js";

const extensionName = "html-stripper-renderer";

// สร้างพื้นที่เก็บข้อมูลถ้ายังไม่มี
if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = {
        savedData: {} // เก็บข้อมูลจำพวก id -> { html: "...", date: "..." }
    };
}

// 1. ระบบตรวจเช็คการเขียน HTML เบื้องต้น
function validateHTML(htmlString) {
    if (!htmlString) return false;
    // สร้างตัวจำลองเพื่อเช็คว่าโค้ดพังไหม
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, "text/html");
    const errorNode = doc.querySelector('parsererror');
    if (errorNode) {
        return { valid: false, message: "พบข้อผิดพลาดในโครงสร้าง HTML" };
    }
    return { valid: true, message: "โครงสร้างปกติ" };
}

// 2. สร้าง UI 🌀 และหน้าต่างตั้งค่า
function setupUI() {
    // เพิ่มปุ่ม 🌀 ใน Extensions Menu (สมมติว่าเป็น div#extensions_menu)
    const iconHtml = `<div id="html-stripper-btn" title="ตั้งค่า HTML Stripper">🌀</div>`;
    $('#extensions_menu').append(iconHtml);

    const modalHtml = `
        <div id="html-stripper-modal">
            <h3>🌀 HTML Stripper & Checker</h3>
            
            <button class="stripper-accordion">ข้อมูล Extension (กดเพื่อดู)</button>
            <div class="stripper-panel">
                <p>ระบบทำการตัด HTML ออกจากโมเดล บันทึก [วันที่] และ Render เฉพาะบนจอเท่านั้น</p>
            </div>

            <div id="html-status-log" style="margin-top: 15px; font-size: 0.9em; color: #ffcc00;">
                รอการตรวจสอบโค้ด...
            </div>
            
            <button id="close-html-modal" style="margin-top: 20px; padding: 5px 10px; background: #555; border: none; color: white; cursor: pointer; border-radius: 4px;">ปิดหน้าต่าง</button>
        </div>
    `;
    $('body').append(modalHtml);

    // Event ใช้งานปุ่มต่างๆ
    $('#html-stripper-btn').on('click', () => $('#html-stripper-modal').fadeIn(200));
    $('#close-html-modal').on('click', () => $('#html-stripper-modal').fadeOut(200));

    // ระบบทำงานของ Accordion (ซ่อน/แสดง Description)
    $('.stripper-accordion').on('click', function() {
        this.classList.toggle("active");
        var panel = this.nextElementSibling;
        if (panel.style.maxHeight) {
            panel.style.maxHeight = null;
        } else {
            panel.style.maxHeight = panel.scrollHeight + "px";
        } 
    });
}

// 3. ฟังก์ชันหลักสำหรับประมวลผลข้อความก่อนส่ง
function processOutgoingMessage(text, messageId) {
    // ดึงวันที่ที่อยู่ในรูปแบบ [ วัน เดือน ปี ]
    const dateRegex = /\[(.*?)\]/g;
    let extractedDates = [];
    let match;
    while ((match = dateRegex.exec(text)) !== null) {
        extractedDates.push(match[1]); // เก็บค่าข้างในวงเล็บ
    }

    // ดึง HTML โค้ดทั้งหมดออกมา
    const htmlRegex = /<[^>]*>?/gm;
    const htmlBlocks = text.match(htmlRegex);
    let extractedHtml = htmlBlocks ? htmlBlocks.join('\n') : "";

    // บันทึกข้อมูลเข้า Storage
    if (extractedHtml || extractedDates.length > 0) {
        extension_settings[extensionName].savedData[messageId] = {
            html: extractedHtml,
            dates: extractedDates,
            isValid: validateHTML(extractedHtml)
        };
        
        // อัปเดตสถานะในหน้าตั้งค่า
        if(extractedHtml) {
            const status = extension_settings[extensionName].savedData[messageId].isValid;
            $('#html-status-log').text(`ตรวจสอบล่าสุด: ${status.valid ? 'ผ่าน ✔️' : 'ไม่ผ่าน ❌'} (${status.message})`);
        }
    }

    // ตัด HTML ออกจากข้อความ (เหลือแค่ Text เพียวๆ ส่งให้โมเดล)
    let cleanText = text.replace(htmlRegex, '').trim();
    return cleanText;
}

// 4. ผูก Event Hooks ของ SillyTavern
jQuery(async () => {
    setupUI();

    // ตัวอย่างการดักจับตอนกดส่งข้อความ (ประยุกต์ใช้ตาม API ของ ST เวอร์ชั่นที่คุณใช้)
    // สำหรับการตัด HTML ก่อนเข้า Prompt
    eventSource.on(event_types.MESSAGE_SENT, (messageId) => {
        const context = getContext();
        let messageElement = context.chat.find(m => m.uid === messageId);
        
        if (messageElement && messageElement.mes) {
            // ประมวลผลและเปลี่ยนข้อความที่โมเดลจะเห็นให้สะอาด
            messageElement.mes = processOutgoingMessage(messageElement.mes, messageId);
        }
    });

    // แสดงผล HTML ที่แอบเก็บไว้บนจอ (ฝั่งข้อความยูเซอร์ .mes[is_user='true'] หรือฝั่งบอท)
    eventSource.on(event_types.MESSAGE_RECEIVED, (messageId) => {
        const savedData = extension_settings[extensionName].savedData[messageId];
        
        if (savedData && savedData.html) {
            // เล็งไปที่กรอบข้อความนั้นๆ แล้วยัดโค้ด HTML ลงไปเพื่อให้มัน Render
            const msgDOM = $(`.mes[mesid="${messageId}"] .mes_text`);
            msgDOM.append(`<div class="rendered-html-layer">${savedData.html}</div>`);
            
            // หมายเหตุ: การแสดงผลขึ้นอยู่กับโครงสร้าง DOM ของคุณ คุณสามารถใช้ prepend() เพื่อให้อยู่ด้านหน้าสุดได้
        }
    });
});
