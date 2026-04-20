import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types } from '../../../../script.js';

// กำหนดชื่อ Extension และที่เก็บข้อมูล
const extensionName = 'html-hider-ext';
const defaultSettings = {
    storedHtml: {} // เก็บข้อมูลรูปแบบ: { "chatId_messageId": "<html>...</html>" }
};

// โหลดตั้งค่า (ช่วยเซฟข้อมูลลงไฟล์ settings.json ของ ST)
async function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    Object.assign(extension_settings[extensionName], defaultSettings, extension_settings[extensionName]);
}

// 1. ฟังก์ชันแยกและตัด HTML ออกจากข้อความ (ก่อนส่ง/ก่อนเซฟ)
function extractAndStripHTML(text, messageId, chatId) {
    const htmlRegex = /<[^>]*>?/gm; // Regex ดัก HTML เบื้องต้น (ปรับแก้ให้ตรงกับรูปแบบโค้ดคุณได้)
    const matches = text.match(htmlRegex);
    
    if (matches) {
        const fullHtml = matches.join('\n');
        const key = `${chatId}_${messageId}`;
        
        // เก็บ HTML ไว้ใน Extension Settings
        extension_settings[extensionName].storedHtml[key] = fullHtml;
        
        // ตัด HTML ออกจากข้อความที่จะส่งให้ AI
        return text.replace(htmlRegex, '').trim();
    }
    return text;
}

// 2. ฟังก์ชันแสดงผล HTML กลับขึ้นไปบนหน้าจอ (Visual Only)
function injectVisualHTML() {
    const context = getContext();
    const chatId = context.chatId;

    // หา Message blocks ทั้งหมดที่แสดงอยู่บนจอ
    $('.mes').each(function () {
        const mesId = $(this).attr('mesid');
        const key = `${chatId}_${mesId}`;
        const storedCode = extension_settings[extensionName].storedHtml[key];

        // ถ้ามีโค้ดเก็บไว้ และยังไม่ได้แสดงผล ให้แทรกเข้าไป
        if (storedCode && $(this).find('.injected-html-container').length === 0) {
            const container = $(`<div class="injected-html-container"></div>`).html(storedCode);
            $(this).find('.mes_text').append(container); // เอาไปต่อท้ายข้อความ
        }
    });
}

// 3. ฟังก์ชันเพิ่มปุ่มในเมนู ••• และระบบตรวจเช็คโค้ด
function addContextMenuButton() {
    // ใช้ MutationObserver หรือ Event เพื่อจับตอนที่ Message ถูกเรนเดอร์
    $('.mes_buttons').each(function () {
        if ($(this).find('.check-html-btn').length === 0) {
            // สร้างปุ่มใหม่
            const btn = $('<div class="mes_button check-html-btn" title="ตรวจสอบโค้ด HTML">🔍</div>');
            
            btn.on('click', function () {
                const mesId = $(this).closest('.mes').attr('mesid');
                const context = getContext();
                const key = `${context.chatId}_${mesId}`;
                const storedCode = extension_settings[extensionName].storedHtml[key];

                if (storedCode) {
                    // ระบบตรวจเช็คโค้ด (คุณสามารถเขียน Logic ตรวจ Syntax เชิงลึกตรงนี้ได้)
                    console.log(`[HTML Checker] โค้ดของข้อความ ${mesId}:`, storedCode);
                    
                    // ตัวอย่างแสดงแจ้งเตือน (สามารถเปลี่ยนเป็น Popup/Modal สวยๆ ได้)
                    alert(`พบโค้ด HTML ที่ถูกซ่อนไว้:\n\n${storedCode}`);
                } else {
                    alert('ไม่มีโค้ด HTML ซ่อนอยู่ในข้อความนี้');
                }
            });

            // แทรกปุ่มลงไปในกลุ่มเครื่องมือ
            $(this).prepend(btn);
        }
    });
}

// ฟังก์ชันเริ่มต้น (Init)
jQuery(async () => {
    await loadSettings();

    // ดักจับตอนโหลดแชท หรือมีการเพิ่มข้อความใหม่
    eventSource.on(event_types.CHAT_CHANGED, () => {
        injectVisualHTML();
        addContextMenuButton();
    });
    
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        injectVisualHTML();
        addContextMenuButton();
    });

    // หมายเหตุ: สำหรับการดักจับ "ก่อน" ส่งให้ AI แบบสมบูรณ์
    // ใน SillyTavern อาจต้องไป Hook ที่ event_types.BEFORE_PROMPT_SETUP หรือดัดแปลง chat array
    // แต่ถ้าใช้วิธีดักจับตอนส่งออก แล้วลบ HTML เซฟลงตัวแปร Extension ก็ใช้ Regex ด้านบนได้เลย
});

