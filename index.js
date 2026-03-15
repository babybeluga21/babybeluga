(async function() {
    // ดึงตัวแปรจาก ST
    const { getContext, extension_settings, saveSettingsDebounced } = await import('../../../extensions.js');
    const { eventSource, event_types } = await import('../../../../script.js');

    const extName = "cold_system_tools";
    if (!extension_settings[extName]) {
        extension_settings[extName] = { enabled: true, enableHtmlOptimizer: true, placeholderText: "<code>[Content Optimized]</code>" };
    }

    // --- 1. จัดการ CSS (Glassmorphism & Position) ---
    const injectStyles = () => {
        if ($('#cold-style').length) return;
        $('head').append(`
            <style id="cold-style">
                #cold-ext-btn {
                    width: 32px; height: 32px; border-radius: 50%;
                    background-size: cover; background-position: center;
                    background-color: #87ceeb;
                    border: 1px solid rgba(255, 255, 255, 0.5);
                    cursor: pointer; flex-shrink: 0; margin: 0 5px;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.4);
                    display: inline-block; vertical-align: middle;
                }
                #cold-ext-modal {
                    display: none; position: fixed; top: 50%; left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(135, 206, 235, 0.2) !important; /* ฟ้าใสจางๆ */
                    backdrop-filter: blur(15px) saturate(150%); -webkit-backdrop-filter: blur(15px);
                    border: 1px solid rgba(255, 255, 255, 0.3);
                    border-radius: 15px; padding: 20px; width: 85%; max-width: 320px;
                    z-index: 10001; color: white; box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                }
                #cold-ext-modal h4 { margin-top:0; text-align:center; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
                .cold-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
                .cold-btn { border: none; padding: 10px; border-radius: 8px; color: white; font-weight: bold; cursor: pointer; }
                .btn-p { background: rgba(0, 150, 255, 0.4); }
                .btn-s { background: rgba(255, 255, 255, 0.2); }
                .btn-d { background: rgba(255, 50, 50, 0.4); grid-column: span 2; }
                #cold-idx-input { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid white; background: rgba(0,0,0,0.2); color: white; margin-bottom: 10px; box-sizing: border-box; }
            </style>
        `);
    };

    // --- 2. ฟังก์ชันหาภาพ Persona (แก้ทาง Mobile) ---
    const getMyAvatar = () => {
        // ลองหาจาก element ที่เก็บรูป user โดยตรง
        const img = $('#user_avatar').attr('src') || $('.user-avatar img').attr('src') || $('#avatar_user').attr('src');
        if (img) return img;
        
        // ถ้าไม่เจอ ให้ไปดึงจาก settings ของ ST (ถ้ามี)
        return '/img/User Avatar.png'; 
    };

    // --- 3. การสร้างปุ่มและบังคับตำแหน่ง ---
    const buildUI = () => {
        if ($('#cold-ext-btn').length) return;

        const btn = $(`<div id="cold-ext-btn" title="Cold Tools"></div>`);
        btn.css('background-image', `url("${getMyAvatar()}")`);

        // บังคับแทรกหลังปุ่มไม้กายสิทธิ์ (#options_button)
        // ถ้าเป็น Mobile ปุ่มไม้กายสิทธิ์คือปุ่มที่ 2 ดังนั้นปุ่มเราจะเป็นปุ่มที่ 3
        if ($('#options_button').length) {
            $('#options_button').after(btn);
        }

        // สร้าง Modal
        if (!$('#cold-ext-modal').length) {
            $('body').append(`
                <div id="cold-ext-modal">
                    <h4>SYSTEM TOOLS</h4>
                    <input type="number" id="cold-idx-input" placeholder="ใส่เลข Index...">
                    <div id="cold-preview" style="font-size:12px; height:40px; overflow:hidden; opacity:0.8;"></div>
                    <div class="cold-grid">
                        <button class="cold-btn btn-s" id="c-copy">Copy</button>
                        <button class="cold-btn btn-s" id="c-token">Token</button>
                        <button class="cold-btn btn-p" id="c-branch">Branch</button>
                        <button class="cold-btn btn-d" id="c-close">Close</button>
                    </div>
                </div>
            `);
        }

        // Events
        $('#cold-ext-btn').on('click', () => {
            $('#cold-ext-btn').css('background-image', `url("${getMyAvatar()}")`);
            $('#cold-ext-modal').fadeIn(200);
        });
        $('#c-close').on('click', () => $('#cold-ext-modal').fadeOut(200));
        
        $('#c-copy').on('click', () => {
            const idx = $('#cold-idx-input').val();
            const chat = getContext().chat;
            if (chat[idx]) { navigator.clipboard.writeText(chat[idx].mes); toastr.success('Copied!'); }
        });

        $('#c-branch').on('click', async () => {
            const idx = parseInt($('#cold-idx-input').val());
            if (confirm('ยืนยันตัดแชท?')) {
                getContext().chat.splice(idx + 1);
                await getContext().saveChat();
                window.location.reload();
            }
        });
    };

    // --- 4. Loop ตรวจสอบ (เพราะ Mobile UI โหลดช้า) ---
    injectStyles();
    const runner = setInterval(() => {
        buildUI();
        // ถ้าปุ่มมาแล้ว และอยู่ถูกที่ (หลัง options_button) ก็หยุดวน
        if ($('#cold-ext-btn').length && $('#options_button').next().is('#cold-ext-btn')) {
            // เช็คซ้ำอีกนิดเผื่อ UI รีเฟรช
            setTimeout(() => clearInterval(runner), 5000);
        }
    }, 1000);

    // ส่วน Token Optimizer
    eventSource.on(event_types.MAKE_PROMPT, (args) => {
        if (extension_settings[extName].enableHtmlOptimizer && args.chat) {
            args.chat.forEach(msg => {
                if (msg.mes?.includes('<code>')) {
                    msg.mes = msg.mes.replace(/<code>[\s\S]*?<\/code>/g, extension_settings[extName].placeholderText);
                }
            });
        }
    });

})();
