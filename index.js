/**
 * HCM Diary v2.2 — ST Extension
 * No ES imports — uses window globals only
 */
console.log('[HCM] index.js parsing...');

// ── ST globals ─────────────────────────────────────────────
const getContext            = () => (window.SillyTavern?.getContext?.() ?? (window.getContext?.() ?? {}));
const saveSettingsDebounced = () => { if (window.saveSettingsDebounced) window.saveSettingsDebounced(); };
const _setPrompt            = (...a) => { if (window.setExtensionPrompt) window.setExtensionPrompt(...a); };

// ── Constants ──────────────────────────────────────────────
const EXT       = 'hcm_diary';
const INJ_KEY   = 'hcm_cal';
const INJ_POS   = 1;
const INJ_DEPTH = 0;
const CAL_RE    = /\[CAL:([^\]]+)\]/gi;
const HTML_RE   = /```html\s*([\s\S]*?)```/gi;

const SYM = {
    heart  :{c:'\u2665',l:'นัดพบ',      col:'#e87098'},
    star   :{c:'\u2605',l:'สำคัญ',       col:'#e8c870'},
    diamond:{c:'\u25C6',l:'ประชุม',      col:'#9898e8'},
    note   :{c:'\u266A',l:'บันเทิง',     col:'#70c898'},
    cross  :{c:'\u271D',l:'ขัดแย้ง',     col:'#e87070'},
    task   :{c:'\u2295',l:'งาน/ภารกิจ', col:'#88a8d8'},
    general:{c:'\u25C7',l:'ทั่วไป',      col:'#a898c8'},
};

const DEFAULTS = {
    enabled:true,calendarEnabled:true,codeEnabled:true,
    calendarData:{},codeData:{},
};

// ── Settings ───────────────────────────────────────────────
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
function getChatId() {
    try { return getContext().chatId || 'default'; } catch { return 'default'; }
}

// ── Calendar data ──────────────────────────────────────────
function calData() {
    const s=S(),id=getChatId();
    if(!s.calendarData[id]) s.calendarData[id]={events:[]};
    return s.calendarData[id];
}
function addEvent(evt) {
    const evs=calData().events;
    if(evs.find(e=>e.date===evt.date&&e.time===evt.time&&e.person===evt.person&&e.activity===evt.activity)) return;
    evs.push({id:Date.now()+Math.random(),...evt});
    saveSettingsDebounced(); updateInjection(); refreshCalUI();
}
function removeEvent(id) {
    const d=calData(); d.events=d.events.filter(e=>e.id!==id);
    saveSettingsDebounced(); updateInjection(); refreshCalUI();
}
function updateInjection() {
    if(!S().calendarEnabled){_setPrompt(INJ_KEY,'',INJ_POS,INJ_DEPTH);return;}
    const evs=calData().events;
    if(!evs.length){_setPrompt(INJ_KEY,'',INJ_POS,INJ_DEPTH);return;}
    const now=new Date(),todayS=ds(now);
    const sorted=[...evs].sort((a,b)=>(`${a.date}${a.time}`).localeCompare(`${b.date}${b.time}`));
    const up=sorted.filter(e=>(e.date||'')>=todayS);
    let txt=`[ปฏิทินตัวละคร — ${todayS} ${pad(now.getHours())}:${pad(now.getMinutes())}]\n`;
    if(!up.length) txt+='(ไม่มีกำหนดการที่จะถึง)';
    else up.slice(0,15).forEach(e=>{
        txt+=`• ${e.date===todayS?'วันนี้':e.date} ${e.time||'--:--'} | ${e.person||'ทุกคน'} | ${e.activity||''}`;
        if(e.details) txt+=` — ${e.details}`;
        txt+='\n';
    });
    txt+='[/ปฏิทินตัวละคร]';
    _setPrompt(INJ_KEY,txt,INJ_POS,INJ_DEPTH);
}

// ── Code data ──────────────────────────────────────────────
let globalCounter=0;
function codeData() {
    const s=S(),id=getChatId();
    if(!s.codeData[id]) s.codeData[id]={blocks:[]};
    return s.codeData[id];
}
function addBlock(html,msgId) {
    globalCounter++;
    const b={id:globalCounter,html,msgId,tokens:Math.ceil(html.length/4),
        ts:new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})};
    codeData().blocks.push(b); saveSettingsDebounced(); refreshCodeUI(); return b;
}
function removeBlock(id) {
    codeData().blocks=codeData().blocks.filter(b=>b.id!==id);
    saveSettingsDebounced(); refreshCodeUI();
}

// ── Message processing ─────────────────────────────────────
function processMessage(messageId) {
    const ctx=getContext();
    if(!ctx.chat||!ctx.chat[messageId]) return;
    const msg=ctx.chat[messageId];
    if(msg.is_user) return;
    let text=msg.mes,dirty=false;
    if(S().calendarEnabled){
        const hits=[...text.matchAll(CAL_RE)];
        hits.forEach(m=>{const a=parseAttrs(m[1]);if(a.activity||a.date) addEvent({person:a.person||'',date:a.date||ds(new Date()),time:a.time||'',activity:a.activity||'',symbol:a.symbol||'general',details:a.details||''});});
        if(hits.length){text=text.replace(CAL_RE,'').replace(/\n{3,}/g,'\n\n').trim();dirty=true;}
        CAL_RE.lastIndex=0;
    }
    if(S().codeEnabled){
        const hh=[...text.matchAll(HTML_RE)];
        if(hh.length){
            hh.forEach(m=>addBlock(m[1].trim(),messageId));
            let idx=0;
            text=text.replace(HTML_RE,()=>{const bl=codeData().blocks;const b=bl[bl.length-hh.length+idx];idx++;return b?`<code${b.id}></code${b.id}>`:''}).trim();
            HTML_RE.lastIndex=0;dirty=true;
        }
    }
    if(dirty){
        msg.mes=text;
        const el=document.querySelector(`[mesid="${messageId}"] .mes_text`);
        if(el) el.innerHTML=msg.mes;
        updateBadge();
    }
}
function parseAttrs(str) {
    const a={};
    str.split(',').forEach(p=>{const i=p.indexOf('=');if(i>0)a[p.slice(0,i).trim()]=p.slice(i+1).trim();});
    return a;
}

// ── Panel state ────────────────────────────────────────────
let currentSection='toc';
let calView={year:new Date().getFullYear(),month:new Date().getMonth()};
let selectedDate=null,currentPopId=null;
let isDragging=false,dragOffX=0,dragOffY=0;

// ── Starfield inside panel ─────────────────────────────────
function initPanelStars() {
    const c=document.getElementById('hcm-pc'); if(!c) return;
    const ctx=c.getContext('2d');
    let stars=[];
    function resize(){
        const book=document.getElementById('hcm-book');
        c.width=book?book.offsetWidth:330; c.height=book?book.offsetHeight:560;
        stars=[];
        for(let i=0;i<110;i++){
            const sz=Math.random();
            stars.push({x:Math.random()*c.width,y:Math.random()*c.height,
                r:sz<.6?.3:sz<.88?.58:.9,a:.08+Math.random()*.8,
                da:(.0003+Math.random()*.001)*(Math.random()<.5?1:-1),
                vx:(Math.random()-.5)*.03,vy:(Math.random()-.5)*.03,
                col:Math.random()<.5?'255,255,255':Math.random()<.5?'220,200,255':'175,220,255'});
        }
    }
    function draw(){
        ctx.clearRect(0,0,c.width,c.height);
        stars.forEach(s=>{
            s.a+=s.da;if(s.a>.9||s.a<.05)s.da*=-1;
            s.x+=s.vx;s.y+=s.vy;
            if(s.x<0)s.x=c.width;if(s.x>c.width)s.x=0;
            if(s.y<0)s.y=c.height;if(s.y>c.height)s.y=0;
            ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);
            ctx.fillStyle=`rgba(${s.col},${s.a.toFixed(2)})`;ctx.fill();
        });
        requestAnimationFrame(draw);
    }
    setTimeout(()=>{resize();draw();},300);
}

// ── Create UI ──────────────────────────────────────────────
function createPanel() {
    if(document.getElementById('hcm-panel')) return;

    const launcher=document.createElement('div');
        launcher.id='hcm-launcher';
    launcher.innerHTML=`<div id="hcm-ltab"><div class="hcm-lt-gem"><span>H</span></div><div class="hcm-lt-lbl">HCM</div><div id="hcm-bdg"><span id="hcm-bdg-n">0</span></div></div>`;
    launcher.querySelector('#hcm-ltab').addEventListener('click',togglePanel);
    document.body.appendChild(launcher);

    const panel=document.createElement('div');
    panel.id='hcm-panel';
    panel.innerHTML=buildHTML();
    document.body.appendChild(panel);

    initPanelStars();
    bindEvents();
    bindDrag();
    startClock();
    refreshAllUI();
}

function buildHTML() {
    const symOpts=Object.entries(SYM).map(([k,v])=>`<option value="${k}">${v.c} ${v.l}</option>`).join('');
    return `
<div class="hcm-frame">
  <div class="hcm-rings">${Array(9).fill('<div class="hcm-ring"></div>').join('')}</div>
  <div class="hcm-bmarks">
    <div class="hcm-bm" data-bm="code">โค้ด</div>
    <div class="hcm-bm" data-bm="cal">ปฏิทิน</div>
    <div class="hcm-bm" data-bm="toc">เมนู</div>
  </div>
  <div class="hcm-book" id="hcm-book">
    <canvas id="hcm-pc"></canvas>
    <div class="hcm-nebula"></div>
    <div class="hcm-band hcm-top"></div>
    <div class="hcm-sb">
      <div class="hcm-sb-l"><div class="hcm-sb-dot"></div><span id="hcm-clock">--:--:--</span><span class="hcm-sep">·</span><span id="hcm-chatname">SillyTavern</span></div>
      <div class="hcm-sb-r" id="hcm-charname">—</div>
    </div>
    <div class="hcm-hd" id="hcm-drag-handle">
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
      <div class="hcm-view hcm-on" id="hcm-v-toc">
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
          <div class="hcm-nc-body">AI ใส่ tag ในบทโรล → extension จับ → ลบออก → inject ก่อนโรล<br><br><code>[CAL:person=,date=YYYY-MM-DD,time=HH:MM,activity=,symbol=,details=]</code><br>symbols: heart · star · diamond · note · cross · task · general</div>
        </div>
      </div>
      <div class="hcm-view" id="hcm-v-code">
        <div class="hcm-sv hcm-on" id="hcm-sv-code">
          <div class="hcm-spill"><div class="hcm-sdot"></div><span>พร้อมทำงาน — เชื่อมต่อ ST</span></div>
          <div class="hcm-srow"><div class="hcm-sc"><div class="hcm-scv" id="hcm-total">0</div><div class="hcm-scl">บล็อก</div></div><div class="hcm-sc"><div class="hcm-scv" id="hcm-tok">~0</div><div class="hcm-scl">token ประหยัด</div></div></div>
          <div class="hcm-dvd"><div class="hcm-dvdg"></div><div class="hcm-dvdt">บล็อกที่จัดเก็บ</div></div>
          <div id="hcm-codelist"></div>
          <div class="hcm-btns"><button class="hcm-btns2" id="hcm-clear-btn">&#215; ล้าง</button><button class="hcm-btnp" id="hcm-export-btn">&#8595; Export JSON</button></div>
        </div>
        <div class="hcm-sv" id="hcm-sv-settings">
          <div class="hcm-dvd"><div class="hcm-dvdg"></div><div class="hcm-dvdt">ฟีเจอร์</div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>I</span></div><div><div class="hcm-fname">ตรวจจับ HTML block</div><div class="hcm-fdesc">จับ \`\`\`html...\`\`\` แทนที่ด้วย &lt;codeN&gt;</div></div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>II</span></div><div><div class="hcm-fname">ประหยัด token</div><div class="hcm-fdesc">~450 → ~12 token ต่อบล็อก</div></div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>III</span></div><div><div class="hcm-fname">จับ [CAL:...] tag</div><div class="hcm-fdesc">บันทึกปฏิทิน ลบออกจากข้อความ</div></div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>IV</span></div><div><div class="hcm-fname">Inject ปฏิทิน</div><div class="hcm-fdesc">ส่งเข้า context ก่อนโรลทุกครั้ง</div></div></div>
        </div>
      </div>
      <div class="hcm-view" id="hcm-v-cal">
        <div class="hcm-sv hcm-calp0 hcm-on" id="hcm-calv-month">
          <div class="hcm-cal-nav"><button class="hcm-cal-nb" id="hcm-cal-prev">&#8249;</button><div class="hcm-cal-lbl" id="hcm-cal-lbl">—</div><button class="hcm-cal-nb" id="hcm-cal-next">&#8250;</button></div>
          <div class="hcm-cal-pf"><span class="hcm-cal-pfl">บุคคล</span><select class="hcm-psel" id="hcm-pfilter"><option value="">ทุกคน</option></select></div>
          <div class="hcm-cal-dows"><div>อา.</div><div>จ.</div><div>อ.</div><div>พ.</div><div>พฤ.</div><div>ศ.</div><div>ส.</div></div>
          <div class="hcm-cal-grid" id="hcm-cal-grid"></div>
          <div class="hcm-cal-leg" id="hcm-cal-leg"></div>
          <div class="hcm-cal-det" id="hcm-cal-det" style="display:none"></div>
        </div>
        <div class="hcm-sv" id="hcm-calv-list">
          <div class="hcm-dvd" style="margin:0 0 8px"><div class="hcm-dvdg"></div><div class="hcm-dvdt">กำหนดการทั้งหมด</div></div>
          <div id="hcm-ev-list"></div>
        </div>
        <div class="hcm-sv" id="hcm-calv-add">
          <div class="hcm-dvd" style="margin:0 0 8px"><div class="hcm-dvdg"></div><div class="hcm-dvdt">เพิ่มกำหนดการ</div></div>
          <div class="hcm-fg"><div class="hcm-fl">บุคคล</div><input type="text" id="hcm-a-person" placeholder="ชื่อตัวละคร" class="hcm-input"></div>
          <div class="hcm-fg"><div class="hcm-fl">วันที่</div><input type="date" id="hcm-a-date" class="hcm-input"></div>
          <div class="hcm-fg"><div class="hcm-fl">เวลา</div><input type="time" id="hcm-a-time" class="hcm-input"></div>
          <div class="hcm-fg"><div class="hcm-fl">กิจกรรม</div><input type="text" id="hcm-a-act" placeholder="รายละเอียด" class="hcm-input"></div>
          <div class="hcm-fg"><div class="hcm-fl">สัญลักษณ์</div><select id="hcm-a-sym" class="hcm-input">${symOpts}</select></div>
          <div class="hcm-fg"><div class="hcm-fl">โน้ต</div><input type="text" id="hcm-a-detail" placeholder="รายละเอียดเพิ่มเติม" class="hcm-input"></div>
          <button class="hcm-btnp" id="hcm-add-save" style="margin-top:2px">&#43; บันทึก</button>
        </div>
      </div>
    </div>
    <div class="hcm-band hcm-bot"></div>
    <div class="hcm-hind"><div class="hcm-hbar"></div></div>
  </div>
</div>
<div id="hcm-pop">
  <div class="hcm-ps">
    <div class="hcm-ph"><span class="hcm-pt" id="hcm-pt">—</span><button class="hcm-pc" id="hcm-pc-btn">คัดลอก</button><div class="hcm-px" id="hcm-pop-close">&#215;</div></div>
    <div class="hcm-ptb"><div class="hcm-ptt hcm-on" data-pt="src">ซอร์สโค้ด</div><div class="hcm-ptt" data-pt="prev">พรีวิว</div></div>
    <div class="hcm-pb"><div id="hcm-ptsrc"><pre id="hcm-psrc"></pre></div><div id="hcm-ptprev" style="display:none"><div id="hcm-pprev"></div></div></div>
  </div>
</div>`;
}

// ── Drag ───────────────────────────────────────────────────
function bindDrag() {
    const handle=document.getElementById('hcm-drag-handle');
    const panel=document.getElementById('hcm-panel');
    if(!handle||!panel) return;
    function onMove(e){
        if(!isDragging) return;
        const cx=e.touches?e.touches[0].clientX:e.clientX;
        const cy=e.touches?e.touches[0].clientY:e.clientY;
        let nx=cx-dragOffX,ny=cy-dragOffY;
        nx=Math.max(0,Math.min(window.innerWidth-panel.offsetWidth,nx));
        ny=Math.max(0,Math.min(window.innerHeight-panel.offsetHeight,ny));
        panel.style.left=nx+'px'; panel.style.top=ny+'px';
        panel.style.right='auto'; panel.style.transform='none';
    }
    function onEnd(){isDragging=false;}
    handle.addEventListener('mousedown',e=>{
        isDragging=true;const r=panel.getBoundingClientRect();
        dragOffX=e.clientX-r.left;dragOffY=e.clientY-r.top;e.preventDefault();
    });
    handle.addEventListener('touchstart',e=>{
        isDragging=true;const r=panel.getBoundingClientRect();
        dragOffX=e.touches[0].clientX-r.left;dragOffY=e.touches[0].clientY-r.top;
    },{passive:true});
    document.addEventListener('mousemove',onMove);
    document.addEventListener('touchmove',onMove,{passive:true});
    document.addEventListener('mouseup',onEnd);
    document.addEventListener('touchend',onEnd);
}

// ── Bind events ────────────────────────────────────────────
function bindEvents() {
    document.getElementById('hcm-close').addEventListener('click',togglePanel);
    document.getElementById('hcm-back' ).addEventListener('click',navBack);
    document.querySelectorAll('.hcm-bm').forEach(bm=>bm.addEventListener('click',()=>{
        const t=bm.dataset.bm;
        if(!panelIsOpen()) openPanel();
        if(t==='toc') navBack(); else openSection(t);
    }));
    document.querySelectorAll('.hcm-trow.hcm-can').forEach(row=>row.addEventListener('click',()=>openSection(row.dataset.nav)));
    document.querySelectorAll('#hcm-tabs-code .hcm-stab').forEach(t=>t.addEventListener('click',()=>switchSub('code',t.dataset.sv)));
    document.querySelectorAll('#hcm-tabs-cal .hcm-stab').forEach(t=>t.addEventListener('click',()=>{
        switchSub('cal',t.dataset.cv);
        if(t.dataset.cv==='month') renderCalGrid();
        if(t.dataset.cv==='list')  renderCalList();
    }));
    document.getElementById('hcm-cal-prev').addEventListener('click',()=>{calView.month--;if(calView.month<0){calView.month=11;calView.year--;}renderCalGrid();});
    document.getElementById('hcm-cal-next').addEventListener('click',()=>{calView.month++;if(calView.month>11){calView.month=0;calView.year++;}renderCalGrid();});
    document.getElementById('hcm-pfilter').addEventListener('change',renderCalGrid);
    document.getElementById('hcm-clear-btn' ).addEventListener('click',()=>{codeData().blocks=[];saveSettingsDebounced();refreshCodeUI();});
    document.getElementById('hcm-export-btn').addEventListener('click',exportJSON);
    document.getElementById('hcm-add-save'  ).addEventListener('click',saveManualEvent);
    document.getElementById('hcm-a-date').value=ds(new Date());
    document.getElementById('hcm-pop-close').addEventListener('click',closePop);
            document.getElementById('hcm-pop').addEventListener('click',e=>{if(e.target.id==='hcm-pop')closePop();});
    document.getElementById('hcm-pc-btn').addEventListener('click',()=>{
        const b=codeData().blocks.find(x=>x.id===currentPopId);if(!b)return;
        navigator.clipboard.writeText(b.html).catch(()=>{});
        const btn=document.getElementById('hcm-pc-btn');btn.textContent='คัดลอกแล้ว';setTimeout(()=>btn.textContent='คัดลอก',1400);
    });
    document.querySelectorAll('.hcm-ptt').forEach(t=>t.addEventListener('click',()=>{
        document.querySelectorAll('.hcm-ptt').forEach(x=>x.classList.remove('hcm-on'));t.classList.add('hcm-on');
        document.getElementById('hcm-ptsrc' ).style.display=t.dataset.pt==='src' ?'block':'none';
        document.getElementById('hcm-ptprev').style.display=t.dataset.pt==='prev'?'block':'none';
    }));
}

// ── Navigation ─────────────────────────────────────────────
function panelIsOpen(){const p=document.getElementById('hcm-panel');return p&&p.classList.contains('hcm-open');}
function openPanel(){document.getElementById('hcm-panel').classList.add('hcm-open');}
function togglePanel(){document.getElementById('hcm-panel').classList.toggle('hcm-open');}
function setActiveBm(s){document.querySelectorAll('.hcm-bm').forEach(bm=>bm.classList.toggle('hcm-active',bm.dataset.bm===s));}

function openSection(s) {
    currentSection=s;
    ['toc','code','cal'].forEach(v=>{const el=document.getElementById(`hcm-v-${v}`);if(el)el.style.display='none';});
    document.getElementById('hcm-tabs-code').style.display='none';
    document.getElementById('hcm-tabs-cal' ).style.display='none';
    document.getElementById('hcm-back').style.display='flex';
    setActiveBm(s);
    if(s==='code'){
        document.getElementById('hcm-v-code').style.display='flex';
        document.getElementById('hcm-tabs-code').style.display='flex';
        const sv=document.getElementById('hcm-sv-code');if(sv)sv.style.display='flex';
        setHeader('ระบบที่ 01','ตัวจัดการโค้ด','HTML Block Store');
        refreshCodeUI();
    } else {
        document.getElementById('hcm-v-cal').style.display='flex';
        document.getElementById('hcm-tabs-cal').style.display='flex';
        const sv=document.getElementById('hcm-calv-month');if(sv)sv.style.display='flex';
        setHeader('ระบบที่ 02','ปฏิทินตัวละคร','กิจกรรมในโรล');
        buildPersonFilter();renderCalGrid();renderCalList();
    }
}
function navBack() {
    currentSection='toc';
    ['code','cal'].forEach(v=>{const el=document.getElementById(`hcm-v-${v}`);if(el)el.style.display='none';});
    document.getElementById('hcm-v-toc').style.display='flex';
    document.getElementById('hcm-tabs-code').style.display='none';
    document.getElementById('hcm-tabs-cal' ).style.display='none';
    document.getElementById('hcm-back').style.display='none';
    setHeader('HCM Diary','สารบัญระบบ','ส่วนขยาย SillyTavern');
    setActiveBm('toc');
}
function switchSub(section,name){
    const tabsId=section==='code'?'hcm-tabs-code':'hcm-tabs-cal';
    const prefix=section==='code'?'hcm-sv-':'hcm-calv-';
    const attr=section==='code'?'sv':'cv';
    document.querySelectorAll(`#${tabsId} .hcm-stab`).forEach(x=>x.classList.remove('hcm-on'));
    const t=document.querySelector(`#${tabsId} .hcm-stab[data-${attr}="${name}"]`);if(t)t.classList.add('hcm-on');
    const parent=document.getElementById(`hcm-v-${section==='code'?'code':'cal'}`);
    parent.querySelectorAll('.hcm-sv').forEach(sv=>sv.style.display='none');
    const target=document.getElementById(prefix+name);if(target)target.style.display='flex';
}

// ── Calendar UI ────────────────────────────────────────────
const TH_MON=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_S  =['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function renderCalGrid(){
    const{year,month}=calView;setText('hcm-cal-lbl',`${TH_MON[month]} ${year+543}`);
    const pf=document.getElementById('hcm-pfilter').value;
    const evs=calData().events.filter(e=>!pf||e.person===pf);
    const first=new Date(year,month,1).getDay(),last=new Date(year,month+1,0).getDate(),todayS=ds(new Date());
    const g=document.getElementById('hcm-cal-grid');g.innerHTML='';
    for(let i=0;i<first;i++){const c=document.createElement('div');c.className='hcm-cal-day hcm-emp';g.appendChild(c);}
    for(let d=1;d<=last;d++){
        const dstr=`${year}-${pad(month+1)}-${pad(d)}`,de=evs.filter(e=>e.date===dstr);
        const cell=document.createElement('div');
        cell.className='hcm-cal-day'+(dstr===todayS?' hcm-tdy':'')+(dstr===selectedDate?' hcm-sel':'');
        cell.innerHTML=`<div class="hcm-dn">${d}</div>`;
        if(de.length){const sy=document.createElement('div');sy.className='hcm-cal-syms';de.slice(0,3).forEach(ev=>{const sym=SYM[ev.symbol]||SYM.general;const sp=document.createElement('span');sp.className='hcm-sym';sp.style.color=sym.col;sp.textContent=sym.c;sy.appendChild(sp);});cell.appendChild(sy);}
        cell.addEventListener('click',()=>showDayDetail(dstr,de));g.appendChild(cell);
    }
    renderLegend();
}
function renderLegend(){document.getElementById('hcm-cal-leg').innerHTML=Object.entries(SYM).map(([,v])=>`<div class="hcm-leg-it"><span class="hcm-sym" style="color:${v.col}">${v.c}</span><span>${v.l}</span></div>`).join('');}
function showDayDetail(dstr,evs){
    selectedDate=dstr;renderCalGrid();
    const det=document.getElementById('hcm-cal-det');
    if(!evs.length){det.style.display='none';return;}det.style.display='block';
    const[y,m,d]=dstr.split('-');
    det.innerHTML=`<div class="hcm-det-hd"><div class="hcm-det-date">${parseInt(d)} ${TH_S[parseInt(m)-1]} ${parseInt(y)+543}</div><div class="hcm-det-cnt">${evs.length} กิจกรรม</div></div>`+evs.map(ev=>{const sym=SYM[ev.symbol]||SYM.general;return`<div class="hcm-det-row"><div class="hcm-det-sym" style="color:${sym.col}">${sym.c}</div><div class="hcm-det-body"><div class="hcm-det-act">${ev.activity}</div><div class="hcm-det-meta"><span>${ev.person||'ทุกคน'}</span><span>${ev.time||'--:--'}</span></div>${ev.details?`<div class="hcm-det-note">${ev.details}</div>`:''}</div><div class="hcm-det-del" data-id="${ev.id}">&#215;</div></div>`;}).join('');
    det.querySelectorAll('.hcm-det-del').forEach(btn=>btn.addEventListener('click',()=>{removeEvent(parseFloat(btn.dataset.id));det.style.display='none';selectedDate=null;}));
}
function renderCalList(){
    const el=document.getElementById('hcm-ev-list');if(!el)return;
    const sorted=[...calData().events].sort((a,b)=>(`${a.date}${a.time}`).localeCompare(`${b.date}${b.time}`));
    const todayS=ds(new Date());
    if(!sorted.length){el.innerHTML='<div class="hcm-empty"><p>ยังไม่มีกำหนดการ</p></div>';return;}
    el.innerHTML=sorted.map(ev=>{const sym=SYM[ev.symbol]||SYM.general;return`<div class="hcm-list-ev${ev.date<todayS?' hcm-past':''}"><div class="hcm-lev-sym" style="color:${sym.col}">${sym.c}</div><div class="hcm-lev-body"><div class="hcm-lev-act">${ev.activity}</div><div class="hcm-lev-meta">${ev.date} ${ev.time} · ${ev.person||'ทุกคน'}</div>${ev.details?`<div class="hcm-lev-det">${ev.details}</div>`:''}</div><div class="hcm-lev-del" data-id="${ev.id}">&#215;</div></div>`;}).join('');
    el.querySelectorAll('.hcm-lev-del').forEach(btn=>btn.addEventListener('click',()=>removeEvent(parseFloat(btn.dataset.id))));
}
function buildPersonFilter(){
    const sel=document.getElementById('hcm-pfilter');if(!sel)return;
    const cur=sel.value,ps=[...new Set(calData().events.map(e=>e.person).filter(Boolean))];
    sel.innerHTML='<option value="">ทุกคน</option>'+ps.map(p=>`<option value="${p}">${p}</option>`).join('');sel.value=cur;
}
function saveManualEvent(){
    const act=document.getElementById('hcm-a-act').value.trim();if(!act)return;
    addEvent({person:document.getElementById('hcm-a-person').value.trim(),date:document.getElementById('hcm-a-date').value||ds(new Date()),time:document.getElementById('hcm-a-time').value,activity:act,symbol:document.getElementById('hcm-a-sym').value,details:document.getElementById('hcm-a-detail').value.trim()});
    document.getElementById('hcm-a-act').value='';document.getElementById('hcm-a-detail').value='';
    switchSub('cal','list');renderCalList();
}
function refreshCalUI(){if(currentSection!=='cal')return;renderCalGrid();renderCalList();buildPersonFilter();}

// ── Code UI ────────────────────────────────────────────────
function refreshCodeUI(){
    const blocks=codeData().blocks,total=blocks.length,tok=blocks.reduce((a,b)=>a+b.tokens,0);
    setText('hcm-total',total);setText('hcm-tok','~'+tok);setText('hcm-cnt',total);updateBadge();
    const list=document.getElementById('hcm-codelist');if(!list)return;
    if(!total){list.innerHTML='<div class="hcm-empty"><p>ยังไม่มีบล็อก</p></div>';return;}
    list.innerHTML=blocks.map(b=>`<div class="hcm-card"><div class="hcm-chead"><span class="hcm-ctag">&lt;code${b.id}&gt;</span><span class="hcm-cid">#${b.id}·${b.ts}</span><div style="display:flex;gap:2px"><div class="hcm-ib" data-a="preview" data-id="${b.id}">&#9675;</div><div class="hcm-ib" data-a="copy" data-id="${b.id}">&#9632;</div><div class="hcm-ib hcm-del" data-a="delete" data-id="${b.id}">&#215;</div></div></div><div style="padding:5px 8px 7px"><div class="hcm-cpre">${escHTML(b.html)}</div><div class="hcm-cmeta"><span>~${b.tokens} tok</span><span>msg#${b.msgId??'—'}</span></div></div></div>`).join('');
    list.querySelectorAll('.hcm-ib').forEach(btn=>btn.addEventListener('click',()=>{const id=parseInt(btn.dataset.id);if(btn.dataset.a==='preview')openPop(id);if(btn.dataset.a==='copy')copyBlock(id,btn);if(btn.dataset.a==='delete')removeBlock(id);}));
}
function openPop(id){
    const b=codeData().blocks.find(x=>x.id===id);if(!b)return;currentPopId=id;
    setText('hcm-pt',`code${b.id} · ~${b.tokens} token`);
    document.getElementById('hcm-psrc').textContent=b.html;
    document.getElementById('hcm-pprev').innerHTML=b.html;
    document.querySelectorAll('.hcm-ptt').forEach(t=>t.classList.remove('hcm-on'));
    document.querySelector('[data-pt="src"]').classList.add('hcm-on');
    document.getElementById('hcm-ptsrc').style.display='block';
    document.getElementById('hcm-ptprev').style.display='none';
    document.getElementById('hcm-pop').classList.add('hcm-on');
}
function closePop(){document.getElementById('hcm-pop').classList.remove('hcm-on');}
function copyBlock(id,btn){const b=codeData().blocks.find(x=>x.id===id);if(!b)return;navigator.clipboard.writeText(b.html).catch(()=>{});btn.innerHTML='\u2713';setTimeout(()=>btn.innerHTML='&#9632;',1200);}
function exportJSON(){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({chatId:getChatId(),calendar:calData(),code:codeData()},null,2)],{type:'application/json'}));a.download=`hcm-${getChatId()}.json`;a.click();}
function renderCodeMarkers(msgId){
    const blocks=codeData().blocks.filter(b=>b.msgId===msgId);if(!blocks.length)return;
    const el=document.querySelector(`[mesid="${msgId}"] .mes_text`);if(!el)return;
    blocks.forEach(b=>{el.innerHTML=el.innerHTML.replace(`<code${b.id}></code${b.id}>`,`<div class="hcm-inline-block"><span class="hcm-inline-tag">HTML Block ${b.id}</span><span class="hcm-inline-meta">~${b.tokens} tok</span><button class="hcm-inline-prev" onclick="window.hcmOpenPop(${b.id})">Preview</button></div>`);});
}
window.hcmOpenPop=function(id){if(!panelIsOpen())openPanel();openSection('code');openPop(id);};

// ── Utils ──────────────────────────────────────────────────
function startClock(){function tick(){const n=new Date();setText('hcm-clock',n.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));setText('hcm-date',n.toLocaleDateString('th-TH',{month:'short',day:'numeric',year:'numeric'}));}tick();setInterval(tick,1000);}
function updateChatLabel(){try{const ctx=getContext();setText('hcm-chatname',ctx.name2||ctx.chatId||'SillyTavern');setText('hcm-charname',ctx.name2||'—');}catch{}}
function updateBadge(){const n=codeData().blocks.length;setText('hcm-bdg-n',n);setText('hcm-cnt',n);}
function setHeader(ey,ti,su){setText('hcm-eyebrow',ey);setText('hcm-title',ti);setText('hcm-sub',su);}
function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v;}
function ds(d){return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function pad(n){return String(n).padStart(2,'0');}
function escHTML(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function refreshAllUI(){refreshCodeUI();updateChatLabel();if(currentSection==='cal'){renderCalGrid();renderCalList();buildPersonFilter();}}

// ── ST hooks ───────────────────────────────────────────────
function registerHooks(){
    const es=window.eventSource,et=window.event_types;
    if(!es||!et){console.warn('[HCM] eventSource not ready');return;}
    es.on(et.MESSAGE_RECEIVED,msgId=>processMessage(msgId));
    es.on(et.MESSAGE_RENDERED,msgId=>renderCodeMarkers(msgId));
    es.on(et.CHAT_CHANGED,()=>{globalCounter=0;updateInjection();refreshAllUI();});
}

// ── Entry point ────────────────────────────────────────────
console.log('[HCM] Registering entry point...');
function hcmInit(){
    try{
        console.log('[HCM] hcmInit() called');
        S();createPanel();registerHooks();updateInjection();
        console.log('[HCM] ✓ Ready — launcher at bottom-right edge');
    }catch(e){
        console.error('[HCM] Error:',e);
        const dbg=document.createElement('div');
        dbg.style.cssText='position:fixed;bottom:10px;right:10px;z-index:999999;background:red;color:white;padding:8px 14px;font-size:12px;border-radius:4px;cursor:pointer;font-family:monospace;';
        dbg.textContent='HCM ERROR — tap for details';dbg.onclick=()=>alert('[HCM]\n'+e.stack);
        document.body.appendChild(dbg);
    }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',hcmInit);
else if(typeof jQuery!=='undefined') jQuery(hcmInit);
else hcmInit();
    
