(async function() {
    const { getContext, extension_settings, saveSettingsDebounced } = await import('../../../extensions.js');
    const { eventSource, event_types } = await import('../../../../script.js');

    const extensionName = "cold_system_tools";
    const defaultSettings = {
        enabled: true,
        enableHtmlOptimizer: true,
        placeholderText: "<code>[Content Optimized]</code>",
    };

    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = Object.assign({}, defaultSettings);
    }

    // 1. Inject CSS เข้าสู่ Head โดยตรง (ธีมกระจกฝ้าฟ้าใส)
    const style = `
        <style>
            #cold-ext-btn {
                width: 30px; height: 30px; border-radius: 50%; 
                background-color: #87ceeb;
                background-size: cover; background-position: center;
                border: 1px solid rgba(255, 255, 255, 0.5);
                cursor: pointer; margin: 0 4px; flex-shrink: 0;
                box-shadow: 0 1px 4px rgba(0,0,0,0.4); transition: 0.2s;
            }
            #cold-ext-btn:hover { transform: scale(1.1); filter: brightness(1.2); }

            #cold-ext-modal {
                display: none; position: fixed; top: 50%; left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(135, 206, 235, 0.18); /* ฟ้าใสจางๆ */
                backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 15px; padding: 20px; width: 85%; max-width: 320px;
                z-index: 99999; box-shadow: 0 8px 32px rgba(0,0,0,0.3); color: white;
            }
            #cold-ext-modal h4 { margin: 0 0 15px 0; text-align: center; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.3); }
            #cold-ext-modal button { border: none; padding: 10px; border-radius: 8px; cursor: pointer; font-weight: bold; color: white; transition: 0.2s; }
            .cold-btn-primary { background: rgba(0, 150, 255, 0.4); }
            .cold-btn-secondary { background: rgba(255, 255, 255, 0.2); }
            .cold-btn-danger { background: rgba(255, 50, 50, 0.4); grid-column: span 2; margin-top: 10px; }
        </style>
    `;
    $('head').append(style);

    // 2. ฟังก์ชันหาภาพ Persona ของ User
    function getUserAvatar() {
        const selectors = [
            '#user_avatar_img', 
            '#user_avatar', 
            '.user-avatar img', 
            'img.user-avatar',
            '#avatar_user'
        ];
        for (let s of selectors) {
            let src = $(s).attr('src');
            if (src && src !== '') return src;
        }
        // ถ้าหาไม่เจอจริงๆ ให้ดึงจากข้อความล่าสุดในแชท
        return $('.user-avatar').last().attr('src') || '/img/User Avatar.png';
    }

    // 3. ฟังก์ชันสร้างปุ่มและจัดการตำแหน่ง
    function injectButton() {
        if ($('#cold-ext-btn').length > 0) return; // ถ้ามีปุ่มแล้วไม่ต้องสร้างซ้ำ

        const avatarUrl = getUserAvatar();
        const btnHtml = `<div id="cold-ext-btn" title="Cold Tools" style="background-image: url('${avatarUrl}');"></div>`;
        
        // บังคับแทรก "หลัง" ปุ่มไม้กายสิทธิ์ (#options_button)
        // เพื่อให้อยู่ลำดับที่ 3 ต่อจาก [เมนูขีดสาม] [ไม้กายสิทธิ์] [ปุ่มคุณ]
        if ($('#options_button').length > 0) {
            $('#options_button').after(btnHtml);
        } else {
            // กรณีหาปุ่มไม้กายสิทธิ์ไม่เจอ (เช่นโหลดช้า) ให้รอแป๊บเดียวแล้วลองใหม่
            setTimeout(injectButton, 500);
            return;
        }

        // จัดการ Modal
        if ($('#cold-ext-modal').length === 0) {
            const modalHtml = `
                <div id="cold-ext-modal">
                    <h4>System Search</h4>
                    <input type="number" id="cold-idx-input" placeholder="Index..." style="width:100%; background:rgba(0,0,0,0.3); border:1px solid white; color:white; padding:10px; border-radius:8px; margin-bottom:15px; box-sizing:border-box;">
                    <div id="cold-preview" style="font-size:12px; height:45px; overflow:hidden; opacity:0.8; margin-bottom:10px;"></div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                        <button id="cold-copy" class="cold-btn-secondary">คัดลอก</button>
                        <button id="cold-token" class="cold-btn-secondary">เช็คโทเคน</button>
                        <button id="cold-branch" class="cold-btn-primary">แยกรูท</button>
                        <button id="cold-close" class="cold-btn-danger">ปิด</button>
                    </div>
                </div>
            `;
            $('body').append(modalHtml);
        }

        // Event Handlers
        $('#cold-ext-btn').off('click').on('click', () => {
            $('#cold-ext-btn').css('background-image', `url('${getUserAvatar()}')`);
            $('#cold-ext-modal').fadeIn(200);
        });
        $('#cold-close').on('click', () => $('#cold-ext-modal').fadeOut(200));
        
        $('#cold-idx-input').on('input', function() {
            const idx = parseInt($(this).val());
            const chat = getContext().chat;
            if (chat && chat[idx]) $('#cold-preview').text(chat[idx].mes.substring(0, 60) + "...");
            else $('#cold-preview').text("ไม่พบข้อความ");
        });

        $('#cold-copy').on('click', () => {
            const idx = parseInt($('#cold-idx-input').val());
            const chat = getContext().chat;
            if (chat && chat[idx]) { navigator.clipboard.writeText(chat[idx].mes); toastr.success('Copied!'); }
        });

        $('#cold-branch').on('click', async () => {
            const idx = parseInt($('#cold-idx-input').val());
            if (confirm(`ตัดแชทที่ Index ${idx}?`)) {
                getContext().chat.splice(idx + 1);
                await getContext().saveChat();
                window.location.reload();
            }
        });
    }

    // ส่วนของ Token Optimizer
    eventSource.on(event_types.MAKE_PROMPT, (args) => {
        if (extension_settings[extensionName].enableHtmlOptimizer && args.chat) {
            args.chat.forEach(msg => {
                if (msg.mes && msg.mes.includes('<code>')) {
                    msg.mes = msg.mes.replace(/<code>[\s\S]*?<\/code>/g, extension_settings[extensionName].placeholderText);
                }
            });
        }
    });

    // เริ่มการทำงาน
    jQuery(async () => {
        // ใช้ Interval ตรวจสอบตำแหน่งปุ่มเรื่อยๆ ในช่วงแรก (ป้องกันโดน ST ย้ายกลับ)
        let checks = 0;
        const posInterval = setInterval(() => {
            injectButton();
            checks++;
            if (checks > 10) clearInterval(posInterval); // ตรวจสอบ 10 ครั้งแล้วหยุด
        }, 1000);

        console.log("Cold Tools Loaded.");
    });
})();
