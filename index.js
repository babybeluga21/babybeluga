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

// ฟังก์ชันสำหรับดึงรูป User Persona ปัจจุบัน
function getUserAvatar() {
    // ดึงจากรูป Persona ปัจจุบันที่เลือกไว้ใน UI ของ SillyTavern ก่อน 
    // ถ้าไม่มีค่อยดึงจากแชทล่าสุด หรือใช้รูปพื้นฐาน
    let personaImg = $('#user_avatar').attr('src') || $('#avatar_user').attr('src');
    let chatImg = $('.user-avatar').last().attr('src');
    
    return personaImg || chatImg || '/img/User Avatar.png';
}

// --- UI Logic: Search & Actions ---
function initUI() {
    // 1. สร้างปุ่มวงกลม
    const avatarUrl = getUserAvatar();
    const btnHtml = `<div id="cold-ext-btn" title="Cold Tools" style="
        width: 28px; height: 28px; border-radius: 50%; 
        background-color: rgba(135, 206, 235, 0.3);
        background-image: url('${avatarUrl}'); 
        background-size: cover; 
        background-position: center;
        border: 1px solid rgba(255, 255, 255, 0.4);
        display: inline-flex; justify-content: center; align-items: center; 
        cursor: pointer; margin: 0 5px; flex-shrink: 0;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);"></div>`;
    
    // แทรกปุ่มไว้ "หน้า" ปุ่มไม้กายสิทธิ์ (#options_button) เพื่อให้เป็นเครื่องมือแรกสุด
    $('#options_button').before(btnHtml);

    // 2. สร้าง Modal สำหรับจัดการข้อความ (ธีมกระจกฝ้า ฟ้าใสจางๆ)
    const modalHtml = `
        <div id="cold-ext-modal">
            <h4>System Search</h4>
            <input type="number" id="cold-idx-input" placeholder="ใส่เลข Index..." 
                style="width:100%; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(135, 206, 235, 0.4); color:white; padding:10px; border-radius:8px; margin-bottom:15px; box-sizing: border-box;">
            <div id="cold-preview" style="font-size:12px; color: #d1e8f0; margin-bottom:15px; height:45px; overflow:hidden; text-shadow: 0 1px 2px rgba(0,0,0,0.8);"></div>
            
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
    $('#cold-ext-btn').on('click', () => {
        // อัปเดตรูปภาพอีกครั้งเผื่อมีการเปลี่ยนตัวละคร User
        $('#cold-ext-btn').css('background-image', `url('${getUserAvatar()}')`);
        $('#cold-ext-modal').fadeIn(200);
    });
    
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
        window.location.reload(); 
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
