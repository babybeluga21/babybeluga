/**
 * HCM Diary v2.2 — no imports, window globals only
 */
console.log('[HCM] index.js parsing...');

// ── ST globals ──────────────────────────────────────────────
const _getCtx   = () => { try { return window.SillyTavern?.getContext?.() ?? {}; } catch { return {}; } };
const _saveSet  = () => { try { if (window.saveSettingsDebounced) window.saveSettingsDebounced(); } catch {} };
const _setPrompt = (key, text, pos, depth) => {
    try { if (window.setExtensionPrompt) window.setExtensionPrompt(key, text, pos, depth); } catch {}
};

// ── Constants ────────────────────────────────────────────────
const EXT     = 'hcm_diary';
const INJ_KEY = 'hcm_calendar';
const CAL_RE  = /\[CAL:([^\]]+)\]/gi;
const HTML_RE = /```html\s*([\s\S]*?)```/gi;

const SYM = {
    heart  : { c: '\u2665', l: 'นัดพบ',        col: '#e87098' },
    star   : { c: '\u2605', l: 'สำคัญ',         col: '#e8c870' },
    diamond: { c: '\u25C6', l: 'ประชุม',        col: '#9898e8' },
    note   : { c: '\u266A', l: 'บันเทิง',       col: '#70c898' },
    cross  : { c: '\u271D', l: 'ขัดแย้ง',       col: '#e87070' },
    task   : { c: '\u2295', l: 'งาน/ภารกิจ',   col: '#88a8d8' },
    general: { c: '\u25C7', l: 'ทั่วไป',        col: '#a898c8' },
};

const DEFAULTS = {
    enabled: true, calendarEnabled: true, codeEnabled: true,
    calendarData: {}, codeData: {}
};

// ── Settings ─────────────────────────────────────────────────
function S() {
    const store = window.extension_settings;
    if (!store) return JSON.parse(JSON.stringify(DEFAULTS));
    if (!store[EXT]) store[EXT] = {};
    for (const k in DEFAULTS) {
        if (store[EXT][k] === undefined)
            store[EXT][k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
    }
    return store[EXT];
}

function getChatId() { return _getCtx().chatId || 'default'; }

// ── Calendar Data ─────────────────────────────────────────────
function calData() {
    const s = S(), id = getChatId();
    if (!s.calendarData[id]) s.calendarData[id] = { events: [] };
    return s.calendarData[id];
}

function addEvent(evt) {
    const evts = calData().events;
    const dup = evts.find(e => e.date === evt.date && e.time === evt.time &&
        e.person === evt.person && e.activity === evt.activity);
    if (dup) return;
    evts.push({ id: Date.now() + Math.random(), ...evt });
    _saveSet(); updateInjection(); refreshCalUI();
}

function removeEvent(id) {
    const d = calData();
    d.events = d.events.filter(e => e.id !== id);
    _saveSet(); updateInjection(); refreshCalUI();
}

function updateInjection() {
    if (!S().calendarEnabled) { _setPrompt(INJ_KEY, '', 1, 0); return; }
    const evts = calData().events;
    if (!evts.length) { _setPrompt(INJ_KEY, '', 1, 0); return; }
    const now = new Date(), todayS = dStr(now);
    const sorted = [...evts].sort((a, b) => (`${a.date}${a.time}`).localeCompare(`${b.date}${b.time}`));
    const upcoming = sorted.filter(e => (e.date || '') >= todayS);
    let text = `[ปฏิทินตัวละคร — ${todayS} ${pad(now.getHours())}:${pad(now.getMinutes())}]\n`;
    if (!upcoming.length) { text += '(ไม่มีกำหนดการที่จะถึง)'; }
    else upcoming.slice(0, 15).forEach(e => {
        text += `• ${e.date === todayS ? 'วันนี้' : e.date} ${e.time || '--:--'} | ${e.person || 'ทุกคน'} | ${e.activity || ''}`;
        if (e.details) text += ` — ${e.details}`;
        text += '\n';
    });
    text += '[/ปฏิทินตัวละคร]';
    _setPrompt(INJ_KEY, text, 1, 0);
}

// ── Code Data ─────────────────────────────────────────────────
let gCnt = 0;
function codeData() {
    const s = S(), id = getChatId();
    if (!s.codeData[id]) s.codeData[id] = { blocks: [] };
    return s.codeData[id];
}

function addBlock(html, msgId) {
    gCnt++;
    const b = { id: gCnt, html, msgId, tokens: Math.ceil(html.length / 4),
        ts: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) };
    codeData().blocks.push(b);
    _saveSet(); refreshCodeUI(); return b;
}

function removeBlock(id) {
    codeData().blocks = codeData().blocks.filter(b => b.id !== id);
    _saveSet(); refreshCodeUI();
}

// ── Message Processing ────────────────────────────────────────
function processMessage(messageId) {
    const ctx = _getCtx();
    if (!ctx.chat || !ctx.chat[messageId]) return;
    const msg = ctx.chat[messageId];
    if (msg.is_user) return;
    let text = msg.mes, dirty = false;

    if (S().calendarEnabled) {
        const hits = [...text.matchAll(CAL_RE)];
        hits.forEach(m => {
            const a = parseAttrs(m[1]);
            if (a.activity || a.date) addEvent({
                person: a.person || '', date: a.date || dStr(new Date()),
                time: a.time || '', activity: a.activity || '',
                symbol: a.symbol || 'general', details: a.details || ''
            });
        });
        if (hits.length) { text = text.replace(CAL_RE, '').replace(/\n{3,}/g, '\n\n').trim(); dirty = true; }
        CAL_RE.lastIndex = 0;
    }

    if (S().codeEnabled) {
        const hits = [...text.matchAll(HTML_RE)];
        if (hits.length) {
            hits.forEach(m => addBlock(m[1].trim(), messageId));
            let idx = 0;
            const blocks = codeData().blocks;
            text = text.replace(HTML_RE, () => {
                const b = blocks[blocks.length - hits.length + idx++];
                return b ? `<code${b.id}></code${b.id}>` : '';
            }).trim();
            HTML_RE.lastIndex = 0; dirty = true;
        }
    }

    if (dirty) {
        msg.mes = text;
        const el = document.querySelector(`[mesid="${messageId}"] .mes_text`);
        if (el) el.innerHTML = msg.mes;
        updateBadge();
    }
}

function parseAttrs(str) {
    const a = {};
    str.split(',').forEach(p => { const i = p.indexOf('='); if (i > 0) a[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
    return a;
}

// ── Panel state ───────────────────────────────────────────────
let curSection = 'toc';
let calView = { year: new Date().getFullYear(), month: new Date().getMonth() };
let selDate = null;
let curPopId = null;
let isOpen = false;
// drag state
let dragOn = false, dragOX = 0, dragOY = 0;

// ── Create Panel ──────────────────────────────────────────────
function createPanel() {
    if (document.getElementById('hcm-launcher')) return;

    // Launcher
    const lnc = document.createElement('div');
    lnc.id = 'hcm-launcher';
    lnc.innerHTML = `<div class="hcm-lt-gem"><span>H</span></div>
      <div class="hcm-lt-lbl">HCM</div>
      <div id="hcm-bdg"><span id="hcm-bdg-n">0</span></div>`;
    lnc.addEventListener('click', togglePanel);
    lnc.addEventListener('touchend', e => { e.preventDefault(); togglePanel(); });
    document.body.appendChild(lnc);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'hcm-panel';
    panel.innerHTML = buildHTML();
    document.body.appendChild(panel);

    initStars();
    bindEvents();
    startClock();
    refreshAllUI();
    console.log('[HCM] Panel created OK');
}

function buildHTML() {
    const symOpts = Object.entries(SYM).map(([k, v]) => `<option value="${k}">${v.c} ${v.l}</option>`).join('');
    return `
<canvas id="hcm-sc"></canvas>
<div class="hcm-frame">
  <div class="hcm-rings">${'<div class="hcm-ring"></div>'.repeat(8)}</div>
  <div class="hcm-bmarks">
    <div class="hcm-bm" data-bm="code">โค้ด</div>
    <div class="hcm-bm" data-bm="cal">ปฏิทิน</div>
    <div class="hcm-bm" data-bm="toc">เมนู</div>
  </div>
  <div class="hcm-book">
    <div class="hcm-band hcm-top"></div>
    <div class="hcm-sb" id="hcm-drag-handle">
      <div class="hcm-sb-l"><div class="hcm-sb-dot"></div><span id="hcm-clock">--:--:--</span><span class="hcm-sep">·</span><span id="hcm-chatname">SillyTavern</span></div>
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
    <div class="hcm-drow"><span class="hcm-dlbl">Date</span><div class="hcm-dval" id="hcm-date">—</div></div>
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

      <div id="hcm-v-toc">
        <div class="hcm-toc-hd"><span class="hcm-toc-lbl">NOTE</span><span class="hcm-toc-yr">ระบบ &amp; เครื่องมือ</span></div>
        <div class="hcm-trow hcm-can" data-nav="code">
          <div class="hcm-tl"><div class="hcm-tbig">C</div><div class="hcm-tabb">CODE</div></div>
          <div class="hcm-tm"><div class="hcm-tnum">ระบบที่ 01</div><div class="hcm-tname">ตัวจัดการโค้ด</div><div class="hcm-tdesc">จัดเก็บ · แทนที่ · พรีวิว HTML</div></div>
          <div class="hcm-tr"><div class="hcm-tgem"><span>I</span></div></div><div class="hcm-tarrow">&#8250;</div>
        </div>
        <div class="hcm-trow hcm-locked"><div class="hcm-tl"><div class="hcm-tbig">M</div><div class="hcm-tabb">MEM</div></div><div class="hcm-tm"><div class="hcm-tnum">ระบบที่ 02</div><div class="hcm-tname">จัดการความจำ</div><div class="hcm-tdesc">เร็ว ๆ นี้</div></div><div class="hcm-tr"><div class="hcm-tgem hcm-grey"><span>&#10007;</span></div></div></div>
        <div class="hcm-trow hcm-locked"><div class="hcm-tl"><div class="hcm-tbig">L</div><div class="hcm-tabb">LOG</div></div><div class="hcm-tm"><div class="hcm-tnum">ระบบที่ 03</div><div class="hcm-tname">บันทึกการสนทนา</div><div class="hcm-tdesc">เร็ว ๆ นี้</div></div><div class="hcm-tr"><div class="hcm-tgem hcm-grey"><span>&#10007;</span></div></div></div>
        <div class="hcm-trow hcm-locked" style="border-bottom:none"><div class="hcm-tl"><div class="hcm-tbig">S</div><div class="hcm-tabb">SYS</div></div><div class="hcm-tm"><div class="hcm-tnum">ระบบที่ 04</div><div class="hcm-tname">ตั้งค่าส่วนกลาง</div><div class="hcm-tdesc">เร็ว ๆ นี้</div></div><div class="hcm-tr"><div class="hcm-tgem hcm-grey"><span>&#10007;</span></div></div></div>
        <div class="hcm-note-card">
          <div class="hcm-nc-title">คำสั่ง AI สำหรับปฏิทิน</div>
          <div class="hcm-nc-body">AI ใส่ tag ในบทโรล → extension จับ → ลบ → บันทึก → inject ก่อนโรลถัดไป<br><br>
          <code>[CAL:person=,date=YYYY-MM-DD,time=HH:MM,activity=,symbol=,details=]</code><br>
          symbols: heart · star · diamond · note · cross · task · general</div>
        </div>
      </div>

      <div id="hcm-v-code" style="display:none">
        <div id="hcm-sv-code" style="padding:10px 14px 12px 11px">
          <div class="hcm-spill"><div class="hcm-sdot"></div><span>พร้อมทำงาน — เชื่อมต่อ ST</span></div>
          <div class="hcm-srow">
            <div class="hcm-sc2"><div class="hcm-scv" id="hcm-total">0</div><div class="hcm-scl">บล็อก</div></div>
            <div class="hcm-sc2"><div class="hcm-scv" id="hcm-tok">~0</div><div class="hcm-scl">token ประหยัด</div></div>
          </div>
          <div class="hcm-dvd"><div class="hcm-dvdg"></div><div class="hcm-dvdt">บล็อกที่จัดเก็บ</div></div>
          <div id="hcm-codelist"></div>
          <div class="hcm-btns">
            <button class="hcm-btns2" id="hcm-clear-btn">&#215; ล้าง</button>
            <button class="hcm-btnp" id="hcm-export-btn">&#8595; Export</button>
          </div>
        </div>
        <div id="hcm-sv-settings" style="display:none;padding:10px 14px 12px 11px">
          <div class="hcm-dvd"><div class="hcm-dvdg"></div><div class="hcm-dvdt">ฟีเจอร์</div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>I</span></div><div><div class="hcm-fname">ตรวจจับ HTML block</div><div class="hcm-fdesc">จับ \`\`\`html...\`\`\` จาก AI แทนที่ด้วย &lt;codeN&gt;</div></div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>II</span></div><div><div class="hcm-fname">ประหยัด token</div><div class="hcm-fdesc">~450 token → ~12 token ต่อบล็อก</div></div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>III</span></div><div><div class="hcm-fname">จับ [CAL:...] tag</div><div class="hcm-fdesc">บันทึกปฏิทินอัตโนมัติ ลบออกจากข้อความ</div></div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>IV</span></div><div><div class="hcm-fname">Inject ปฏิทิน</div><div class="hcm-fdesc">ส่งกำหนดการเข้า context ก่อนโรลทุกครั้ง</div></div></div>
        </div>
      </div>

      <div id="hcm-v-cal" style="display:none">
        <div id="hcm-calv-month">
          <div class="hcm-cal-nav">
            <button class="hcm-cal-nb" id="hcm-cal-prev">&#8249;</button>
            <div class="hcm-cal-lbl" id="hcm-cal-lbl">—</div>
            <button class="hcm-cal-nb" id="hcm-cal-next">&#8250;</button>
          </div>
          <div class="hcm-cal-pf">
            <span class="hcm-cal-pfl">บุคคล</span>
            <select id="hcm-pfilter" style="font-size:9px;flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);color:rgba(255,255,255,.92);padding:2px 5px;outline:none">
              <option value="">ทุกคน</option>
            </select>
          </div>
          <div class="hcm-cal-dows"><div>อา.</div><div>จ.</div><div>อ.</div><div>พ.</div><div>พฤ.</div><div>ศ.</div><div>ส.</div></div>
          <div class="hcm-cal-grid" id="hcm-cal-grid"></div>
          <div class="hcm-cal-leg" id="hcm-cal-leg"></div>
          <div id="hcm-cal-det" style="display:none"></div>
        </div>
        <div id="hcm-calv-list" style="display:none;padding:10px 14px 12px 11px">
          <div class="hcm-dvd"><div class="hcm-dvdg"></div><div class="hcm-dvdt">กำหนดการทั้งหมด</div></div>
          <div id="hcm-ev-list"></div>
        </div>
        <div id="hcm-calv-add" style="display:none;padding:10px 14px 12px 11px">
          <div class="hcm-dvd"><div class="hcm-dvdg"></div><div class="hcm-dvdt">เพิ่มกำหนดการ</div></div>
          <div class="hcm-fg"><div class="hcm-fl">บุคคล</div><input type="text" id="hcm-a-person" placeholder="ชื่อตัวละคร" class="hcm-inp"></div>
          <div class="hcm-fg"><div class="hcm-fl">วันที่</div><input type="date" id="hcm-a-date" class="hcm-inp"></div>
          <div class="hcm-fg"><div class="hcm-fl">เวลา</div><input type="time" id="hcm-a-time" class="hcm-inp"></div>
          <div class="hcm-fg"><div class="hcm-fl">กิจกรรม</div><input type="text" id="hcm-a-act" placeholder="รายละเอียดกิจกรรม" class="hcm-inp"></div>
          <div class="hcm-fg"><div class="hcm-fl">สัญลักษณ์</div><select id="hcm-a-sym" class="hcm-inp">${symOpts}</select></div>
          <div class="hcm-fg"><div class="hcm-fl">รายละเอียด</div><input type="text" id="hcm-a-detail" placeholder="โน้ตเพิ่มเติม" class="hcm-inp"></div>
          <button class="hcm-btnp" id="hcm-add-save" style="margin-top:4px;width:100%">&#43; บันทึก</button>
        </div>
      </div>

    </div>
    <div class="hcm-band hcm-bot"></div>
    <div class="hcm-hind" id="hcm-resize-handle"><div class="hcm-hbar"></div></div>
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
      <div id="hcm-ptsrc"><pre id="hcm-psrc" style="font-family:'Courier New',monospace;font-size:9px;color:rgba(255,255,255,.88);white-space:pre-wrap;word-break:break-all;line-height:1.6;margin:0;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);padding:10px"></pre></div>
      <div id="hcm-ptprev" style="display:none"><div id="hcm-pprev" style="background:white;padding:14px;min-height:60px"></div></div>
    </div>
  </div>
</div>`;
}

// ── Starfield ─────────────────────────────────────────────────
function initStars() {
    const canvas = document.getElementById('hcm-sc');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, stars = [];

    function resize() {
        const panel = document.getElementById('hcm-panel');
        W = canvas.width  = panel.offsetWidth  || 330;
        H = canvas.height = panel.offsetHeight || 600;
        stars = [];
        const n = Math.floor(W * H / 2800);
        for (let i = 0; i < n; i++) {
            const s = Math.random();
            stars.push({ x: Math.random() * W, y: Math.random() * H,
                r: s < .72 ? .38 : s < .9 ? .7 : 1.1,
                a: Math.random(), da: (.0002 + Math.random() * .0005) * (Math.random() < .5 ? 1 : -1),
                col: Math.random() < .65 ? '255,255,255' : Math.random() < .5 ? '200,175,255' : '165,205,255' });
        }
    }

    function draw() {
        if (!document.getElementById('hcm-panel')) return;
        ctx.clearRect(0, 0, W, H);
        // dark base
        ctx.fillStyle = '#0b0c1a';
        ctx.fillRect(0, 0, W, H);
        // nebula
        const g1 = ctx.createRadialGradient(W * .22, H * .28, 0, W * .22, H * .28, W * .55);
        g1.addColorStop(0, 'rgba(140,70,200,.07)'); g1.addColorStop(1, 'transparent');
        ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H);
        const g2 = ctx.createRadialGradient(W * .8, H * .65, 0, W * .8, H * .65, W * .45);
        g2.addColorStop(0, 'rgba(70,90,210,.06)'); g2.addColorStop(1, 'transparent');
        ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
        // stars
        stars.forEach(s => {
            s.a += s.da; if (s.a > 1 || s.a < .04) s.da *= -1;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${s.col},${s.a.toFixed(2)})`; ctx.fill();
        });
        requestAnimationFrame(draw);
    }

    resize(); draw();
    // resize when panel opens
    document.getElementById('hcm-launcher').addEventListener('click', () => setTimeout(resize, 50));
}

// ── Drag + Resize ─────────────────────────────────────────────
function initDrag() {
    const handle = document.getElementById('hcm-drag-handle');
    const panel  = document.getElementById('hcm-panel');
    const rHandle = document.getElementById('hcm-resize-handle');
    if (!handle || !panel) return;

    // ─ Move drag (top bar) ─
    function startDrag(cx, cy) {
        dragOn = true;
        const r = panel.getBoundingClientRect();
        dragOX = cx - r.left; dragOY = cy - r.top;
        panel.style.transition = 'none';
    }
    function moveDrag(cx, cy) {
        if (!dragOn) return;
        let nx = cx - dragOX, ny = cy - dragOY;
        nx = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  nx));
        ny = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ny));
        panel.style.left = nx + 'px'; panel.style.top = ny + 'px';
        panel.style.right = 'auto'; panel.style.transform = 'none';
    }
    function endDrag() { dragOn = false; panel.style.transition = ''; }

    handle.addEventListener('mousedown',  e => { e.preventDefault(); startDrag(e.clientX, e.clientY); });
    document.addEventListener('mousemove', e => moveDrag(e.clientX, e.clientY));
    document.addEventListener('mouseup',   endDrag);
    handle.addEventListener('touchstart',  e => { const t = e.touches[0]; startDrag(t.clientX, t.clientY); }, { passive: true });
    document.addEventListener('touchmove',  e => { if (!dragOn) return; const t = e.touches[0]; moveDrag(t.clientX, t.clientY); }, { passive: true });
    document.addEventListener('touchend',   endDrag);

    // ─ Resize drag (bottom handle) ─
    if (!rHandle) return;
    let resizeOn = false, resizeStartY = 0, resizeStartH = 0;

    function startResize(cy) {
        resizeOn = true;
        resizeStartY = cy;
        resizeStartH = panel.offsetHeight;
        panel.style.transition = 'none';
        document.body.style.userSelect = 'none';
    }
    function moveResize(cy) {
        if (!resizeOn) return;
        const newH = Math.max(300, Math.min(window.innerHeight - 20, resizeStartH + (cy - resizeStartY)));
        panel.style.maxHeight = newH + 'px';
        panel.style.height    = newH + 'px';
        // resize stars canvas too
        const sc = document.getElementById('hcm-sc');
        if (sc) { sc.width = panel.offsetWidth; sc.height = newH; }
    }
    function endResize() { resizeOn = false; panel.style.transition = ''; document.body.style.userSelect = ''; }

    rHandle.addEventListener('mousedown',  e => { e.preventDefault(); startResize(e.clientY); });
    document.addEventListener('mousemove', e => { if (resizeOn) moveResize(e.clientY); });
    document.addEventListener('mouseup',   endResize);
    rHandle.addEventListener('touchstart',  e => { startResize(e.touches[0].clientY); }, { passive: true });
    document.addEventListener('touchmove',  e => { if (!resizeOn) return; moveResize(e.touches[0].clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener('touchend',   endResize);
}

// ── Resize (bottom handle) ────────────────────────────────────
function initResize() {
    const handle = document.querySelector('.hcm-hind');
    const panel  = document.getElementById('hcm-panel');
    if (!handle || !panel) return;

    let resizing = false, startY = 0, startH = 0;
    const MIN_H = 280, MAX_H = window.innerHeight * 0.95;

    function startResize(cy) {
        resizing = true; startY = cy;
        startH = panel.offsetHeight;
        panel.style.transition = 'none';
        document.body.style.userSelect = 'none';
    }
    function doResize(cy) {
        if (!resizing) return;
        let newH = startH + (cy - startY);
        newH = Math.min(Math.max(newH, MIN_H), MAX_H);
        panel.style.maxHeight = newH + 'px';
        panel.style.height    = newH + 'px';
        // resize starfield canvas too
        const sc = document.getElementById('hcm-sc');
        if (sc) { sc.width = panel.offsetWidth; sc.height = panel.offsetHeight; }
    }
    function endResize() {
        if (!resizing) return;
        resizing = false;
        panel.style.transition = '';
        document.body.style.userSelect = '';
    }

    handle.addEventListener('mousedown',  e => { e.preventDefault(); startResize(e.clientY); });
    document.addEventListener('mousemove', e => doResize(e.clientY));
    document.addEventListener('mouseup',   endResize);
    handle.addEventListener('touchstart',  e => { const t = e.touches[0]; startResize(t.clientY); }, { passive: true });
    document.addEventListener('touchmove',  e => { if (!resizing) return; const t = e.touches[0]; doResize(t.clientY); e.preventDefault(); }, { passive: false });
    document.addEventListener('touchend',   endResize);
}


function bindEvents() {
    document.getElementById('hcm-close').addEventListener('click', togglePanel);
    document.getElementById('hcm-back' ).addEventListener('click', navBack);

    document.querySelectorAll('.hcm-bm').forEach(bm => bm.addEventListener('click', () => {
        if (!isOpen) openPanel();
        if (bm.dataset.bm === 'toc') navBack(); else openSec(bm.dataset.bm);
    }));
    document.querySelectorAll('.hcm-trow.hcm-can').forEach(r =>
        r.addEventListener('click', () => openSec(r.dataset.nav)));

    document.querySelectorAll('#hcm-tabs-code .hcm-stab').forEach(t =>
        t.addEventListener('click', () => switchSub('code', t.dataset.sv)));
    document.querySelectorAll('#hcm-tabs-cal .hcm-stab').forEach(t =>
        t.addEventListener('click', () => {
            switchSub('cal', t.dataset.cv);
            if (t.dataset.cv === 'month') renderGrid();
            if (t.dataset.cv === 'list')  renderList();
        }));

    document.getElementById('hcm-cal-prev').addEventListener('click', () => { calView.month--; if (calView.month < 0) { calView.month = 11; calView.year--; } renderGrid(); });
    document.getElementById('hcm-cal-next').addEventListener('click', () => { calView.month++; if (calView.month > 11) { calView.month = 0; calView.year++; } renderGrid(); });
    document.getElementById('hcm-pfilter').addEventListener('change', renderGrid);
    document.getElementById('hcm-clear-btn' ).addEventListener('click', () => { codeData().blocks = []; _saveSet(); refreshCodeUI(); });
    document.getElementById('hcm-export-btn').addEventListener('click', exportJSON);
    document.getElementById('hcm-add-save'  ).addEventListener('click', saveEvent);
    document.getElementById('hcm-a-date').value = dStr(new Date());

    document.getElementById('hcm-pop-close').addEventListener('click', closePop);
    document.getElementById('hcm-pop').addEventListener('click', e => { if (e.target.id === 'hcm-pop') closePop(); });
    document.getElementById('hcm-pc-btn').addEventListener('click', () => {
        const b = codeData().blocks.find(x => x.id === curPopId);
        if (!b) return;
        navigator.clipboard.writeText(b.html).catch(() => {});
        const btn = document.getElementById('hcm-pc-btn');
        btn.textContent = 'คัดลอกแล้ว'; setTimeout(() => btn.textContent = 'คัดลอก', 1400);
    });
    document.querySelectorAll('.hcm-ptt').forEach(t => t.addEventListener('click', () => {
        document.querySelectorAll('.hcm-ptt').forEach(x => x.classList.remove('hcm-on')); t.classList.add('hcm-on');
        document.getElementById('hcm-ptsrc' ).style.display = t.dataset.pt === 'src'  ? 'block' : 'none';
        document.getElementById('hcm-ptprev').style.display = t.dataset.pt === 'prev' ? 'block' : 'none';
    }));

    initDrag();
    initResize();
}

// ── Navigation ────────────────────────────────────────────────
function openPanel() {
    isOpen = true;
    const p = document.getElementById('hcm-panel');
    p.classList.add('hcm-open');
    // center on first open
    if (!p.style.left) {
        const pw = p.offsetWidth || 330;
        p.style.left = Math.max(4, Math.round((window.innerWidth - pw) / 2)) + 'px';
        p.style.top  = '50%';
        p.style.transform = 'translateY(-50%)';
        p.style.right = 'auto';
    }
}
function closePanel() { isOpen = false; document.getElementById('hcm-panel').classList.remove('hcm-open'); }
function togglePanel() { isOpen ? closePanel() : openPanel(); }

function setActiveBm(s) {
    document.querySelectorAll('.hcm-bm').forEach(b => b.classList.toggle('hcm-active', b.dataset.bm === s));
}

function openSec(s) {
    curSection = s;
    ['toc','code','cal'].forEach(v => { const e = document.getElementById(`hcm-v-${v}`); if (e) e.style.display = 'none'; });
    document.getElementById('hcm-tabs-code').style.display = 'none';
    document.getElementById('hcm-tabs-cal' ).style.display = 'none';
    document.getElementById('hcm-back').style.display = 'flex';
    setActiveBm(s);
    if (s === 'code') {
        document.getElementById('hcm-v-code').style.display = 'flex';
        document.getElementById('hcm-v-code').style.flexDirection = 'column';
        document.getElementById('hcm-tabs-code').style.display = 'flex';
        document.getElementById('hcm-sv-code').style.display = 'block';
        setHdr('ระบบที่ 01', 'ตัวจัดการโค้ด', 'HTML Block Store');
        refreshCodeUI();
    } else {
        document.getElementById('hcm-v-cal').style.display = 'flex';
        document.getElementById('hcm-v-cal').style.flexDirection = 'column';
        document.getElementById('hcm-tabs-cal').style.display = 'flex';
        document.getElementById('hcm-calv-month').style.display = 'block';
        setHdr('ระบบที่ 02', 'ปฏิทินตัวละคร', 'กิจกรรมในโรล');
        buildPF(); renderGrid(); renderList();
    }
}

function navBack() {
    curSection = 'toc';
    document.getElementById('hcm-v-code').style.display = 'none';
    document.getElementById('hcm-v-cal' ).style.display = 'none';
    document.getElementById('hcm-v-toc' ).style.display = 'block';
    document.getElementById('hcm-tabs-code').style.display = 'none';
    document.getElementById('hcm-tabs-cal' ).style.display = 'none';
    document.getElementById('hcm-back').style.display = 'none';
    setHdr('HCM Diary', 'สารบัญระบบ', 'ส่วนขยาย SillyTavern');
    setActiveBm('toc');
}

function switchSub(sec, name) {
    const tabsId = sec === 'code' ? 'hcm-tabs-code' : 'hcm-tabs-cal';
    const attr   = sec === 'code' ? 'sv' : 'cv';
    document.querySelectorAll(`#${tabsId} .hcm-stab`).forEach(x => x.classList.remove('hcm-on'));
    const t = document.querySelector(`#${tabsId} .hcm-stab[data-${attr}="${name}"]`);
    if (t) t.classList.add('hcm-on');
    if (sec === 'code') {
        ['code','settings'].forEach(k => { const e = document.getElementById(`hcm-sv-${k}`); if (e) e.style.display = 'none'; });
        const v = document.getElementById(`hcm-sv-${name}`); if (v) v.style.display = 'block';
    } else {
        ['month','list','add'].forEach(k => { const e = document.getElementById(`hcm-calv-${k}`); if (e) e.style.display = 'none'; });
        const v = document.getElementById(`hcm-calv-${name}`); if (v) v.style.display = 'block';
    }
}

// ── Calendar UI ───────────────────────────────────────────────
const TH_M = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_S = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function renderGrid() {
    const { year, month } = calView;
    document.getElementById('hcm-cal-lbl').textContent = `${TH_M[month]} ${year + 543}`;
    const pf = document.getElementById('hcm-pfilter').value;
    const evts = calData().events.filter(e => !pf || e.person === pf);
    const first = new Date(year, month, 1).getDay();
    const last  = new Date(year, month + 1, 0).getDate();
    const todayS = dStr(new Date());
    const g = document.getElementById('hcm-cal-grid'); g.innerHTML = '';
    for (let i = 0; i < first; i++) { const c = document.createElement('div'); c.className = 'hcm-cd hcm-emp'; g.appendChild(c); }
    for (let d = 1; d <= last; d++) {
        const ds = `${year}-${pad(month+1)}-${pad(d)}`;
        const de = evts.filter(e => e.date === ds);
        const c  = document.createElement('div');
        c.className = 'hcm-cd' + (ds === todayS ? ' hcm-tdy' : '') + (ds === selDate ? ' hcm-sel' : '');
        c.innerHTML = `<div class="hcm-dn">${d}</div>`;
        if (de.length) {
            const ss = document.createElement('div'); ss.className = 'hcm-syms';
            de.slice(0, 3).forEach(ev => {
                const sy = SYM[ev.symbol] || SYM.general;
                const sp = document.createElement('span');
                sp.className = 'hcm-sym'; sp.style.color = sy.col; sp.textContent = sy.c;
                ss.appendChild(sp);
            }); c.appendChild(ss);
        }
        c.addEventListener('click', () => showDay(ds, de)); g.appendChild(c);
    }
    renderLeg();
}

function renderLeg() {
    document.getElementById('hcm-cal-leg').innerHTML = Object.values(SYM).map(v =>
        `<div class="hcm-leg-it"><span class="hcm-sym" style="color:${v.col}">${v.c}</span><span>${v.l}</span></div>`).join('');
}

function showDay(ds, evts) {
    selDate = ds; renderGrid();
    const det = document.getElementById('hcm-cal-det');
    if (!evts.length) { det.style.display = 'none'; return; }
    det.style.display = 'block';
    const [y,m,d] = ds.split('-');
    det.innerHTML = `<div class="hcm-det-hd"><div class="hcm-det-date">${parseInt(d)} ${TH_S[parseInt(m)-1]} ${parseInt(y)+543}</div><div class="hcm-det-cnt">${evts.length} กิจกรรม</div></div>`
        + evts.map(ev => {
            const sy = SYM[ev.symbol] || SYM.general;
            return `<div class="hcm-det-row"><div class="hcm-det-sym" style="color:${sy.col}">${sy.c}</div><div class="hcm-det-body"><div class="hcm-det-act">${ev.activity}</div><div class="hcm-det-meta"><span>${ev.person||'ทุกคน'}</span><span>${ev.time||'--:--'}</span></div>${ev.details?`<div class="hcm-det-note">${ev.details}</div>`:''}</div><div class="hcm-det-del" data-id="${ev.id}">&#215;</div></div>`;
        }).join('');
    det.querySelectorAll('.hcm-det-del').forEach(b => b.addEventListener('click', () => { removeEvent(parseFloat(b.dataset.id)); det.style.display = 'none'; selDate = null; }));
}

function renderList() {
    const el = document.getElementById('hcm-ev-list'); if (!el) return;
    const s = [...calData().events].sort((a, b) => (`${a.date}${a.time}`).localeCompare(`${b.date}${b.time}`));
    const ts = dStr(new Date());
    if (!s.length) { el.innerHTML = '<div class="hcm-empty"><p>ยังไม่มีกำหนดการ</p></div>'; return; }
    el.innerHTML = s.map(ev => {
        const sy = SYM[ev.symbol] || SYM.general;
        return `<div class="hcm-lev${ev.date < ts ? ' hcm-past' : ''}"><div class="hcm-lev-sym" style="color:${sy.col}">${sy.c}</div><div class="hcm-lev-body"><div class="hcm-lev-act">${ev.activity}</div><div class="hcm-lev-meta">${ev.date} ${ev.time} · ${ev.person||'ทุกคน'}</div>${ev.details?`<div class="hcm-lev-det">${ev.details}</div>`:''}</div><div class="hcm-lev-del" data-id="${ev.id}">&#215;</div></div>`;
    }).join('');
    el.querySelectorAll('.hcm-lev-del').forEach(b => b.addEventListener('click', () => removeEvent(parseFloat(b.dataset.id))));
}

function buildPF() {
    const sel = document.getElementById('hcm-pfilter'); if (!sel) return;
    const cur = sel.value;
    const ps  = [...new Set(calData().events.map(e => e.person).filter(Boolean))];
    sel.innerHTML = '<option value="">ทุกคน</option>' + ps.map(p => `<option value="${p}">${p}</option>`).join('');
    sel.value = cur;
}

function saveEvent() {
    const act = document.getElementById('hcm-a-act').value.trim(); if (!act) return;
    addEvent({ person: document.getElementById('hcm-a-person').value.trim(),
        date: document.getElementById('hcm-a-date').value || dStr(new Date()),
        time: document.getElementById('hcm-a-time').value, activity: act,
        symbol: document.getElementById('hcm-a-sym').value,
        details: document.getElementById('hcm-a-detail').value.trim() });
    document.getElementById('hcm-a-act').value = ''; document.getElementById('hcm-a-detail').value = '';
    switchSub('cal', 'list'); renderList();
}

function refreshCalUI() {
    if (curSection !== 'cal') return;
    renderGrid(); renderList(); buildPF();
}

// ── Code UI ───────────────────────────────────────────────────
function refreshCodeUI() {
    const blocks = codeData().blocks;
    const total  = blocks.length, tok = blocks.reduce((a, b) => a + b.tokens, 0);
    setT('hcm-total', total); setT('hcm-tok', '~' + tok); updateBadge();
    const list = document.getElementById('hcm-codelist'); if (!list) return;
    if (!total) { list.innerHTML = '<div class="hcm-empty"><p>ยังไม่มีบล็อก</p></div>'; return; }
    list.innerHTML = blocks.map(b => `<div class="hcm-card"><div class="hcm-chead"><span class="hcm-ctag">&lt;code${b.id}&gt;</span><span class="hcm-cid">#${b.id}·${b.ts}</span><div style="display:flex;gap:2px"><div class="hcm-ib" data-a="preview" data-id="${b.id}">&#9675;</div><div class="hcm-ib" data-a="copy" data-id="${b.id}">&#9632;</div><div class="hcm-ib hcm-del" data-a="del" data-id="${b.id}">&#215;</div></div></div><div style="padding:5px 8px 7px"><div class="hcm-cpre">${esc(b.html)}</div><div class="hcm-cmeta"><span>~${b.tokens} tok</span><span>msg#${b.msgId||'—'}</span></div></div></div>`).join('');
    list.querySelectorAll('.hcm-ib').forEach(btn => btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.id);
        if (btn.dataset.a === 'preview') openPop(id);
        if (btn.dataset.a === 'copy')    copyBlock(id, btn);
        if (btn.dataset.a === 'del')     removeBlock(id);
    }));
}

function openPop(id) {
    const b = codeData().blocks.find(x => x.id === id); if (!b) return;
    curPopId = id; setT('hcm-pt', `code${b.id} · ~${b.tokens} token`);
    document.getElementById('hcm-psrc' ).textContent = b.html;
    document.getElementById('hcm-pprev').innerHTML   = b.html;
    document.querySelectorAll('.hcm-ptt').forEach(t => t.classList.remove('hcm-on'));
    document.querySelector('[data-pt="src"]').classList.add('hcm-on');
    document.getElementById('hcm-ptsrc' ).style.display = 'block';
    document.getElementById('hcm-ptprev').style.display = 'none';
    document.getElementById('hcm-pop').classList.add('hcm-on');
}
function closePop() { document.getElementById('hcm-pop').classList.remove('hcm-on'); }
function copyBlock(id, btn) {
    const b = codeData().blocks.find(x => x.id === id); if (!b) return;
    navigator.clipboard.writeText(b.html).catch(() => {});
    btn.textContent = '\u2713'; setTimeout(() => btn.textContent = '&#9632;', 1200);
}
function exportJSON() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ chatId: getChatId(), calendar: calData(), code: codeData() }, null, 2)], { type: 'application/json' }));
    a.download = `hcm-${getChatId()}.json`; a.click();
}

function renderCodeMarkers(msgId) {
    const blocks = codeData().blocks.filter(b => b.msgId === msgId);
    if (!blocks.length) return;
    const el = document.querySelector(`[mesid="${msgId}"] .mes_text`); if (!el) return;
    blocks.forEach(b => {
        const tag  = `<code${b.id}></code${b.id}>`;
        const card = `<div class="hcm-inline-block"><span class="hcm-inline-tag">HTML Block ${b.id}</span><span class="hcm-inline-meta">~${b.tokens} tok</span><button class="hcm-inline-prev" onclick="hcmOpenPop(${b.id})">Preview</button></div>`;
        el.innerHTML = el.innerHTML.replace(tag, card);
    });
}
window.hcmOpenPop = function(id) { if (!isOpen) openPanel(); openSec('code'); openPop(id); };

// ── Clock & Labels ────────────────────────────────────────────
function startClock() {
    function tick() {
        const n = new Date();
        setT('hcm-clock', n.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        setT('hcm-date',  n.toLocaleDateString('th-TH', { month: 'short', day: 'numeric', year: 'numeric' }));
    }
    tick(); setInterval(tick, 1000);
}
function updateChatLabel() {
    try { const ctx = _getCtx(); setT('hcm-chatname', ctx.name2 || 'SillyTavern'); setT('hcm-charname', ctx.name2 || '—'); } catch {}
}
function updateBadge() { const n = codeData().blocks.length; setT('hcm-bdg-n', n); setT('hcm-cnt', n); }
function refreshAllUI() { refreshCodeUI(); updateChatLabel(); if (curSection === 'cal') { renderGrid(); renderList(); buildPF(); } }

// ── Utils ─────────────────────────────────────────────────────
function setHdr(ey, ti, su) { setT('hcm-eyebrow', ey); setT('hcm-title', ti); setT('hcm-sub', su); }
function setT(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
function dStr(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function pad(n) { return String(n).padStart(2, '0'); }
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── ST Hooks ──────────────────────────────────────────────────
function registerHooks() {
    const es = window.eventSource, et = window.event_types;
    if (!es || !et) { console.warn('[HCM] ST events not available'); return; }
    es.on(et.MESSAGE_RECEIVED, msgId => processMessage(msgId));
    es.on(et.MESSAGE_RENDERED, msgId => renderCodeMarkers(msgId));
    es.on(et.CHAT_CHANGED, () => { gCnt = 0; updateInjection(); refreshAllUI(); });
}

// ── Entry ─────────────────────────────────────────────────────
console.log('[HCM] Registering entry...');

function hcmInit() {
    try {
        console.log('[HCM] hcmInit called');
        S(); createPanel(); registerHooks(); updateInjection();
        console.log('[HCM] ✓ Ready');
    } catch(e) {
        console.error('[HCM] Error:', e);
        const dbg = document.createElement('div');
        dbg.style.cssText = 'position:fixed;bottom:10px;right:10px;z-index:99999;background:red;color:white;padding:6px 12px;font-size:12px;border-radius:4px;cursor:pointer';
        dbg.textContent = 'HCM ERROR — tap for details'; dbg.onclick = () => alert(e.stack || e);
        document.body.appendChild(dbg);
    }
}

if (typeof jQuery !== 'undefined') jQuery(hcmInit);
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hcmInit);
else hcmInit();





