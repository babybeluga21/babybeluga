// index.js
import { eventSource, event_types } from '../../../../script.js';
import { getExtensionContext } from '../../../extensions.js';

let capturedHtml = {}; // เก็บ HTML ที่ถูกตัดออกมาแยกตาม Message ID

// ฟังก์ชันลบ HTML แต่เก็บข้อมูลไว้
function filterAndStoreHtml(messageId, text) {
    const regex = /<[^>]*>.*<\/?[^>]*>/g; // ค้นหา Tag HTML
    const matches = text.match(regex);
    
    if (matches) {
        capturedHtml[messageId] = matches; // เก็บโค้ดไว้ในตัวแปร
    }
    
    return text.replace(regex, ''); // คืนค่าข้อความที่ไม่มี HTML
}

// ดักจับตอนได้รับข้อความ
eventSource.on(event_types.MESSAGE_RECEIVED, (data) => {
    const messageIndex = data.message_id;
    // ดำเนินการกรองข้อมูลที่นี่
});

