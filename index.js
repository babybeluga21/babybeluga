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

    // --- ส่วนที่ 1: จัดการสไตล์ (CSS) ---
    // รวม CSS ไว้ใน Javascript เลยเพื่อความชัวร์ 100% ว่าจะแสดงผลตามที่ต้องการ
    const style = `
        <style>
            #cold-ext-btn {
                width: 32px; height: 32px; border-radius: 50%; 
                background-color: #add8e6; /* สีฟ้าอ่อนสำหรับพื้นหลังปุ่มเผื่อรูปไม่โหลด */
                background-size: cover; background-position: center;
                border: 2px solid rgba(255, 255, 255, 0.6);
                cursor: pointer; margin: 0 4px; flex-shrink: 0;
                box-shadow: 0 1px 5px rgba(0,0,0,0.5); transition: 0.2s;
            }
            #cold-ext-btn:hover { transform: scale(1.1); filter: brightness(1.2); }

            #cold-ext-modal {
                display: none; position: fixed; top: 50%; left: 50%;
                transform: translate(-50%, -50%);
                /* พื้นหลังมัวและฟ้าใสจางๆ (Glassmorphism) */
                background: rgba(135, 206, 235, 0.18); 
                backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 15px; padding: 20px; width: 85%; max-width: 340px;
                z-index: 99999; box-shadow: 0 10px 40px rgba(0,0,0,0.5); color: white;
            }
            #cold-ext-modal h4 { margin: 0 0 15px 0; text-align: center; color: white; text-shadow: 0 2px 4px rgba(0,0,0,0.3); font-weight: bold; }
            #cold-ext-modal input#cold-idx-input { 
                width: 100%; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.4); 
                color: white; padding: 12px; border-radius: 8px; margin-bottom: 15px; box-sizing: border-box; outline: none;
            }
            #cold-ext-modal button { border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-weight: bold; color: white; transition: 0.2s; font-size: 14px; }
            #cold-ext-modal .cold-btn-primary { background: rgba(0, 150, 255, 0.4); }
            #cold-ext-modal .cold-btn-secondary { background: rgba(255, 255, 255, 0.2); }
            #cold-ext-modal .cold-btn-danger { background: rgba(255, 50, 50, 0.4); grid-column: span 2; margin-top: 10px; }
            #cold-ext-modal button:hover { opacity: 0.8; transform: translateY(-1px); }
        </style>
    `;
    $('head').append(style);

    // --- ส่วนที่ 2: ค้นหาภาพโปรไฟล์ ---
    // เน้น selector ที่เฉพาะเจาะจงกับ Persona ของ User (img#user_avatar)
    function getUserAvatar() {
        const selectors = [
            'img#user_avatar',     // Selector สำคัญ: รูปโปรไฟล์ Persona ของ User ในเมนูหลัก
            '#user_avatar_img', 
            '.user-avatar img',
            '#user_avatar' 
        ];
        for (let s of selectors) {
            let src = $(s).attr('src');
            if (src && src !== '') return src;
        }
        // ถ้าหาไม่เจอจริงๆ ให้ดึงจากข้อความล่าสุดของ user
        return $('.user-avatar').last().attr('src') || '/img/User Avatar.png';
    }

    // --- ส่วนที่ 3: จัดการปุ่มและ Modal ---
    function injectButton() {
        if ($('#cold-ext-btn').length > 0) return; // ถ้ามีปุ่มแล้วไม่ต้องสร้างซ้ำ

        const avatarUrl = getUserAvatar();
        const btnHtml = `<div id="cold-ext-btn" title="Cold Tools" style="background-image: url('${avatarUrl}');"></div>`;
        
        // บังคับวาง "หลัง" ปุ่มไม้กายสิทธิ์ (#options_button)
        if ($('#options_button').length > 0) {
            $('#options_button').after(btnHtml);
        } else {
            // ถ้าหาไม่เจอ ให้ลองใหม่
            setTimeout(injectButton, 500);
            return;
        }

        // จัดการ Modal
        if ($('#cold-ext-modal').length === 0) {
            const modalHtml = `
                <div id="cold-ext-modal">
                    <h4>SYSTEM TOOLS</h4>
                    <input type="number" id="cold-idx-input" placeholder="ใส่ Index เพื่อดูข้อความ...">
                    <div id="cold-preview" style="font-size:12px; height:45px; overflow:hidden; opacity:0.8; margin-bottom:10px; padding: 0 5px; line-height: 1.3;"></div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
                        <button id="cold-copy" class="cold-btn-secondary">คัดลอก</button>
                        <button id="cold-token" class="cold-btn-secondary">เช็ค</button>
                        <button id="cold-branch" class="cold-btn-primary">แยกรูท</button>
                        <button id="cold-close" class="cold-btn-danger">ปิด</button>
                    </div>
                </div>
            `;
            $('body').append(modalHtml);
        }

        // ลงทะเบียน Event Handlers
        $('#cold-ext-btn').off('click').on('click', () => {
            // อัปเดตรูปทุกครั้งที่คลิกเผื่อมีการเปลี่ยน Persona
            $('#cold-ext-btn').css('background-image', `url('${getUserAvatar()}')`);
            $('#cold-ext-modal').fadeIn(200);
        });
        $('#cold-close').on('click', () => $('#cold-ext-modal').fadeOut(200));
        
        // จัดการ Input
        $('#cold-idx-input').on('input', function() {
            const idx = parseInt($(this).val());
            const chat = getContext().chat;
            if (chat && chat[idx]) $('#cold-preview').text(chat[idx].mes.substring(0, 80) + "...");
            else $('#cold-preview').text("ไม่พบข้อความที่ Index นี้");
        });

        // จัดการ Actions
        $('#cold-copy').on('click', () => {
            const idx = parseInt($('#cold-idx-input').val());
            const chat = getContext().chat;
            if (chat && chat[idx]) { navigator.clipboard.writeText(chat[idx].mes); toastr.success('คัดลอกข้อความแล้ว!'); }
        });

        $('#cold-token').on('click', () => {
            const idx = parseInt($('#cold-idx-input').val());
            const chat = getContext().chat;
            if (chat && chat[idx]) alert(`ข้อความนี้มีประมาณ: ${chat[idx].mes.length} ตัวอักษร`);
        });

        $('#cold-branch').on('click', async () => {
            const idx = parseInt($('#cold-idx-input').val());
            if (confirm(`ยืนยันการแยกรูท? ข้อความหลังจากแชทที่ ${idx} จะถูกลบทั้งหมด!`)) {
                getContext().chat.splice(idx + 1);
                await getContext().saveChat();
                window.location.reload();
            }
        });
    }

    // ส่วนของ Token Optimizer (คงเดิม)
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
        // ใช้ Interval ตรวจสอบและบังคับตำแหน่งปุ่มในช่วง 10 วินาทีแรก
        let checkCount = 0;
        const ensurePlacement = setInterval(() => {
            if ($('#options_button').length > 0) {
                if ($('#cold-ext-btn').length === 0) {
                    injectButton(); // ถ้าปุ่มหายไป ให้สร้างใหม่
                } else if ($('#options_button').next().id !== 'cold-ext-btn') {
                    $('#cold-ext-btn').insertAfter('#options_button'); // ถ้าตำแหน่งผิด บังคับกลับมา
                }
            }
            checkCount++;
            if (checkCount > 20) clearInterval(ensurePlacement); // ตรวจสอบ 20 ครั้งแล้วหยุด
        }, 500);

        console.log("Cold System Tools Definitive Version Loaded.");
    });
})();
