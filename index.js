(async function() {
    const { getContext, extension_settings, saveSettingsDebounced } = await import('../../../extensions.js');
    const { eventSource, event_types } = await import('../../../../script.js');

    const extensionName = "cold_system_tools";
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = { enabled: true, enableHtmlOptimizer: true, placeholderText: "<code>[Content Optimized]</code>" };
    }

    // --- 1. CSS Injection (กระจกฝ้า ฟ้าใส + ทรงปุ่ม) ---
    const styles = `
        <style id="cold-tools-css">
            #cold-ext-btn {
                width: 32px !important; height: 32px !important; 
                border-radius: 50% !important;
                background-size: cover !important; 
                background-position: center !important;
                background-repeat: no-repeat !important;
                border: 1.5px solid rgba(255, 255, 255, 0.6) !important;
                cursor: pointer; flex-shrink: 0; margin: 0 5px;
                box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                display: inline-block; vertical-align: middle;
                transition: transform 0.2s;
            }
            #cold-ext-modal {
                display: none; position: fixed; top: 50%; left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(135, 206, 235, 0.15) !important; /* ฟ้าใสจางๆ */
                backdrop-filter: blur(12px) !important; -webkit-backdrop-filter: blur(12px) !important;
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 18px; padding: 22px; width: 88%; max-width: 320px;
                z-index: 999999; color: white; box-shadow: 0 10px 40px rgba(0,0,0,0.4);
            }
            #cold-ext-modal h4 { margin: 0 0 15px 0; text-align: center; letter-spacing: 1px; color: #e0f4ff; }
            #cold-idx-input { 
                width: 100%; padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.3); 
                background: rgba(0,0,0,0.2); color: white; margin-bottom: 12px; box-sizing: border-box; 
            }
            .cold-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .cold-btn { border: none; padding: 12px; border-radius: 10px; color: white; font-weight: bold; cursor: pointer; transition: 0.2s; }
            .btn-p { background: rgba(0, 150, 255, 0.35); }
            .btn-s { background: rgba(255, 255, 255, 0.15); }
            .btn-d { background: rgba(255, 60, 60, 0.35); grid-column: span 2; margin-top: 5px; }
        </style>
    `;
    if (!$('#cold-tools-css').length) $('head').append(styles);

    // --- 2. ฟังก์ชันดึงรูปโปรไฟล์ Persona ({{user}}) ---
    function getPersonaPhoto() {
        // อ้างอิงจากระบบ ST และ CSS ที่คุณส่งมา
        const personaImg = $('#user_avatar').attr('src') || // รูปในหน้า UI หลัก
                         $('#avatar_user').attr('src') || // รูปในตั้งค่า
                         $('.user-avatar img').first().attr('src'); // รูปจากแชท
        
        return personaImg || '/img/User Avatar.png';
    }

    // --- 3. ฟังก์ชันสร้างและย้ายตำแหน่งปุ่ม ---
    function forceButtonPosition() {
        const target = $('#options_button'); // ปุ่มไม้กายสิทธิ์
        let btn = $('#cold-ext-btn');

        if (target.length === 0) return; // ถ้ายังไม่โหลดปุ่ม ST ให้รอ

        if (btn.length === 0) {
            // สร้างปุ่มใหม่ถ้ายังไม่มี
            btn = $('<div id="cold-ext-btn"></div>');
            btn.on('click', () => {
                btn.css('background-image', `url("${getPersonaPhoto()}")`);
                $('#cold-ext-modal').fadeIn(200);
            });
            
            // สร้าง Modal
            if (!$('#cold-ext-modal').length) {
                $('body').append(`
                    <div id="cold-ext-modal">
                        <h4>SYSTEM SEARCH</h4>
                        <input type="number" id="cold-idx-input" placeholder="ใส่เลข Index...">
                        <div id="cold-preview" style="font-size:12px; height:40px; overflow:hidden; opacity:0.8; margin-bottom:10px;"></div>
                        <div class="cold-grid">
                            <button class="cold-btn btn-s" id="c-copy">คัดลอก</button>
                            <button class="cold-btn btn-s" id="c-token">เช็ค</button>
                            <button class="cold-btn btn-p" id="c-branch">แยกรูท</button>
                            <button class="cold-btn btn-d" id="c-close">ปิดหน้าต่าง</button>
                        </div>
                    </div>
                `);
                
                // Modal Events
                $('#c-close').on('click', () => $('#cold-ext-modal').fadeOut(200));
                $('#cold-idx-input').on('input', function() {
                    const idx = $(this).val();
                    const chat = getContext().chat;
                    if (chat[idx]) $('#cold-preview').text(chat[idx].mes.substring(0, 60) + "...");
                });
                $('#c-copy').on('click', () => {
                    const idx = $('#cold-idx-input').val();
                    const chat = getContext().chat;
                    if (chat[idx]) { navigator.clipboard.writeText(chat[idx].mes); toastr.success('คัดลอกแล้ว'); }
                });
                $('#c-branch').on('click', async () => {
                    const idx = parseInt($('#cold-idx-input').val());
                    if (confirm('คุณแน่ใจนะว่าจะตัดแชทจากตรงนี้?')) {
                        getContext().chat.splice(idx + 1);
                        await getContext().saveChat();
                        window.location.reload();
                    }
                });
            }
        }

        // อัปเดตรูป Persona ล่าสุด
        btn.css('background-image', `url("${getPersonaPhoto()}")`);

        // บังคับย้ายตำแหน่งไปหลังปุ่มไม้กายสิทธิ์ (ตำแหน่งที่ 3)
        if (!btn.prev().is('#options_button')) {
            target.after(btn);
        }
    }

    // --- 4. ระบบ MutationObserver ตรวจจับการเปลี่ยนแปลงหน้าจอ (สำหรับมือถือ) ---
    const observer = new MutationObserver(() => {
        forceButtonPosition();
    });

    // เริ่มทำงาน
    jQuery(async () => {
        forceButtonPosition();
        
        // สั่งให้คอยดูการเปลี่ยนแปลงของแถบเครื่องมือด้านล่าง
        const footer = document.querySelector('#send_form') || document.body;
        observer.observe(footer, { childList: true, subtree: true });

        // Backup plan: เช็คซ้ำทุก 2 วินาที เผื่อ Observer พลาด
        setInterval(forceButtonPosition, 2000);
        
        console.log("Cold System Tools: Persona Button Mode Active");
    });

    // Token Optimizer Logic
    eventSource.on(event_types.MAKE_PROMPT, (args) => {
        if (extension_settings[extensionName].enableHtmlOptimizer && args.chat) {
            args.chat.forEach(msg => {
                if (msg.mes?.includes('<code>')) {
                    msg.mes = msg.mes.replace(/<code>[\s\S]*?<\/code>/g, extension_settings[extensionName].placeholderText);
                }
            });
        }
    });

})();
