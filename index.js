import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";

const MODULE_NAME = "cute-html-renderer";
let htmlStorageEnabled = true;

// สร้างแผงลอยน่ารักฝั่งขวา (ขยับได้ + มีฐาน)
function createFloatingPanel() {
    const panel = document.createElement("div");
    panel.id = "cute-html-panel";
    panel.innerHTML = `
        <div id="cute-html-header">📅 Cute HTML Renderer!!</div>
        <div id="cute-html-body">
            <label>
                <input type="checkbox" id="enable-html" checked> เปิดใช้งาน (ลด Token อัตโนมัติ)
            </label>
            <br><br>
            <button id="clear-html" style="width:100%; padding:8px; background:#d48c3d; color:white; border:none; border-radius:12px;">ล้างข้อมูลทั้งหมด</button>
            <p style="font-size:12px; margin-top:10px; text-align:center; color:#8b5a2b;">
                ลากหัวข้อเพื่อขยับ<br>มีฐานหยุดที่ขอบจอขวา \~<br>ธีมส้มน่ารักตามภาพที่คุณส่งมา!
            </p>
        </div>
    `;
    document.body.appendChild(panel);

    // ทำให้ลากได้
    const header = panel.querySelector("#cute-html-header");
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    header.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
        e.preventDefault();
        pos3 = e.clientX;
        pos4 = e.clientY;
        document.onmouseup = closeDragElement;
        document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        panel.style.top = (panel.offsetTop - pos2) + "px";
        panel.style.right = "auto";
        panel.style.left = (panel.offsetLeft - pos1) + "px";
    }

    function closeDragElement() {
        document.onmouseup = null;
        document.onmousemove = null;
        // สแนปกลับไปขวาถ้าอยู่ใกล้ขอบ
        if (parseInt(panel.style.left) > window.innerWidth - 400) {
            panel.style.left = "auto";
            panel.style.right = "25px";
        }
    }

    // ปุ่มเปิด/ปิด
    panel.querySelector("#enable-html").onchange = (e) => {
        htmlStorageEnabled = e.target.checked;
    };

    // ล้างข้อมูล
    panel.querySelector("#clear-html").onclick = () => {
        const ctx = getContext();
        ctx.chat.forEach(msg => { if (msg.stHtmlBlocks) msg.stHtmlBlocks = []; });
        saveSettingsDebounced();
        toastr.success("ล้างข้อมูล HTML ทั้งหมดแล้ว!", "Cute HTML Renderer");
    };
}

// ตรวจจับและแทนที่โค้ด HTML → <code data-html-id="...">description</code>
function handleMessageReceived(data) {
    if (!htmlStorageEnabled || !data.message.mes) return;

    const regex = /```html\s*([\s\S]*?)\s*```/g;
    let match;
    let newMes = data.message.mes;
    const newBlocks = [];

    while ((match = regex.exec(data.message.mes)) !== null) {
        const fullBlock = match[0];
        const content = match[1].trim();
        const lines = content.split("\n");
        let desc = "Rich UI Content";
        let htmlContent = content;

        if (lines.length > 1) {
            const first = lines[0].trim();
            if (first.toLowerCase().startsWith("description:") || first.toLowerCase().startsWith("desc:")) {
                desc = first.replace(/^desc(ription)?:/i, "").trim();
                htmlContent = lines.slice(1).join("\n");
            } else {
                desc = first;
                htmlContent = lines.slice(1).join("\n") || content;
            }
        }

        const id = `html-\( {Date.now()}- \){Math.floor(Math.random() * 10000)}`;
        newBlocks.push({ id, html: htmlContent });

        newMes = newMes.replace(fullBlock, `<code data-html-id="\( {id}"> \){desc}</code>`);
    }

    if (newBlocks.length > 0) {
        data.message.mes = newMes;
        data.message.stHtmlBlocks = (data.message.stHtmlBlocks || []).concat(newBlocks);
    }
}

// แสดงผล HTML จริงในข้อความ
function renderHtmlBlocks() {
    const ctx = getContext();
    const mesElements = document.querySelectorAll("#chat .mes");

    mesElements.forEach((el, idx) => {
        const msg = ctx.chat[idx];
        if (!msg?.stHtmlBlocks) return;

        const codeTags = el.querySelectorAll("code[data-html-id]");
        codeTags.forEach(code => {
            const id = code.dataset.htmlId;
            const block = msg.stHtmlBlocks.find(b => b.id === id);
            if (!block) return;

            const container = document.createElement("div");
            container.className = "st-html-rendered";
            container.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(block.html) : block.html;

            code.replaceWith(container);
        });
    });
}

jQuery(async () => {
    console.log(`[${MODULE_NAME}] Loaded – น่ารักมากกก`);

    createFloatingPanel();

    // ฟังก์ชันหลัก
    eventSource.on(event_types.MESSAGE_RECEIVED, handleMessageReceived);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, renderHtmlBlocks);
    eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(renderHtmlBlocks, 300));

    // รันครั้งแรก
    setTimeout(renderHtmlBlocks, 800);
});
