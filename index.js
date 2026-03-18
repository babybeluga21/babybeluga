/**
 * HCM Diary Extension v2.2 — SillyTavern 1.16.x
 */

import { getContext, saveSettingsDebounced, eventSource, event_types }
    from '../../../../script.js';
import { extension_settings } from '../../../../extensions.js';

// setExtensionPrompt — ลอง import แบบ optional
let _setPrompt = () => {};
try {
    const m = await import('../../../../extensions.js');
    if (typeof m.setExtensionPrompt === 'function') _setPrompt = m.setExtensionPrompt;
} catch {}

const EXT = 'hcm_diary', INJ_KEY = 'hcm_calendar', INJ_POS = 1, INJ_DEPTH = 0;
const CAL_RE  = /\[CAL:([^\]]+)\]/gi;
const HTML_RE = /```html\s*([\s\S]*?)```/gi;
const SYM = {
    heart:{c:'\u2665',label:'นัดพบ',color:'#e87098'},
    star:{c:'\u2605',label:'สำคัญ',color:'#e8c870'},
    diamond:{c:'\u25C6',label:'ประชุม',color:'#9898e8'},
    note:{c:'\u266A',label:'บันเทิง',color:'#70c898'},
    cross:{c:'\u271D',label:'ขัดแย้ง',color:'#e87070'},
    task:{c:'\u2295',label:'งาน/ภารกิจ',color:'#88a8d8'},
    general:{c:'\u25C7',label:'ทั่วไป',color:'#a898c8'},
};

function S() {
    if (!extension_settings[EXT]) extension_settings[EXT] = {};
    const D = {enabled:true,calendarEnabled:true,codeEnabled:true,calendarData:{},codeData:{}};
    for (const k in D) if (extension_settings[EXT][k] === undefined) extension_settings[EXT][k] = JSON.parse(JSON.stringify(D[k]));
    return extension_settings[EXT];
}
function getChatId() { try { return getContext().chatId||'default'; } catch { return 'default'; } }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function pad(n) { return String(n).padStart(2,'0'); }
function escHTML(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ─── Calendar ──────────────────────────────────────────────────
function calData() { const s=S(),id=getChatId(); if(!s.calendarData[id])s.calendarData[id]={events:[]}; return s.calendarData[id]; }
function addEvent(evt) {
    const evts=calData().events;
    if(evts.find(e=>e.date===evt.date&&e.time===evt.time&&e.person===evt.person&&e.activity===evt.activity))return;
    evts.push({id:Date.now()+Math.random(),...evt});
    saveSettingsDebounced(); updateInjection(); refreshCalUI();
}
function removeEvent(id) { calData().events=calData().events.filter(e=>e.id!==id); saveSettingsDebounced(); updateInjection(); refreshCalUI(); }
function updateInjection() {
    try {
        const s=S(); if(!s.calendarEnabled){_setPrompt(INJ_KEY,'',INJ_POS,INJ_DEPTH);return;}
        const evts=calData().events; if(!evts.length){_setPrompt(INJ_KEY,'',INJ_POS,INJ_DEPTH);return;}
        const now=new Date(),todayS=fmtDate(now);
        const sorted=[...evts].sort((a,b)=>(`${a.date}${a.time}`).localeCompare(`${b.date}${b.time}`));
        const up=sorted.filter(e=>(e.date||'')>=todayS);
        let text=`[ปฏิทินตัวละคร — ${todayS} ${pad(now.getHours())}:${pad(now.getMinutes())}]\n`;
        if(!up.length) text+='(ไม่มีกำหนดการที่จะถึง)';
        else up.slice(0,15).forEach(e=>{text+=`• ${e.date===todayS?'วันนี้':e.date} ${e.time||'--:--'} | ${e.person||'ทุกคน'} | ${e.activity||''}`;if(e.details)text+=` — ${e.details}`;text+='\n';});
        text+='[/ปฏิทินตัวละคร]';
        _setPrompt(INJ_KEY,text,INJ_POS,INJ_DEPTH);
    } catch(err) { console.warn('[HCM] inject err',err); }
}

// ─── Code ─────────────────────────────────────────────────────
let gCnt=0;
function codeData() { const s=S(),id=getChatId(); if(!s.codeData[id])s.codeData[id]={blocks:[]}; return s.codeData[id]; }
function addBlock(html,msgId) { gCnt++; const b={id:gCnt,html,msgId,tokens:Math.ceil(html.length/4),ts:new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})}; codeData().blocks.push(b); saveSettingsDebounced(); refreshCodeUI(); return b; }
function removeBlock(id) { codeData().blocks=codeData().blocks.filter(b=>b.id!==id); saveSettingsDebounced(); refreshCodeUI(); }

// ─── Process message ───────────────────────────────────────────
function processMessage(msgId) {
    try {
        const ctx=getContext(); if(!ctx.chat||!ctx.chat[msgId])return;
        const msg=ctx.chat[msgId]; if(msg.is_user)return;
        let text=msg.mes,dirty=false;
        CAL_RE.lastIndex=0;
        const calHits=[...text.matchAll(CAL_RE)];
        calHits.forEach(m=>{const a=parseAttrs(m[1]);if(a.activity||a.date)addEvent({person:a.person||'',date:a.date||fmtDate(new Date()),time:a.time||'',activity:a.activity||'',symbol:a.symbol||'general',details:a.details||''}); });
        if(calHits.length){text=text.replace(CAL_RE,'').replace(/\n{3,}/g,'\n\n').trim();dirty=true;} CAL_RE.lastIndex=0;
        HTML_RE.lastIndex=0;
        const htmlHits=[...text.matchAll(HTML_RE)];
        if(htmlHits.length){const newBlocks=htmlHits.map(m=>addBlock(m[1].trim(),msgId));let i=0;text=text.replace(HTML_RE,()=>{const b=newBlocks[i++];return b?`<code${b.id}></code${b.id}>`:''}).trim();dirty=true;HTML_RE.lastIndex=0;}
        if(dirty){msg.mes=text;const el=document.querySelector(`[mesid="${msgId}"] .mes_text`);if(el)el.innerHTML=msg.mes;updateBadge();}
    } catch(err){console.warn('[HCM] processMsg err',err);}
}
function parseAttrs(str){const a={};str.split(',').forEach(p=>{const i=p.indexOf('=');if(i>0)a[p.slice(0,i).trim()]=p.slice(i+1).trim();});return a;}

// ═══ UI ═══════════════════════════════════════════════════════
let section='toc', calView={year:new Date().getFullYear(),month:new Date().getMonth()}, selDate=null, popId=null;
const TH_MON=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_S=['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function createPanel() {
    if(document.getElementById('hcm-launcher'))return;
    const symOpts=Object.entries(SYM).map(([k,v])=>`<option value="${k}">${v.c} ${v.label}</option>`).join('');

    $('body').append(`<div id="hcm-launcher"><div id="hcm-ltab"><div class="hcm-lt-gem"><span>H</span></div><div class="hcm-lt-lbl">HCM</div><div id="hcm-bdg"><span id="hcm-bdg-n">0</span></div></div></div>`);

    $('body').append(`<div id="hcm-panel"><div class="hcm-frame">
  <div class="hcm-rings">${Array(9).fill('<div class="hcm-ring"></div>').join('')}</div>
  <div class="hcm-bmarks"><div class="hcm-bm" data-bm="code">โค้ด</div><div class="hcm-bm" data-bm="cal">ปฏิทิน</div><div class="hcm-bm" data-bm="toc">เมนู</div></div>
  <div class="hcm-book">
    <div class="hcm-band hcm-top"></div>
    <div class="hcm-sb"><div class="hcm-sb-l"><div class="hcm-sb-dot"></div><span id="hcm-clock">--:--:--</span><span class="hcm-sep">·</span><span id="hcm-chatname">ST</span></div><div class="hcm-sb-r" id="hcm-charname">—</div></div>
    <div class="hcm-hd"><div class="hcm-hdm"><span class="hcm-eyebrow" id="hcm-eyebrow">HCM Diary</span><div class="hcm-title" id="hcm-title">สารบัญระบบ</div><div class="hcm-sub" id="hcm-sub">ส่วนขยาย SillyTavern</div></div><div class="hcm-hdbtns"><div class="hcm-hdbtn" id="hcm-back" style="display:none">&#8592;</div><div class="hcm-hdbtn" id="hcm-close">&#215;</div></div></div>
    <div class="hcm-drow"><span class="hcm-dlbl">Date</span><div class="hcm-dval" id="hcm-date">—</div></div>
    <div class="hcm-stabs" id="hcm-tabs-code"><div class="hcm-stab hcm-on" data-sv="code">โค้ด <span class="hcm-tbadge" id="hcm-cnt">0</span></div><div class="hcm-stab" data-sv="settings">ตั้งค่า</div></div>
    <div class="hcm-stabs" id="hcm-tabs-cal"><div class="hcm-stab hcm-on" data-cv="month">เดือน</div><div class="hcm-stab" data-cv="list">รายการ</div><div class="hcm-stab" data-cv="add">+ เพิ่ม</div></div>
    <div class="hcm-body">

      <div class="hcm-view hcm-on" id="hcm-v-toc">
        <div class="hcm-toc-hd"><span class="hcm-toc-lbl">NOTE</span><span class="hcm-toc-yr">ระบบ &amp; เครื่องมือ</span></div>
        <div class="hcm-trow hcm-can" data-nav="code"><div class="hcm-tl"><div class="hcm-tbig">C</div><div class="hcm-tabb">CODE</div></div><div class="hcm-tm"><div class="hcm-tnum">ระบบที่ 01</div><div class="hcm-tname">ตัวจัดการโค้ด</div><div class="hcm-tdesc">จัดเก็บ · แทนที่ · พรีวิว</div></div><div class="hcm-tr"><div class="hcm-tgem"><span>I</span></div></div><div class="hcm-tarrow">›</div></div>
        <div class="hcm-trow hcm-locked"><div class="hcm-tl"><div class="hcm-tbig">M</div><div class="hcm-tabb">MEM</div></div><div class="hcm-tm"><div class="hcm-tnum">ระบบที่ 02</div><div class="hcm-tname">จัดการความจำ</div><div class="hcm-tdesc">เร็ว ๆ นี้</div></div><div class="hcm-tr"><div class="hcm-tgem hcm-grey"><span>✗</span></div></div></div>
        <div class="hcm-trow hcm-locked" style="border-bottom:none"><div class="hcm-tl"><div class="hcm-tbig">S</div><div class="hcm-tabb">SYS</div></div><div class="hcm-tm"><div class="hcm-tnum">ระบบที่ 03</div><div class="hcm-tname">ตั้งค่าส่วนกลาง</div><div class="hcm-tdesc">เร็ว ๆ นี้</div></div><div class="hcm-tr"><div class="hcm-tgem hcm-grey"><span>✗</span></div></div></div>
        <div class="hcm-note-card"><div class="hcm-nc-title">คำสั่ง AI ปฏิทิน</div><div class="hcm-nc-body">AI ใส่ tag → extension จับ → ลบออก → inject ก่อนโรล<br><br><code>[CAL:person=,date=YYYY-MM-DD,time=HH:MM,activity=,symbol=,details=]</code></div></div>
      </div>

      <div class="hcm-view" id="hcm-v-code">
        <div class="hcm-sv hcm-on" id="hcm-sv-code">
          <div class="hcm-spill"><div class="hcm-sdot"></div><span>พร้อมทำงาน</span></div>
          <div class="hcm-srow"><div class="hcm-sc"><div class="hcm-scv" id="hcm-total">0</div><div class="hcm-scl">บล็อก</div></div><div class="hcm-sc"><div class="hcm-scv" id="hcm-tok">~0</div><div class="hcm-scl">token ประหยัด</div></div></div>
          <div class="hcm-dvd"><div class="hcm-dvdg"></div><div class="hcm-dvdt">บล็อกที่จัดเก็บ</div></div>
          <div id="hcm-codelist"></div>
          <div class="hcm-btns"><button class="hcm-btns2" id="hcm-clear-btn">✕ ล้าง</button><button class="hcm-btnp" id="hcm-export-btn">↓ Export</button></div>
        </div>
        <div class="hcm-sv" id="hcm-sv-settings">
          <div class="hcm-dvd"><div class="hcm-dvdg"></div><div class="hcm-dvdt">ฟีเจอร์</div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>I</span></div><div><div class="hcm-fname">ตรวจจับ HTML block</div><div class="hcm-fdesc">จับ \`\`\`html...\`\`\` แทนที่ด้วย &lt;codeN&gt;</div></div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>II</span></div><div><div class="hcm-fname">ประหยัด token</div><div class="hcm-fdesc">~450 tok → ~12 tok ต่อบล็อก</div></div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>III</span></div><div><div class="hcm-fname">จับ [CAL:...] tag</div><div class="hcm-fdesc">บันทึกปฏิทิน ลบออกจากข้อความ</div></div></div>
          <div class="hcm-feat"><div class="hcm-fn"><span>IV</span></div><div><div class="hcm-fname">Inject ปฏิทิน</div><div class="hcm-fdesc">ส่งเข้า context ก่อนโรลทุกครั้ง</div></div></div>
        </div>
      </div>

      <div class="hcm-view" id="hcm-v-cal">
        <div class="hcm-sv hcm-on hcm-cal-full" id="hcm-calv-month">
          <div class="hcm-cal-nav"><button class="hcm-cal-nb" id="hcm-cal-prev">‹</button><div class="hcm-cal-lbl" id="hcm-cal-lbl">—</div><button class="hcm-cal-nb" id="hcm-cal-next">›</button></div>
          <div class="hcm-cal-pf"><span class="hcm-cal-pfl">บุคคล</span><select class="hcm-psel" id="hcm-pfilter"><option value="">ทุกคน</option></select></div>
          <div class="hcm-cal-dows"><div>อา.</div><div>จ.</div><div>อ.</div><div>พ.</div><div>พฤ.</div><div>ศ.</div><div>ส.</div></div>
          <div class="hcm-cal-grid" id="hcm-cal-grid"></div>
          <div class="hcm-cal-leg" id="hcm-cal-leg"></div>
          <div class="hcm-cal-det" id="hcm-cal-det" style="display:none"></div>
        </div>
        <div class="hcm-sv" id="hcm-calv-list"><div class="hcm-dvd" style="margin:0 0 8px"><div class="hcm-dvdg"></div><div class="hcm-dvdt">กำหนดการทั้งหมด</div></div><div id="hcm-ev-list"></div></div>
        <div class="hcm-sv" id="hcm-calv-add">
          <div class="hcm-dvd" style="margin:0 0 8px"><div class="hcm-dvdg"></div><div class="hcm-dvdt">เพิ่มกำหนดการ</div></div>
          <div class="hcm-fg"><div class="hcm-fl">บุคคล</div><input type="text" id="hcm-a-person" placeholder="ชื่อตัวละคร"></div>
          <div class="hcm-fg"><div class="hcm-fl">วันที่</div><input type="date" id="hcm-a-date"></div>
          <div class="hcm-fg"><div class="hcm-fl">เวลา</div><input type="time" id="hcm-a-time"></div>
          <div class="hcm-fg"><div class="hcm-fl">กิจกรรม</div><input type="text" id="hcm-a-act" placeholder="รายละเอียดกิจกรรม"></div>
          <div class="hcm-fg"><div class="hcm-fl">สัญลักษณ์</div><select id="hcm-a-sym">${symOpts}</select></div>
          <div class="hcm-fg"><div class="hcm-fl">รายละเอียด</div><input type="text" id="hcm-a-detail" placeholder="โน้ตเพิ่มเติม"></div>
          <button class="hcm-btnp" id="hcm-add-save">+ บันทึก</button>
        </div>
      </div>

    </div>
    <div class="hcm-band hcm-bot"></div>
    <div class="hcm-hind"><div class="hcm-hbar"></div></div>
  </div>
</div></div>

<div id="hcm-pop"><div class="hcm-ps"><div class="hcm-ph"><span class="hcm-pt" id="hcm-pt">—</span><button class="hcm-pc" id="hcm-pc-btn">คัดลอก</button><div class="hcm-px" id="hcm-pop-close">✕</div></div><div class="hcm-ptb"><div class="hcm-ptt hcm-on" data-pt="src">ซอร์สโค้ด</div><div class="hcm-ptt" data-pt="prev">พรีวิว</div></div><div class="hcm-pb"><div id="hcm-ptsrc"><pre id="hcm-psrc"></pre></div><div id="hcm-ptprev" style="display:none"><div id="hcm-pprev"></div></div></div></div></div>`);

    // ─ bind events ─
    $('body').on('click','#hcm-ltab',togglePanel);
    $('body').on('click','#hcm-close',()=>$('#hcm-panel').removeClass('hcm-open'));
    $('body').on('click','#hcm-back',navBack);
    $('body').on('click','#hcm-pop-close',()=>$('#hcm-pop').removeClass('hcm-on'));
    $('body').on('click','#hcm-pop',e=>{if(e.target.id==='hcm-pop')$('#hcm-pop').removeClass('hcm-on');});
    $('body').on('click','.hcm-bm',function(){const t=$(this).data('bm');if(!$('#hcm-panel').hasClass('hcm-open'))$('#hcm-panel').addClass('hcm-open');t==='toc'?navBack():openSec(t);});
    $('body').on('click','.hcm-trow.hcm-can',function(){openSec($(this).data('nav'));});
    $('body').on('click','#hcm-tabs-code .hcm-stab',function(){swSub('code',$(this).data('sv'));});
    $('body').on('click','#hcm-tabs-cal .hcm-stab',function(){const cv=$(this).data('cv');swSub('cal',cv);if(cv==='month')rGrid();if(cv==='list')rList();});
    $('body').on('click','#hcm-cal-prev',()=>{calView.month--;if(calView.month<0){calView.month=11;calView.year--;}rGrid();});
    $('body').on('click','#hcm-cal-next',()=>{calView.month++;if(calView.month>11){calView.month=0;calView.year++;}rGrid();});
    $('body').on('change','#hcm-pfilter',rGrid);
    $('body').on('click','#hcm-clear-btn',()=>{codeData().blocks=[];saveSettingsDebounced();refreshCodeUI();});
    $('body').on('click','#hcm-export-btn',()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({chatId:getChatId(),calendar:calData(),code:codeData()},null,2)],{type:'application/json'}));a.download=`hcm-${getChatId()}.json`;a.click();});
    $('body').on('click','#hcm-add-save',saveEv);
    $('body').on('click','#hcm-pc-btn',()=>{const b=codeData().blocks.find(x=>x.id===popId);if(!b)return;navigator.clipboard.writeText(b.html).catch(()=>{});$('#hcm-pc-btn').text('คัดลอกแล้ว');setTimeout(()=>$('#hcm-pc-btn').text('คัดลอก'),1400);});
    $('body').on('click','.hcm-ptt',function(){$('.hcm-ptt').removeClass('hcm-on');$(this).addClass('hcm-on');$('#hcm-ptsrc').toggle($(this).data('pt')==='src');$('#hcm-ptprev').toggle($(this).data('pt')==='prev');});
    $('body').on('click','.hcm-ib',function(){const id=parseInt($(this).data('id')),act=$(this).data('action');if(act==='preview')openPop(id);if(act==='copy'){const b=codeData().blocks.find(x=>x.id===id);if(b){navigator.clipboard.writeText(b.html).catch(()=>{});$(this).html('✓');setTimeout(()=>$(this).html('■'),1200);}}if(act==='delete')removeBlock(id);});
    setTimeout(()=>{const el=document.getElementById('hcm-a-date');if(el)el.value=fmtDate(new Date());},200);
    startClock(); refreshAllUI();
    console.log('[HCM] created ✓');
}

function togglePanel(){$('#hcm-panel').toggleClass('hcm-open');}
function openSec(s){
    section=s;
    $('#hcm-v-toc,#hcm-v-code,#hcm-v-cal').hide();
    $('#hcm-tabs-code,#hcm-tabs-cal').hide();
    $('#hcm-back').css('display','flex');
    $('.hcm-bm').each(function(){$(this).toggleClass('hcm-active',$(this).data('bm')===s);});
    if(s==='code'){$('#hcm-v-code,#hcm-tabs-code').css('display','flex');$('#hcm-eyebrow').text('ระบบที่ 01');$('#hcm-title').text('ตัวจัดการโค้ด');$('#hcm-sub').text('HTML Block Store');refreshCodeUI();}
    else{$('#hcm-v-cal,#hcm-tabs-cal').css('display','flex');$('#hcm-eyebrow').text('ระบบที่ 02');$('#hcm-title').text('ปฏิทินตัวละคร');$('#hcm-sub').text('กิจกรรมในโรล');bPF();rGrid();rList();}
}
function navBack(){section='toc';$('#hcm-v-code,#hcm-v-cal').hide();$('#hcm-v-toc').css('display','flex');$('#hcm-tabs-code,#hcm-tabs-cal').hide();$('#hcm-back').hide();$('#hcm-eyebrow').text('HCM Diary');$('#hcm-title').text('สารบัญระบบ');$('#hcm-sub').text('ส่วนขยาย SillyTavern');$('.hcm-bm').each(function(){$(this).toggleClass('hcm-active',$(this).data('bm')==='toc');});}
function swSub(sec,name){const tid=sec==='code'?'#hcm-tabs-code':'#hcm-tabs-cal',pre=sec==='code'?'#hcm-sv-':'#hcm-calv-',at=sec==='code'?'sv':'cv';$(`${tid} .hcm-stab`).removeClass('hcm-on');$(`${tid} .hcm-stab[data-${at}="${name}"]`).addClass('hcm-on');$(`#hcm-v-${sec==='code'?'code':'cal'} .hcm-sv`).hide();$(pre+name).css('display','flex');}

// ─── Calendar UI ───────────────────────────────────────────────
function rGrid(){
    const{year,month}=calView;$('#hcm-cal-lbl').text(`${TH_MON[month]} ${year+543}`);
    const pf=$('#hcm-pfilter').val(),evs=calData().events.filter(e=>!pf||e.person===pf);
    const first=new Date(year,month,1).getDay(),last=new Date(year,month+1,0).getDate(),todayS=fmtDate(new Date());
    const g=document.getElementById('hcm-cal-grid');if(!g)return;g.innerHTML='';
    for(let i=0;i<first;i++){const c=document.createElement('div');c.className='hcm-cal-day hcm-emp';g.appendChild(c);}
    for(let d=1;d<=last;d++){
        const ds=`${year}-${pad(month+1)}-${pad(d)}`,de=evs.filter(e=>e.date===ds);
        const cell=document.createElement('div');cell.className='hcm-cal-day'+(ds===todayS?' hcm-tdy':'')+(ds===selDate?' hcm-sel':'');
        cell.innerHTML=`<div class="hcm-dn">${d}</div>`;
        if(de.length){const sd=document.createElement('div');sd.className='hcm-cal-syms';de.slice(0,3).forEach(ev=>{const s=SYM[ev.symbol]||SYM.general;const sp=document.createElement('span');sp.className='hcm-sym';sp.style.color=s.color;sp.textContent=s.c;sd.appendChild(sp);});cell.appendChild(sd);}
        cell.addEventListener('click',()=>showDay(ds,de));g.appendChild(cell);
    }
    $('#hcm-cal-leg').html(Object.entries(SYM).map(([,v])=>`<div class="hcm-leg-it"><span class="hcm-sym" style="color:${v.color}">${v.c}</span><span>${v.label}</span></div>`).join(''));
}
function showDay(ds,evs){
    selDate=ds;rGrid();const det=document.getElementById('hcm-cal-det');if(!det)return;
    if(!evs.length){det.style.display='none';return;}det.style.display='block';
    const[y,m,d]=ds.split('-');
    det.innerHTML=`<div class="hcm-det-hd"><div class="hcm-det-date">${parseInt(d)} ${TH_S[parseInt(m)-1]} ${parseInt(y)+543}</div><div class="hcm-det-cnt">${evs.length} กิจกรรม</div></div>`+evs.map(ev=>{const s=SYM[ev.symbol]||SYM.general;return`<div class="hcm-det-row"><div class="hcm-det-sym" style="color:${s.color}">${s.c}</div><div class="hcm-det-body"><div class="hcm-det-act">${ev.activity}</div><div class="hcm-det-meta"><span>${ev.person||'ทุกคน'}</span><span>${ev.time||'--:--'}</span><
