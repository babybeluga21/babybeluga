import { getContext, extension_settings } from '../../../../script.js';
import { eventSource, event_types } from '../../../../events.js';

const extensionName = "cold_system_tools";
const defaultSettings = {
    enableHtmlOptimizer: true,
    autoHideCode: true,
    themeColor: '#7E97A6'
};

// โหลด Settings หรือใช้ค่า Default
if (!extension_settings[extensionName]) {
    extension_settings[extensionName] = defaultSettings;
}

// ฟังก์ชันสร้าง UI ในหน้า Extension Settings
function setupSettingsMenu() {
    const settingsHtml = `
        <div class="cold_ext_settings">
            <div class="inline-drawer">
                <div class="inline-drawer-header">
                    <b>Cold System Tools Config</b>
                </div>
                <div class="inline-drawer-content">
                    <div class="flex-container">
                        <label>
                            <input type="checkbox" id="cold_enable_optimizer" ${extension_settings[extensionName].enableHtmlOptimizer ? 'checked' : ''}> 
                            เปิดใช้งาน HTML Token Optimizer
                        </label>
                    </div>
                    <div class="flex-container" style="margin-top:10px;">
                        <label>
                            <input type="checkbox" id="cold_auto_hide" ${extension_settings[extensionName].autoHideCode ? 'checked' : ''}> 
                            ซ่อนโค้ดอัตโนมัติเมื่อส่ง Prompt
                        </label>
                    </div>
                    <p style="font-size:0.8em; color:gray; margin-top:10px;">
                        *ระบบนี้จะช่วยประหยัดโทเคนโดยการแทนที่ <code> ด้วยข้อความสั้นๆ ก่อนส่งหา AI
                    </p>
                </div>
            </div>
        </div>
    `;

    // แทรกเข้าไปในหน้า Extension Settings
    $('#extensions_settings').append(settingsHtml);

    // ผูก Event สำหรับบันทึกค่า
    $('#cold_enable_optimizer').on('change', function() {
        extension_settings[extensionName].enableHtmlOptimizer = !!$(this).prop('checked');
        saveSettings();
    });

    $('#cold_auto_hide').on('change', function() {
        extension_settings[extensionName].autoHideCode = !!$(this).prop('checked');
        saveSettings();
    });
}

function saveSettings() {
    // ฟังก์ชันนี้จะบันทึกค่าลงใน settings.json ของ SillyTavern อัตโนมัติ
    // ปกติ ST จัดการให้เมื่อเราแก้ค่าใน extension_settings
}

// แก้ไขฟังก์ชัน Optimize ให้เช็คค่าจาก Settings ก่อนทำ
function optimizeHtmlContext(chatArray) {
    if (!extension_settings[extensionName].enableHtmlOptimizer) return chatArray;

    for (let i = 0; i < chatArray.length; i++) {
        let msg = chatArray[i];
        if (msg.mes && msg.mes.includes('<code>')) {
            msg.mes = msg.mes.replace(/<code>[\s\S]*?<\/code>/g, '<code>[Code Optimized]</code>');
        }
    }
    return chatArray;
}

// ... (ส่วนการสร้างปุ่มวงกลมในหน้าแชทยังคงเดิม) ...

jQuery(() => {
    initUI(); // สร้างปุ่มวงกลมที่หน้าแชท
    setupSettingsMenu(); // สร้างเมนูตั้งค่าในหน้า Extension
    console.log('Cold System Tools with Settings Loaded');
});
