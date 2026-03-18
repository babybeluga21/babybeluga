
/**
 * HCM Diary Extension v2.1
 * ─────────────────────────────────────────────────────────────
 * ระบบที่ 01 — Code Manager
 *   • ตรวจจับ ```html...``` จาก AI response
 *   • แทนที่ด้วย <codeN></codeN> ใน context (~450 tok → ~12 tok)
 *   • เก็บ HTML จริงไว้ใน store, แสดง card ใน panel
 *
 * ระบบที่ 02 — Calendar
 *   • AI ใส่ [CAL:person=,date=,time=,activity=,symbol=,details=]
 *   • Extension จับ → ลบออกจากข้อความ → บันทึกปฏิทิน
 *   • Inject ปฏิทินเข้า context ก่อนโรลทุกครั้ง (system prompt position)
 *   • แยกข้อมูลต่อ chatId, บันทึกถาวรใน extension_settings
 * ─────────────────────────────────────────────────────────────
 */

import {
    getContext,
    saveSettingsDebounced,
    eventSource,
    event_types,
} from '../../../../script.js';

import {
    extension_settings,
    setExtensionPrompt,
} from '../../../../extensions.js';

// ═══ CONSTANTS ════════════════════════════════════════════════
const EXT      = 'hcm_diary';
const INJ_KEY  = 'hcm_calendar';
const INJ_POS  = 1;   // position: after system prompt, before chat
const INJ_DEPTH = 0;

const CAL_RE  = /\[CAL:([^\]]+)\]/gi;
const HTML_RE = /```html\s*([\s\S]*?)```/gi;

const SYMBOL_MAP = {
    heart   : { c: '\u2665', label: 'นัดพบ',        color: '#e87098' },
    star    : { c: '\u2605', label: 'สำคัญ',         color: '#e8c870' },
    diamond : { c: '\u25C6', label: 'ประชุม',        color: '#9898e8' },
    note    : { c: '\u266A', label: 'บันเทิง',       color: '#70c898' },
    cross   : { c: '\u271D', label: 'ขัดแย้ง',       color: '#e87070' },
    task    : { c: '\u2295', label: 'งาน/ภารกิจ',   color: '#88a8d8' },
    general : { c: '\u25C7', label: 'ทั่วไป',        color: '#a898c8' },
};

// ═══ SETTINGS ═════════════════════════════════════════════════
const DEFAULTS = {
    enabled         : true,
    calendarEnabled : true,
    codeEnabled     : true,
    calendarData    : {},  // { [chatId]: { events: [] } }
    codeData        : {},  // { [chatId]: { blocks: [] } }
};

function S() {
    if (!extension_settings[EXT]) extension_settings[EXT] = {};
    for (const k in DEFAULTS) {
        if (extension_settings[EXT][k] === undefined)
            extension_settings[EXT][k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
    }
    return extension_settings[EXT];
}

function getChatId() {
    try { return getContext().chatId || 'default'; } catch { return 'default'; }
}

// ═══ CALENDAR DATA ════════════════════════════════════════════
function calData() {
    const s = S(), id = getChatId();
    if (!s.calendarData[id]) s.calendarData[id] = { events: [] };
    return s.calendarData[id];
}

function addEvent(evt) {
    const events = calData().events;
    // ป้องกัน duplicate จาก re-render
    const dup = events.find(e =>
        e.date === evt.date && e.time === evt.time &&
        e.person === evt.person && e.activity === evt.activity
    );
    if (dup) return;
    events.push({ id: Date.now() + Math.random(), ...evt });
    saveSettingsDebounced();
    updateInjection();
    refreshCalUI();
}

function removeEvent(id) {
    const d = calData();
    d.events = d.events.filter(e => e.id !== id);
    saveSettingsDebounced();
    updateInjection();
    refreshCalUI();
}

// ─── Build injection text ──────────────────────────────────────
function updateInjection() {
    if (!S().calendarEnabled) {
        setExtensionPrompt(INJ_KEY, '', INJ_POS, INJ_DEPTH);
        return;
    }
    const events = calData().events;
    if (!events.length) {
        setExtensionPrompt(INJ_KEY, '', INJ_POS, INJ_DEPTH);
        return;
    }

    const now    = new Date();
    const todayS = dateStr(now);
    const timeS  = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const sorted = [...events].sort((a, b) =>
        (`${a.date}${a.time}`).localeCompare(`${b.date}${b.time}`)
    );
    const upcoming = sorted.filter(e => (e.date || '') >= todayS);

    let text = `[ปฏิทินตัวละคร — ${todayS} เวลา ${timeS}]\n`;
    if (!upcoming.length) {
        text += '(ไม่มีกำหนดการที่จะถึง)';
    } else {
        upcoming.slice(0, 15).forEach(e => {
            const when = e.date === todayS ? 'วันนี้' : e.date;
            text += `• ${when} ${e.time || '--:--'} | ${e.person || 'ทุกคน'} | ${e.activity || ''}`;
            if (e.details) text += ` — ${e.details}`;
            text += '\n';
        });
    }
    text += '[/ปฏิทินตัวละคร]';

    setExtensionPrompt(INJ_KEY, text, INJ_POS, INJ_DEPTH);
}

// ═══ CODE DATA ════════════════════════════════════════════════
let globalCounter = 0;

function codeData() {
    const s = S(), id = getChatId();
    if (!s.codeData[id]) s.codeData[id] = { blocks: [] };
    return s.codeData[id];
}

function addBlock(html, msgId) {
    globalCounter++;
    const block = {
        id     : globalCounter,
        html,
        msgId,
        tokens : Math.ceil(html.length / 4),
        ts     : new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
    };
    codeData().blocks.push(block);
    saveSettingsDebounced();
    refreshCodeUI();
    return block;
}

function removeBlock(id) {
    codeData().blocks = codeData().blocks.filter(b => b.id !== id);
    saveSettingsDebounced();
    refreshCodeUI();
}

// ═══ MESSAGE PROCESSING ═══════════════════════════════════════
function processMessage(messageId) {
    const ctx = getContext();
    if (!ctx.chat || !ctx.chat[messageId]) return;
    const msg = ctx.chat[messageId];
    if (msg.is_user) return;

    let text  = msg.mes;
    let dirty = false;

    // ─ Method A: [CAL:...] tags ─
    if (S().calendarEnabled) {
        const hits = [...text.matchAll(CAL_RE)];
        hits.forEach(m => {
            const a = parseAttrs(m[1]);
            if (a.activity || a.date) {
                addEvent({
                    person   : a.person   || '',
                    date     : a.date     || dateStr(new Date()),
                    time     : a.time     || '',
                    activity : a.activity || '',
                    symbol   : a.symbol   || 'general',
                    details  : a.details  || '',
                });
            }
        });
        if (hits.length) {
            text  = text.replace(CAL_RE, '').replace(/\n{3,}/g, '\n\n').trim();
            dirty = true;
        }
        CAL_RE.lastIndex = 0;
    }

    // ─ Method B: regex scan for time keywords ─
    if (S().calendarEnabled) {
        scanPatterns(text, messageId);
    }

    // ─ Code block extraction ─
    if (S().codeEnabled) {
        const htmlHits = [...text.matchAll(HTML_RE)];
        if (htmlHits.length) {
            htmlHits.forEach(m => addBlock(m[1].trim(), messageId));
            let idx = 0;
            text = text.replace(HTML_RE, () => {
                const blocks = codeData().blocks;
                const b = blocks[blocks.length - htmlHits.length + idx];
                idx++;
                return b ? `<code${b.id}></code${b.id}>` : '';
            }).trim();
            dirty = true;
            HTML_RE.lastIndex = 0;
        }
    }

    if (dirty) {
        msg.mes = text;
        const el = document.querySelector(`[mesid="${messageId}"] .mes_text`);
        if (el) el.innerHTML = msg.mes;
        // update badge
        updateBadge();
    }
}

// Method B: scan for schedule keywords + time pattern
const TIME_RE     = /(\d{1,2})[:.h]\d{2}(?:\s*(?:น\.|นาฬิกา|โมง))?/g;
const SCHEDULE_KW = ['นัด', 'ไป', 'พบ', 'ประชุม', 'งาน', 'เจอ', 'meet', 'schedule', 'appointment'];

function scanPatterns(text, msgId) {
    // ข้ามถ้ามี CAL tag อยู่แล้ว
    if (CAL_RE.test(text)) { CAL_RE.lastIndex = 0; return; }
    CAL_RE.lastIndex = 0;
    const hasKw = SCHEDULE_KW.some(k => text.includes(k));
    if (!hasKw) return;
    const times = [...text.matchAll(TIME_RE)];
    if (!times.length) return;
    const t = times[0][0];
    addEvent({
        person   : '',
        date     : dateStr(new Date()),
        time     : t.replace(/[h\s]/g, ':').replace('น.', '').replace('นาฬิกา', '').trim(),
        activity : '[auto] ' + text.slice(0, 45).replace(/\n/g, ' '),
        symbol   : 'general',
        details  : '',
    });
}

function parseAttrs(str) {
    const a = {};
    str.split(',').forEach(pair => {
        const i = pair.indexOf('=');
        if (i > 0) a[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    });
    return a;
}

// ═══ UI PANEL ═════════════════════════════════════════════════
let currentSection = 'toc';
let calView = { year: new Date().getFullYear(), month: new Date().getMonth() };
let selectedDate  = null;

function createPanel() {
    if (document.getElementById('hcm-panel')) return;

    // ── Launcher tab (right edge) ──
    const launcher = document.createElement('div');
    launcher.id = 'hcm-launcher';
    launcher.innerHTML = `
      <div id="hcm-ltab">
        <div class="hcm-lt-gem"><span>H</span></div>
        <div class="hcm-lt-lbl">HCM</div>
        <div id="hcm-bdg"><span id="hcm-bdg-n">0</span></div>
      </div>`;
    launcher.querySelector('#hcm-ltab').addEventListener('click', togglePanel);
    document.body.appendChild(launcher);

    // ── Panel ──
    const panel = document.createElement('div');
    panel.id = 'hcm-panel';
    panel.innerHTML = buildHTML();
    document.body.appendChild(panel);

    bindEvents();
    startClock();
    refreshAllUI();
}

// ─── HTML structure ────────────────────────────────────────────
function buildHTML() {
    return `
<div class="hcm-frame">
  <div class="hcm-rings">${Array(9).fill('<div class="hcm-ring"></div>').join('')}</div>
  <div class="hcm-bmarks">
    <div class="hcm-bm" data-bm="code">โค้ด</div>
    <div class="hcm-bm" data-bm="cal">ปฏิทิน</div>
    <div class="hcm-bm" data-bm="toc">เมนู</div>
  </div>
  <div class="hcm-book">
    <div class="hcm-band hcm-top"></div>

    <div class="hcm-sb">
      <div class="hcm-sb-l">
        <div class="hcm-sb-dot"></div>
        <span id="hcm-clock">--:--:--</span>
        <span class="hcm-sep">·</span>
        <span id="hcm-chatname">SillyTavern</span>
      </div>
      <div class="hcm-sb-r" id="hcm-charname">—</div>
    </div>

    <div class="hcm-hd">
      <div class="hcm-hdm">
        <span class="hcm-eyebrow" id="hcm-eyebrow">HCM Diary</span>
        <div class="hcm-title" id="hcm-title">สารบัญระบบ</div>
        <div class="hcm-sub" id="hcm-sub">ส่วนขยาย SillyTavern</div>
      </div>
      <div class="hcm-hdbtns">
        <div class="hcm-hdbtn" id="hcm-back" style="display:none">&#8592;</div>
        <div class="hcm-hdbtn" id="hcm-close">&#215;</div>
      </div>
    </div>

    <div class="hcm-drow">
      <span class="hcm-dlbl">Date</span>
      <div class="hcm-dval" id="hcm-date">—</div>
    </div>

    <div class="hcm-stabs" id="hcm-tabs-code">
      <div class="hcm-stab hcm-on" data-sv="code">โค้ด <span class="hcm-tbadge" id="hcm-cnt">0</span></div>
      <div class="hcm-stab" data-sv="settings">ตั้งค่า</div>
    </div>
    <div class="hcm-stabs" id="hcm-tabs-cal">
      <div class="hcm-stab hcm-on" data-cv="month">เดือน</div>
      <div class="hcm-stab" data-cv="list">รายการ</div>
      <div class="hcm-stab" data-cv="add">+ เพิ่ม</div>
    </div>

    <div class="hcm-body">
      ${buildTOC()}
      ${buildCode()}
      ${buildCalendar()}
    </div>

    <div class="hcm-band hcm-bot"></div>
    <div class="hcm-hind"><div class="hcm-hbar"></div></div>
  </div>
</div>

<div id="hcm-pop">
  <div class="hcm-ps">
    <div class="hcm-ph">
      <span class="hcm-pt" id="hcm-pt">—</span>
      <button class="hcm-pc" id="hcm-pc-btn">คัดลอก</button>
      <div class="hcm-px" id="hcm-pop-close">&#215;</div>
    </div>
    <div class="hcm-ptb">
      <div class="hcm-ptt hcm-on" data-pt="src">ซอร์สโค้ด</div>
      <div class="hcm-ptt" data-pt="prev">พรีวิว</div>
    </div>
    <div class="hcm-pb">
      <div id="hcm-ptsrc"><pre id="hcm-psrc"></pre></div>
      <div id="hcm-ptprev" style="display:none"><div id="hcm-pprev"></div></div>
    </div>
  </div>
</div>`;
}

function buildTOC() {
    return `
<div class="hcm-view hcm-on" id="hcm-v-toc">
  <div class="hcm-toc-hd">
    <span class="hcm-toc-lbl">NOTE</span>
    <span class="hcm-toc-yr">ระบบ &amp; เครื่องมือ</span>
  </div>
  <div class="hcm-trow hcm-can" data-nav="code">
    <div class="hcm-tl"><div class="hcm-tbig">C</div><div class="hcm-tabb">CODE</div></div>
    <div class="hcm-tm">
      <div class="hcm-tnum">ระบบที่ 01</div>
      <div class="hcm-tname">ตัวจัดการโค้ด</div>
      <div class="hcm-tdesc">จัดเก็บ · แทนที่ · พรีวิว HTML</div>
    </div>
    <div class="hcm-tr"><div class="hcm-tgem"><span>I</span></div></div>
    <div class="hcm-tarrow">&#8250;</div>
  </div>
  <div class="hcm-trow hcm-locked">
    <div class="hcm-tl"><div class="hcm-tbig">M</div><div class="hcm-tabb">MEM</div></div>
    <div class="hcm-tm"><div class="hcm-tnum">ระบบที่ 02</div><div class="hcm-tname">จัดการความจำ</div><div class="hcm-tdesc">เร็ว ๆ นี้</div></div>
    <div class="hcm-tr"><div class="hcm-tgem hcm-grey"><span>&#10007;</span></div></div>
  </div>
  <div class="hcm-trow hcm-locked">
    <div class="hcm-tl"><div class="hcm-tbig">L</div><div class="hcm-tabb">LOG</div></div>
    <div class="hcm-tm"><div class="hcm-tnum">ระบบที่ 03</div><div class="hcm-tname">บันทึกการสนทนา</div><div class="hcm-tdesc">เร็ว ๆ นี้</div></div>
    <div class="hcm-tr"><div class="hcm-tgem hcm-grey"><span>&#10007;</span></div></div>
  </div>
  <div class="hcm-trow hcm-locked" style="border-bottom:none">
    <div class="hcm-tl"><div class="hcm-tbig">S</div><div class="hcm-tabb">SYS</div></div>
    <div class="hcm-tm"><div class="hcm-tnum">ระบบที่ 04</div><div class="hcm-tname">ตั้งค่าส่วนกลาง</div><div class="hcm-tdesc">เร็ว ๆ นี้</div></div>
    <div class="hcm-tr"><div class="hcm-tgem hcm-grey"><span>&#10007;</span></div></div>
  </div>
  <div class="hcm-note-card">
    <div class="hcm-nc-title">คำสั่ง AI สำหรับปฏิทิน</div>
    <div class="hcm-nc-body">
      AI ใส่ tag ในบทโรล → extension จับ → ลบออก → บันทึก → inject ก่อนโรลถัดไป<br><br>
      <code>[CAL:person=,date=YYYY-MM-DD,time=HH:MM,activity=,symbol=,details=]</code><br>
      symbols: heart · star · diamond · note · cross · task · general
    </div>
  </div>
</div>`;
}

function buildCode() {
    return `
<div class="hcm-view" id="hcm-v-code">
  <div class="hcm-sv hcm-on" id="hcm-sv-code">
    <div class="hcm-spill"><div class="hcm-sdot"></div><span>พร้อมทำงาน — เชื่อมต่อ ST</span></div>
    <div class="hcm-srow">
      <div class="hcm-sc"><div class="hcm-scv" id="hcm-total">0</div><div class="hcm-scl">บล็อก</div></div>
      <div class="hcm-sc"><div class="hcm-scv" id="hcm-tok">~0</div><div class="hcm-scl">token ประหยัด</div></div>
    </div>
    <div class="hcm-dvd"><div class="hcm-dvdg"></div><div class="hcm-dvdt">บล็อกที่จัดเก็บ</div></div>
    <div id="hcm-codelist"></div>
    <div class="hcm-btns">
      <button class="hcm-btns2" id="hcm-clear-btn">&#215; ล้าง</button>
      <button class="hcm-btnp" id="hcm-export-btn">&#8595; Export JSON</button>
    </div>
  </div>
  <div class="hcm-sv" id="hcm-sv-settings" style="display:none">
    <div class="hcm-dvd"><div class="hcm-dvdg"></div><div class="hcm-dvdt">ฟีเจอร์</div></div>
    <div class="hcm-feat"><div class="hcm-fn"><span>I</span></div><div><div class="hcm-fname">ตรวจจับ HTML block</div><div class="hcm-fdesc">จับ \`\`\`html...\`\`\` จาก AI แทนที่ใน context ด้วย &lt;codeN&gt;</div></div></div>
    <div class="hcm-feat"><div class="hcm-fn"><span>II</span></div><div><div class="hcm-fname">ประหยัด token</div><div class="hcm-fdesc">~450 token → ~12 token ต่อบล็อก</div></div></div>
    <div class="hcm-feat"><div class="hcm-fn"><span>III</span></div><div><div class="hcm-fname">จับ [CAL:...] tag</div><div class="hcm-fdesc">บันทึกปฏิทินอัตโนมัติ ลบออกจากข้อความ</div></div></div>
    <div class="hcm-feat"><div class="hcm-fn"><span>IV</span></div><div><div class="hcm-fname">Inject ปฏิทิน</div><div class="hcm-fdesc">ส่งกำหนดการเข้า context ก่อนโรลทุกครั้ง</div></div></div>
  </div>
</div>`;
}

function buildCalendar() {
    const symOpts = Object.entries(SYMBOL_MAP)
        .map(([k, v]) => `<option value="${k}">${v.c} ${v.label}</option>`).join('');
    return `
<div class="hcm-view" id="hcm-v-cal">
  <div class="hcm-sv hcm-on hcm-cal-full" id="hcm-calv-month">
    <div class="hcm-cal-nav">
      <button class="hcm-cal-nb" id="hcm-cal-prev">&#8249;</button>
      <div class="hcm-cal-lbl" id="hcm-cal-lbl">—</div>
      <button class="hcm-cal-nb" id="hcm-cal-next">&#8250;</button>
    </div>
    <div class="hcm-cal-pf">
      <span class="hcm-cal-pfl">บุคคล</span>
      <select class="hcm-psel" id="hcm-pfilter"><option value="">ทุกคน</option></select>
    </div>
    <div class="hcm-cal-dows">
      <div>อา.</div><div>จ.</div><div>อ.</div><div>พ.</div>
      <div>พฤ.</div><div>ศ.</div><div>ส.</div>
    </div>
    <div class="hcm-cal-grid" id="hcm-cal-grid"></div>
    <div class="hcm-cal-leg" id="hcm-cal-leg"></div>
    <div class="hcm-cal-det" id="hcm-cal-det" style="display:none"></div>
  </div>

  <div class="hcm-sv" id="hcm-calv-list" style="display:none">
    <div class="hcm-dvd" style="margin:0 0 8px"><div class="hcm-dvdg"></div><div class="hcm-dvdt">กำหนดการทั้งหมด</div></div>
    <div id="hcm-ev-list"></div>
  </div>

  <div class="hcm-sv" id="hcm-calv-add" style="display:none">
    <div class="hcm-dvd" style="margin:0 0 8px"><div class="hcm-dvdg"></div><div class="hcm-dvdt">เพิ่มกำหนดการ</div></div>
    <div class="hcm-fg"><div class="hcm-fl">บุคคล</div><input type="text" id="hcm-a-person" placeholder="ชื่อตัวละคร" class="hcm-input"></div>
    <div class="hcm-fg"><div class="hcm-fl">วันที่</div><input type="date" id="hcm-a-date" class="hcm-input"></div>
    <div class="hcm-fg"><div class="hcm-fl">เวลา</div><input type="time" id="hcm-a-time" class="hcm-input"></div>
    <div class="hcm-fg"><div class="hcm-fl">กิจกรรม</div><input type="text" id="hcm-a-act" placeholder="รายละเอียดกิจกรรม" class="hcm-input"></div>
    <div class="hcm-fg"><div class="hcm-fl">สัญลักษณ์</div><select id="hcm-a-sym" class="hcm-input">${symOpts}</select></div>
    <div class="hcm-fg"><div class="hcm-fl">รายละเอียด</div><input type="text" id="hcm-a-detail" placeholder="โน้ตเพิ่มเติม" class="hcm-input"></div>
    <button class="hcm-btnp" id="hcm-add-save">&#43; บันทึก</button>
  </div>
</div>`;
}

// ═══ EVENT BINDING ════════════════════════════════════════════
function bindEvents() {
    // Close / back
    document.getElementById('hcm-close').addEventListener('click', () => togglePanel());
    document.getElementById('hcm-back' ).addEventListener('click', navBack);

    // Bookmark navigation
    document.querySelectorAll('.hcm-bm').forEach(bm => {
        bm.addEventListener('click', () => {
            const target = bm.dataset.bm;
            if (!panelOpen()) openPanel();
            if (target === 'toc') navBack();
            else openSection(target);
        });
    });

    // TOC row click
    document.querySelectorAll('.hcm-trow.hcm-can').forEach(row => {
        row.addEventListener('click', () => openSection(row.dataset.nav));
    });

    // Code sub-tabs
    document.querySelectorAll('#hcm-tabs-code .hcm-stab').forEach(t =>
        t.addEventListener('click', () => switchSub('code', t.dataset.sv))
    );

    // Cal sub-tabs
    document.querySelectorAll('#hcm-tabs-cal .hcm-stab').forEach(t =>
        t.addEventListener('click', () => {
            switchSub('cal', t.dataset.cv);
            if (t.dataset.cv === 'month') renderCalGrid();
            if (t.dataset.cv === 'list')  renderCalList();
        })
    );

    // Calendar nav
    document.getElementById('hcm-cal-prev').addEventListener('click', () => {
        calView.month--;
        if (calView.month < 0) { calView.month = 11; calView.year--; }
        renderCalGrid();
    });
    document.getElementById('hcm-cal-next').addEventListener('click', () => {
        calView.month++;
        if (calView.month > 11) { calView.month = 0; calView.year++; }
        render
