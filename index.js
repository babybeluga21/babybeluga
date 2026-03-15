// ลบบรรทัด import ออกให้หมด แล้วใช้ตัวแปรที่ ST เตรียมไว้ให้
const { 
    getContext, 
    extension_settings, 
    saveSettingsDebounced 
} = await import('../../../extensions.js');

const { 
    eventSource, 
    event_types 
} = await import('../../../../script.js');


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
    // 1. สร้างปุ่มวงกลม (สีฟ้าเย็น) ในแถบข้อความ
    // เลือกตำแหน่งข้างปุ่มไม้กายสิทธิ์ (#options_button)
    // ปรับขนาดให้เล็กลง (28px) และเปลี่ยนไอคอนเป็นรูปตัวละคร {{user}}
    const btnHtml = `<div id="cold-ext-btn" title="Cold Tools" style="
        width: 28px; height: 28px; border-radius: 50%; 
        background-color: rgba(173, 216, 230, 0.5); /* สีฟ้าใสโปร่งใส */
        color: white; 
        display: inline-flex; justify-content: center; align-items: center; 
        cursor: pointer; margin: 0 5px; flex-shrink: 0; font-size: 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        background-image: url('{{user}}'); background-size: cover; background-position: center; /* ใช้รูปตัวละคร */
        border: 1px solid rgba(255, 255, 255, 0.3); /* เส้นขอบบางๆ */
        "></div>`;
    
    // ย้ายไปเป็นเครื่องมือตำแหน่งที่สาม
    // แทรกก่อนปุ่มที่สาม (#send_but)
    $('#send_but').before(btnHtml);

    // 2. สร้าง Modal สำหรับจัดการข้อความ (ธีมใหม่)
    const modalHtml = `
        <div id="cold-ext-modal" style="display:none; position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); 
            background: rgba(42, 50, 56, 0.8); /* สีเทาอมฟ้าเข้มแบบโปร่งใส */
            border: 1px solid rgba(173, 216, 230, 0.4); /* เส้นขอบสีฟ้าใสบางๆ */
            border-radius: 12px; padding: 20px; width: 300px; z-index: 10001; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.4); /* เงาแบบ Soft */
            backdrop-filter: blur(10px); /* เอฟเฟกต์เบลอพื้นหลัง */
            color: #e2e8f0; font-family: sans-serif;">
            <h4 style="margin:0 0 15px 0; color: #add8e6; border-bottom: 1px solid rgba(173, 216, 230, 0.2); padding-bottom: 10px;">System Search</h4>
            <input type="number" id="cold-idx-input" placeholder="ใส่เลข Index..." 
                style="width:100%; background: rgba(30, 36, 40, 0.7); border: 1px solid rgba(173, 216, 230, 0.3); color:white; padding:10px; border-radius:8px; margin-bottom:15px; box-sizing: border-box;">
            <div id="cold-preview" style="font-size:12px; color: #a0aec0; margin-bottom:15px; height:45px; overflow:hidden;"></div>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                <button id="cold-copy" class="cold-btn-secondary">คัดลอก</button>
                <button id="cold-token" class="cold-btn-secondary">เช็คโทเคน</button>
                <button id="cold-branch" class="cold-btn-primary">แยกรูท</button>
                <button id="cold-close" class="cold-btn-danger">ปิด</button>
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
            alert(`ข้อความนี้มีประมาณ ${Math.floor(chat[idx].mes.length / 4)} โทเคน (โดยประมาณ)`);
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
                        <label for="cold_opt_toggle">เปิดระบบ Token Optimizer (ซ่อน HTML &lt;code&gt;)</label>
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

    if (args && args.chat) {
        args.chat.forEach(msg => {
            if (msg.mes && msg.mes.includes('<code>')) {
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
