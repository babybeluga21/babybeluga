import { getContext } from '../../../../script.js';
import { eventSource, event_types } from '../../../../events.js';

// ==========================================
// ส่วนที่ 1: สร้าง UI และระบบค้นหาข้อความ
// ==========================================
function initUI() {
    // 1. สร้างปุ่มกลมๆ แทรกเข้าไปข้างปุ่ม Auto-generate (ไม้กายสิทธิ์)
    const btnHtml = `<div id="cold-ext-btn" title="Extension Tools">◈</div>`;
    // แทรกปุ่มไว้ใน container ของปุ่มส่งข้อความ
    $('#options_button').after(btnHtml); // ปรับ selector ตามเวอร์ชั่น ST ที่ใช้ได้เลยถ้าตำแหน่งคลาดเคลื่อน

    // 2. สร้างโครงสร้างหน้าต่าง Modal
    const modalHtml = `
        <div id="cold-ext-modal">
            <h3>จัดการข้อความ</h3>
            <input type="number" id="msg-index-input" placeholder="ใส่หมายเลขข้อความ (Index)...">
            <div id="msg-preview" style="font-size: 12px; margin-bottom: 10px; color: #7E97A6; max-height: 50px; overflow: hidden;"></div>
            
            <button id="btn-copy-msg">คัดลอก</button>
            <button id="btn-branch-msg">แยกรูท (Branch)</button>
            <button id="btn-token-msg">เช็คโทเคน</button>
            <button id="btn-close-modal" class="close-btn">ปิด</button>
        </div>
    `;
    $('body').append(modalHtml);

    // 3. ผูก Event ให้ปุ่มต่างๆ
    $('#cold-ext-btn').on('click', () => {
        $('#cold-ext-modal').fadeToggle(200);
    });

    $('#btn-close-modal').on('click', () => {
        $('#cold-ext-modal').fadeOut(200);
    });

    // อัปเดตพรีวิวข้อความเมื่อพิมพ์ตัวเลข
    $('#msg-index-input').on('input', function() {
        let index = parseInt($(this).val());
        let chat = getContext().chat;
        if (chat[index] && chat[index].mes) {
            let preview = chat[index].mes.substring(0, 50) + '...';
            $('#msg-preview').text(preview);
        } else {
            $('#msg-preview').text('ไม่พบข้อความ');
        }
    });

    // ฟังก์ชั่นคัดลอก
    $('#btn-copy-msg').on('click', () => {
        let index = parseInt($('#msg-index-input').val());
        let chat = getContext().chat;
        if (chat[index]) {
            navigator.clipboard.writeText(chat[index].mes);
            alert('คัดลอกข้อความแล้ว!');
        }
    });

    // ฟังก์ชั่นเช็คโทเคน (เรียกใช้ฟังก์ชันใน ST)
    $('#btn-token-msg').on('click', async () => {
        let index = parseInt($('#msg-index-input').val());
        let chat = getContext().chat;
        if (chat[index]) {
            // สมมติฐานว่าใช้ tokenizer เริ่มต้นของ ST
            if (typeof window.getTokenCountAsync === 'function') {
                let count = await window.getTokenCountAsync(chat[index].mes);
                alert(`ข้อความนี้ใช้: ${count} โทเคน`);
            } else {
                alert('ไม่สามารถเรียกใช้ Tokenizer ได้');
            }
        }
    });

    // ฟังก์ชั่นแยกรูท (สร้าง Branch จากข้อความที่เลือก)
    $('#btn-branch-msg').on('click', () => {
        let index = parseInt($('#msg-index-input').val());
        // ใน ST การทำ Branch แบบพื้นฐานคือการเรียกใช้ฟังก์ชัน swipe หรือตัดแชท
        if (typeof window.deleteChat === 'function') {
            if(confirm('ต้องการแยกรูทจากข้อความนี้ใช่หรือไม่? (ข้อความหลังจากนี้จะถูกลบออกจากจอ)')) {
                // เก็บข้อความเก่าไว้ก่อนถ้าต้องการทำระบบเซฟ
                window.deleteChat(index + 1); // ตัดข้อความตั้งแต่ index ถัดไปทิ้ง
                $('#cold-ext-modal').fadeOut();
            }
        }
    });
}

// ==========================================
// ส่วนที่ 2: ระบบจัดการ HTML Code (Token Optimizer)
// ==========================================

// Hook เพื่อดักข้อความก่อนส่งไปให้โมเดลประมวลผล (ประหยัดโทเคน)
function optimizeHtmlContext(chatArray) {
    // วนลูปเช็คประวัติแชทที่จะถูกส่งไปทำ Context
    for (let i = 0; i < chatArray.length; i++) {
        let msg = chatArray[i];
        
        // เช็คว่ามีแท็ก <code>...</code> อยู่ในข้อความไหม
        if (msg.mes && msg.mes.includes('<code>') && msg.mes.includes('</code>')) {
            // ซ่อนโค้ดฉบับเต็ม แทนที่ด้วยคำอธิบายสั้นๆ เพื่อให้โมเดลอ่านแค่นี้
            msg.mes = msg.mes.replace(/<code>[\s\S]*?<\/code>/g, '<code>[System: Detailed HTML code hidden for performance]</code>');
        }
    }
    return chatArray;
}

// ผูก Event กับ ST เมื่อกำลังจะสร้าง Prompt
eventSource.on(event_types.MAKE_PROMPT, (args) => {
    // args.chat คือ array ของข้อความที่กำลังจะถูกปั้นเป็น Context
    if (args && args.chat) {
        args.chat = optimizeHtmlContext(args.chat);
    }
});

// เริ่มทำงานเมื่อ Extension โหลดเสร็จ
jQuery(() => {
    initUI();
    console.log('Cold HTML & Search Extension Loaded');
});
