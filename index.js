import { 
    getContext, 
    extension_settings, 
    getStrippedStack 
} from '../../../../script.js';
import { eventSource, event_types } from '../../../../events.js';
import { saveSettingsDebounced } from '../../../../extensions.js';

// --- Configuration ---
const extensionName = "cold_system_tools";
const defaultSettings = {
    enabled: true,
    enableHtmlOptimizer: true,
    placeholderText: "<code>[Content Optimized]</code>",
};

// Load or Initialize Settings
if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = Object.assign({}, defaultSettings);
}

// --- UI Logic: Search & Actions ---
function initUI() {
    // 1. สร้างปุ่มวงกลม (สีส้ม/เย็น) ในแถบข้อความ
    // เลือกตำแหน่งข้างปุ่มไม้กายสิทธิ์ (#options_button)
    const btnHtml = `<div id="cold-ext-btn" title="Cold Tools" style="
        width: 32px; height: 32px; border-radius: 50%; 
        background: #e67e22; color: white; 
        display: inline-flex; justify-content: center; align-items: center; 
        cursor: pointer; margin: 0 5px; flex-shrink: 0; font-size: 14px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);">◈</div>`;
    
    $('#options_button').after(btnHtml);

    // 2. สร้าง Modal สำหรับจัดการข้อความ
    const modalHtml = `
        <div id="cold-ext-modal" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); 
            background:#1a2026; border:1px solid #4a5c6a; border-radius:10px; padding:15px; width:280px; z-index:10001; 
            box-shadow: 0 10px 30px rgba(0,0,0,0.6); color:#cbd5e1; font-family:sans-serif;">
            <h4 style="margin:0 0 10px 0; color:#7E97A6; border-bottom:1px solid #334155; padding-bottom:5px;">System Search</h4>
            <input type="number" id="cold-idx-input" placeholder="ใส่เลข Index..." 
                style="width:100%; background:#0f172a; border:1px solid #334155; color:white; padding:8px; border-radius:5px; margin-bottom:10px;">
            <div id="cold-preview" style="font-size:11px; color:#64748b; margin-bottom:10px; height:40px; overflow:hidden;"></div>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
                <button id="cold-copy" style="background:#334155; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">คัดลอก</button>
                <button id="cold-token" style="background:#334155; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">เช็คโทเคน</button>
                <button id="cold-branch" style="background:#334155; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">แยกรูท</button>
                <button id="cold-close" style="background:#450a0a; color:white; border:none; padding:8px; border-radius:4px; cursor:pointer;">ปิด</button>
            </div>
        </div>
    `;
    $('body').append(modalHtml);

    // Event Handlers
    $('#cold-ext-btn').on('click', () => $('#cold-ext-modal').fadeIn(200));
    $('#cold-close').on('click', () => $('#cold-ext-modal').fadeOut(200));

    // Preview เมื่อพิมพ์ตัวเลข
    $('#cold-idx-input').on('input', function() {
        const idx = parseInt($(this).val());
        const chat = getContext().chat;
        if (chat[idx]) {
            $('#cold-preview').text(chat[idx].mes.substring(0, 60) + "...");
        } else {
            $('#cold-preview').text("ไม่พบข้อความ");
        }
    });

    // Action: Copy
    $('#cold-copy').on('click', () => {
        const idx = parseInt($('#cold-idx-input').val());
        const chat = getContext().chat;
        if (chat[idx]) {
            navigator.clipboard.writeText(chat[idx].mes);
            toastr.success('Copied to clipboard');
        }
    });

    // Action: Token Check
    $('#cold-token').on('click', async () => {
        const idx = parseInt($('#cold-idx-input').val());
        const chat = getContext().chat;
        if (chat[idx]) {
            const count = Number($('#token_counter').text().split('/')[0]) || 0; // fallback แบบง่าย
            alert(`ข้อความนี้มีประมาณ ${chat[idx].mes.length / 4} โทเคน (โดยประมาณ)`);
        }
    });

    // Action: Branch (แยกรูท)
    $('#cold-branch').on('click', async () => {
        const idx = parseInt($('#cold-idx-input').val());
        if (confirm(`คุณต้องการแยกรูทจากข้อความที่ ${idx} ใช่ไหม? (ข้อความหลังจากนี้จะถูกลบ)`)) {
            await deleteMessagesFromIndex(idx + 1);
            $('#cold-ext-modal').fadeOut(200);
        }
    });
}

async function deleteMessagesFromIndex(index) {
    const context = getContext();
    if (index < context.chat.length) {
        context.chat.splice(index);
        await context.saveChat();
        window.location.reload(); // รีโหลดเพื่อให้ UI อัปเดตแชทที่ถูกตัด
    }
}

// --- UI Logic: Settings Menu ---
function setupSettings() {
    const html = `
        <div class="cold-settings-container">
            <div class="inline-drawer">
                <div class="inline-drawer-header">
                    <b>Cold System Tools</b>
                </div>
                <div class="inline-drawer-content">
                    <div class="flex-container">
                        <label for="cold_opt_toggle">เปิดระบบ Token Optimizer (ซ่อน HTML <code>)</label>
                        <input type="checkbox" id="cold_opt_toggle" ${extension_settings[extensionName].enableHtmlOptimizer ? 'checked' : ''}>
                    </div>
                    <div style="margin-top:10px;">
                        <label>คำที่จะแสดงแทนโค้ด:</label>
                        <input type="text" id="cold_placeholder" class="text_box" value="${extension_settings[extensionName].placeholderText}">
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#extensions_settings').append(html);

    $('#cold_opt_toggle').on('change', function() {
        extension_settings[extensionName].enableHtmlOptimizer = !!$(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#cold_placeholder').on('input', function() {
        extension_settings[extensionName].placeholderText = $(this).val();
        saveSettingsDebounced();
    });
}

// --- Core Logic: Token Optimizer ---
// ดักจับก่อนที่ Prompt จะถูกส่งไปยัง AI API
eventSource.on(event_types.MAKE_PROMPT, (args) => {
    if (!extension_settings[extensionName].enableHtmlOptimizer) return;

    // args.chat เป็นอาเรย์ข้อความที่จะส่งไปประมวลผล
    if (args && args.chat) {
        args.chat.forEach(msg => {
            if (msg.mes && msg.mes.includes('<code>')) {
                // แทนที่เนื้อหาใน <code> ด้วย placeholder เพื่อประหยัดโทเคน
                // โดยที่ข้อความในหน้าจอแชท (UI) ของผู้ใช้ยังคงเดิม
                msg.mes = msg.mes.replace(/<code>[\s\S]*?<\/code>/g, extension_settings[extensionName].placeholderText);
            }
        });
    }
});

// --- Entry Point ---
jQuery(async () => {
    initUI();
    setupSettings();
    console.log("Cold System Tools Extension Loaded.");
});
