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

if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = Object.assign({}, defaultSettings);
}

// ฟังก์ชันดึงรูป User ที่รองรับทั้ง PC และ Mobile
function getUserAvatar() {
    // ลองดึงจากองค์ประกอบต่างๆ ที่ ST มักใช้เก็บรูป User
    const imgSelectors = [
        '#user_avatar_img', 
        '#user_avatar', 
        '.user-avatar img', 
        'img.user-avatar'
    ];
    
    for (let selector of imgSelectors) {
        const src = $(selector).attr('src');
        if (src) return src;
    }

    // ถ้าหาไม่เจอจริงๆ ให้ลองดึงจากแชทล่าสุดที่เป็นของ User
    const lastUserMsg = $('.user-avatar').last().attr('src');
    return lastUserMsg || '/img/User Avatar.png';
}

function initUI() {
    // ลบปุ่มเก่าออกก่อน (กันปุ่มซ้อนเวลาแก้โค้ด)
    $('#cold-ext-btn').remove();

    const avatarUrl = getUserAvatar();
    const btnHtml = `<div id="cold-ext-btn" title="Cold Tools" style="
        width: 30px; height: 30px; border-radius: 50%; 
        background-color: rgba(135, 206, 235, 0.3);
        background-image: url('${avatarUrl}'); 
        background-size: cover; 
        background-position: center;
        border: 1px solid rgba(255, 255, 255, 0.5);
        display: inline-flex; justify-content: center; align-items: center; 
        cursor: pointer; margin: 0 4px; flex-shrink: 0;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);"></div>`;
    
    // ย้ายมาแทรก "หลัง" ปุ่มไม้กายสิทธิ์ (#options_button)
    // วิธีนี้จะทำให้มันอยู่ลำดับที่ 3 ต่อจากปุ่มขีดสาม และปุ่มไม้กายสิทธิ์
    $('#options_button').after(btnHtml);

    const modalHtml = `
        <div id="cold-ext-modal">
            <h4>System Search</h4>
            <input type="number" id="cold-idx-input" placeholder="ใส่เลข Index..." 
                style="width:100%; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(135, 206, 235, 0.4); color:white; padding:12px; border-radius:8px; margin-bottom:15px; box-sizing: border-box; outline:none;">
            <div id="cold-preview" style="font-size:12px; color: #d1e8f0; margin-bottom:15px; height:45px; overflow:hidden; text-shadow: 0 1px 2px rgba(0,0,0,0.8); line-height:1.4;"></div>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                <button id="cold-copy" class="cold-btn-secondary">คัดลอก</button>
                <button id="cold-token" class="cold-btn-secondary">เช็คโทเคน</button>
                <button id="cold-branch" class="cold-btn-primary">แยกรูท</button>
                <button id="cold-close" class="cold-btn-danger">ปิด</button>
            </div>
        </div>
    `;
    
    if ($('#cold-ext-modal').length === 0) {
        $('body').append(modalHtml);
    }

    // Event Handlers
    $('#cold-ext-btn').on('click', () => {
        const currentAvatar = getUserAvatar();
        $('#cold-ext-btn').css('background-image', `url('${currentAvatar}')`);
        $('#cold-ext-modal').fadeIn(200);
    });
    
    $('#cold-close').on('click', () => $('#cold-ext-modal').fadeOut(200));

    $('#cold-idx-input').on('input', function() {
        const idx = parseInt($(this).val());
        const chat = getContext().chat;
        if (chat && chat[idx]) {
            $('#cold-preview').text(chat[idx].mes.substring(0, 80) + "...");
        } else {
            $('#cold-preview').text("ไม่พบข้อความที่ Index นี้");
        }
    });

    $('#cold-copy').on('click', () => {
        const idx = parseInt($('#cold-idx-input').val());
        const chat = getContext().chat;
        if (chat && chat[idx]) {
            navigator.clipboard.writeText(chat[idx].mes);
            toastr.success('คัดลอกข้อความแล้ว');
        }
    });

    $('#cold-token').on('click', () => {
        const idx = parseInt($('#cold-idx-input').val());
        const chat = getContext().chat;
        if (chat && chat[idx]) {
            alert(`ข้อความนี้ยาวประมาณ: ${chat[idx].mes.length} ตัวอักษร`);
        }
    });

    $('#cold-branch').on('click', async () => {
        const idx = parseInt($('#cold-idx-input').val());
        if (confirm(`ยืนยันการตัดแชทที่ Index ${idx}? ข้อความหลังจากนี้จะหายไปทั้งหมด`)) {
            const context = getContext();
            context.chat.splice(idx + 1);
            await context.saveChat();
            window.location.reload();
        }
    });
}

function setupSettings() {
    const html = `
        <div class="cold-settings-container">
            <div class="inline-drawer">
                <div class="inline-drawer-header"><b>Cold System Tools</b></div>
                <div class="inline-drawer-content">
                    <label><input type="checkbox" id="cold_opt_toggle" ${extension_settings[extensionName].enableHtmlOptimizer ? 'checked' : ''}> เปิด Token Optimizer</label>
                </div>
            </div>
        </div>
    `;
    $('#extensions_settings').append(html);
    $('#cold_opt_toggle').on('change', function() {
        extension_settings[extensionName].enableHtmlOptimizer = !!$(this).prop('checked');
        saveSettingsDebounced();
    });
}

eventSource.on(event_types.MAKE_PROMPT, (args) => {
    if (extension_settings[extensionName].enableHtmlOptimizer && args.chat) {
        args.chat.forEach(msg => {
            if (msg.mes && msg.mes.includes('<code>')) {
                msg.mes = msg.mes.replace(/<code>[\s\S]*?<\/code>/g, extension_settings[extensionName].placeholderText);
            }
        });
    }
});

jQuery(async () => {
    initUI();
    setupSettings();
});
