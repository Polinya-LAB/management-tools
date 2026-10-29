/* ---------- Constants ---------- */
const ACTIVE=['Not approved','Queued','Planned','In progress','Endurance running','On hold','Report'];
const CLOSED=['Completed','Cancelled'];
/* Not approved tests stay in the queue and on the board but never count for alerts, planning, occupancy or KPIs. */
const counts=t=>ACTIVE.includes(t.status)&&t.status!=='Not approved';
const STATUSES=[...ACTIVE,...CLOSED];
const ST_CLS={'Queued':'cola','Planned':'plan','In progress':'curso','Endurance running':'endu','On hold':'bloq','Report':'inf','Completed':'cerr','Cancelled':'canc','Not approved':'noap'};
const EQ_STATES=new Set(['Planned','In progress','Endurance running','On hold']);
/* Both running statuses behave the same for dates, load and alerts. */
const RUNNING=new Set(['In progress','Endurance running']);
const TECH_STATES=new Set(['Planned','In progress','Endurance running','On hold','Report']);
const PRIOS=['Urgent','High','Medium','Low'];
const PRIO_RANK={Urgent:0,High:1,Medium:2,Low:3};
const EQ_STATUS=['Operational','Maintenance','Calibration','Out of service'];
const EQ_LEGACY={'Operativo':'Operational','Mantenimiento':'Maintenance','Calibración':'Calibration','Fuera de servicio':'Out of service'};
const UNITS=['Hours','Days','Weeks','Cycles'];
const UNIT_SHORT={Hours:'h',Days:'d',Weeks:'wk',Cycles:'cycles'};
const RESULTS=['Pass','Fail','N/A'];
const ARAS_STATUS={'in queue':'Queued','queued':'Queued','in progress':'In progress','completed':'Completed','complete':'Completed','cancelled':'Cancelled','canceled':'Cancelled','endurance running':'Endurance running','endurance':'Endurance running','not approved':'Not approved','not aproved':'Not approved','rejected':'Not approved'};
/* The same code runs three apps on the same data, chosen by <body data-app>: Control de ensayos (tests), Ocupación
   (equipment and technician load) and Muestras (samples: reception, PLR links and labels). Each app shows only its own views. */
const APP=['occupancy','samples'].includes(document.body.dataset.app)?document.body.dataset.app:'tests';
const VIEWS=APP==='occupancy'
  ?[['overview','Overview'],['planning','Planning'],['occupancy','Occupancy'],['resources','Equipment & team']]
  :APP==='samples'?[['samples','Samples'],['import','Import ARAS']]
  :[['overview','Overview'],['board','Board'],['queue','Queue'],['planning','Planning'],['history','History'],['resources','Equipment & team'],['library','QTP library'],['import','Import ARAS']];
const VIEW_KEY=APP==='occupancy'?'occ.view':APP==='samples'?'smp.view':'tl.view';
const DAY=86400000, WEEKS_HEAT=8;
/* Firestore-style collections. People and equipment keep the collections created in the first version. */
const COL={tests:'tests',people:'personas',equipment:'bancos',qtps:'qtps',samples:'muestras'};

const ARAS_FIELDS=[
  {k:'plr',label:'Request number (PLR)',req:true,syn:['request number','request','plr','request no']},
  {k:'qtp',label:'Task item (QTP)',req:true,syn:['task item','qtp','task','procedure']},
  {k:'title',label:'Test description',syn:['description','test','title','test name']},
  {k:'project',label:'Project',syn:['project']},
  {k:'requester',label:'Request creator',syn:['created by id','created by','requester','created by name','creator']},
  {k:'comments',label:'Comments',syn:['comments','comment']},
  {k:'status',label:'Task status',syn:['task status','status']},
  {k:'techName',label:'Lab resource (technician)',syn:['lab resource lab manager use only','lab resource','technician']},
  {k:'equipmentName',label:'Equipment',syn:['equipment']},
  {k:'start',label:'Start work date',type:'date',syn:['start work date','start date']},
  {k:'requestedDue',label:'Requested due date',type:'date',syn:['requested due date','due date']},
  {k:'flexible',label:'Due date flexible?',type:'bool',syn:['due date flexible']},
  {k:'durVal',label:'Duration',type:'num',syn:['duration']},
  {k:'durUnit',label:'Duration units',syn:['duration units']},
  {k:'pieces',label:'Number of pieces',type:'num',syn:['number of pieces requested','number of pieces','pieces']},
  {k:'sequence',label:'Test sequence',type:'num',syn:['test sequence','sequence']},
  {k:'result',label:'Test result',syn:['test result','result']},
  {k:'category',label:'Product category',syn:['product category','category']},
  {k:'requestNote',label:'Request status note',syn:['request status']},
];
const QTP_FIELDS=[
  {k:'code',label:'QTP code',req:true,syn:['qtp','qtp code','code','task item','procedure','document number']},
  {k:'name',label:'Test name',syn:['description','name','test name','title','test']},
  {k:'durVal',label:'Estimated duration',type:'num',syn:['duration','estimated duration','est duration','duration h','duration hours']},
  {k:'durUnit',label:'Duration unit',syn:['unit','units','duration unit','duration units']},
  {k:'techHours',label:'Technician hours',type:'num',syn:['technician hours','tech hours','labour hours','labor hours','man hours']},
  {k:'equipmentName',label:'Default equipment',syn:['equipment','bench','testbench']},
  {k:'durBasis',label:'Duration basis (per test / per sample)',syn:['basis','duration basis','per','time basis']},
  {k:'testType',label:'Test type',syn:['lab test type','test type','type of test']},
  {k:'standard',label:'Standard',syn:['lab agency standard','standard','norma','agency standard']},
  {k:'notes',label:'Notes',syn:['notes','note','remarks']},
];

/* ---------- State ---------- */
const S={tests:[],people:[],equipment:[],qtps:[],cfg:{},loaded:new Set(),view:APP==='samples'?'samples':'overview',q:'',imp:null,qimp:null,ro:false,noDb:false,dayW:18,hist:{st:'',res:''},incClosed:true,sort:{queue:{k:'',dir:1},hist:{k:'',dir:1}},qst:['Not approved','Queued','Planned','In progress','Endurance running','On hold'],occ:{start:null,weeks:4,sel:null}};
let db=null, dl=null, IX=null;
try{const v=localStorage.getItem(VIEW_KEY); if(VIEWS.some(x=>x[0]===v)) S.view=v; S.hideIdle=localStorage.getItem('tl.hideIdle')==='1'; const z=+localStorage.getItem('tl.dayW'); if(z) S.dayW=z===30?32:z; const qs=JSON.parse(localStorage.getItem('tl.qst')||'null'); if(Array.isArray(qs)&&qs.length) S.qst=qs.filter(x=>ACTIVE.includes(x)); if(!localStorage.getItem('tl.qstv')){ if(!S.qst.includes('Not approved')) S.qst.unshift('Not approved'); localStorage.setItem('tl.qstv','2'); } if(localStorage.getItem('tl.qstv')==='2'){ if(!S.qst.includes('Endurance running')) S.qst.push('Endurance running'); localStorage.setItem('tl.qstv','3'); } localStorage.setItem('tl.qst',JSON.stringify(S.qst)); const ow=+localStorage.getItem('tl.occw'); if([2,4,6,8].includes(ow)) S.occ.weeks=ow;}catch(e){}
if(location.hash&&VIEWS.some(x=>'#'+x[0]===location.hash)) S.view=location.hash.slice(1);

/* ---------- Utilities ---------- */
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const d=s=>{if(!s) return null; const m=String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m?Date.UTC(+m[1],m[2]-1,+m[3]):null};
const iso=ms=>new Date(ms).toISOString().slice(0,10);
const todayMs=()=>{const n=new Date(); return Date.UTC(n.getFullYear(),n.getMonth(),n.getDate())};
const mondayOf=ms=>ms-((new Date(ms).getUTCDay()+6)%7)*DAY;
const isWork=ms=>{const w=new Date(ms).getUTCDay(); return w!==0&&w!==6};
const workdays=(a,b)=>{let n=0; for(let t=a;t<=b;t+=DAY) if(isWork(t)) n++; return n};
const fmt=s=>{if(!s) return '—'; const [y,m,dd]=String(s).split('-'); return `${dd}/${m}/${y.slice(2)}`};
const fmtMs=ms=>ms==null?'—':fmt(iso(ms));
const nowIso=()=>new Date().toISOString();
const norm=s=>String(s??'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const qid=c=>String(c||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'_');
const slug=s=>String(s||'').trim().replace(/[^A-Za-z0-9_-]+/g,'_').slice(0,60);
const eqById=id=>id?S.equipment.find(b=>b.id===id):null;
const personById=id=>id?S.people.find(p=>p.id===id):null;
const libOf=t=>t&&t.qtp?S.qtps.find(q=>q.id===qid(t.qtp)):null;
const eqName=b=>b?(b.nombre||'(unnamed)'):'(deleted equipment)';
const eqStatus=b=>EQ_LEGACY[b?.estado]||b?.estado||'Operational';
/* Instruments (FLE) come from the calibration plan (lab-data/calibraciones/calibraciones.json, read-only here).
   Each equipment keeps the ids of the instruments usually used on it in `instrumentos`. */
const CAL={eq:null,err:null};
const calMonth=(ym,add=0)=>{const m=/^(\d{4})-(\d{2})/.exec(ym||''); return m?+m[1]*12+(+m[2]-1)+add:null};
function fleDue(e){
  if(e.calMode==='Expiry date') return e.nextOverride||'';
  if(e.calMode!=='Periodic') return '';
  const i=calMonth(e.lastCal,+e.periodMonths||0); return e.nextOverride||(i==null?'':`${Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`);
}
function fleState(e){
  if(!e) return {cls:'off',text:'not in the calibration plan'};
  if(e.state&&e.state!=='In use') return {cls:'off',text:e.state};
  if(e.calMode==='Not required') return {cls:'',text:'no calibration required'};
  if(e.calMode==='Before use') return {cls:'',text:'checked before use'};
  const due=fleDue(e), di=calMonth(due), n=new Date(), now=n.getFullYear()*12+n.getMonth();
  if(di==null) return {cls:'warn',text:'calibration dates missing'};
  const m=`${due.slice(5,7)}/${due.slice(2,4)}`;
  return di<now?{cls:'crit',text:`calibration overdue since ${m}`}:di-now<=1?{cls:'warn',text:`calibration due ${m}`}:{cls:'ok',text:`calibrated until ${m}`};
}
const fleById=id=>CAL.eq&&CAL.eq[id];
const fleLabel=e=>[e.description||'(no description)',[e.brand,e.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
const fleChip=id=>{const e=fleById(id), s=CAL.eq?fleState(e):{cls:'',text:'calibration plan not loaded'}; return `<span class="chip fle ${s.cls}" title="${esc(`${e?fleLabel(e):id} · ${s.text}`)}">${esc(e?e.code:String(id).replace(/^eq-/,''))}</span>`;};
const eqCap=b=>Math.max(1,parseInt(b?.capacidad)||1);
const eqStateCls=s=>s==='Operational'?'ok':s==='Out of service'?'off':'no';
const byName=(a,b)=>String(a.nombre||a.name||a.id||'').localeCompare(String(b.nombre||b.name||b.id||''),'en');
const keyOf=t=>String(t.plr||'').trim().toUpperCase()+'|'+String(t.qtp||'').trim().toUpperCase();
const baseRef=t=>`${t.plr||'—'} · ${t.qtp||'—'}`;
const ref=t=>{const g=IX&&IX.tag.get(t.id); return g?`${baseRef(t)} (${g})`:baseRef(t)};
const projectNo=t=>{const m=String(t.project||'').match(/^\s*([A-Za-z0-9]+)\s*-\s+/); return m?m[1]:String(t.project||'')};
const daysTo=s=>s?Math.round((d(s)-todayMs())/DAY):null;
function toast(msg){const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>t.hidden=true,3800)}
function errMsg(e){const c=e&&e.code; if(c==='not_granted'||c==='forbidden') return 'You cannot change data: connect GitHub with an account that has write access to the repository.'; if(c==='auth') return 'Your GitHub key is no longer valid. Connect GitHub again with a new key.'; if(c==='conflict') return 'Someone else saved at the same time. Your change was not saved; try again.'; if(c==='rate') return 'GitHub is limiting requests right now. Wait a minute and try again.'; if(c==='unavailable') return 'Could not reach GitHub. Check your connection and try again.'; return 'Could not save: '+(e&&e.message||e)}
const estPill=s=>`<span class="pill est st-${ST_CLS[s]||'cola'}">${esc(s)}</span>`;
const prioTag=p=>`<span class="prio ${esc(p||'Medium')}">${esc(p||'Medium')}</span>`;
const resTag=r=>r?`<span class="res ${r==='N/A'?'NA':esc(r)}">${esc(r)}</span>`:'';
const projChip=t=>t.project?`<span class="chip proj" title="${esc(t.project)}">${esc(projectNo(t))}</span>`:'';
const projectName=t=>{const s=String(t.project||''); const m=s.match(/^\s*[A-Za-z0-9]+\s*-\s+(.*)$/); return m?m[1]:(projectNo(t)===s?'':s)};
const projCell=t=>t.project?`${projChip(t)}${projectName(t)?`<span class="pname">${esc(projectName(t))}</span>`:''}`:'<span class="muted">—</span>';
const isoWeek=ms=>{const dt=new Date(ms); const day=(dt.getUTCDay()+6)%7; const th=ms-day*DAY+3*DAY; const y=new Date(th).getUTCFullYear(); return 1+Math.round((th-Date.UTC(y,0,4))/DAY/7-((new Date(Date.UTC(y,0,4)).getUTCDay()+6)%7-3)/7)};
const WD=['Su','Mo','Tu','We','Th','Fr','Sa'];
/* Sortable table header. cols: [key,label,cls?] */
function sortHead(table,cols){const st=S.sort[table]; return `<tr>${cols.map(([k,l,c])=>k?`<th class="${c||''}"><button type="button" class="th-sort" data-act="sort" data-table="${table}" data-k="${k}" ${st.k===k?`aria-sort="${st.dir>0?'ascending':'descending'}"`:''}>${l}<span class="arr">${st.k===k?(st.dir>0?'▲':'▼'):'↕'}</span></button></th>`:`<th class="${c||''}">${l}</th>`).join('')}</tr>`;}
function sortBy(list,table,getters,fallback){
  const st=S.sort[table]; if(!st.k||!getters[st.k]) return list.sort(fallback);
  const g=getters[st.k];
  return list.sort((a,b)=>{const x=g(a), y=g(b), ex=x==null||x==='', ey=y==null||y===''; if(ex&&ey) return fallback(a,b); if(ex) return 1; if(ey) return -1;
    const c=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'en',{numeric:true,sensitivity:'base'}); return c*st.dir||fallback(a,b);});
}
function durHours(x){if(!x) return null; if(x.unit==='Hours') return x.val; if(x.unit==='Days') return x.val*24; if(x.unit==='Weeks') return x.val*168; if(x.unit==='Cycles') return x.cpd?x.val/x.cpd*24:null; return null;}
const techSel=t=>{const p=personById(t.techId); if(S.ro) return `<span class="tech-cell ${p?'':'none'}">${esc(p?p.nombre:'Unassigned')}</span>`;
  return `<select class="tech-sel ${p?'':'none'}" data-settech="${esc(t.id)}" aria-label="Technician of ${esc(baseRef(t))}"><option value="">Unassigned</option>${[...S.people].sort(byName).map(x=>`<option value="${esc(x.id)}" ${x.id===t.techId?'selected':''}>${esc(x.nombre)}</option>`).join('')}${t.techId&&!p?`<option value="${esc(t.techId)}" selected>(deleted person)</option>`:''}</select>`};
const statusSel=t=>S.ro?estPill(t.status):`<select class="st-sel st-${ST_CLS[t.status]||'cola'}" data-setstatus="${esc(t.id)}" aria-label="Status of ${esc(baseRef(t))}">${STATUSES.map(s=>`<option ${s===t.status?'selected':''}>${s}</option>`).join('')}</select>`;

/* ---------- Duration and end date ---------- */
/* A QTP can give its duration and technician hours per test or per sample; per sample they are
   multiplied by the test's number of pieces (1 when the test has no pieces set). */
const piecesSet=t=>parseInt(t.pieces)>0;
const samplesOf=t=>Math.max(1,parseInt(t.pieces)||0);
const round2=x=>Math.round(x*100)/100;
const libTech=t=>{const L=libOf(t); if(!L||!(+L.techHours>0)) return 0; return round2(+L.techHours*(L.techBasis==='sample'?samplesOf(t):1));};
function effDur(t){
  const L=libOf(t);
  const cont=t.continuous==='yes'?true:t.continuous==='no'?false:!(L&&L.continuous===false);
  const cpd=+(t.cyclesPerDay||(L&&L.cyclesPerDay))||0;
  if(+t.durVal>0) return {val:+t.durVal,unit:t.durUnit||'Hours',cont,cpd,src:'this test'};
  /* Precedence: this test > QTP library per sample > QTP library per test > ARAS */
  if(L&&+L.durVal>0&&L.durBasis==='sample'){const unit=L.durUnit||'Hours', n=samplesOf(t);
    return {val:round2(+L.durVal*n),unit,cont,cpd,src:`QTP library · ${L.durVal} ${UNIT_SHORT[unit]||unit} × ${n}${piecesSet(t)?'':' (pieces not set)'}`,perSample:true};}
  if(L&&+L.durVal>0) return {val:+L.durVal,unit:L.durUnit||'Hours',cont,cpd,src:'QTP library'};
  if(+t.arasDurVal>0) return {val:+t.arasDurVal,unit:normUnit(t.arasDurUnit)||'Hours',cont,cpd,src:'ARAS'};
  return null;
}
const durLabel=x=>x?`${x.val} ${UNIT_SHORT[x.unit]||x.unit}`:'—';
function durDays(x){
  if(!x) return null; const v=x.val;
  if(x.unit==='Hours') return x.cont?{n:Math.max(1,Math.ceil(v/24)),work:false}:{n:Math.max(1,Math.ceil(v/8)),work:true};
  if(x.unit==='Days') return {n:Math.max(1,Math.ceil(v)),work:!x.cont};
  if(x.unit==='Weeks') return {n:Math.max(1,Math.ceil(v*7)),work:false};
  if(x.unit==='Cycles') return x.cpd?{n:Math.max(1,Math.ceil(v/x.cpd)),work:false}:null;
  return null;
}
function addSpan(s,dd){ if(!dd.work) return s+(dd.n-1)*DAY; let t=s,c=isWork(t)?1:0; while(c<dd.n){t+=DAY; if(isWork(t)) c++;} return t; }
/* kind: set = typed by the lab; auto = start + estimated duration; open = unknown end */
function endInfo(t){
  const s=d(t.start); if(s==null) return {end:null,kind:'none'};
  if(t.end) return {end:d(t.end),kind:'set'};
  const dd=durDays(effDur(t)); if(dd) return {end:addSpan(s,dd),kind:'auto'};
  return {end:RUNNING.has(t.status)?Math.max(s,todayMs()):s,kind:'open'};
}
const evenTech=t=>+t.techHours||libTech(t);
/* Technician load. "even" spreads the total hours over the working days.
   "endurance" (set per QTP in the library): setup and teardown in blocks of LOAD_DAY h per working day,
   a daily check on the working days in between, and periodic reviews counted from the start. No hours at weekends. */
const LOAD_DAY=8, REVIEW_MS={Hours:3600000,Days:DAY,Weeks:7*DAY};
const isEndu=t=>libOf(t)?.profile==='endurance';
const nextWork=ms=>{while(!isWork(ms)) ms+=DAY; return ms;};
function techPlan(t,s,e,openEnd){
  const m=new Map(), tags=new Map(), add=(day,h,tag)=>{if(!(h>0)) return; m.set(day,(m.get(day)||0)+h); if(!tags.has(day)) tags.set(day,new Set()); tags.get(day).add(tag);};
  const L=libOf(t);
  if(!isEndu(t)){const tot=evenTech(t), wd=workdays(s,e)||1; for(let x=s;x<=e;x+=DAY) if(isWork(x)) add(x,tot/wd,'work'); return {m,tags,parts:null};}
  const blocks=(h,first)=>{const out=[]; let x=nextWork(first); for(let r=h;r>0;r-=LOAD_DAY){out.push([x,Math.min(LOAD_DAY,r)]); x=nextWork(x+DAY);} return out;};
  const setup=blocks(+L.setupH||0,s), lastSetup=setup.length?setup[setup.length-1][0]:s-DAY;
  setup.forEach(([x,h])=>add(x,h,'setup'));
  let teardown=[];
  if(!openEnd&&+L.teardownH>0){
    const n=Math.ceil(+L.teardownH/LOAD_DAY), back=[];
    for(let x=e;x>lastSetup&&back.length<n;x-=DAY) if(isWork(x)) back.unshift(x);
    let x=e; while(back.length<n){x=nextWork(x+DAY); back.push(x);}
    let r=+L.teardownH; teardown=back.map(x=>{const h=Math.min(LOAD_DAY,r); r-=h; return [x,h];});
    teardown.forEach(([x,h])=>add(x,h,'teardown'));
  }
  const firstTear=teardown.length?teardown[0][0]:e+DAY;
  let dailyDays=0; const daily=+L.dailyH||0;
  if(daily) for(let x=lastSetup+DAY;x<firstTear&&x<=e;x+=DAY) if(isWork(x)){add(x,daily,'daily'); dailyDays++;}
  let reviews=0; const every=+L.reviewEvery||0, rh=+L.reviewH||0;
  if(every>0&&rh>0){const step=every*(REVIEW_MS[L.reviewUnit]||REVIEW_MS.Hours);
    for(let k=1;k<1000;k++){const day=nextWork(Math.floor((s+k*step)/DAY)*DAY); if(day>e||day>=firstTear) break; if(day<=lastSetup) continue; add(day,rh,'review'); reviews++;}}
  return {m,tags,parts:{setupDays:setup.length,teardownDays:teardown.length,dailyDays,reviews}};
}
const planTotal=pl=>[...pl.m.values()].reduce((a,b)=>a+b,0);
/* Total technician hours. The app simulates unscheduled endurance tests from the next working day. */
function effTech(t){
  if(!isEndu(t)) return evenTech(t);
  const s=d(t.start)??nextWork(todayMs()), ei=endInfo({...t,start:iso(s)});
  return planTotal(techPlan(t,s,Math.max(s,ei.end??s),ei.kind==='open'));
}
const loadSummary=q=>q.profile==='endurance'
  ?`Endurance · setup ${+q.setupH||0} h · daily ${+q.dailyH||0} h${+q.reviewEvery&&+q.reviewH?` · review ${q.reviewH} h every ${q.reviewEvery} ${UNIT_SHORT[q.reviewUnit||'Hours']}`:''} · teardown ${+q.teardownH||0} h`
  :(+q.techHours?`${q.techHours} h ${q.techBasis==='sample'?'per sample':'total'}, spread evenly`:'—');

/* ---------- Index: siblings, end dates, equipment load ---------- */
function buildIndex(list){
  const END=new Map(), byEq=new Map(), sib=new Map(), tag=new Map(), over=new Map(), TP=new Map();
  for(const t of list){const k=keyOf(t); if(!sib.has(k)) sib.set(k,[]); sib.get(k).push(t);}
  for(const arr of sib.values()){
    if(arr.length<2) continue; const seen={};
    arr.forEach((t,i)=>{const b=eqById(t.equipmentId); let g=b?eqName(b):(t.arasEquipment||(t.sequence?'seq '+t.sequence:'#'+(i+1))); seen[g]=(seen[g]||0)+1; tag.set(t.id,seen[g]>1?g+' #'+seen[g]:g);});
  }
  for(const t of list){
    if(!counts(t)) continue;
    const ei=endInfo(t); END.set(t.id,ei); const s=d(t.start);
    if(TECH_STATES.has(t.status)&&t.techId&&s!=null&&ei.end!=null) TP.set(t.id,techPlan(t,s,Math.max(s,ei.end),ei.kind==='open'));
    if(EQ_STATES.has(t.status)&&t.equipmentId&&s!=null&&ei.end!=null){ if(!byEq.has(t.equipmentId)) byEq.set(t.equipmentId,[]); byEq.get(t.equipmentId).push({t,s,e:Math.max(s,ei.end)}); }
  }
  for(const [eid,iv] of byEq){
    const cap=eqCap(eqById(eid)); if(iv.length<=cap) continue;
    const lo=Math.min(...iv.map(x=>x.s)), hi=Math.min(Math.max(...iv.map(x=>x.e)),lo+600*DAY);
    let first=null,max=0; const ids=new Set();
    for(let day=lo;day<=hi;day+=DAY){const on=iv.filter(x=>x.s<=day&&day<=x.e); if(on.length>cap){ if(first==null) first=day; max=Math.max(max,on.length); on.forEach(x=>ids.add(x.t.id)); }}
    if(ids.size) over.set(eid,{ids,first,max});
  }
  return {END,byEq,sib,tag,over,list,TP};
}
const eqCount=(ix,eid,day,ex)=>(ix.byEq.get(eid)||[]).filter(x=>x.t.id!==ex&&x.s<=day&&day<=x.e).length;
function freeFrom(ix,eid,ex){const cap=eqCap(eqById(eid)), T=todayMs(); for(let t=T;t<T+730*DAY;t+=DAY) if(eqCount(ix,eid,t,ex)<cap) return t; return null;}
function eqWeekPct(ix,eid,wk){let n=0; for(let i=0;i<7;i++) n+=eqCount(ix,eid,wk+i*DAY); return n/(7*eqCap(eqById(eid)))*100;}
function personHours(ix,pid,wk){
  let h=0; const wkEnd=wk+6*DAY;
  for(const t of ix.list){
    if(t.techId!==pid||!TECH_STATES.has(t.status)) continue;
    const pl=ix.TP.get(t.id); if(!pl) continue;
    for(const [day,x] of pl.m) if(day>=wk&&day<=wkEnd) h+=x;
  }
  return h;
}

/* ---------- Alerts (active tests only) ---------- */
function testAlerts(t,ix){
  const out=[]; if(!ACTIVE.includes(t.status)||t.status==='Not approved') return out;
  const push=(sev,short,text,key,occ)=>out.push({sev,short,text,key,occ});
  const T=todayMs(), b=eqById(t.equipmentId), p=personById(t.techId), ei=ix.END.get(t.id)||endInfo(t), s=d(t.start), e=ei.end, useEq=EQ_STATES.has(t.status);
  if((t.status==='Planned'||RUNNING.has(t.status))&&s==null) push('warn','No start date',`${ref(t)}: ${t.status.toLowerCase()} without a start date.`);
  if(useEq&&s!=null&&ei.kind==='open') push('warn','No duration',`${ref(t)}: no estimated duration on the test or in the QTP library, so the end date is unknown.`);
  if(t.end&&s!=null&&d(t.end)<s) push('crit','Dates inconsistent',`${ref(t)}: the planned end is before the start.`);
  if(useEq&&b){
    const oc=ix.over.get(b.id);
    if(oc&&oc.ids.has(t.id)) push('crit','Over capacity',`${eqName(b)}: ${oc.max} tests at the same time from ${fmtMs(oc.first)} (capacity ${eqCap(b)}).`,'cap:'+b.id,true);
    const st=eqStatus(b); if(st!=='Operational'&&(e==null||e>=T)) push('crit','Equipment not operational',`${ref(t)}: ${eqName(b)} is in status "${st}".`);
    if(b.proximaCalibracion&&e!=null){const c=d(b.proximaCalibracion);
      if(c<T) push('crit','Calibration expired',`${eqName(b)}: calibration expired on ${fmt(b.proximaCalibracion)} (used by ${ref(t)}).`,'calx:'+b.id);
      else if(c<=e) push('warn','Calibration due',`${eqName(b)}: calibration due on ${fmt(b.proximaCalibracion)}, before ${ref(t)} ends (${fmtMs(e)}).`);}
  }
  if(p&&b&&(p.habilitaciones||[]).length&&!p.habilitaciones.includes(b.id)) push('warn','Not qualified',`${p.nombre} is not qualified on ${eqName(b)} (${ref(t)}).`);
  const due=t.agreedDue||t.requestedDue;
  if(due){
    const r=d(due), sev=t.flexible&&!t.agreedDue?'warn':'crit', which=t.agreedDue?'agreed':'requested', fl=t.flexible&&!t.agreedDue?' (flexible)':'';
    if(t.status!=='Report'&&e!=null&&ei.kind!=='open'&&e>r) push(sev,'Ends after due date',`${ref(t)}: planned end ${fmtMs(e)} is after the ${which} date ${fmt(due)}${fl}.`);
    else if(r<T) push(sev,'Overdue',`${ref(t)}: ${Math.round((T-r)/DAY)} days past the ${which} date ${fmt(due)}${fl}.`);
    else if(t.status==='Queued'&&r-T<=10*DAY) push('warn','Due soon',`${ref(t)}: still queued and due on ${fmt(due)}.`);
  }
  if(RUNNING.has(t.status)&&e!=null&&ei.kind!=='open'&&e<T) push('warn','Past planned end',`${ref(t)}: planned end was ${fmtMs(e)} and it is still ${t.status.toLowerCase()}.`);
  if(t.status==='On hold') push('warn','On hold',`${ref(t)} is on hold${t.holdReason?': '+t.holdReason:' (no reason given)'}.`);
  if(p&&s!=null&&e!=null&&TECH_STATES.has(t.status)&&+p.horasSemana){
    for(let w=mondayOf(Math.max(s,mondayOf(T)));w<=e&&w<mondayOf(T)+WEEKS_HEAT*7*DAY;w+=7*DAY){
      const h=personHours(ix,p.id,w); if(h>+p.horasSemana*1.001){out.push({sev:'warn',short:'Technician overloaded',text:`${p.nombre} reaches ${Math.round(h/p.horasSemana*100)}% of capacity in the week of ${fmtMs(w)}.`,skipGlobal:true,occ:true}); break;}
    }
  }
  return out;
}
/* Load alerts (over capacity, overloaded technicians) belong to the occupancy app; the rest to Control de ensayos. */
const mine=x=>APP==='occupancy'?!!x.occ:!x.occ;
function computeAlerts(ix){
  const T=todayMs(), per=new Map(), global=[], seen=new Set();
  for(const t of ix.list){ if(!ACTIVE.includes(t.status)) continue;
    const al=testAlerts(t,ix); per.set(t.id,al);
    for(const x of al){ if(x.skipGlobal) continue; if(x.key){ if(seen.has(x.key)) continue; seen.add(x.key);} global.push({...x,tid:x.key&&x.key.startsWith('cap:')?null:t.id}); }
  }
  for(const p of S.people){const cap=+p.horasSemana||0; if(!cap) continue;
    for(let i=0;i<WEEKS_HEAT;i++){const w=mondayOf(T)+i*7*DAY, h=personHours(ix,p.id,w); if(h>cap*1.001){global.push({sev:h>cap*1.2?'crit':'warn',text:`${p.nombre}: ${Math.round(h)} h assigned in the week of ${fmtMs(w)} (capacity ${cap} h, ${Math.round(h/cap*100)}%).`,occ:true}); break;}}}
  for(const b of S.equipment){ if(!b.proximaCalibracion||seen.has('calx:'+b.id)) continue; const c=d(b.proximaCalibracion);
    if(c<T) global.push({sev:'crit',text:`${eqName(b)}: calibration expired on ${fmt(b.proximaCalibracion)}.`});
    else if(c-T<=30*DAY) global.push({sev:'warn',text:`${eqName(b)}: calibration due on ${fmt(b.proximaCalibracion)} (in ${Math.round((c-T)/DAY)} days).`}); }
  for(const [id,al] of per) per.set(id,al.filter(mine));
  global.sort((x,y)=>(x.sev==='crit'?0:1)-(y.sev==='crit'?0:1));
  return {global:global.filter(mine),per};
}

/* ---------- Render ---------- */
function render(){
  IX=buildIndex(S.tests); const A=computeAlerts(IX); S.A=A;
  $('#qtp-list').innerHTML=[...S.qtps].sort(byName).map(q=>`<option value="${esc(q.code||q.id)}">${esc(q.name||'')}</option>`).join('');
  const crit=A.global.filter(a=>a.sev==='crit').length, nq=S.tests.filter(t=>t.status==='Queued').length, nh=S.tests.filter(t=>CLOSED.includes(t.status)).length, ns=APP!=='occupancy'?smpMissingCount():0;
  $('#tabs').innerHTML=VIEWS.map(([k,l])=>`<button data-view="${k}" ${S.view===k?'aria-current="page"':''}>${k==='samples'?tx('tab'):l}${k==='samples'&&ns?`<span class="n warn" title="${esc(tx('k_miss'))}">${ns}</span>`:''}${k==='overview'&&A.global.length?`<span class="n ${crit?'crit':''}">${A.global.length}</span>`:''}${k==='queue'&&nq?`<span class="n">${nq}</span>`:''}${k==='history'&&nh?`<span class="n">${nh}</span>`:''}</button>`).join('');
  $('#btn-new').hidden=S.ro||S.noDb||APP!=='tests';
  let banner='';
  if(S.noDb) banner=S.privateData
    ? (GH.login
      ? `<div class="banner crit"><b>Your account ${esc(GH.login)} cannot see the lab data.</b> Ask the owner to add you to the private repository <span class="mono">${REPO.owner}/${REPO.repo}</span>.</div>`
      : `<div class="banner crit"><b>The lab data is private.</b> Press Connect GitHub with an account that has access to see it${PREVIEW?`, or <button class="link" data-pv="demo-on">try the preview with example data</button>`:''}.</div>`)
    : `<div class="banner crit"><b>Could not load the lab data from GitHub.</b> Check your connection and reload the page${PREVIEW?`, or <button class="link" data-pv="demo-on">try the preview with example data</button>`:''}.</div>`;
  else if(PREVIEW&&DEMO) banner=`<div class="banner"><b>Preview with example data.</b> The data is invented and changes are kept only in this browser; nothing is read from or sent to GitHub. You can also import an ARAS export to try it. <button class="link" data-pv="demo-reset">Reset the example data</button> · <button class="link" data-pv="demo-off">Use the real data</button></div>`;
  else if(PREVIEW&&remote.data) banner=`<div class="banner"><b>Preview version.</b> It shows the real data from <span class="mono">lab-data</span>, but changes are not saved to GitHub: they stay in this page until you reload it.</div>`;
  else if(GH.invalid) banner=`<div class="banner crit">Your GitHub key is no longer valid or has expired. <button class="link" data-act="gh">Connect GitHub</button> and paste a new one.</div>`;
  else if(GH.login&&!GH.push) banner=`<div class="banner">Your GitHub account <b>${esc(GH.login)}</b> cannot edit this repository. Ask to be added as a collaborator with the Write role.</div>`;
  else if(S.ro) banner=`<div class="banner">Read-only. To create or change tests, <button class="link" data-act="gh">connect GitHub</button> with an account that has write access to the repository.</div>`;
  renderGh();
  const loading=!S.noDb&&S.loaded.size<6;
  const fn={overview:vOverview,board:vBoard,queue:vQueue,planning:vPlanning,samples:vSamples,occupancy:vOccupancy,history:vHistory,resources:vResources,library:vLibrary,import:vImport}[S.view]||vOverview;
  $('#view').innerHTML=banner+(loading?`<div class="empty"><h3>Loading lab data…</h3></div>`:fn(A));
}
function noTests(){
  if(APP==='occupancy') return `<div class="empty"><p class="eyebrow">No tests yet</p><h3>Nothing to plan yet</h3><p>Tests are created in <a href="../control-ensayos/">Control de ensayos</a>, by hand or from the ARAS export. They appear here as soon as they are saved.</p></div>`;
  return `<div class="empty"><p class="eyebrow">No tests yet</p><h3>Import your ARAS export to get started</h3>
  <p>Export the lab request search from ARAS to Excel and load it in <b>Import ARAS</b>. Each row becomes one test identified by its PLR and QTP. You can also create tests by hand with <b>+ New test</b>.</p>
  <div class="row">${S.ro||S.noDb?'':`<button class="btn primary" data-view="import">Import from ARAS</button><button class="btn" data-view="resources">Check equipment & team</button><button class="btn ghost" data-view="library">Open QTP library</button>`}</div></div>`;
}
const active=()=>S.tests.filter(counts);
const searchBox=()=>`<input class="search" id="q" type="search" placeholder="Search PLR, QTP, project, requester…" value="${esc(S.q)}" aria-label="Search">`;
function matchQ(t){ if(!S.q) return true; const q=S.q.toLowerCase(); return [t.plr,t.qtp,t.title,t.project,t.requester,t.comments,eqName(eqById(t.equipmentId)),personById(t.techId)?.nombre,t.arasEquipment].some(v=>String(v||'').toLowerCase().includes(q)); }

/* Alerts panel. In each app it lists only that app's alerts (see computeAlerts). */
function alertsPanel(A){
  const none=APP==='occupancy'?'No conflicts: no equipment over capacity and no overloaded technicians.':'No tests past their dates and no blocked or inconsistent tests.';
  return `<section class="panel"><div class="panel-h"><h2>Alerts</h2><span class="muted">${A.global.length} active · completed, cancelled and not approved tests never raise alerts</span></div>
    ${A.global.length?`<ul class="alerts">${A.global.map(a=>`<li class="${a.sev}" ${a.tid?`data-act="edit" data-id="${esc(a.tid)}"`:''}><span class="sev">${a.sev==='crit'?'Critical':'Warning'}</span><span>${esc(a.text)}</span></li>`).join('')}</ul>`:`<div class="empty-ok">${none}</div>`}
  </section>`;
}
function vOverview(A){
  if(!S.tests.length) return noTests();
  const T=todayMs(), act=active(), n=s=>act.filter(t=>t.status===s).length;
  const overdue=act.filter(t=>{const due=t.agreedDue||t.requestedDue; return due&&d(due)<T}).length;
  const date=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  if(APP==='occupancy') return vLoadOverview(A,date);
  return `<div class="view-h"><h2>Lab overview</h2><span class="muted">${date}</span></div>
  <section class="kpis">
    <button class="kpi" data-view="board"><span class="eyebrow">In progress</span><b>${n('In progress')}</b><span class="muted">${n('Planned')} planned</span></button>
    <button class="kpi" data-view="board"><span class="eyebrow">Endurance running</span><b>${n('Endurance running')}</b><span class="muted">long-running tests</span></button>
    <button class="kpi" data-view="queue"><span class="eyebrow">Queued</span><b>${n('Queued')}</b><span class="muted">waiting to be planned</span></button>
    <button class="kpi" data-view="board"><span class="eyebrow">Report</span><b>${n('Report')}</b><span class="muted">tests finished, report in writing</span></button>
    <button class="kpi ${n('On hold')?'warn':''}" data-view="board"><span class="eyebrow">On hold</span><b>${n('On hold')}</b><span class="muted">blocked tests</span></button>
    <button class="kpi ${overdue?'crit':''}" data-view="queue"><span class="eyebrow">Overdue</span><b>${overdue}</b><span class="muted">past requested or agreed date</span></button>
  </section>
  ${alertsPanel(A)}`;
}
/* Occupancy app overview: load this week, weekly heat maps for the team and the equipment, and load alerts. */
function vLoadOverview(A,date){
  const T=todayMs(), M=mondayOf(T);
  const weeks=[...Array(WEEKS_HEAT)].map((_,i)=>M+i*7*DAY);
  const cls=p=>p<=0?'':p<=40?'h1':p<=75?'h2':p<=100?'h3':'hx';
  const head=`<tr><th></th>${weeks.map((w,i)=>`<th class="wk ${i===0?'now':''}">${i===0?'This wk':fmtMs(w).slice(0,5)}</th>`).join('')}</tr>`;
  const pRows=[...S.people].sort(byName).map(p=>{const cap=+p.horasSemana||0; return `<tr><th class="rl" title="${esc(p.nombre)}">${esc(p.nombre)}</th>${weeks.map(w=>{const h=personHours(IX,p.id,w), pc=cap?h/cap*100:0; return `<td class="${cls(pc)}" title="${Math.round(h)} h of ${cap} h">${pc?Math.round(pc)+'%':'·'}</td>`}).join('')}</tr>`}).join('');
  const bRows=[...S.equipment].sort(byName).map(b=>`<tr><th class="rl" title="${esc(eqName(b))} · capacity ${eqCap(b)}">${esc(eqName(b))}</th>${weeks.map(w=>{const pc=eqWeekPct(IX,b.id,w); return `<td class="${cls(pc)}" title="${Math.round(pc)}% of ${eqCap(b)} slot(s)">${pc?Math.round(pc)+'%':'·'}</td>`}).join('')}</tr>`).join('');
  const hours=S.people.reduce((a,p)=>a+personHours(IX,p.id,M),0), capH=S.people.reduce((a,p)=>a+(+p.horasSemana||0),0);
  const inUse=S.equipment.filter(b=>eqCount(IX,b.id,T)>0).length, over=IX.over.size;
  const overP=S.people.filter(p=>+p.horasSemana&&personHours(IX,p.id,M)>+p.horasSemana*1.001).length;
  return `<div class="view-h"><h2>Occupancy overview</h2><span class="muted">${date}</span></div>
  <section class="kpis">
    <button class="kpi" data-view="occupancy"><span class="eyebrow">Team load this week</span><b>${capH?Math.round(hours/capH*100):0}%</b><span class="muted">${fmtH(hours)} h of ${fmtH(capH)} h</span></button>
    <button class="kpi ${overP?'warn':''}" data-view="occupancy"><span class="eyebrow">Overloaded technicians</span><b>${overP}</b><span class="muted">this week</span></button>
    <button class="kpi" data-view="resources"><span class="eyebrow">Equipment in use today</span><b>${inUse}</b><span class="muted">of ${S.equipment.length}</span></button>
    <button class="kpi ${over?'crit':''}" data-view="planning"><span class="eyebrow">Over capacity</span><b>${over}</b><span class="muted">equipment double-booked</span></button>
  </section>
  <div class="grid2">
    ${alertsPanel(A)}
    <section class="panel"><div class="panel-h"><h2>Occupancy, next ${WEEKS_HEAT} weeks</h2></div>
      <p class="eyebrow" style="margin-bottom:4px">Team · assigned hours / weekly capacity</p>
      ${pRows?`<div class="scroll-x"><table class="heat">${head}${pRows}</table></div>`:'<p class="muted">No team members yet.</p>'}
      <p class="eyebrow" style="margin:14px 0 4px">Equipment · slot-days used / available (capacity × 7)</p>
      ${bRows?`<div class="scroll-x"><table class="heat">${head}${bRows}</table></div>`:'<p class="muted">No equipment yet.</p>'}
      <div class="legend"><span><i style="background:var(--h1)"></i>≤ 40%</span><span><i style="background:var(--h2)"></i>41–75%</span><span><i style="background:var(--h3)"></i>76–100%</span><span><i style="background:var(--crit)"></i>&gt; 100% overbooked</span></div>
    </section>
  </div>`;
}

function planText(t){
  const ei=IX.END.get(t.id)||endInfo(t);
  if(ei.kind==='none'){const x=effDur(t); return x?`not scheduled · est. ${durLabel(x)}`:'not scheduled';}
  return `${fmt(t.start)} → ${ei.kind==='auto'?'~':ei.kind==='open'?'?':''}${fmtMs(ei.end)}`;
}
function dueText(t){const due=t.agreedDue||t.requestedDue; return due?`${fmt(due)}${t.agreedDue?' (agreed)':''}${t.flexible&&!t.agreedDue?'<span class="flex">flex</span>':''}`:'—';}
function card(t,al){
  const b=eqById(t.equipmentId), p=personById(t.techId), cls=ST_CLS[t.status]||'cola', g=IX.tag.get(t.id);
  const uniq=[...new Map(al.map(x=>[x.short,x])).values()];
  return `<article class="card st-${cls} ${al.some(x=>x.sev==='crit')?'has-crit':''}" draggable="${!S.ro}" data-act="edit" data-id="${esc(t.id)}" tabindex="0">
    <div class="card-top"><span class="ref">${esc(baseRef(t))}</span>${prioTag(t.priority)}</div>
    ${g?`<div class="tagline">${esc(g)}</div>`:''}
    <h4>${esc(t.title||'(no description)')}</h4>
    <div class="chips">${projChip(t)}${t.requester?`<span class="by">by ${esc(t.requester)}</span>`:''}${smpTestChip(t)}</div>
    <dl class="meta"><div><dt>Equipment</dt><dd>${esc(b?eqName(b):(t.arasEquipment?t.arasEquipment+' (ARAS)':'—'))}</dd></div><div><dt>Technician</dt><dd>${esc(p?p.nombre:'—')}</dd></div>
    <div><dt>Plan</dt><dd>${esc(planText(t))}</dd></div><div><dt>Due</dt><dd>${dueText(t)}</dd></div></dl>
    ${['In progress','Endurance running','Report','On hold'].includes(t.status)?`<div class="prog" title="${+t.progress||0}%"><span style="width:${Math.min(100,+t.progress||0)}%"></span></div>`:''}
    ${uniq.length?`<ul class="card-al">${uniq.map(x=>`<li class="${x.sev}">${esc(x.short)}</li>`).join('')}</ul>`:''}
  </article>`;
}
const sortQueue=(a,b)=>(PRIO_RANK[a.priority]??2)-(PRIO_RANK[b.priority]??2)||(d(a.agreedDue||a.requestedDue)??9e15)-(d(b.agreedDue||b.requestedDue)??9e15)||String(a.plr).localeCompare(String(b.plr));
function vBoard(A){
  if(!S.tests.length) return noTests();
  const cols=ACTIVE.map(s=>{const list=S.tests.filter(t=>t.status===s&&matchQ(t)).sort(sortQueue);
    return `<section class="col st-${ST_CLS[s]}" data-drop="${s}"><div class="col-h"><h3>${s}</h3><span class="mono">${list.length}</span></div>${list.map(t=>card(t,A.per.get(t.id)||[])).join('')}</section>`}).join('');
  return `<div class="view-h"><h2>Test board</h2>${searchBox()}</div>
  <p class="muted" style="margin:0">${S.ro?'':'Drag a card to change its status, or open it to edit. Report = test finished, report being written.'}</p>
  <div class="board">${cols}</div>
  ${S.ro?'':`<div class="close-row"><div class="close-zone st-cerr" data-drop="Completed">Drop here to mark as <b>Completed</b> and move it to History</div><div class="close-zone st-canc" data-drop="Cancelled">Drop here to mark as <b>Cancelled</b> and move it to History</div></div>`}`;
}

function vQueue(){
  if(!S.tests.length) return noTests();
  const T=todayMs();
  const due=t=>{const dd=t.agreedDue||t.requestedDue, n=daysTo(dd); if(n==null) return '<span class="muted">—</span>'; const c=n<0?(t.flexible&&!t.agreedDue?'warn':'crit'):n<=10?'warn':''; return `<span class="due ${c}">${dueText(t)}<br><small>${n<0?`${-n} d overdue`:n===0?'today':`in ${n} d`}</small></span>`};
  const counts=Object.fromEntries(ACTIVE.map(s=>[s,S.tests.filter(t=>t.status===s).length]));
  const list=S.tests.filter(t=>S.qst.includes(t.status)&&matchQ(t));
  const G={tech:t=>personById(t.techId)?.nombre||null,id:t=>baseRef(t),project:t=>t.project||null,test:t=>t.title||null,requester:t=>t.requester||null,
    due:t=>d(t.agreedDue||t.requestedDue),dur:t=>durHours(effDur(t)),equipment:t=>t.equipmentId?eqName(eqById(t.equipmentId)):(t.arasEquipment||null),
    start:t=>d(t.start),end:t=>{const ei=IX.END.get(t.id); return ei&&ei.kind!=='open'&&ei.kind!=='none'?ei.end:null},status:t=>STATUSES.indexOf(t.status),priority:t=>PRIO_RANK[t.priority]??2};
  const fallback=(a,b)=>STATUSES.indexOf(b.status)-STATUSES.indexOf(a.status)||sortQueue(a,b);
  sortBy(list,'queue',G,fallback);
  const dateIn=(t,field,val,cls,extra='')=>`<input type="date" class="cell-date ${cls}" data-setdate="${esc(t.id)}" data-field="${field}" value="${esc(val||'')}" aria-label="${field==='start'?'Start date':'End date'} of ${esc(baseRef(t))}" ${extra}>`;
  const startCell=t=>{if(t.status==='Not approved') return '<span class="muted">—</span>';
    const fr=APP==='occupancy'&&!t.start&&t.equipmentId?freeFrom(IX,t.equipmentId,t.id):null, hint=fr==null?'':`<span class="sub">free ${fr===T?'today':fmtMs(fr)}</span>`;
    return S.ro?(t.start?fmt(t.start):'<span class="muted">—</span>')+hint:dateIn(t,'start',t.start,'')+hint};
  const endCell=t=>{if(t.status==='Not approved') return '<span class="muted">—</span>'; const ei=IX.END.get(t.id)||endInfo(t), manual=!!t.end;
    const val=manual?t.end:ei.kind==='auto'?iso(ei.end):'';
    const sub=manual?'manual':ei.kind==='auto'?'auto':t.start?'no duration':'';
    if(S.ro) return (val?(manual?'':'~')+fmt(val):'<span class="muted">—</span>');
    return dateIn(t,'end',val,manual?'':'auto',t.start?'title="Clear the date to compute it from start + duration"':'disabled title="Set a start date first"')+(sub?`<span class="sub" title="${manual?'Set by hand. Clear the date to go back to start + estimated duration.':'Start + estimated duration'}">${sub}</span>`:'')};
  const rows=list.map(t=>{const b=eqById(t.equipmentId), x=effDur(t);
    return `<tr class="click strow st-${ST_CLS[t.status]||'cola'}" data-act="edit" data-id="${esc(t.id)}"><td class="ref nowrap">${esc(baseRef(t))}${IX.tag.get(t.id)?`<small>${esc(IX.tag.get(t.id))}</small>`:''}</td><td>${techSel(t)}</td><td>${statusSel(t)}</td><td>${projCell(t)}</td><td><b>${esc(t.title||'')}</b>${t.comments?`<span class="snip" title="${esc(t.comments)}">${esc(t.comments.replace(/\s+/g,' '))}</span>`:''}</td><td class="nowrap">${startCell(t)}</td><td class="nowrap">${endCell(t)}</td><td class="nowrap">${x?`${durLabel(x)}<br><small class="muted">${esc(x.src)}</small>`:'<span class="muted">no estimate</span>'}</td><td class="nowrap">${due(t)}</td><td>${esc(t.requester||'—')}</td></tr>`}).join('');
  return `<div class="view-h"><h2>Test queue</h2>${searchBox()}</div>
  <div class="row" role="group" aria-label="Statuses shown"><span class="muted" style="font-size:13px">Show:</span>${ACTIVE.map(s=>`<button type="button" class="chipbtn st-${ST_CLS[s]}" data-act="qst" data-s="${s}" aria-pressed="${S.qst.includes(s)}">${s} · ${counts[s]}</button>`).join('')}</div>
  <section class="panel"><div class="panel-h"><h2>${list.length} test${list.length===1?'':'s'}</h2><span class="muted">Click a column header to sort. Technician, status, start and end dates can be changed directly in the table. Setting a start date on a queued test moves it to Planned.</span></div>
  ${list.length?`<div class="scroll-x"><table class="tbl compact"><thead>${sortHead('queue',[['id','PLR · QTP'],['tech','Technician'],['status','Status'],['project','Project'],['test','Test · comments'],['start','Start date'],['end','End date'],['dur','Est. duration'],['due','Due'],['requester','Requester']])}</thead><tbody>${rows}</tbody></table></div>`:'<div class="empty-ok">No tests with the selected statuses.</div>'}
  </section>`;
}
function lanes(items){const ends=[],out=[]; for(const it of [...items].sort((a,b)=>a.s-b.s)){let l=ends.findIndex(x=>x<it.s); if(l<0){l=ends.length; ends.push(it.e);} else ends[l]=it.e; out.push({...it,lane:l});} return {out,n:Math.max(1,ends.length)};}
function vPlanning(){
  if(!S.tests.length) return noTests();
  const T=todayMs(), W=S.dayW, dayMode=W>=26, start=mondayOf(T)-7*DAY, nW=dayMode?8:14, days=nW*7, end=start+(days-1)*DAY, labW=window.innerWidth<600?130:220;
  const item=t=>{const s=d(t.start), ei=IX.END.get(t.id); if(s==null||!ei||ei.end==null) return null; const e=Math.max(s,ei.end); if(e<start||s>end) return null; return {t,s,e,kind:ei.kind}};
  const bar=(x,light)=>{const a=Math.max(x.s,start), b=Math.min(x.e,end), left=(a-start)/DAY*W, w=((b-a)/DAY+1)*W-2, eq=eqById(x.t.equipmentId), p=personById(x.t.techId);
    return `<button class="bar st-${ST_CLS[x.t.status]} ${x.kind==='open'?'open':''} ${light?'light':''}" style="left:${left+1}px;width:${Math.max(w,6)}px;top:${x.lane*26+4}px" data-act="edit" data-id="${esc(x.t.id)}" title="${esc(`${ref(x.t)} · ${x.t.title||''}\n${fmtMs(x.s)} → ${x.kind==='open'?'end unknown':fmtMs(x.e)} · ${x.t.status}\n${eq?eqName(eq):'no equipment'} · ${p?p.nombre:'no technician'}`)}">${esc(baseRef(x.t))} · ${esc(x.t.title||'')}</button>`};
  let weekend=''; for(let t=start;t<=end;t+=DAY) if(!isWork(t)) weekend+=`<div class="weekend" style="left:${(t-start)/DAY*W}px;width:${W}px"></div>`;
  const todayL=`<div class="today" style="left:${(T-start)/DAY*W+W/2}px"></div>`;
  const row=(label,sub,items,conf,lightFn)=>{const L=lanes(items.filter(Boolean)), h=Math.max(46,L.n*26+8);
    return `<div class="g-lab ${conf?'conf':''}" style="height:${h}px"><b title="${esc(label)}">${esc(label)}</b><small>${sub}</small></div><div class="g-track" style="height:${h}px">${weekend}${todayL}${L.out.map(o=>bar(o,lightFn&&lightFn(o.t))).join('')}</div>`};
  const head=`<div class="g-lab" style="height:30px"><small>${dayMode?'Week':'Week of'}</small></div><div class="g-head">${[...Array(nW)].map((_,i)=>{const w=start+i*7*DAY; return `<div style="width:${7*W}px" class="${w===mondayOf(T)?'now':''}">${dayMode?`W${isoWeek(w)} · ${new Date(w).toLocaleDateString('en-GB',{month:'short',year:'numeric',timeZone:'UTC'})}`:fmtMs(w).slice(0,5)}</div>`}).join('')}</div>`
    +(dayMode?`<div class="g-lab" style="height:34px"><small>Day</small></div><div class="g-days">${[...Array(days)].map((_,i)=>{const t=start+i*DAY, dt=new Date(t); return `<div style="width:${W}px" class="${t===T?'now':''} ${isWork(t)?'':'we'} ${dt.getUTCDay()===1?'mon':''}"><small>${WD[dt.getUTCDay()]}</small>${dt.getUTCDate()}</div>`}).join('')}</div>`:'');
  /* "Hide idle equipment" leaves out equipment with no test bar inside the visible period. */
  const eqItems=[...S.equipment].sort(byName).map(b=>({b,items:S.tests.filter(t=>t.equipmentId===b.id&&EQ_STATES.has(t.status)).map(item).filter(Boolean)}));
  const shownEq=S.hideIdle?eqItems.filter(x=>x.items.length):eqItems, hiddenEq=eqItems.length-shownEq.length;
  const bRows=shownEq.map(({b,items})=>row(eqName(b),`<span class="bstate ${eqStateCls(eqStatus(b))}">${esc(eqStatus(b))}</span> · capacity ${eqCap(b)}`,items,IX.over.has(b.id))).join('');
  const pRows=[...S.people].sort(byName).map(p=>{const h=personHours(IX,p.id,mondayOf(T)), cap=+p.horasSemana||0; return row(p.nombre,`${esc(p.rol||'')}${APP==='occupancy'&&cap?` · this week ${Math.round(h)}/${cap} h`:''}`,S.tests.filter(t=>t.techId===p.id&&TECH_STATES.has(t.status)).map(item),false,t=>t.status==='Report')}).join('');
  const missing=S.tests.filter(t=>EQ_STATES.has(t.status)&&(!t.start)).length;
  return `<div class="view-h"><h2>Planning by resource</h2>
    <div class="zoom" role="group" aria-label="Zoom">${[[10,'Quarter'],[18,'Weeks'],[32,'Days']].map(([z,l])=>`<button data-act="zoom" data-z="${z}" aria-pressed="${S.dayW===z}">${l}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="hide-idle" ${S.hideIdle?'checked':''}> Hide equipment with no tests in this period</label></div>
  <p class="muted" style="margin:0">Equipment rows show one lane per test running in parallel; a red edge means more tests than the equipment's capacity. End dates marked ~ are start + estimated duration (Hours and Days run 24/7 unless the QTP says working hours). Faded bars have no known end.${missing?` <b>${missing} planned or running test(s) have no start date and are not shown.</b>`:''}</p>
  <div class="gantt" style="--wk:${7*W}px;--day:${W}px"><div class="g-grid ${dayMode?'days':''}" style="grid-template-columns:${labW}px ${days*W}px">
    ${head}
    <div class="g-sec"><span>Equipment${hiddenEq?` <small style="text-transform:none;font-weight:400">· ${hiddenEq} without tests hidden</small>`:''}</span></div>${bRows||`<div class="g-sec" style="text-transform:none;font-weight:400"><span>${eqItems.length?'No equipment has tests in this period':'No equipment yet'}</span></div>`}
    <div class="g-sec"><span>Team</span></div>${pRows||'<div class="g-sec" style="text-transform:none;font-weight:400"><span>No team members yet</span></div>'}
  </div></div>
  <div class="legend">${['Planned','In progress','Endurance running','On hold','Report'].map(s=>`<span><i style="background:var(--st-${ST_CLS[s]})"></i>${s}</span>`).join('')}<span><i style="background:var(--crit);width:2px"></i>Today</span></div>`;
}

function vHistory(){
  const all=S.tests.filter(t=>CLOSED.includes(t.status));
  if(!all.length) return `<div class="view-h"><h2>History</h2></div><div class="empty"><h3>No completed or cancelled tests yet</h3><p>Tests move here when their status becomes Completed or Cancelled, either in this app or through an ARAS import. They never raise alerts.</p></div>`;
  const H=S.hist, list=all.filter(t=>(!H.st||t.status===H.st)&&(!H.res||(H.res==='none'?!t.result:t.result===H.res))&&matchQ(t));
  const techOf=t=>personById(t.techId)?.nombre||t.arasTech||'';
  const G={tech:t=>techOf(t)||null,result:t=>t.result||null,id:t=>baseRef(t),project:t=>t.project||null,test:t=>t.title||null,requester:t=>t.requester||null,
    equipment:t=>t.equipmentId?eqName(eqById(t.equipmentId)):(t.arasEquipment||null),start:t=>d(t.start),closed:t=>d(t.closedAt),status:t=>t.status};
  sortBy(list,'hist',G,(a,b)=>String(b.closedAt||b.start||'').localeCompare(String(a.closedAt||a.start||''))||String(b.plr).localeCompare(String(a.plr)));
  const comp=all.filter(t=>t.status==='Completed'), pass=comp.filter(t=>t.result==='Pass').length, fail=comp.filter(t=>t.result==='Fail').length;
  const rows=list.map(t=>{const b=eqById(t.equipmentId), tn=techOf(t);
    return `<tr class="click" data-act="edit" data-id="${esc(t.id)}"><td class="tech-cell ${tn?'':'none'}">${esc(tn||'—')}</td><td>${resTag(t.result)||'<span class="muted">—</span>'}</td><td class="ref nowrap">${esc(baseRef(t))}${IX.tag.get(t.id)?`<small>${esc(IX.tag.get(t.id))}</small>`:''}</td><td style="min-width:200px"><span class="chip proj">${esc(projectNo(t))}</span> ${esc(projectName(t))}</td><td><b>${esc(t.title||'')}</b>${t.comments?`<span class="snip" title="${esc(t.comments)}">${esc(t.comments.replace(/\s+/g,' '))}</span>`:''}</td><td>${esc(t.requester||'—')}</td><td>${esc(b?eqName(b):t.arasEquipment||'—')}</td><td class="nowrap">${fmt(t.start)}</td><td class="nowrap">${fmt(t.closedAt)}</td><td>${estPill(t.status)}</td></tr>`}).join('');
  return `<div class="view-h"><h2>History</h2>${searchBox()}
    <select class="fsel" id="hist-st" aria-label="Status"><option value="">All statuses</option>${CLOSED.map(s=>`<option ${H.st===s?'selected':''}>${s}</option>`).join('')}</select>
    <select class="fsel" id="hist-res" aria-label="Result"><option value="">All results</option>${RESULTS.map(r=>`<option ${H.res===r?'selected':''}>${r}</option>`).join('')}<option value="none" ${H.res==='none'?'selected':''}>No result</option></select></div>
  <p class="muted" style="margin:0">${comp.length} completed · ${all.length-comp.length} cancelled${pass+fail?` · first-time pass rate ${Math.round(pass/(pass+fail)*100)}% (${pass} pass, ${fail} fail)`:''}. Closed tests do not raise alerts. Click a column header to sort; open a test and change its status to bring it back to the board.</p>
  <section class="panel">${list.length?`<div class="scroll-x"><table class="tbl compact"><thead>${sortHead('hist',[['tech','Technician'],['result','Result'],['id','PLR · QTP'],['project','Project'],['test','Test · comments'],['requester','Requester'],['equipment','Equipment'],['start','Start'],['closed','Closed'],['status','Status']])}</thead><tbody>${rows}</tbody></table></div>`:'<div class="empty-ok">No tests match these filters.</div>'}</section>`;
}

/* ---------- Occupancy (daily) ---------- */
function personDay(ix,pid,day){
  const items=[]; let h=0;
  if(!isWork(day)) return {h,items};
  for(const t of ix.list){
    if(t.techId!==pid||!TECH_STATES.has(t.status)) continue;
    const pl=ix.TP.get(t.id); if(!pl) continue;
    const x=pl.m.get(day)||0, s=d(t.start), e=ix.END.get(t.id)?.end, unknown=!planTotal(pl);
    if(x>0||(unknown&&day>=s&&day<=e)){h+=x; items.push({t,h:x,unknown,tags:[...(pl.tags.get(day)||[])]});}
  }
  return {h,items};
}
const eqDay=(ix,eid,day)=>(ix.byEq.get(eid)||[]).filter(x=>x.s<=day&&day<=x.e).map(x=>x.t);
const lvl=p=>p<=0?'':p<=40?'h1':p<=75?'h2':p<=100?'h3':'hx';
const fmtH=h=>h>=10?String(Math.round(h)):(Math.round(h*10)/10).toString();
function vOccupancy(){
  if(!S.tests.length) return noTests();
  const T=todayMs(), O=S.occ; if(O.start==null) O.start=mondayOf(T);
  const n=O.weeks*7, days=[...Array(n)].map((_,i)=>O.start+i*DAY), end=days[n-1];
  const sel=O.sel, isSel=(type,id,day)=>sel&&sel.type===type&&sel.id===id&&sel.day===day;
  const head1=`<tr><th class="rh" rowspan="2"><small>${fmtMs(O.start)} – ${fmtMs(end)}</small></th>${[...Array(O.weeks)].map((_,w)=>{const m=O.start+w*7*DAY; return `<th class="wkh" colspan="7">W${isoWeek(m)} · ${new Date(m).toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'})}</th>`}).join('')}<th class="tot" rowspan="2">Period</th></tr>`;
  const head2=`<tr>${days.map(t=>{const dt=new Date(t); return `<th class="dh ${t===T?'now':''} ${isWork(t)?'':'we'} ${dt.getUTCDay()===1?'wkst':''}"><small>${WD[dt.getUTCDay()]}</small>${dt.getUTCDate()}</th>`}).join('')}</tr>`;
  const queuedFor=pid=>S.tests.filter(t=>t.techId===pid&&t.status==='Queued');
  const pRows=[...S.people].sort(byName).map(p=>{
    const daily=(+p.horasSemana||0)/5; let tot=0,cap=0;
    const cells=days.map(t=>{const r=personDay(IX,p.id,t); tot+=r.h; if(isWork(t)) cap+=daily; const pc=daily?r.h/daily*100:0;
      const unk=r.items.length&&!r.h; const txt=r.h?fmtH(r.h):unk?'?':'';
      const tip=r.items.length?`${WD[new Date(t).getUTCDay()]} ${fmtMs(t)}: ${fmtH(r.h)} h of ${fmtH(daily)} h\n`+r.items.map(x=>`${baseRef(x.t)} · ${x.t.title||''} (${x.h?fmtH(x.h)+' h'+(x.tags.length&&!x.tags.includes('work')?' '+x.tags.join('+'):''):'hours not set'})`).join('\n'):`${fmtMs(t)}: free`;
      return `<td class="${isWork(t)?'':'we'} ${new Date(t).getUTCDay()===1?'wkst':''}"><button type="button" class="cell ${unk?'unk':lvl(pc)} ${isSel('p',p.id,t)?'sel':''}" data-act="occ-cell" data-type="p" data-id="${esc(p.id)}" data-day="${t}" title="${esc(tip)}">${txt}</button></td>`}).join('');
    const q=queuedFor(p.id), qh=q.reduce((a,t)=>a+effTech(t),0);
    return `<tr><th class="rh"><b title="${esc(p.nombre)}">${esc(p.nombre)}</b><small>${+p.horasSemana||0} h/week${q.length?` · ${q.length} queued${qh?` (${fmtH(qh)} h)`:''}`:''}</small></th>${cells}<td class="tot"><b>${fmtH(tot)} h</b> / ${fmtH(cap)} h<br><span class="due ${cap&&tot>cap?'crit':''}">${cap?Math.round(tot/cap*100):0}%</span></td></tr>`}).join('');
  const bRows=[...S.equipment].sort(byName).map(b=>{
    const cap=eqCap(b); let used=0;
    const cells=days.map(t=>{const on=eqDay(IX,b.id,t); used+=on.length; const pc=on.length/cap*100;
      const tip=on.length?`${WD[new Date(t).getUTCDay()]} ${fmtMs(t)}: ${on.length} of ${cap} slot(s)\n`+on.map(x=>`${baseRef(x)} · ${x.title||''}`).join('\n'):`${fmtMs(t)}: free`;
      return `<td class="${isWork(t)?'':'we'} ${new Date(t).getUTCDay()===1?'wkst':''}"><button type="button" class="cell ${lvl(pc)} ${isSel('e',b.id,t)?'sel':''}" data-act="occ-cell" data-type="e" data-id="${esc(b.id)}" data-day="${t}" title="${esc(tip)}">${on.length?(cap>1?`${on.length}/${cap}`:'●'):''}</button></td>`}).join('');
    return `<tr><th class="rh"><b title="${esc(eqName(b))}">${esc(eqName(b))}</b><small><span class="bstate ${eqStateCls(eqStatus(b))}">${esc(eqStatus(b))}</span> · capacity ${cap}</small></th>${cells}<td class="tot"><b>${Math.round(used/(n*cap)*100)}%</b><br><span class="muted">${used} slot-days</span></td></tr>`}).join('');
  const span=n+2;
  let detail='<p class="muted" style="margin:0">Click a day to see which tests occupy that technician or piece of equipment.</p>';
  if(sel){
    if(sel.type==='p'){const p=personById(sel.id); if(p){const r=personDay(IX,p.id,sel.day), daily=(+p.horasSemana||0)/5;
      detail=`<div class="panel-h" style="margin:0"><h2>${esc(p.nombre)} · ${WD[new Date(sel.day).getUTCDay()]} ${fmtMs(sel.day)}</h2><span class="muted">${fmtH(r.h)} h of ${fmtH(daily)} h available${isWork(sel.day)?'':' · weekend'}</span></div>`+
      (r.items.length?`<div class="occ-detail">${r.items.map(x=>{const b=eqById(x.t.equipmentId); return `<button type="button" data-act="edit" data-id="${esc(x.t.id)}"><span class="ref">${esc(ref(x.t))}</span><b>${esc(x.t.title||'')}</b>${estPill(x.t.status)}<span class="muted">${b?esc(eqName(b)):'no equipment'}</span><span class="sp"></span><span>${x.h?fmtH(x.h)+' h this day'+(x.tags.length&&!x.tags.includes('work')?` · ${esc(x.tags.join(' + '))}`:''):'<span class="due warn">technician hours not set</span>'}</span></button>`}).join('')}</div>`:'<div class="empty-ok">No tests assigned this day.</div>');}}
    else {const b=eqById(sel.id); if(b){const on=eqDay(IX,b.id,sel.day);
      detail=`<div class="panel-h" style="margin:0"><h2>${esc(eqName(b))} · ${WD[new Date(sel.day).getUTCDay()]} ${fmtMs(sel.day)}</h2><span class="muted">${on.length} of ${eqCap(b)} slot(s) in use</span></div>`+
      (on.length?`<div class="occ-detail">${on.map(t=>{const p=personById(t.techId), ei=IX.END.get(t.id)||{}; return `<button type="button" data-act="edit" data-id="${esc(t.id)}"><span class="ref">${esc(ref(t))}</span><b>${esc(t.title||'')}</b>${estPill(t.status)}<span class="muted">${esc(p?p.nombre:'no technician')}</span><span class="sp"></span><span class="mono">${fmt(t.start)} → ${ei.kind==='open'?'end unknown':(ei.kind==='auto'?'~':'')+fmtMs(ei.end)}</span></button>`}).join('')}</div>`:'<div class="empty-ok">Free this day.</div>');}}
  }
  return `<div class="view-h"><h2>Occupancy</h2>
    <div class="occ-ctl"><button class="btn sm" data-act="occ-nav" data-d="-1" aria-label="Previous week">◀</button><button class="btn sm" data-act="occ-nav" data-d="0">This week</button><button class="btn sm" data-act="occ-nav" data-d="1" aria-label="Next week">▶</button>
    <div class="zoom" role="group" aria-label="Period">${[2,4,6,8].map(w=>`<button data-act="occ-weeks" data-w="${w}" aria-pressed="${O.weeks===w}">${w} wk</button>`).join('')}</div></div></div>
  <p class="muted" style="margin:0;max-width:110ch">Technicians: hours per day, from each test's technician hours spread over its working days, against the weekly hours ÷ 5. <b>?</b> = assigned to a test without technician hours. Equipment: tests running that day against its capacity (● = in use when capacity is 1). Only planned, running, on-hold and report tests with a start date count.</p>
  <div class="occ-wrap"><table class="occ"><thead>${head1}${head2}</thead><tbody>
    <tr class="sec"><th colspan="${span}"><span>Technicians</span></th></tr>${pRows||`<tr><td colspan="${span}" class="muted" style="padding:10px">No team members yet.</td></tr>`}
    <tr class="sec"><th colspan="${span}"><span>Equipment</span></th></tr>${bRows||`<tr><td colspan="${span}" class="muted" style="padding:10px">No equipment yet.</td></tr>`}
  </tbody></table></div>
  <div class="legend"><span><i style="background:var(--h1)"></i>≤ 40%</span><span><i style="background:var(--h2)"></i>41–75%</span><span><i style="background:var(--h3)"></i>76–100%</span><span><i style="background:var(--crit)"></i>&gt; 100% overbooked</span><span><i style="background:var(--surface-2)"></i>weekend</span></div>
  <section class="panel">${detail}</section>`;
}
/* Equipment & team. The load columns (in use, free from, hours and load per week) only show in the occupancy app. */
function vResources(){
  const T=todayMs(), M=mondayOf(T), load=APP==='occupancy', opt=(on,html)=>on?html:'';
  const bRows=[...S.equipment].sort(byName).map(b=>{const cap=eqCap(b), now=eqCount(IX,b.id,T), fr=freeFrom(IX,b.id), c=b.proximaCalibracion?daysTo(b.proximaCalibracion):null;
    return `<tr class="click" data-act="edit-b" data-id="${esc(b.id)}"><td><b>${esc(eqName(b))}</b><br><small class="muted">${esc(b.descripcion||'')}${b.nombreAras&&norm(b.nombreAras)!==norm(b.nombre)?` · ARAS: ${esc(b.nombreAras)}`:''}</small></td><td><span class="bstate ${eqStateCls(eqStatus(b))}">${esc(eqStatus(b))}</span></td><td class="num">${cap}</td>${opt(load,`<td class="num"><span class="due ${now>cap?'crit':''}">${now} / ${cap}</span></td><td class="nowrap">${fr==null?'—':fr===T?'today':fmtMs(fr)}</td>`)}<td><div class="chips">${(b.instrumentos||[]).map(fleChip).join('')||'<span class="muted">—</span>'}</div></td><td class="nowrap"><span class="due ${c!=null&&c<0?'crit':c!=null&&c<=30?'warn':''}">${fmt(b.proximaCalibracion)}</span></td></tr>`}).join('');
  const pRows=[...S.people].sort(byName).map(p=>{const cap=+p.horasSemana||0, h=personHours(IX,p.id,M), n=S.tests.filter(t=>t.techId===p.id&&TECH_STATES.has(t.status)).length, pc=cap?Math.round(h/cap*100):0;
    return `<tr class="click" data-act="edit-p" data-id="${esc(p.id)}"><td><b>${esc(p.nombre)}</b><br><small class="muted">${esc(p.rol||'')}</small></td>${opt(load,`<td class="num">${cap||'—'} h</td><td class="num"><span class="due ${pc>100?'crit':pc>85?'warn':''}">${pc}%</span></td>`)}<td class="num">${n}</td><td><div class="chips">${(p.habilitaciones||[]).map(eqById).filter(Boolean).map(b=>`<span class="chip">${esc(eqName(b))}</span>`).join('')||'<span class="muted">not set</span>'}</div></td></tr>`}).join('');
  return `<div class="view-h"><h2>Equipment & team</h2></div>
  <section class="panel"><div class="panel-h"><h2>Equipment</h2><span class="muted">Capacity = number of tests the equipment can run at the same time</span>${S.ro||S.noDb?'':'<button class="btn sm" data-act="new-b">+ Add equipment</button>'}</div>
    ${bRows?`<div class="scroll-x"><table class="tbl"><thead><tr><th>Equipment</th><th>Status</th><th class="num">Capacity</th>${opt(load,'<th class="num">In use today</th><th>Slot free from</th>')}<th>Instruments (FLE)</th><th>Next calibration</th></tr></thead><tbody>${bRows}</tbody></table></div>`:'<div class="empty-ok">No equipment yet. Add it here, or let the ARAS import create it from the Equipment column.</div>'}
  </section>
  <section class="panel"><div class="panel-h"><h2>Team</h2>${S.ro||S.noDb?'':'<button class="btn sm" data-act="new-p">+ Add person</button>'}</div>
    ${pRows?`<div class="scroll-x"><table class="tbl"><thead><tr><th>Person</th>${opt(load,'<th class="num">Hours/week</th><th class="num">Load this week</th>')}<th class="num">Active tests</th><th>Qualified on</th></tr></thead><tbody>${pRows}</tbody></table></div>`:'<div class="empty-ok">No team members yet. The ARAS import creates them from the Lab Resource column.</div>'}
  </section>`;
}

function vLibrary(){
  const list=[...S.qtps].sort((a,b)=>String(a.code||a.id).localeCompare(String(b.code||b.id)));
  const use=new Map(); for(const t of S.tests) if(counts(t)&&t.qtp){const k=qid(t.qtp); use.set(k,(use.get(k)||0)+1);}
  const noDur=list.filter(q=>!(+q.durVal>0)).length;
  const rows=list.map(q=>{const b=eqById(q.equipmentId);
    return `<tr class="click ${+q.durVal>0?'':'miss'}" data-act="edit-q" data-id="${esc(q.id)}"><td class="ref nowrap">${esc(q.code||q.id)}</td><td><b>${esc(q.name||'')}</b>${q.testType||q.standard?`<span class="snip">${esc([q.testType,q.standard].filter(Boolean).join(' · '))}</span>`:''}${q.notes?`<span class="snip">${esc(q.notes)}</span>`:''}</td><td>${esc(b?eqName(b):'—')}</td><td><div class="chips">${(q.instrumentos||[]).map(fleChip).join('')||'<span class="muted">—</span>'}</div></td><td class="nowrap">${+q.durVal>0?`${esc(q.durVal)} ${esc(UNIT_SHORT[q.durUnit]||q.durUnit||'h')}${q.durBasis==='sample'?' <small class="muted">per sample</small>':''}${q.durUnit==='Cycles'&&q.cyclesPerDay?` <small class="muted">(${esc(q.cyclesPerDay)}/day)</small>`:''}`:'<span class="due warn">not set</span>'}</td><td>${q.continuous===false?'Working hours':'24/7'}</td><td>${esc(loadSummary(q))}</td><td class="num">${use.get(q.id)||0}</td></tr>`}).join('');
  const I=S.qimp;
  return `<div class="view-h"><h2>QTP library</h2>${S.ro||S.noDb?'':'<button class="btn" data-act="new-q">+ Add QTP</button>'}</div>
  <p class="muted" style="margin:0;max-width:90ch">Estimated duration and technician hours for each test procedure, per test or per sample. They are planning defaults only: every test line uses them unless you set its own duration or hours in the test. A library duration takes precedence over the duration that comes from ARAS, which is only used when the QTP has none; a per-sample library duration is always multiplied by the test's number of pieces.</p>
  ${S.ro||S.noDb?'':`<section class="panel"><div class="panel-h"><h2>Import QTP list from Excel</h2><span class="muted">Columns such as QTP, test name, estimated duration, unit, technician hours, equipment</span></div>
    <label class="drop-zone" data-dz="qtp"><input type="file" id="file-qtp" accept=".xlsx,.xls,.csv"><b>Drop the QTP list here</b><span class="muted">or click to choose a file</span></label>
    ${I?qtpImportPanel(I):''}</section>`}
  <section class="panel"><div class="panel-h"><h2>Procedures</h2><span class="muted">${list.length} QTPs${noDur?` · <b class="due warn">${noDur} without estimated duration</b>`:''}</span></div>
    ${list.length?`<div class="scroll-x"><table class="tbl"><thead><tr><th>QTP</th><th>Test name</th><th>Default equipment</th><th>Instruments (FLE)</th><th>Est. duration</th><th>Runs</th><th>Technician load</th><th class="num">Active tests</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<div class="empty-ok">The library is empty. Import your QTP list above; the ARAS import also adds every QTP it finds.</div>'}
  </section>`;
}

/* ---------- Spreadsheet reading ---------- */
/* ARAS writes cell references as "col:row" (e.g. "2:1") instead of "B1"; rebuild them so SheetJS can read the sheet. */
function fixSheet(ws){
  const bad=Object.keys(ws).some(k=>/^\d+:\d+$/.test(k)); if(!bad) return ws;
  const out={}; let mr=0,mc=0;
  for(const k of Object.keys(ws)){
    if(k[0]==='!'){ if(k!=='!ref') out[k]=ws[k]; continue; }
    const m=k.match(/^(\d+):(\d+)$/); if(!m) continue;
    const c=+m[1]-1, r=+m[2]-1; out[XLSX.utils.encode_cell({c,r})]=ws[k]; if(r>mr) mr=r; if(c>mc) mc=c;
  }
  out['!ref']=XLSX.utils.encode_range({s:{c:0,r:0},e:{c:mc,r:mr}}); return out;
}
async function readSheet(f){
  if(!window.XLSX) throw new Error('the Excel reader did not load. Reload the page.');
  const buf=await f.arrayBuffer(), isCsv=/\.csv$/i.test(f.name);
  const wb=XLSX.read(buf,{type:'array',raw:isCsv});
  const ws=fixSheet(wb.Sheets[wb.SheetNames[0]]);
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
  const hi=aoa.findIndex(r=>r.filter(c=>String(c).trim()!=='').length>=2);
  if(hi<0) throw new Error('no header row found.');
  const headers=aoa[hi].map((h,i)=>String(h).trim()||`Column ${i+1}`);
  const rows=aoa.slice(hi+1).filter(r=>r.some(c=>String(c).trim()!==''));
  return {fileName:f.name,headers,rows};
}
function guessMap(headers,fields,saved){
  const nh=headers.map(norm), used=new Set(), map={};
  for(const f of fields){ if(saved&&saved[f.k]&&headers.includes(saved[f.k])){map[f.k]=saved[f.k]; used.add(headers.indexOf(saved[f.k]));} }
  for(const f of fields){ if(map[f.k]) continue; const i=nh.findIndex((h,i)=>!used.has(i)&&f.syn.includes(h)); if(i>=0){used.add(i); map[f.k]=headers[i];} }
  for(const f of fields){ if(map[f.k]) continue; const i=nh.findIndex((h,i)=>!used.has(i)&&f.syn.some(s=>s.length>=6&&h.includes(s))); if(i>=0){used.add(i); map[f.k]=headers[i];} }
  return map;
}
function toISO(v){
  if(v==null||v==='') return '';
  if(typeof v==='number'&&v>20000&&v<80000) return iso((Math.floor(v)-25569)*DAY);
  if(v instanceof Date&&!isNaN(v)) return iso(Date.UTC(v.getFullYear(),v.getMonth(),v.getDate()));
  const s=String(v).trim(); let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if(m) return iso(Date.UTC(+m[1],m[2]-1,+m[3]));
  m=s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/); if(m){let y=+m[3]; if(y<100) y+=2000; return iso(Date.UTC(y,m[2]-1,+m[1]));}
  const t=Date.parse(s); if(!isNaN(t)){const x=new Date(t); return iso(Date.UTC(x.getFullYear(),x.getMonth(),x.getDate()));}
  return '';
}
/* Repairs UTF-8 text that was decoded as Windows-1252 (e.g. 2.5â€ → 2.5”). */
const CP1252={0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};
function fixText(s){
  s=String(s??'').replace(/\r\n?/g,'\n');
  if(!/[Â-ô][\u0080-¿Œ-™]/.test(s)) return s;
  try{const bytes=[]; for(const ch of s){const c=ch.codePointAt(0); if(c<256) bytes.push(c); else if(CP1252[c]!=null) bytes.push(CP1252[c]); else return s;}
    return new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(bytes));}catch(e){return s;}
}
function normUnit(u){const s=norm(u); if(!s) return ''; if(/^(h|hr|hrs|hour|hours|horas?)$/.test(s)) return 'Hours'; if(/^(d|day|days|dias?)$/.test(s)) return 'Days'; if(/^(w|wk|wks|week|weeks|semanas?)$/.test(s)) return 'Weeks'; if(/cycl|cicl/.test(s)) return 'Cycles'; return '';}
function cellVal(f,v){
  if(f.type==='date') return toISO(v);
  if(f.type==='num'){ if(v===''||v==null) return ''; const n=typeof v==='number'?v:parseFloat(String(v).replace(',','.')); return isNaN(n)?'':n; }
  if(f.type==='bool'){ const s=norm(v); return s==='true'||s==='yes'||s==='1'||s==='si'||s==='y'; }
  return fixText(v).trim();
}
function readRecs(I,fields){const ix=k=>I.map[k]?I.headers.indexOf(I.map[k]):-1; return I.rows.map(r=>{const rec={}; for(const f of fields){const i=ix(f.k); rec[f.k]=cellVal(f,i<0?'':r[i]);} return rec;});}
function mappingGrid(I,fields,kind){
  return `<div class="map-grid">${fields.map(f=>`<div class="field ${f.req?'req':''}"><label for="map-${kind}-${f.k}">${f.label}</label><select id="map-${kind}-${f.k}" data-map="${f.k}" data-kind="${kind}"><option value="">— not imported —</option>${I.headers.map(h=>`<option ${I.map[f.k]===h?'selected':''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div>`;
}

/* ---------- ARAS import ---------- */
function eqMatchByName(name){
  const n=norm(name); if(!n) return null;
  /* The ARAS name may list several aliases separated by ";". */
  return S.equipment.find(b=>String(b.nombreAras||'').split(';').some(x=>norm(x)===n))||S.equipment.find(b=>norm(b.nombre)===n)||null;
}
function eqSuggest(name){
  const stop=new Set(['test','tests','the','of','and','bench','stand','testbench']); const tok=s=>new Set(norm(s).split(' ').filter(w=>w&&!stop.has(w)));
  const a=tok(name); let best=null,score=0;
  for(const b of S.equipment){const t=tok(b.nombre); const inter=[...a].filter(x=>t.has(x)).length, uni=new Set([...a,...t]).size; const j=uni?inter/uni:0; if(j>score){score=j; best=b;}}
  return score>=0.5?best:null;
}
function personMatch(name){const n=norm(name); return n?S.people.find(p=>norm(p.nombre)===n)||null:null;}
const mapStatus=s=>ARAS_STATUS[norm(s)]||'';
/* Lab statuses that refine an ARAS status do not count as a difference (ARAS has no Planned, On hold or Report). */
const ARAS_SAME={'Queued':['Queued','Planned'],'In progress':['In progress','Endurance running','On hold','Report'],'Endurance running':['Endurance running','On hold','Report']};
function arasPreview(){
  const I=S.imp, recs=readRecs(I,ARAS_FIELDS), T=todayMs();
  const eqMap=I.eqMap||(I.eqMap={});
  const unknownEq=new Map(), newPeople=new Map(), newQtps=new Map();
  for(const r of recs){
    if(r.equipmentName&&!eqMatchByName(r.equipmentName)){const n=norm(r.equipmentName); if(!unknownEq.has(n)) unknownEq.set(n,{name:r.equipmentName,count:0}); unknownEq.get(n).count++;}
    if(r.techName&&!personMatch(r.techName)) newPeople.set(norm(r.techName),r.techName);
    if(r.qtp&&!S.qtps.some(q=>q.id===qid(r.qtp))){const k=qid(r.qtp); if(!newQtps.has(k)) newQtps.set(k,{code:r.qtp.trim(),names:{}}); const o=newQtps.get(k); if(r.title) o.names[r.title]=(o.names[r.title]||0)+1;}
  }
  const savedEq=(S.cfg.importAras&&S.cfg.importAras.eqMap)||{};
  for(const [n,o] of unknownEq){ if(!(n in eqMap)){ const sv=savedEq[n]; if(sv&&(sv==='__new'||sv==='__none'||eqById(sv))) eqMap[n]=sv; else {const sg=eqSuggest(o.name); eqMap[n]=sg?sg.id:'__new';} } }
  const resolveEq=name=>{if(!name) return ''; const b=eqMatchByName(name); if(b) return b.id; const v=eqMap[norm(name)]; return v==='__none'?'':v==='__new'?'new:'+norm(name):v||'';};
  const resolveP=name=>{if(!name) return ''; const p=personMatch(name); return p?p.id:'newp:'+norm(name);};
  /* Match file rows to existing ARAS tests by PLR+QTP; when a pair repeats, score by equipment, sequence, comments and technician. */
  const existing=new Map(); for(const t of S.tests) if(t.source==='ARAS'){const k=keyOf(t); if(!existing.has(k)) existing.set(k,[]); existing.get(k).push(t);}
  const groups=new Map(); recs.forEach((r,i)=>{r._i=i; if(!r.plr||!r.qtp){r._st='error'; return;} const k=keyOf(r); if(!groups.has(k)) groups.set(k,[]); groups.get(k).push(r);});
  for(const [k,rows] of groups){
    const cands=[...(existing.get(k)||[])];
    if(!cands.length) continue;
    if(rows.length===1&&cands.length===1){rows[0]._match=cands[0]; continue;}
    const pairs=[];
    for(const r of rows) for(const c of cands){let s=0; if(norm(r.equipmentName)===norm(c.arasEquipment)) s+=4; if(String(r.sequence)===String(c.sequence??'')) s+=2; if(norm(r.comments).slice(0,160)===norm(c.comments).slice(0,160)) s+=3; if(norm(r.techName)===norm(c.arasTech)) s+=1; if(norm(r.title)===norm(c.title)) s+=1; pairs.push({r,c,s});}
    pairs.sort((a,b)=>b.s-a.s); const ur=new Set(), uc=new Set();
    for(const p of pairs){ if(ur.has(p.r)||uc.has(p.c)||p.s<4) continue; ur.add(p.r); uc.add(p.c); p.r._match=p.c; }
  }
  const OWN=['title','project','requester','comments','pieces','requestedDue','flexible','sequence','category','requestNote','result'];
  for(const r of recs){
    if(r._st==='error') continue;
    const st=mapStatus(r.status);
    r._eq=resolveEq(r.equipmentName); r._tech=resolveP(r.techName); r._status=st||'Queued';
    const t=r._match;
    if(!t){ if(CLOSED.includes(r._status)&&!S.incClosed){r._st='skip'; continue;} r._st=CLOSED.includes(r._status)?'hist':'new'; continue; }
    const patch={}, changes=[];
    for(const k of OWN){ const nv=r[k], ov=t[k]??(k==='flexible'?false:''); if(String(nv)!==String(ov)){patch[k]=nv; changes.push(k);} }
    if(String(r.status)!==String(t.arasStatus||'')) patch.arasStatus=r.status;
    if(String(r.durVal)!==String(t.arasDurVal??'')||normUnit(r.durUnit)!==normUnit(t.arasDurUnit)){patch.arasDurVal=r.durVal; patch.arasDurUnit=normUnit(r.durUnit); if(r.durVal!==''||t.arasDurVal) changes.push('duration');}
    if(r.equipmentName!==(t.arasEquipment||'')) patch.arasEquipment=r.equipmentName;
    if(r.techName!==(t.arasTech||'')) patch.arasTech=r.techName;
    if(!t.equipmentId&&r._eq){patch.equipmentId=r._eq; changes.push('equipment');}
    if(!t.techId&&r._tech){patch.techId=r._tech; changes.push('technician');}
    if(!t.start&&r.start){patch.start=r.start; changes.push('start');}
    /* The import asks before applying a different status. A choice to keep the app status holds until ARAS changes again. */
    if(st&&!(ARAS_SAME[st]||[st]).includes(t.status)&&t.arasStatusKept!==r.status) r._conflict={id:t.id,from:t.status,to:st,aras:r.status};
    if(t.arasStatusKept&&t.arasStatusKept!==r.status) patch.arasStatusKept='';
    r._patch=patch; r._changes=changes; r._st=Object.keys(patch).length?'update':'same';
    if(r._st==='update'&&!changes.length) r._quiet=true;
  }
  return {recs,unknownEq,newPeople,newQtps,eqMap};
}
function statusPanel(P){
  const I=S.imp, ch=I.choice||(I.choice={}), list=P.recs.filter(r=>r._conflict);
  if(!list.length) return I.done?'<section class="panel"><div class="panel-h"><h2>Status differences</h2></div><div class="empty-ok">Every imported test has the same status in the app and in ARAS.</div></section>':'';
  const n=list.filter(r=>ch[r._conflict.id]).length;
  return `<section class="panel"><div class="panel-h"><h2>Status differences · ${list.length}</h2><span class="muted">These tests already exist and ARAS shows a different status. Choose which one to keep.</span>
    <span class="sp"></span><button class="btn sm ghost" data-act="sc-all" data-v="app">Keep all app</button><button class="btn sm ghost" data-act="sc-all" data-v="aras">Use all ARAS</button></div>
    <div class="scroll-x"><table class="tbl"><thead><tr><th>PLR · QTP</th><th>Test</th><th>Keep app status</th><th>Use ARAS status</th></tr></thead><tbody>
    ${list.map(r=>{const c=r._conflict, v=ch[c.id]; return `<tr><td class="ref nowrap">${esc(r.plr+' · '+r.qtp)}${r.equipmentName?`<br><small class="muted">${esc(r.equipmentName)}</small>`:''}</td><td>${esc(r.title||'')}</td>
      <td><label class="check"><input type="radio" name="sc-${esc(c.id)}" data-sc="${esc(c.id)}" value="app" ${v==='app'?'checked':''} ${dis()}><span class="pill est st-${ST_CLS[c.from]||''}">${esc(c.from)}</span></label></td>
      <td><label class="check"><input type="radio" name="sc-${esc(c.id)}" data-sc="${esc(c.id)}" value="aras" ${v==='aras'?'checked':''} ${dis()}><span class="pill est st-${ST_CLS[c.to]||''}">${esc(c.to)}</span>${c.aras!==c.to?` <small class="muted">(${esc(c.aras)})</small>`:''}</label></td></tr>`}).join('')}
    </tbody></table></div>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-act="sc-apply" ${n&&!S.ro?'':'disabled'}>Apply ${n} of ${list.length} choice${list.length===1?'':'s'}</button></div>
    <p class="note" style="margin-top:10px">Tests left without a choice keep their app status and are asked again on the next import. When you keep the app status, it is not asked again until ARAS shows another status. Planned counts as In Queue, and Endurance running, On hold and Report count as In Progress.</p></section>`;
}
async function applyStatusChoices(){
  const I=S.imp; if(!I||!I.P||!db) return; const ch=I.choice||{}, now=nowIso(), T=iso(todayMs()), jobs=[]; let nA=0,nK=0;
  for(const r of I.P.recs){const c=r._conflict, v=c&&ch[c.id]; if(!v) continue; const t=S.tests.find(x=>x.id===c.id); if(!t) continue;
    if(v==='app'){jobs.push(db.doc(`${COL.tests}/${t.id}`).update({arasStatusKept:c.aras,updated:now})); nK++; continue;}
    const patch={status:c.to,arasStatusKept:'',updated:now};
    if(CLOSED.includes(c.to)){ if(!t.closedAt) patch.closedAt=T; } else patch.closedAt='';
    if(c.to==='Completed') patch.progress=100;
    if(RUNNING.has(c.to)&&!t.start) patch.start=T;
    jobs.push(db.doc(`${COL.tests}/${t.id}`).update(patch)); nA++;}
  I.choice={};
  try{await Promise.all(jobs); toast(`Status: ${nA} changed to the ARAS status, ${nK} kept.`);}catch(e){toast(errMsg(e));}
  render();
}
function importPanelAras(){
  const I=S.imp, P=arasPreview(); I.P=P;
  if(I.done) return `<section class="panel"><div class="panel-h"><h2>Imported</h2><span class="muted">${esc(I.fileName)}</span><span class="sp"></span><button class="btn sm ghost" data-act="cancel-import">Close</button></div>
    <div class="imp-sum"><span class="tag-st new">${I.done.nNew} new</span><span class="tag-st update">${I.done.nUpd} updated</span></div>
    ${(n=>n&&!S.ro?`<div class="row" style="margin-top:8px"><span>📦 ${esc(tx('impProp',n))}</span>${APP==='samples'?`<button class="btn sm primary" data-view="samples">${esc(tx('impGo'))}</button>`:`<a class="btn sm primary" href="../muestras/">${esc(tx('impGo'))}</a>`}</div>`:'')(smpProposals().length)}
    ${I.done.rows.length?`<div class="scroll-x" style="margin-top:8px"><table class="tbl"><thead><tr><th>Result</th><th>PLR · QTP</th><th>Test</th><th>Changes</th></tr></thead><tbody>${I.done.rows.slice(0,250).map(r=>`<tr><td><span class="tag-st ${r.st}">${r.st==='update'?'Updated':r.st==='hist'?'New → History':'New'}</span></td><td class="ref nowrap">${esc(r.ref)}</td><td>${esc(r.title||'')}</td><td><small class="muted">${esc(r.changes||'')}</small></td></tr>`).join('')}</tbody></table></div>`:''}</section>
  ${statusPanel(P)}`;
  const c=k=>P.recs.filter(r=>r._st===k).length, upd=P.recs.filter(r=>r._st==='update'&&!r._quiet).length, stch=P.recs.filter(r=>r._patch&&r._patch.status).length;
  const label={new:'New',hist:'New → History',update:'Update',same:'No change',skip:'Skipped (closed)',error:'Missing PLR or QTP'};
  const show=P.recs.filter(r=>r._st!=='same'||r._quiet).filter(r=>!r._quiet).slice(0,250);
  const eqOpts=[...S.equipment].sort(byName);
  return `<section class="panel"><div class="panel-h"><h2>Column mapping</h2><span class="muted">${esc(I.fileName)} · ${I.rows.length} rows</span></div>
    <p class="note" style="margin-bottom:10px">Each column of the export is matched to a field. The mapping is remembered for the next import.</p>
    ${mappingGrid(I,ARAS_FIELDS,'aras')}</section>
  ${P.unknownEq.size?`<section class="panel"><div class="panel-h"><h2>ARAS equipment not found in the app</h2><span class="muted">Choose what each name means. The choice is remembered.</span></div>
    <div class="eqmap">${[...P.unknownEq].map(([n,o])=>`<div class="from">${esc(o.name)} <small>· ${o.count} task(s)</small></div><select class="fsel" data-eqmap="${esc(n)}" aria-label="Equipment for ${esc(o.name)}"><option value="__new" ${P.eqMap[n]==='__new'?'selected':''}>Create new equipment "${esc(o.name)}"</option><option value="__none" ${P.eqMap[n]==='__none'?'selected':''}>Leave tests without equipment</option>${eqOpts.map(b=>`<option value="${esc(b.id)}" ${P.eqMap[n]===b.id?'selected':''}>Use existing: ${esc(eqName(b))}</option>`).join('')}</select>`).join('')}</div></section>`:''}
  <section class="panel"><div class="panel-h"><h2>Preview</h2>
    <div class="imp-sum"><span class="tag-st new">${c('new')} new active</span><span class="tag-st hist">${c('hist')} new to History</span><span class="tag-st update">${upd} updated${stch?` (${stch} status change)`:''}</span><span class="tag-st same">${c('same')+P.recs.filter(r=>r._quiet).length} no change</span>${c('skip')?`<span class="tag-st skip">${c('skip')} skipped</span>`:''}${c('error')?`<span class="tag-st error">${c('error')} missing PLR or QTP</span>`:''}</div></div>
    <label class="check" style="margin-bottom:8px"><input type="checkbox" id="inc-closed" ${S.incClosed?'checked':''}> Also import completed and cancelled tasks as History</label>
    ${P.newPeople.size||P.newQtps.size?`<p class="note" style="margin-bottom:8px">${P.newPeople.size?`New team members: <b>${esc([...P.newPeople.values()].join(', '))}</b>. `:''}${P.newQtps.size?`New QTPs added to the library: <b>${P.newQtps.size}</b> (${esc([...P.newQtps.values()].map(x=>x.code).join(', '))}).`:''}</p>`:''}
    ${!I.map.plr||!I.map.qtp?'<p class="form-err">Map both the PLR and the QTP columns: together they identify each test.</p>':''}
    <div class="scroll-x"><table class="tbl"><thead><tr><th>Result</th><th>PLR · QTP</th><th>Test</th><th>Project</th><th>Requester</th><th>ARAS status</th><th>Changes</th></tr></thead><tbody>
    ${show.map(r=>`<tr><td><span class="tag-st ${r._st}">${label[r._st]}</span></td><td class="ref nowrap">${esc((r.plr||'—')+' · '+(r.qtp||'—'))}${r.equipmentName?`<br><small class="muted">${esc(r.equipmentName)}</small>`:''}</td><td>${esc(r.title||'')}</td><td>${esc(r.project||'')}</td><td>${esc(r.requester||'')}</td><td class="nowrap">${esc(r.status||'—')}${r._status&&r._st!=='update'&&r._st!=='same'?` → ${esc(r._status)}`:''}</td><td><small class="muted">${r._changes?esc(r._changes.join(', ')):''}</small></td></tr>`).join('')}
    </tbody></table></div>${show.length===250?'<p class="muted">Showing the first 250 rows.</p>':''}
    <div class="row" style="margin-top:12px"><button class="btn primary" data-act="do-import" ${!I.map.plr||!I.map.qtp||!(c('new')+c('hist')+upd+P.recs.filter(r=>r._quiet).length)||S.ro?'disabled':''}>Import ${c('new')+c('hist')} new and update ${upd}</button><button class="btn ghost" data-act="cancel-import">Discard file</button></div>
    <p class="note" style="margin-top:10px">Once the columns and equipment names are set, later files are imported as soon as they are loaded. On re-import, ARAS updates the request data (description, project, requester, comments, due date, result…). Equipment, technician and start date are only filled when empty. A different status is never changed on its own: you choose it after the import.</p>
  </section>
  ${statusPanel(P)}`;
}
/* New files go in without a confirm step once the columns are mapped and every unknown ARAS equipment name has a remembered choice. */
function arasReady(){
  const I=S.imp, P=I&&I.P; if(!P||S.ro||!db||!I.map.plr||!I.map.qtp) return false;
  const saved=(S.cfg.importAras&&S.cfg.importAras.eqMap)||{};
  return [...P.unknownEq.keys()].every(n=>n in saved);
}
async function runArasImport(){
  const I=S.imp; if(!I||!db||!I.P) return; const P=I.P, now=nowIso(), T=iso(todayMs());
  const btn=$('[data-act="do-import"]'); if(btn){btn.disabled=true; btn.textContent='Importing…';}
  try{
    /* 1. master data */
    const newEqIds=new Map(), newPIds=new Map(), jobs=[];
    for(const r of P.recs){
      if(r._eq&&r._eq.startsWith('new:')){const n=r._eq.slice(4); if(!newEqIds.has(n)){let id='eq-'+slug(n); while(eqById(id)) id+='_'; newEqIds.set(n,id); jobs.push(()=>db.doc(`${COL.equipment}/${id}`).set({nombre:r.equipmentName,nombreAras:r.equipmentName,descripcion:'',estado:'Operational',capacidad:1,proximaCalibracion:'',actualizado:now}));}}
      if(r._tech&&r._tech.startsWith('newp:')){const n=r._tech.slice(5); if(!newPIds.has(n)){let id='p-'+slug(n); while(personById(id)) id+='_'; newPIds.set(n,id); jobs.push(()=>db.doc(`${COL.people}/${id}`).set({nombre:r.techName,rol:'Lab technician',horasSemana:40,habilitaciones:[],actualizado:now}));}}
    }
    for(const [k,o] of P.newQtps){const name=Object.entries(o.names).sort((a,b)=>b[1]-a[1])[0]?.[0]||''; jobs.push(()=>db.doc(`${COL.qtps}/${k}`).set({code:o.code,name,durVal:'',durUnit:'Hours',continuous:true,techHours:'',equipmentId:'',notes:'',actualizado:now}));}
    /* equipment chosen as "use existing" keeps the ARAS name as alias for next time */
    for(const [n,v] of Object.entries(P.eqMap)){const b=eqById(v); if(b&&!b.nombreAras){const nm=[...P.unknownEq.values()].find(o=>norm(o.name)===n)?.name; if(nm) jobs.push(()=>db.doc(`${COL.equipment}/${b.id}`).update({nombreAras:nm,actualizado:now}));}}
    const resId=v=>!v?'':v.startsWith('new:')?newEqIds.get(v.slice(4))||'':v.startsWith('newp:')?newPIds.get(v.slice(5))||'':v;
    /* 2. tests */
    const usedIds=new Set(S.tests.map(t=>t.id));
    let nNew=0,nUpd=0; const doneRows=[];
    for(const r of P.recs){
      if(r._st==='new'||r._st==='hist'){
        let base='aras-'+slug(r.plr)+'-'+slug(r.qtp), id=base, i=2; while(usedIds.has(id)) id=base+'-'+(i++); usedIds.add(id);
        const data={source:'ARAS',plr:r.plr,qtp:r.qtp,title:r.title,project:r.project,requester:r.requester,comments:r.comments,pieces:r.pieces,requestedDue:r.requestedDue,flexible:!!r.flexible,sequence:r.sequence,category:r.category,requestNote:r.requestNote,result:r.result,
          arasStatus:r.status,arasDurVal:r.durVal,arasDurUnit:normUnit(r.durUnit),arasEquipment:r.equipmentName,arasTech:r.techName,
          status:r._status,equipmentId:resId(r._eq),techId:resId(r._tech),start:r.start,end:'',durVal:'',durUnit:'',continuous:'',techHours:'',priority:'Medium',progress:r._status==='Completed'?100:0,holdReason:'',labNotes:'',agreedDue:'',closedAt:'',created:now,updated:now,imported:now};
        jobs.push(()=>db.doc(`${COL.tests}/${id}`).set(data)); nNew++; doneRows.push({st:r._st,ref:`${r.plr} · ${r.qtp}`,title:r.title});
      }else if(r._st==='update'){
        const patch={...r._patch,updated:now,imported:now}; if(patch.equipmentId) patch.equipmentId=resId(patch.equipmentId); if(patch.techId) patch.techId=resId(patch.techId);
        jobs.push(()=>db.doc(`${COL.tests}/${r._match.id}`).update(patch)); if(!r._quiet){nUpd++; doneRows.push({st:'update',ref:`${r.plr} · ${r.qtp}`,title:r.title,changes:r._changes.join(', ')});}
      }
    }
    /* The import queues all writes together so it becomes one commit. */
    const keepEq={...((S.cfg.importAras&&S.cfg.importAras.eqMap)||{}),...P.eqMap};
    jobs.push(()=>db.doc('config/importAras').set({map:I.map,eqMap:keepEq,lastFile:I.fileName,date:now,includeClosed:S.incClosed}));
    await Promise.all(jobs.map(j=>j()));
    I.done={nNew,nUpd,rows:doneRows}; toast(`Import finished: ${nNew} new, ${nUpd} updated.`); render();
  }catch(e){toast(errMsg(e)); render();}
}

/* ---------- QTP list import ---------- */
function qtpPreview(){
  const I=S.qimp, recs=readRecs(I,QTP_FIELDS);
  for(const r of recs){
    if(!r.code){r._st='error'; continue;}
    r._basis=r.durBasis?(/sampl|muestr|piece|pieza|unit/i.test(r.durBasis)?'sample':'test'):'';
    r._unit=normUnit(r.durUnit)||(I.map.durVal&&/\bd(ays?|ias?)?\b/i.test(I.map.durVal)?'Days':'Hours');
    r._eq=r.equipmentName?(eqMatchByName(r.equipmentName)||eqSuggest(r.equipmentName))?.id||'':'';
    const q=S.qtps.find(x=>x.id===qid(r.code));
    if(!q){r._st='new'; continue;}
    const patch={};
    if(r.name&&r.name!==q.name) patch.name=r.name;
    if(r.durVal!==''&&(String(r.durVal)!==String(q.durVal)||r._unit!==q.durUnit)){patch.durVal=r.durVal; patch.durUnit=r._unit;}
    if(r.techHours!==''&&String(r.techHours)!==String(q.techHours)) patch.techHours=r.techHours;
    if(r._eq&&r._eq!==q.equipmentId) patch.equipmentId=r._eq;
    if(r.notes&&r.notes!==q.notes) patch.notes=r.notes;
    if(r.testType&&r.testType!==(q.testType||'')) patch.testType=r.testType;
    if(r.standard&&r.standard!==(q.standard||'')) patch.standard=r.standard;
    if(r._basis&&r._basis!==(q.durBasis||'test')) patch.durBasis=r._basis;
    r._patch=patch; r._q=q; r._st=Object.keys(patch).length?'update':'same';
  }
  return recs;
}
function qtpImportPanel(I){
  const recs=qtpPreview(); I.recs=recs; const c=k=>recs.filter(r=>r._st===k).length;
  return `<div style="display:grid;gap:12px;margin-top:14px">
    <p class="note">${esc(I.fileName)} · ${I.rows.length} rows. Empty cells never overwrite values already in the library.</p>
    ${mappingGrid(I,QTP_FIELDS,'qtp')}
    <div class="imp-sum"><span class="tag-st new">${c('new')} new</span><span class="tag-st update">${c('update')} updated</span><span class="tag-st same">${c('same')} no change</span>${c('error')?`<span class="tag-st error">${c('error')} without QTP code</span>`:''}</div>
    <div class="scroll-x"><table class="tbl"><thead><tr><th>Result</th><th>QTP</th><th>Test name</th><th>Est. duration</th><th class="num">Tech hours</th><th>Equipment</th></tr></thead><tbody>
    ${recs.slice(0,200).map(r=>`<tr><td><span class="tag-st ${r._st}">${{new:'New',update:'Update',same:'No change',error:'No code'}[r._st]}</span></td><td class="ref">${esc(r.code||'—')}</td><td>${esc(r.name||'')}</td><td class="nowrap">${r.durVal!==''?esc(r.durVal+' '+(UNIT_SHORT[r._unit]||''))+(r._basis==='sample'?' <small class="muted">per sample</small>':''):'—'}</td><td class="num">${r.techHours!==''?esc(r.techHours):'—'}</td><td>${esc(r.equipmentName||'')}${r.equipmentName&&!r._eq?' <small class="muted">(not found)</small>':''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row"><button class="btn primary" data-act="do-qimport" ${!I.map.code||!(c('new')+c('update'))||S.ro?'disabled':''}>Import ${c('new')} new and update ${c('update')}</button><button class="btn ghost" data-act="cancel-qimport">Discard file</button></div>
  </div>`;
}
async function runQtpImport(){
  const I=S.qimp; if(!I||!db) return; const now=nowIso(), jobs=[];
  for(const r of I.recs||qtpPreview()){
    if(r._st==='new') jobs.push(()=>db.doc(`${COL.qtps}/${qid(r.code)}`).set({code:r.code.trim(),name:r.name||'',durVal:r.durVal,durUnit:r._unit,continuous:true,techHours:r.techHours,durBasis:r._basis||'test',techBasis:'test',equipmentId:r._eq||'',testType:r.testType||'',standard:r.standard||'',notes:r.notes||'',actualizado:now}));
    else if(r._st==='update') jobs.push(()=>db.doc(`${COL.qtps}/${r._q.id}`).update({...r._patch,actualizado:now}));
  }
  try{const n=jobs.length; jobs.push(()=>db.doc('config/importQtp').set({map:I.map,date:now})); await Promise.all(jobs.map(j=>j())); S.qimp=null; toast(`QTP library updated: ${n} procedure(s).`); render();}catch(e){toast(errMsg(e));}
}

function vImport(){
  return `<div class="view-h"><h2>Import from ARAS</h2>${S.tests.length?'<button class="btn" data-act="export">Export tests to Excel</button>':''}</div>
  <ol class="steps"><li>In ARAS, run the lab request search (a_Lab_Dashboard) and export it to Excel.</li><li>Load the file here (.xlsx, .xls or .csv).</li><li>New tasks are created and existing ones updated at once. The first time, or when ARAS brings an unknown equipment name, check the mapping and confirm.</li><li>Choose the status to keep for tests whose status differs from ARAS.</li></ol>
  ${S.ro||S.noDb?'':`<label class="drop-zone" data-dz="aras"><input type="file" id="file-aras" accept=".xlsx,.xls,.csv"><b>Drop the ARAS export here</b><span class="muted">or click to choose the file</span></label>`}
  ${S.imp?importPanelAras():''}`;
}
async function onFile(f,kind){
  if(!f) return;
  try{
    const sh=await readSheet(f);
    if(kind==='qtp'){ sh.map=guessMap(sh.headers,QTP_FIELDS,S.cfg.importQtp&&S.cfg.importQtp.map); S.qimp=sh; }
    else { sh.map=guessMap(sh.headers,ARAS_FIELDS,S.cfg.importAras&&S.cfg.importAras.map); if(S.cfg.importAras&&S.cfg.importAras.includeClosed===false) S.incClosed=false; S.imp=sh; }
    render();
    if(kind==='aras'&&arasReady()) await runArasImport();
  }catch(e){toast('Could not read the file: '+(e.message||e));}
}

/* ---------- Export ---------- */
async function exportXlsx(){
  if(!window.XLSX) return;
  const rows=[...S.tests].sort((a,b)=>STATUSES.indexOf(a.status)-STATUSES.indexOf(b.status)||String(a.plr).localeCompare(String(b.plr))).map(t=>{const ei=endInfo(t), x=effDur(t);
    return {'PLR':t.plr||'','QTP':t.qtp||'','Test':t.title||'','Project':t.project||'','Requester':t.requester||'','Status':t.status||'','ARAS status':t.arasStatus||'','Priority':t.priority||'','Equipment':t.equipmentId?eqName(eqById(t.equipmentId)):'','Technician':personById(t.techId)?.nombre||'','Start':t.start||'','End':ei.end!=null?iso(ei.end):'','End type':ei.kind,'Est. duration':x?x.val:'','Unit':x?x.unit:'','Duration source':x?x.src:'','Technician hours':effTech(t)||'','Progress %':+t.progress||0,'Requested due':t.requestedDue||'','Agreed due':t.agreedDue||'','Due flexible':t.flexible?'Yes':'No','Result':t.result||'','Closed':t.closedAt||'','Pieces':t.pieces??'','Sequence':t.sequence??'','Comments':t.comments||'','Lab notes':t.labNotes||'','Hold reason':t.holdReason||''}});
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Tests');
  const buf=XLSX.write(wb,{type:'array',bookType:'xlsx'});
  const url=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})), a=document.createElement('a');
  a.href=url; a.download=`lab_tests_${iso(todayMs())}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000);
}

/* ---------- Dialogs ---------- */
const dlg=$('#dlg');
const dis=()=>S.ro?'disabled':'';
function fld(id,label,inner,cls='',help=''){return `<div class="field ${cls}"><label for="${id}">${label}</label>${inner}${help?`<span class="help" id="${id}-help">${help}</span>`:''}</div>`}
function inp(name,val,type='text',extra=''){return `<input id="f-${name}" name="${name}" type="${type}" value="${esc(val??'')}" ${extra} ${dis()}>`}
function sel(name,val,opts,extra=''){return `<select id="f-${name}" name="${name}" ${extra} ${dis()}>${opts.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o]; return `<option value="${esc(v)}" ${String(val??'')===String(v)?'selected':''}>${esc(l)}</option>`}).join('')}</select>`}
function dlgShell(eyebrow,title,body,footerLeft=''){
  return `<form class="dlg-form" id="dlg-form" novalidate><header class="dlg-h"><div><p class="eyebrow">${eyebrow}</p><h2>${esc(title)}</h2></div><button type="button" class="icon-btn" data-act="close" aria-label="Close">×</button></header>
  <div class="dlg-body">${body}<div id="f-err" class="form-err" hidden></div></div>
  <footer class="dlg-f">${S.ro?'':footerLeft}<span class="sp"></span><button type="button" class="btn ghost" data-act="close">${S.ro?'Close':'Cancel'}</button>${S.ro?'':'<button class="btn primary" type="submit">Save</button>'}</footer></form>`;
}
function openEditor(id){
  const isNew=!id, t=isNew?{status:'Queued',priority:'Medium',source:'Manual'}:S.tests.find(x=>x.id===id);
  if(!t) return;
  dlg.dataset.kind='test'; dlg.dataset.id=id||'';
  const eqOpts=[['','— none —'],...[...S.equipment].sort(byName).map(b=>[b.id,eqName(b)+(eqStatus(b)!=='Operational'?` (${eqStatus(b)})`:'')+` · cap ${eqCap(b)}`])];
  if(t.equipmentId&&!eqById(t.equipmentId)) eqOpts.push([t.equipmentId,'(deleted equipment)']);
  const pOpts=[['','— none —'],...[...S.people].sort(byName).map(p=>[p.id,p.nombre])];
  const fromAras=t.source==='ARAS';
  const sibs=isNew?[]:S.tests.filter(x=>x.id!==t.id&&x.plr&&String(x.plr).toUpperCase()===String(t.plr).toUpperCase()).sort((a,b)=>(a.sequence||99)-(b.sequence||99)||String(a.qtp).localeCompare(String(b.qtp)));
  const body=`<fieldset><legend>Request${fromAras?' · from ARAS':''}</legend>
    ${fld('f-plr','Request (PLR)',inp('plr',t.plr,'text','placeholder="PLR000000"'),'req')}
    ${fld('f-qtp','Task item (QTP)',inp('qtp',t.qtp,'text','list="qtp-list" placeholder="QTP0000"'),'req')}
    ${fld('f-title','Test description',inp('title',t.title),'span2')}
    ${fld('f-project','Project',inp('project',t.project,'text','placeholder="25046 - PROJECT NAME"'))}
    ${fld('f-requester','Request creator',inp('requester',t.requester))}
    ${fld('f-pieces','Number of pieces (samples)',inp('pieces',t.pieces,'number','min="0" step="1"'),'','<span id="pieces-help"></span>')}
    ${fld('f-sequence','Test sequence',inp('sequence',t.sequence,'number','min="0" step="1"'))}
    ${fld('f-requestedDue','Requested due date',inp('requestedDue',t.requestedDue,'date'))}
    <div class="field"><span class="lbl">Due date flexible?</span><label class="check"><input type="checkbox" id="f-flexible" name="flexible" value="1" ${t.flexible?'checked':''} ${dis()}> Flexible</label></div>
    ${fld('f-comments','Comments',`<textarea id="f-comments" name="comments" class="tall" ${dis()}>${esc(t.comments||'')}</textarea>`,'span2')}
    ${t.category?`<div class="field span2"><span class="lbl">Product category</span><span>${esc(t.category)}</span></div>`:''}
    ${fromAras?`<p class="note span2">ARAS: status <b>${esc(t.arasStatus||'—')}</b> · equipment <b>${esc(t.arasEquipment||'—')}</b> · lab resource <b>${esc(t.arasTech||'—')}</b>${t.arasDurVal?` · duration <b>${esc(t.arasDurVal)} ${esc(t.arasDurUnit||'')}</b>`:''}${t.requestNote?`<br>Request status note: ${esc(t.requestNote)}`:''}<br>The fields in this section are refreshed from ARAS on each import.</p>`:''}
  </fieldset>
  <fieldset><legend>Lab planning</legend>
    ${fld('f-status','Status',sel('status',t.status,STATUSES),'','Report = test finished, report being written')}
    ${fld('f-priority','Priority',sel('priority',t.priority||'Medium',PRIOS))}
    ${fld('f-equipmentId','Equipment',sel('equipmentId',t.equipmentId||'',eqOpts),'','<span id="eq-sug"></span>')}
    ${fld('f-techId','Technician',sel('techId',t.techId||'',pOpts))}
    ${fld('f-start','Start',inp('start',t.start,'date'))}
    ${fld('f-end','Planned end',inp('end',t.end,'date'),'','<span id="end-help"></span>')}
    <div class="field"><label for="f-durVal">Estimated duration</label><div class="inline">${inp('durVal',t.durVal,'number','min="0" step="any" style="flex:1"')}${sel('durUnit',t.durUnit||'Hours',UNITS,'style="flex:1"')}</div><span class="help" id="dur-help"></span></div>
    ${fld('f-continuous','Runs',sel('continuous',t.continuous||'',[['','Default from QTP library'],['yes','Continuous 24/7'],['no','Working hours (8 h/day)']]))}
    ${fld('f-techHours','Technician hours (total)',inp('techHours',isEndu(t)?'':t.techHours,'number',`min="0" step="0.5" ${isEndu(t)?'readonly':''}`),'','<span id="tech-help"></span>')}
    ${fld('f-progress','Progress (%)',inp('progress',t.progress,'number','min="0" max="100" step="5"'))}
    ${fld('f-agreedDue','Agreed due date',inp('agreedDue',t.agreedDue,'date'),'','Overrides the requested date for alerts')}
    ${fld('f-result','Test result',sel('result',t.result||'',[['','—'],...RESULTS]))}
    ${fld('f-holdReason','On hold reason',inp('holdReason',t.holdReason,'text','placeholder="Only when on hold"'),'span2')}
    ${fld('f-labNotes','Lab notes',`<textarea id="f-labNotes" name="labNotes" ${dis()}>${esc(t.labNotes||'')}</textarea>`,'span2')}
    <div class="span2 note" id="f-hint"></div>
  </fieldset>
  <div id="f-warn"></div>
  ${sibs.length?`<div><p class="eyebrow" style="margin-bottom:6px">Other tasks in ${esc(t.plr)}</p><div class="siblings">${sibs.map(x=>`<button type="button" data-act="open-sib" data-id="${esc(x.id)}"><span class="ref">${esc(ref(x))}</span><span>${esc(x.title||'')}</span>${x.sequence?`<span class="chip">seq ${esc(x.sequence)}</span>`:''}<span class="sp"></span>${estPill(x.status)}${resTag(x.result)}</button>`).join('')}</div></div>`:''}
  ${isNew||APP==='occupancy'?'':smpEditorBlock(t)}`;
  dlg.innerHTML=dlgShell(isNew?'New manual test':(fromAras?'ARAS task':'Manual test'),isNew?'New test':`${baseRef(t)} · ${t.title||''}`,body,isNew?'':`<button type="button" class="btn ghost danger" data-act="del">Delete</button>`);
  if(!dlg.open) dlg.showModal(); liveHints();
}
function readForm(){const fd=new FormData($('#dlg-form')), o={}; for(const [k,v] of fd.entries()) o[k]=typeof v==='string'?v.trim():v; return o;}
function draftFromForm(){
  const id=dlg.dataset.id, base=id?S.tests.find(x=>x.id===id):{source:'Manual'}, f=readForm();
  return {...base,...f,flexible:!!f.flexible,id:id||'__draft'};
}
function liveHints(){
  if(dlg.dataset.kind!=='test') return;
  const id=dlg.dataset.id, t=draftFromForm(), list=[...S.tests.filter(x=>x.id!==id),t];
  const ix=buildIndex(list), al=testAlerts(t,ix).filter(x=>APP==='occupancy'||!x.occ), L=libOf(t);
  $('#f-warn').innerHTML=al.length?`<ul class="alerts">${al.map(a=>`<li class="${a.sev}"><span class="sev">${a.sev==='crit'?'Critical':'Warning'}</span><span>${esc(a.text)}</span></li>`).join('')}</ul>`:'';
  const tdef={...t,durVal:''}, def=effDur(tdef);
  $('#dur-help').textContent=+t.durVal>0?`Overrides ${def?`${durLabel(def)} from ${def.src}`:'the default'}. Clear it to use the default.`:def?`Using ${durLabel(def)} from ${def.src}. Type a value to override it for this test only.`:'No default: set it here or in the QTP library.';
  $('#f-durVal').placeholder=def?String(def.val):'';
  const ph=$('#pieces-help'); if(ph){const per=L&&(L.durBasis==='sample'||(L.techBasis==='sample'&&!isEndu(t))); ph.textContent=per?(piecesSet(t)?`The QTP library counts time per sample: × ${samplesOf(t)}.`:'The QTP library counts time per sample: set the pieces (counted as 1 for now).'):'';}
  const lt=libTech(t), ltNote=L&&L.techBasis==='sample'&&lt?` (${L.techHours} h × ${samplesOf(t)} samples)`:''; if(isEndu(t)){const ti=$('#f-techHours'); ti.readOnly=true; ti.value=''; ti.placeholder=fmtH(effTech(t)); $('#tech-help').textContent=`Endurance profile from the QTP library: ${loadSummary(L).replace('Endurance · ','')}.`;} else {$('#f-techHours').readOnly=false; $('#tech-help').textContent=+t.techHours?(lt?`Overrides ${fmtH(lt)} h from the QTP library${ltNote}.`:''):lt?`Using ${fmtH(lt)} h from the QTP library${ltNote}.`:'Used to compute technician load.';
  $('#f-techHours').placeholder=lt?String(lt):'';}
  const ei=endInfo(t); $('#end-help').textContent=t.end?'Set by hand. Clear it to compute start + duration.':ei.kind==='auto'?`Auto: ${fmtMs(ei.end)} (start + estimated duration)`:t.start?'Unknown: no duration available':'Leave empty to compute it from start + duration';
  const sug=$('#eq-sug'); if(sug){ const lb=L&&eqById(L.equipmentId); sug.innerHTML=!t.equipmentId&&lb?`QTP default: <button type="button" class="link" data-act="use-eq" data-id="${esc(lb.id)}">${esc(eqName(lb))}</button>`:''; }
  let hint=''; if(t.status==='Not approved') hint='Not approved: this test is ignored by alerts, planning and occupancy until its status changes. '; else if(APP==='occupancy'&&t.equipmentId){const fr=freeFrom(ix,t.equipmentId,t.id); hint+=`Equipment slot free from <b>${fr==null?'—':fr===todayMs()?'today':fmtMs(fr)}</b> (capacity ${eqCap(eqById(t.equipmentId))}). `;}
  const s=d(t.start); if(t.status!=='Not approved'&&s!=null&&ei.end!=null&&ei.kind!=='open'){const wd=workdays(s,ei.end); hint+=`${(ei.end-s)/DAY+1} calendar days · ${wd} working days`;
    if(isEndu(t)){const pl=techPlan(t,s,Math.max(s,ei.end),false), P=pl.parts, Lq=libOf(t); hint+=`. Technician load: setup ${+Lq.setupH||0} h over ${P.setupDays} day(s) · daily check ${+Lq.dailyH||0} h × ${P.dailyDays} day(s) · ${P.reviews} review(s) × ${+Lq.reviewH||0} h · teardown ${+Lq.teardownH||0} h over ${P.teardownDays} day(s) = <b>${fmtH(planTotal(pl))} h</b>`;}
    else {const th=effTech(t); if(th) hint+=` · ${(th/(wd||1)).toFixed(1)} technician h/day`;} hint+='.';}
  $('#f-hint').innerHTML=hint;
}
function openPerson(id){
  const p=id?personById(id):{nombre:'',rol:'Lab technician',horasSemana:40,habilitaciones:[]}; if(!p) return;
  dlg.dataset.kind='person'; dlg.dataset.id=id||'';
  const body=`<fieldset><legend>Person</legend>
    ${fld('f-nombre','Name',inp('nombre',p.nombre,'text','required'),'req')}
    ${fld('f-rol','Role',inp('rol',p.rol))}
    ${fld('f-horasSemana','Hours per week available for tests',inp('horasSemana',p.horasSemana,'number','min="0" max="60" step="1"'))}
    <div class="field span2"><span class="lbl">Qualified on (leave empty to skip the qualification check)</span><div class="checks">${[...S.equipment].sort(byName).map(b=>`<label><input type="checkbox" name="hab" value="${esc(b.id)}" ${(p.habilitaciones||[]).includes(b.id)?'checked':''} ${dis()}>${esc(eqName(b))}</label>`).join('')||'<span class="muted">Add equipment first.</span>'}</div></div>
    <p class="note span2">The name must match the ARAS Lab Resource name (accents and capitals are ignored) so imported tasks are assigned automatically.</p>
  </fieldset>`;
  dlg.innerHTML=dlgShell(id?'Edit person':'New person',id?p.nombre:'New person',body,id?'<button type="button" class="btn ghost danger" data-act="del">Delete</button>':'');
  dlg.showModal();
}
function openEquipment(id){
  const b=id?eqById(id):{nombre:'',nombreAras:'',descripcion:'',estado:'Operational',capacidad:1,proximaCalibracion:''}; if(!b) return;
  dlg.dataset.kind='equipment'; dlg.dataset.id=id||'';
  const body=`<fieldset><legend>Equipment</legend>
    ${fld('f-nombre','Name',inp('nombre',b.nombre,'text','required'),'req')}
    ${fld('f-nombreAras','Name in ARAS (Equipment column)',inp('nombreAras',b.nombreAras,'text','placeholder="Same as name"'),'','Several names: separate them with ;')}
    ${fld('f-capacidad','Simultaneous tests (capacity)',inp('capacidad',eqCap(b),'number','min="1" max="200" step="1"'),'','How many tests can run on it at the same time')}
    ${fld('f-estado','Status',sel('estado',eqStatus(b),EQ_STATUS))}
    ${fld('f-proximaCalibracion','Next calibration',inp('proximaCalibracion',b.proximaCalibracion,'date'))}
    ${fld('f-descripcion','Lab / description',inp('descripcion',b.descripcion),'span2')}
  </fieldset>
  <fieldset><legend>Instruments (FLE)</legend>${flePicker(b.instrumentos||[])}</fieldset>`;
  dlg.innerHTML=dlgShell(id?'Edit equipment':'New equipment',id?eqName(b):'New equipment',body,id?'<button type="button" class="btn ghost danger" data-act="del">Delete</button>':'');
  dlg.showModal();
}
function flePicker(ids,what='this equipment'){
  const picked=new Set(ids);
  if(!CAL.eq) return `<p class="note span2">${CAL.err?'The calibration plan could not be read':'The calibration plan is loading'}. Connect GitHub with an account that can read <span class="mono">${REPO.owner}/${REPO.repo}</span> to assign instruments.${ids.length?' Assigned now:':''}</p>${ids.length?`<div class="chips span2">${ids.map(fleChip).join('')}</div>`:''}`;
  const all=Object.entries(CAL.eq).map(([id,e])=>({...e,id})).filter(e=>picked.has(e.id)||!['Reserved','Retired'].includes(e.state));
  ids.filter(id=>!CAL.eq[id]).forEach(id=>all.push({id,code:String(id).replace(/^eq-/,''),group:'',missing:true}));
  const grp=e=>e.group==='Test equipment'?0:e.group==='Auxiliary equipment'?1:2;
  all.sort((a,b)=>grp(a)-grp(b)||String(a.code).localeCompare(String(b.code),'en',{numeric:true})||a.id.localeCompare(b.id));
  let last=null; const rows=all.map(e=>{const s=fleState(e.missing?null:e), g=grp(e), h=g!==last?`<h4>${['Test equipment','Auxiliary equipment','Other'][g]}</h4>`:''; last=g;
    return `${h}<label data-s="${esc(norm([e.code,e.description,e.brand,e.model,e.serial].join(' ')))}"><input type="checkbox" name="fle" value="${esc(e.id)}" ${picked.has(e.id)?'checked':''} ${dis()}><span class="mono">${esc(e.code)}</span><span>${esc(e.missing?'(deleted from the calibration plan)':fleLabel(e))}</span><span class="due ${s.cls==='off'?'':s.cls}">${esc(s.text)}</span></label>`}).join('');
  return `<p class="note span2">Instruments from the calibration plan that are usually used on ${what}.</p>
    <div class="field span2"><input id="fle-q" type="search" placeholder="Filter by code, description, brand or model" autocomplete="off" aria-label="Filter instruments">
    <div class="fle-list" id="fle-list">${rows}</div><div class="chips" id="fle-sel">${fleSel(ids)}</div></div>`;
}
const fleSel=ids=>ids.length?`<span class="muted">${ids.length} assigned:</span> ${ids.map(fleChip).join('')}`:'<span class="muted">None assigned.</span>';
function openQtp(id){
  const q=id?S.qtps.find(x=>x.id===id):{code:'',name:'',durVal:'',durUnit:'Hours',continuous:true,cyclesPerDay:'',techHours:'',equipmentId:'',notes:''}; if(!q) return;
  dlg.dataset.kind='qtp'; dlg.dataset.id=id||'';
  const eqOpts=[['','— none —'],...[...S.equipment].sort(byName).map(b=>[b.id,eqName(b)])];
  const body=`<fieldset><legend>Test procedure</legend>
    ${fld('f-code','QTP code',inp('code',q.code||q.id,'text',id?'readonly':'placeholder="QTP0000"'),'req')}
    ${fld('f-name','Test name',inp('name',q.name),'span2')}
    ${fld('f-testType','Test type',inp('testType',q.testType))}
    ${fld('f-standard','Standard',inp('standard',q.standard,'text','placeholder="e.g. IEC 60068"'))}
    <div class="field span2"><label for="f-durVal">Estimated duration</label><div class="inline">${inp('durVal',q.durVal,'number','min="0" step="any" style="flex:1"')}${sel('durUnit',q.durUnit||'Hours',UNITS,'style="flex:1"')}${sel('durBasis',q.durBasis==='sample'?'sample':'test',[['test','per test'],['sample','per sample']],'style="flex:1.2" aria-label="Duration basis"')}</div><span class="help">Per sample: multiplied by the number of pieces of each test</span></div>
    ${fld('f-continuous','Runs',sel('continuous',q.continuous===false?'no':'yes',[['yes','Continuous 24/7'],['no','Working hours (8 h/day)']]))}
    ${fld('f-cyclesPerDay','Cycles per day',inp('cyclesPerDay',q.cyclesPerDay,'number','min="0" step="any"'),'','Only for durations in cycles')}
    ${fld('f-equipmentId','Default equipment',sel('equipmentId',q.equipmentId||'',eqOpts))}
    ${fld('f-profile','Technician load profile',sel('profile',q.profile==='endurance'?'endurance':'even',[['even','Even: total hours spread over the working days'],['endurance','Endurance: setup + daily check + reviews + teardown']]),'span2')}
    <div class="field span2" id="even-fields" ${q.profile==='endurance'?'hidden':''}><label for="f-techHours">Technician hours</label><div class="inline" style="max-width:420px">${inp('techHours',q.techHours,'number','min="0" step="0.5" style="flex:1"')}${sel('techBasis',q.techBasis==='sample'?'sample':'test',[['test','per test'],['sample','per sample']],'style="flex:1.2" aria-label="Technician hours basis"')}</div><span class="help">Per sample: multiplied by the number of pieces of each test</span></div>
    <div class="span2" id="endu-fields" ${q.profile==='endurance'?'':'hidden'}><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">
      ${fld('f-setupH','Setup hours',inp('setupH',q.setupH,'number','min="0" step="0.5"'),'',`In blocks of ${LOAD_DAY} h per working day from the start`)}
      ${fld('f-dailyH','Daily check hours',inp('dailyH',q.dailyH,'number','min="0" step="0.25"'),'','Every working day between setup and teardown')}
      <div class="field"><label for="f-reviewEvery">Review every</label><div class="inline">${inp('reviewEvery',q.reviewEvery,'number','min="0" step="any" style="flex:1"')}${sel('reviewUnit',q.reviewUnit||'Hours',['Hours','Days','Weeks'],'style="flex:1"')}</div><span class="help">Counted from the start; weekend reviews move to Monday</span></div>
      ${fld('f-reviewH','Hours per review',inp('reviewH',q.reviewH,'number','min="0" step="0.5"'))}
      ${fld('f-teardownH','Teardown hours',inp('teardownH',q.teardownH,'number','min="0" step="0.5"'),'',`In blocks of ${LOAD_DAY} h per working day, ending on the end date`)}
    </div></div>
    ${fld('f-notes','Notes',`<textarea id="f-notes" name="notes" ${dis()}>${esc(q.notes||'')}</textarea>`,'span2')}
    <p class="note span2">These values are planning defaults. Each test can override duration and running mode; with the even profile it can also override the total technician hours. Weekends never carry technician hours.</p>
  </fieldset>
  <fieldset><legend>Instruments (FLE)</legend>${flePicker(q.instrumentos||[],'this test procedure')}</fieldset>`;
  dlg.innerHTML=dlgShell(id?'Edit QTP':'New QTP',id?`${q.code||q.id} · ${q.name||''}`:'New QTP',body,id?'<button type="button" class="btn ghost danger" data-act="del">Delete</button>':'');
  dlg.showModal();
}
const num=v=>v===''||v==null||isNaN(+v)?'':+v;
function formErr(m){const el=$('#f-err'); el.textContent=m; el.hidden=!m; return null;}
async function saveDialog(){
  if(dlg.dataset.kind==='gh') return saveGh();
  if(dlg.dataset.kind==='smp-rc') return smpSaveReceive(false);
  if(dlg.dataset.kind==='smp-lot') return smpSaveLot();
  if(dlg.dataset.kind==='smp-lb'||dlg.dataset.kind==='smp-gen') return;
  if(!db||S.ro) return;
  const kind=dlg.dataset.kind, id=dlg.dataset.id, f=readForm(), now=nowIso(), T=iso(todayMs());
  try{
    if(kind==='test'){
      if(!f.plr&&!f.qtp) return formErr('Enter the PLR and the QTP: together they identify the test.');
      if(!f.qtp) return formErr('Enter the QTP code.');
      if(f.start&&f.end&&d(f.end)<d(f.start)) return formErr('The planned end cannot be before the start.');
      const prev=id?S.tests.find(x=>x.id===id):null;
      const data={plr:f.plr,qtp:f.qtp.toUpperCase(),title:f.title,project:f.project,requester:f.requester,comments:f.comments,pieces:f.pieces===''?'':+f.pieces,sequence:f.sequence===''?'':+f.sequence,requestedDue:f.requestedDue,flexible:!!f.flexible,
        status:f.status,priority:f.priority,equipmentId:f.equipmentId,techId:f.techId,start:f.start,end:f.end,durVal:f.durVal===''?'':+f.durVal,durUnit:f.durUnit,continuous:f.continuous,techHours:f.techHours===''?'':+f.techHours,
        progress:Math.max(0,Math.min(100,+f.progress||0)),agreedDue:f.agreedDue,result:f.result,holdReason:f.holdReason,labNotes:f.labNotes,updated:now};
      if(RUNNING.has(data.status)&&!data.start) data.start=T;
      if(CLOSED.includes(data.status)&&!(prev&&CLOSED.includes(prev.status))) data.closedAt=(prev&&prev.closedAt)||T;
      if(!CLOSED.includes(data.status)) data.closedAt='';
      if(data.status==='Completed'||data.status==='Report') data.progress=Math.max(data.progress,data.status==='Completed'?100:data.progress);
      if(!data.title){const L=libOf(data); if(L&&L.name) data.title=L.name;}
      if(id) await db.doc(`${COL.tests}/${id}`).update(data);
      else await db.collection(COL.tests).add({...data,source:'Manual',created:now});
      if(data.qtp&&!S.qtps.some(q=>q.id===qid(data.qtp))) await db.doc(`${COL.qtps}/${qid(data.qtp)}`).set({code:data.qtp,name:data.title||'',durVal:'',durUnit:'Hours',continuous:true,techHours:'',equipmentId:'',notes:'',actualizado:now});
    }else if(kind==='person'){
      if(!f.nombre) return formErr('The name is required.');
      const data={nombre:f.nombre,rol:f.rol||'',horasSemana:+f.horasSemana||0,habilitaciones:[...dlg.querySelectorAll('input[name="hab"]:checked')].map(x=>x.value),actualizado:now};
      if(id) await db.doc(`${COL.people}/${id}`).update(data); else await db.collection(COL.people).add(data);
    }else if(kind==='equipment'){
      if(!f.nombre) return formErr('The name is required.');
      const data={nombre:f.nombre,nombreAras:f.nombreAras||'',descripcion:f.descripcion||'',estado:f.estado||'Operational',capacidad:Math.max(1,parseInt(f.capacidad)||1),proximaCalibracion:f.proximaCalibracion||'',actualizado:now};
      if(CAL.eq) data.instrumentos=[...dlg.querySelectorAll('input[name="fle"]:checked')].map(x=>x.value); else if(!id) data.instrumentos=[];
      if(id) await db.doc(`${COL.equipment}/${id}`).update(data); else await db.collection(COL.equipment).add(data);
    }else if(kind==='qtp'){
      const code=(f.code||'').trim(); if(!code) return formErr('The QTP code is required.');
      if(!id&&S.qtps.some(q=>q.id===qid(code))) return formErr(`${code} is already in the library.`);
      const data={code:id?(S.qtps.find(q=>q.id===id).code||code):code.toUpperCase(),name:f.name||'',durVal:f.durVal===''?'':+f.durVal,durUnit:f.durUnit||'Hours',continuous:f.continuous!=='no',cyclesPerDay:f.cyclesPerDay===''?'':+f.cyclesPerDay,techHours:f.techHours===''?'':+f.techHours,durBasis:f.durBasis==='sample'?'sample':'test',techBasis:f.techBasis==='sample'?'sample':'test',equipmentId:f.equipmentId||'',testType:f.testType||'',standard:f.standard||'',notes:f.notes||'',profile:f.profile==='endurance'?'endurance':'even',
        setupH:num(f.setupH),dailyH:num(f.dailyH),reviewEvery:num(f.reviewEvery),reviewUnit:f.reviewUnit||'Hours',reviewH:num(f.reviewH),teardownH:num(f.teardownH),actualizado:now};
      if(CAL.eq) data.instrumentos=[...dlg.querySelectorAll('input[name="fle"]:checked')].map(x=>x.value); else if(!id) data.instrumentos=[];
      if(id) await db.doc(`${COL.qtps}/${id}`).update(data); else await db.doc(`${COL.qtps}/${qid(code)}`).set(data);
    }
    dlg.close(); toast('Saved.');
  }catch(e){formErr(errMsg(e));}
}
async function deleteFromDialog(btn){
  if(!btn.classList.contains('armed')){btn.classList.add('armed'); btn.textContent='Confirm delete'; return;}
  const kind=dlg.dataset.kind, id=dlg.dataset.id, col={test:COL.tests,person:COL.people,equipment:COL.equipment,qtp:COL.qtps}[kind];
  try{await db.doc(`${col}/${id}`).delete(); dlg.close(); toast('Deleted.');}catch(e){formErr(errMsg(e));}
}

/* ---------- Status changes ---------- */
async function setStatus(id,status,{openHold=true}={}){
  const t=S.tests.find(x=>x.id===id); if(!t||t.status===status||!db) return;
  const T=iso(todayMs()), patch={status,updated:nowIso()};
  if(RUNNING.has(status)&&!t.start) patch.start=T;
  if(CLOSED.includes(status)) patch.closedAt=t.closedAt||T; else if(t.closedAt) patch.closedAt='';
  if(status==='Completed') patch.progress=100;
  try{await db.doc(`${COL.tests}/${id}`).update(patch); toast(`${baseRef(t)} → ${status}${CLOSED.includes(status)?' (moved to History)':''}`); if(openHold&&status==='On hold'&&!t.holdReason) openEditor(id);}catch(err){toast(errMsg(err)); render();}
}

async function setDate(id,field,value){
  const t=S.tests.find(x=>x.id===id); if(!t||!db) return;
  const patch={updated:nowIso()}; let msg='';
  if(field==='start'){
    if((t.start||'')===value) return;
    if(value&&t.end&&d(t.end)<d(value)){toast('The start date cannot be after the end date.'); render(); return;}
    patch.start=value; msg=value?`start ${fmt(value)}`:'start date cleared';
    if(value&&t.status==='Queued'){patch.status='Planned'; msg+=' · moved to Planned';}
  }else{
    const ei=endInfo(t), auto=ei.kind==='auto'?iso(ei.end):'';
    if(!value){ if(!t.end) {render(); return;} patch.end=''; msg='end date back to automatic'; }
    else{
      if(t.start&&d(value)<d(t.start)){toast('The end date cannot be before the start date.'); render(); return;}
      if(value===(t.end||'')||(!t.end&&value===auto)) return;
      patch.end=value; msg=`end ${fmt(value)}`;
    }
  }
  try{await db.doc(`${COL.tests}/${id}`).update(patch); toast(`${baseRef(t)}: ${msg}`);}catch(e){toast(errMsg(e)); render();}
}
async function setTech(id,techId){
  const t=S.tests.find(x=>x.id===id); if(!t||!db||(t.techId||'')===techId) return;
  try{await db.doc(`${COL.tests}/${id}`).update({techId,updated:nowIso()}); const p=personById(techId); toast(`${baseRef(t)} → ${p?p.nombre:'Unassigned'}`);}catch(e){toast(errMsg(e)); render();}
}

/* ---------- Samples (muestras) ----------
   Each reception of samples is one document in the collection "muestras": one FLS-xxxxx number per reception and
   one suffix per physical unit (-1, -2…), which keeps its number when it is withdrawn. A reception is linked to one or
   more PLRs; its tests are the ARAS tests (PLR · QTP) of those PLRs, so an ARAS import updates them here too.
   Units whose codes come from an ARAS request start as "expected" and count as received once someone receives them.
   This tab is in Spanish with an English switch: all its texts go through tx(). */
const SMP=['expected','received','waiting','testing','tested','stored','returned','scrapped'];
const SMP_CLS={expected:'exp',received:'plan',waiting:'cola',testing:'curso',tested:'inf',stored:'cerr',returned:'endu',scrapped:'canc'};
const SMP_DEFAULT=['expected','received','waiting','testing','tested','stored'];
const SMP_PHASES=['Feasibility','MSL','ESL','Pilot','Production','N/A'];
const SMP_LABELS={
  '99012':{w:89,h:36,n:'99012 Large Address · 89 × 36 mm'},
  '99010':{w:89,h:28,n:'99010 Standard Address · 89 × 28 mm'},
  '11354':{w:57,h:32,n:'11354 Multi-purpose · 57 × 32 mm'},
  '11352':{w:54,h:25,n:'11352 Return Address · 54 × 25 mm'}};
const SMP_CODE_RE=/FLS-\d{5}(?:-\d+)?/i;
const SMP_I18N={
es:{
  tab:'Muestras', title:'Muestras',
  search:'Buscar o escanear: FLS, PLR, QTP, proyecto, nº serie…',
  byPlr:'Por PLR', list:'Lista', lang:'Idioma',
  receive:'+ Recibir muestras', labels:n=>`Etiquetas${n?` · ${n} por imprimir`:''}`,
  k_inlab:'En el laboratorio', k_inlab_s:'unidades recibidas, sin devolver',
  k_wait:'En espera', k_wait_s:'recibidas, sin empezar ensayo',
  k_test:'En ensayo', k_test_s:'unidades en un ensayo',
  k_done:'Ensayadas', k_done_s:'falta decidir: guardar, devolver o desechar',
  k_miss:'PLR con muestras pendientes', k_miss_s:'faltan piezas por recibir',
  k_lbl:'Etiquetas por imprimir', k_lbl_s:'unidades sin etiqueta',
  show:'Mostrar:', phaseAll:'Todas las fases', onlyMissing:'Solo PLR con muestras pendientes',
  st:{expected:'Pendiente de recibir',received:'Recibida',waiting:'En espera',testing:'En ensayo',tested:'Ensayada',stored:'Almacenada',returned:'Devuelta',scrapped:'Desechada'},
  removed:'Retirada',
  recvOf:(a,b)=>`de ${b} recibidas`, recvN:'recibidas',
  missing:n=>`Faltan ${n} muestra${n===1?'':'s'}`, complete:'Muestras completas', none:'Pendiente de recibir', extra:n=>`${n} de más`,
  closedPlr:'Ensayos cerrados', legacy:'Referencia antigua (FLT): no está en Control de ensayos',
  alsoIn:p=>`también en ${p}`, noLots:'Aún no ha llegado ninguna muestra.', hiddenN:n=>`${n} recepción${n===1?'':'es'} oculta${n===1?'':'s'} por el filtro`,
  by:'por', units:n=>`${n} ud${n===1?'':'s'}.`, notPrinted:'sin etiqueta', receiveFor:'+ Recibir',
  noMatch:'Ninguna muestra cumple el filtro.', noPlr:'Ningún PLR cumple el filtro.',
  empty_h:'Aún no hay muestras ni ensayos', empty_p:'Importa el Excel de ARAS en Import ARAS: cada PLR aparecerá aquí, listo para recibir sus muestras. También puedes recibir muestras de un PLR escribiéndolo a mano.',
  c_sample:'Muestra', c_plr:'PLR · QTP', c_desc:'Descripción', c_proj:'Proyecto', c_phase:'Fase proyecto', c_state:'Estado', c_pn:'Part number', c_sn:'Nº serie', c_loc:'Ubicación', c_recv:'Recepción', c_com:'Comentarios',
  several:'varios', expandAll:'Desplegar todo', collapseAll:'Contraer todo', listHelp:'Cada recepción (FLS-xxxxx) agrupa sus unidades (-1, -2…). El estado de cada unidad se cambia en la tabla; el resto, abriendo la recepción.',
  selN:n=>`${n} unidad${n===1?'':'es'} seleccionada${n===1?'':'s'}`, setState:'Cambiar estado a…', printSel:'Imprimir etiquetas', clearSel:'Quitar selección',
  stateChanged:n=>`Estado cambiado en ${n} unidad${n===1?'':'es'}.`,
  rc_eyebrow:'Recepción de muestras', rc_title:'Recibir muestras',
  f_plr:'PLR', f_plr_ph:'PLR000000', f_plr_help:'Escribe o elige el PLR. Los antiguos FLT-XXXX también sirven.',
  f_plr2:'Otros PLR', f_plr2_help:'Si la misma muestra repite en otro ensayo. Separados por comas.',
  qtpLines:'Ensayos (QTP) por los que pasará', piecesInfo:(p,r)=>`Piezas pedidas en ARAS: <b>${p||'—'}</b> · ya recibidas: <b>${r}</b>`,
  plrUnknown:'Este PLR aún no está en Control de ensayos. Se guarda igual y se enlazará con sus ensayos cuando se importe de ARAS.',
  plrPick:'Elige un PLR para ver sus ensayos.',
  lg_sample:'Muestra', f_desc:'Descripción', f_pn:'Part number', f_phase:'Fase del proyecto', f_project:'Proyecto', f_date:'Fecha de recepción', f_by:'Recibido por', f_loc:'Ubicación', f_loc_ph:'Estantería A2', f_com:'Comentarios',
  lg_units:'Unidades y numeración', f_qty:'Número de unidades',
  nextCode:c=>`Se asignará <b class="mono">${c}</b>. Cada unidad lleva su sufijo (-1, -2…) y su propia etiqueta.`,
  u_code:'Código', u_sn:'Nº serie', u_state:'Estado', u_loc:'Ubicación', u_note:'Nota', u_lbl:'Etiqueta',
  save:'Guardar', savePrint:'Guardar e imprimir etiquetas', cancel:'Cancelar', close:'Cerrar',
  errPlr:'Indica el PLR.', errDesc:'Escribe la descripción de la muestra.', errQty:'Tiene que haber al menos una unidad.',
  saved:c=>`Recepción ${c} guardada.`,
  lot_eyebrow:c=>`Recepción ${c}`, addUnit:'+ Añadir unidad', allTo:'Todas a…', withdraw:'Retirar', restore:'Recuperar',
  printed:'Impresa', notPrintedS:'Pendiente', history:'Historial', del:'Eliminar recepción', delArm:'Pulsa otra vez para eliminar',
  deleted:c=>`Recepción ${c} eliminada. Su número no se vuelve a usar.`, unitsHelp:'Las unidades retiradas conservan su número: no se reutiliza. Una unidad nueva recibe el siguiente sufijo libre.',
  linked:'Ensayos enlazados', printLot:'Imprimir etiquetas',
  log_recv:n=>`Recibida (${n} ud${n===1?'':'s'}.)`, log_state:(c,a,b)=>`${c}: ${a} → ${b}`, log_add:c=>`${c} añadida`, log_rm:c=>`${c} retirada`, log_back:c=>`${c} recuperada`, log_edit:'Datos de la recepción editados', log_print:n=>`${n} etiqueta${n===1?'':'s'} impresa${n===1?'':'s'}`,
  lb_eyebrow:'Etiquetas · DYMO LabelWriter 550', lb_title:n=>`Imprimir ${n} etiqueta${n===1?'':'s'}`, lb_units:'Unidades', lb_all:'Todas', lb_noneSel:'Ninguna',
  lb_size:'Etiqueta', lb_code:'Código', qr:'QR (abre la muestra en la app)', bar:'Código de barras (Code 128)', noCode:'Sin código',
  lb_show:'Contenido', lb_plr:'PLR · QTP', lb_desc:'Descripción', lb_proj:'Proyecto', lb_phase:'Fase del proyecto', lb_date:'Fecha de recepción',
  lb_preview:'Vista previa a tamaño real',
  lb_how:'<b>En el cuadro de impresión:</b> impresora <b>DYMO LabelWriter 550</b>, tamaño de papel el de la etiqueta (p. ej. <i>99012 Large Address</i>), márgenes <b>ninguno</b>, escala <b>100 %</b> y sin encabezados ni pies de página. Sale una etiqueta por página.',
  lb_print:'Imprimir', lb_done:n=>`${n} etiqueta${n===1?'':'s'} enviada${n===1?'':'s'} a la impresora.`, lb_empty:'Marca al menos una unidad.', lb_noLib:'No se ha podido cargar la librería del código. Revisa la conexión.',
  prop_h:n=>`Códigos por validar · ${n} PLR`, prop_help:'PLR activos con piezas pedidas en ARAS que aún no tienen código. Revisa la propuesta y valida: los números FLS se asignan al validar y las unidades quedan pendientes de recibir.',
  prop_all:'Validar todos', prop_ok:'Validar', prop_okPrint:'Validar e imprimir etiquetas', prop_skip:'Descartar',
  prop_mode:'Piezas', prop_plr:'Las mismas para todo el PLR', prop_line:'Distintas por QTP',
  prop_code:'Código', prop_qtp:'Ensayos (QTP)', prop_units:'Unidades', prop_desc:'Descripción',
  propDone:n=>`${n} código${n===1?'':'s'} FLS creado${n===1?'':'s'}.`, propNone:'No hay ninguna unidad que generar.',
  propSkipped:p=>`${p} descartado. Puedes generar sus códigos más tarde desde su tarjeta.`,
  gen:'Generar códigos', gen_eyebrow:'Códigos de muestra desde ARAS', gen_title:p=>`Generar códigos · ${p}`,
  gen_help:n=>n?`Este PLR ya tiene ${n} unidad${n===1?'':'es'} con código. La propuesta cubre las piezas de ARAS que faltan; ajusta las unidades si hace falta.`:'La propuesta sale de las piezas pedidas en ARAS; ajusta las unidades si hace falta.',
  recvExp:n=>`✓ Marcar recibidas (${n})`, recvDone:n=>`${n} unidad${n===1?'':'es'} marcada${n===1?'':'s'} como recibida${n===1?'':'s'}.`,
  expN:n=>`${n} pendiente${n===1?'':'s'} de recibir`,
  impProp:n=>`${n} PLR con códigos de muestra por validar.`, impGo:'Ir a Muestras',
  log_gen:n=>`Códigos generados desde ARAS (${n} ud${n===1?'':'s'}.)`,
  ed_title:p=>`Muestras de ${p}`, ed_none:'Aún no se ha recibido ninguna muestra de este PLR.', chip:(r,p)=>p?`Muestras ${r}/${p}`:`Muestras ${r}`, notFound:c=>`No hay ninguna muestra ${c}.`
},
en:{
  tab:'Samples', title:'Samples',
  search:'Search or scan: FLS, PLR, QTP, project, serial no.…',
  byPlr:'By PLR', list:'List', lang:'Language',
  receive:'+ Receive samples', labels:n=>`Labels${n?` · ${n} to print`:''}`,
  k_inlab:'In the lab', k_inlab_s:'units received, not returned',
  k_wait:'Waiting', k_wait_s:'received, test not started',
  k_test:'Under test', k_test_s:'units in a test',
  k_done:'Tested', k_done_s:'to decide: store, return or scrap',
  k_miss:'PLRs missing samples', k_miss_s:'pieces still to receive',
  k_lbl:'Labels to print', k_lbl_s:'units without a label',
  show:'Show:', phaseAll:'All phases', onlyMissing:'Only PLRs missing samples',
  st:{expected:'Expected',received:'Received',waiting:'Waiting',testing:'Under test',tested:'Tested',stored:'Stored',returned:'Returned',scrapped:'Scrapped'},
  removed:'Withdrawn',
  recvOf:(a,b)=>`of ${b} received`, recvN:'received',
  missing:n=>`${n} sample${n===1?'':'s'} missing`, complete:'All samples in', none:'Not received yet', extra:n=>`${n} extra`,
  closedPlr:'Tests closed', legacy:'Old reference (FLT): not in Control de ensayos',
  alsoIn:p=>`also in ${p}`, noLots:'No samples have arrived yet.', hiddenN:n=>`${n} reception${n===1?'':'s'} hidden by the filter`,
  by:'by', units:n=>`${n} unit${n===1?'':'s'}`, notPrinted:'no label', receiveFor:'+ Receive',
  noMatch:'No samples match the filter.', noPlr:'No PLRs match the filter.',
  empty_h:'No samples or tests yet', empty_p:'Import the ARAS export in Import ARAS: each PLR will show up here, ready to receive its samples. You can also receive samples for a PLR by typing it.',
  c_sample:'Sample', c_plr:'PLR · QTP', c_desc:'Description', c_proj:'Project', c_phase:'Project phase', c_state:'Status', c_pn:'Part number', c_sn:'Serial no.', c_loc:'Location', c_recv:'Received', c_com:'Comments',
  several:'several', expandAll:'Expand all', collapseAll:'Collapse all', listHelp:'Each reception (FLS-xxxxx) groups its units (-1, -2…). Change the status of a unit in the table; everything else by opening the reception.',
  selN:n=>`${n} unit${n===1?'':'s'} selected`, setState:'Set status to…', printSel:'Print labels', clearSel:'Clear selection',
  stateChanged:n=>`Status changed on ${n} unit${n===1?'':'s'}.`,
  rc_eyebrow:'Sample reception', rc_title:'Receive samples',
  f_plr:'PLR', f_plr_ph:'PLR000000', f_plr_help:'Type or pick the PLR. Old FLT-XXXX references also work.',
  f_plr2:'Other PLRs', f_plr2_help:'When the same sample is used again in another request. Comma separated.',
  qtpLines:'Tests (QTP) it will go through', piecesInfo:(p,r)=>`Pieces requested in ARAS: <b>${p||'—'}</b> · already received: <b>${r}</b>`,
  plrUnknown:'This PLR is not in Control de ensayos yet. It is saved anyway and linked to its tests when it is imported from ARAS.',
  plrPick:'Pick a PLR to see its tests.',
  lg_sample:'Sample', f_desc:'Description', f_pn:'Part number', f_phase:'Project phase', f_project:'Project', f_date:'Reception date', f_by:'Received by', f_loc:'Location', f_loc_ph:'Shelf A2', f_com:'Comments',
  lg_units:'Units and numbering', f_qty:'Number of units',
  nextCode:c=>`It will get <b class="mono">${c}</b>. Each unit gets its suffix (-1, -2…) and its own label.`,
  u_code:'Code', u_sn:'Serial no.', u_state:'Status', u_loc:'Location', u_note:'Note', u_lbl:'Label',
  save:'Save', savePrint:'Save and print labels', cancel:'Cancel', close:'Close',
  errPlr:'Enter the PLR.', errDesc:'Enter the sample description.', errQty:'There must be at least one unit.',
  saved:c=>`Reception ${c} saved.`,
  lot_eyebrow:c=>`Reception ${c}`, addUnit:'+ Add unit', allTo:'Set all to…', withdraw:'Withdraw', restore:'Restore',
  printed:'Printed', notPrintedS:'Pending', history:'History', del:'Delete reception', delArm:'Press again to delete',
  deleted:c=>`Reception ${c} deleted. Its number is not used again.`, unitsHelp:'Withdrawn units keep their number: it is never reused. A new unit gets the next free suffix.',
  linked:'Linked tests', printLot:'Print labels',
  log_recv:n=>`Received (${n} unit${n===1?'':'s'})`, log_state:(c,a,b)=>`${c}: ${a} → ${b}`, log_add:c=>`${c} added`, log_rm:c=>`${c} withdrawn`, log_back:c=>`${c} restored`, log_edit:'Reception details edited', log_print:n=>`${n} label${n===1?'':'s'} printed`,
  lb_eyebrow:'Labels · DYMO LabelWriter 550', lb_title:n=>`Print ${n} label${n===1?'':'s'}`, lb_units:'Units', lb_all:'All', lb_noneSel:'None',
  lb_size:'Label', lb_code:'Code', qr:'QR (opens the sample in the app)', bar:'Barcode (Code 128)', noCode:'No code',
  lb_show:'Content', lb_plr:'PLR · QTP', lb_desc:'Description', lb_proj:'Project', lb_phase:'Project phase', lb_date:'Reception date',
  lb_preview:'Preview at real size',
  lb_how:'<b>In the print dialog:</b> printer <b>DYMO LabelWriter 550</b>, paper size of the label (e.g. <i>99012 Large Address</i>), margins <b>none</b>, scale <b>100%</b> and no headers or footers. One label per page.',
  lb_print:'Print', lb_done:n=>`${n} label${n===1?'':'s'} sent to the printer.`, lb_empty:'Tick at least one unit.', lb_noLib:'Could not load the code library. Check the connection.',
  prop_h:n=>`Codes to validate · ${n} PLR${n===1?'':'s'}`, prop_help:'Active PLRs with pieces requested in ARAS that have no code yet. Check the proposal and validate: the FLS numbers are assigned when you validate, and the units wait to be received.',
  prop_all:'Validate all', prop_ok:'Validate', prop_okPrint:'Validate and print labels', prop_skip:'Dismiss',
  prop_mode:'Pieces', prop_plr:'Same for the whole PLR', prop_line:'Different per QTP',
  prop_code:'Code', prop_qtp:'Tests (QTP)', prop_units:'Units', prop_desc:'Description',
  propDone:n=>`${n} FLS code${n===1?'':'s'} created.`, propNone:'There are no units to create.',
  propSkipped:p=>`${p} dismissed. You can create its codes later from its card.`,
  gen:'Create codes', gen_eyebrow:'Sample codes from ARAS', gen_title:p=>`Create codes · ${p}`,
  gen_help:n=>n?`This PLR already has ${n} unit${n===1?'':'s'} with a code. The proposal covers the ARAS pieces still missing; change the units if needed.`:'The proposal comes from the pieces requested in ARAS; change the units if needed.',
  recvExp:n=>`✓ Mark received (${n})`, recvDone:n=>`${n} unit${n===1?'':'s'} marked as received.`,
  expN:n=>`${n} expected`,
  impProp:n=>`${n} PLR${n===1?'':'s'} with sample codes to validate.`, impGo:'Go to Samples',
  log_gen:n=>`Codes created from ARAS (${n} unit${n===1?'':'s'})`,
  ed_title:p=>`Samples of ${p}`, ed_none:'No samples of this PLR have been received yet.', chip:(r,p)=>p?`Samples ${r}/${p}`:`Samples ${r}`, notFound:c=>`There is no sample ${c}.`
}};
let SMP_LANG='es'; try{SMP_LANG=localStorage.getItem('tl.lang')==='en'?'en':'es';}catch(e){}
const tx=(k,...a)=>{const v=SMP_I18N[SMP_LANG][k]??SMP_I18N.es[k]??k; return typeof v==='function'?v(...a):v;};
const smpSt=s=>tx('st')[s]||s;
S.samples=[];
S.smp={sv:'plr',sst:new Set(SMP_DEFAULT),phase:'',onlyMissing:false,collapsed:new Set(),sel:new Set(),edit:null,rc:null,lb:null,prop:{}};
try{if(localStorage.getItem('tl.smp.view')==='list') S.smp.sv='list';}catch(e){}

/* Helpers */
const smpLive=l=>(l.units||[]).filter(u=>!u.removed);
const smpIn=l=>smpLive(l).filter(u=>u.state!=='expected');   // units physically received
const smpCode=(l,u)=>`${l.code}-${u.n}`;
const smpKey=(l,u)=>`${l.id}:${u.n}`;
const smpByKey=k=>{const [id,n]=String(k).split(':'); const l=S.samples.find(x=>x.id===id); const u=l&&(l.units||[]).find(x=>x.n===+n); return l&&u?{l,u}:null;};
const smpPlrKey=p=>String(p||'').trim().toUpperCase();
const smpBySeq=(a,b)=>(+a.sequence||99)-(+b.sequence||99)||String(a.qtp).localeCompare(String(b.qtp));
const smpTestsOfPlr=p=>S.tests.filter(x=>smpPlrKey(x.plr)===smpPlrKey(p)).sort(smpBySeq);
/* Tests of a reception: the ones ticked at reception; for a PLR with none ticked (e.g. imported from ARAS later), all of its tests. */
function smpLotTests(l){
  const ids=new Set(l.tests||[]);
  return (l.plrs||[]).flatMap(p=>{const all=smpTestsOfPlr(p), picked=all.filter(x=>ids.has(x.id)); return picked.length?picked:all;});
}
/* Pieces a PLR expects: its lines share the samples (the largest number of pieces of a line), unless its receptions are
   split per QTP line, as "different per QTP" creates them: then each line brings its own pieces. */
function smpPieces(p){
  const ts=smpTestsOfPlr(p), ids=new Set(ts.map(x=>x.id)), own=new Set();
  S.samples.filter(l=>(l.plrs||[]).includes(smpPlrKey(p))).forEach(l=>{const mine=(l.tests||[]).filter(id=>ids.has(id)); if(mine.length===1) own.add(mine[0]);});
  return own.size>1?ts.reduce((a,x)=>a+(+x.pieces||0),0):Math.max(0,...ts.map(x=>+x.pieces||0));
}
const smpRecv=p=>S.samples.filter(l=>(l.plrs||[]).includes(smpPlrKey(p))).reduce((a,l)=>a+smpIn(l).length,0);
const smpNum=l=>+((String(l.code||'').match(/\d{5}/)||[0])[0]);
const smpNextSeq=()=>Math.max(+((S.cfg.samples||{}).seq)||0,0,...S.samples.map(smpNum))+1;
const smpFmtCode=n=>`FLS-${String(n).padStart(5,'0')}`;
const smpLegacy=p=>/^FLT/i.test(p);
const smpWho=id=>id?(personById(id)?.nombre||id):'';
const smpLogTxt=e=>e.txt&&e.txt.k?tx(e.txt.k,...(e.txt.a||[]).map(x=>x&&x.st?smpSt(x.st):x)):String(e.txt||'');
const smpLog=(k,...a)=>({at:nowIso(),by:GH.login||'',txt:{k,a}});
const smpProj=p=>projCell({project:p});
const smpPhase=p=>{ if(!p) return '<span class="muted">—</span>'; const i=SMP_PHASES.indexOf(p);
  if(p==='N/A'||i<0) return `<span class="phase na">${esc(p)}</span>`;
  return `<span class="phase" title="${esc(p)}"><span class="p5" aria-hidden="true">${[0,1,2,3,4].map(k=>`<i class="${k<=i?'on':''}"></i>`).join('')}</span>${esc(p)}</span>`;};
const smpChipU=(l,u)=>`<i class="u st-${SMP_CLS[u.state]}${u.removed?' rm':''}${!u.printed&&!u.removed?' np':''}" title="${esc(smpCode(l,u))} · ${esc(u.removed?tx('removed'):smpSt(u.state))}${!u.printed&&!u.removed?' · '+esc(tx('notPrinted')):''}">${u.n}</i>`;
function smpSummary(l){
  const L=smpLive(l), c={}; L.forEach(u=>c[u.state]=(c[u.state]||0)+1);
  const keys=SMP.filter(s=>c[s]);
  return `<div class="ssum"><div class="sbar">${keys.map(s=>`<i class="st-${SMP_CLS[s]}" style="flex:${c[s]}"></i>`).join('')}</div>${keys.map(s=>`<span class="st-${SMP_CLS[s]}">${c[s]} ${esc(smpSt(s))}</span>`).join('')}${(l.units||[]).length>L.length?`<small>${(l.units||[]).length-L.length} ${esc(tx('removed').toLowerCase())}</small>`:''}</div>`;
}
function smpMatch(l,q){ if(!q) return true; q=norm(q);
  return [l.code,l.desc,l.pn,l.project,l.loc,l.comments,smpWho(l.by),...(l.plrs||[]),...(l.units||[]).flatMap(u=>[smpCode(l,u),u.serial,u.loc,u.note]),...smpLotTests(l).flatMap(x=>[x.qtp,x.title])].some(v=>norm(v).includes(q)); }
const smpInState=l=>smpLive(l).some(u=>S.smp.sst.has(u.state));
const smpVisible=l=>smpInState(l)&&(!S.smp.phase||l.phase===S.smp.phase)&&smpMatch(l,S.q);
function smpGroups(){
  const M=new Map(), get=p=>{p=smpPlrKey(p); if(!M.has(p)) M.set(p,{plr:p,tests:[],lots:[]}); return M.get(p);};
  S.tests.forEach(x=>{ if(x.plr) get(x.plr).tests.push(x); });
  S.samples.forEach(l=>(l.plrs||[]).forEach(p=>get(p).lots.push(l)));
  return [...M.values()].map(g=>{ g.tests.sort(smpBySeq);
    g.active=g.tests.some(x=>ACTIVE.includes(x.status)&&x.status!=='Not approved'); g.legacy=!g.tests.length;
    g.pieces=smpPieces(g.plr); g.recv=g.lots.reduce((a,l)=>a+smpIn(l).length,0); g.exp=g.lots.flatMap(l=>smpLive(l).filter(u=>u.state==='expected').map(u=>smpKey(l,u)));
    g.project=(g.tests[0]||{}).project||(g.lots[0]||{}).project||''; g.requester=(g.tests[0]||{}).requester||'';
    g.rc=g.legacy?'rc-legacy':!g.active?'rc-closed':g.recv===0?'rc-none':g.pieces&&g.recv<g.pieces?'rc-part':'rc-ok';
    g.rank=g.legacy?4:!g.active?3:g.rc==='rc-ok'?2:g.rc==='rc-part'?0:1; return g;});
}
function smpKpis(){
  const U=S.samples.flatMap(smpLive), n=s=>U.filter(u=>u.state===s).length;
  return {inlab:U.filter(u=>!['expected','returned','scrapped'].includes(u.state)).length,wait:n('received')+n('waiting'),test:n('testing'),done:n('tested'),
    miss:smpGroups().filter(g=>g.active&&g.pieces>g.recv).length,lbl:U.filter(u=>!u.printed).length};
}
const smpMissingCount=()=>smpGroups().filter(g=>g.active&&g.pieces>g.recv).length;
const smpPending=()=>S.samples.flatMap(l=>smpLive(l).filter(u=>!u.printed).map(u=>smpKey(l,u)));

/* ---------- Codes from the ARAS requests ----------
   Every active PLR with pieces in ARAS and no codes gets a proposal: one reception for the whole PLR when its QTP lines
   share the samples, or one per line when each line has its own pieces (the default when the lines ask for different
   numbers of pieces). A proposal takes no number: the next free FLS numbers go to it when someone validates it. */
const smpCfg=()=>S.cfg.samples||{};
const smpSkipped=p=>!!(smpCfg().skip||{})[smpPlrKey(p)];
const smpLines=p=>smpTestsOfPlr(p).filter(x=>ACTIVE.includes(x.status)&&x.status!=='Not approved'&&+x.pieces>0);
function smpProposal(p){
  p=smpPlrKey(p); const st=S.smp.prop[p]||{}, ls=smpLines(p), all=smpTestsOfPlr(p), t0=all[0]||{};
  const mode=ls.length>1?(st.mode||(new Set(ls.map(x=>+x.pieces)).size>1?'line':'plr')):'plr';
  const lots=S.samples.filter(l=>(l.plrs||[]).includes(p)), units=ls2=>ls2.reduce((a,l)=>a+smpLive(l).length,0);
  const groups=mode==='line'
    ?ls.map(x=>({key:x.id,tests:[x.id],qtps:[x.qtp],desc:x.title||t0.project||p,need:Math.max(0,+x.pieces-units(lots.filter(l=>(l.tests||[]).includes(x.id))))}))
    :[(src=>({key:'plr',tests:src.map(x=>x.id),qtps:src.map(x=>x.qtp),desc:[...new Set(src.map(x=>x.title).filter(Boolean))].join(' / ')||t0.project||p,
        need:Math.max(0,Math.max(0,...ls.map(x=>+x.pieces))-units(lots))}))(ls.length?ls:all)];
  // A forced proposal (button on the card) offers one unit when ARAS asks for nothing more.
  const none=!groups.some(g=>g.need);
  groups.forEach((g,i)=>{const q=(st.qty||{})[g.key]; g.qty=q!=null?q:st.force&&none&&!i?1:g.need;});
  return {plr:p,mode,canSplit:ls.length>1,groups,project:t0.project||'',requester:t0.requester||'',have:units(lots)};
}
const smpProposals=()=>smpGroups().filter(g=>g.active&&!g.legacy&&!smpSkipped(g.plr)).map(g=>smpProposal(g.plr)).filter(P=>P.groups.some(g=>g.need>0));
/* One proposal; next.n numbers the preview in the order shown. */
function smpPropBlock(P,next){
  const rows=P.groups.map(g=>{const n=g.qty>0?next.n++:0;
    return `<tr><td class="ref nowrap">${n?esc(smpFmtCode(n))+(g.qty>1?`-1…${g.qty}`:'-1'):'<span class="muted">—</span>'}</td><td>${esc(g.qtps.join(' · ')||'—')}</td>
      <td><input type="number" min="0" max="200" data-pq="${esc(P.plr)}|${esc(g.key)}" value="${g.qty}" aria-label="${esc(tx('prop_units'))} ${esc(g.qtps.join(' '))}"></td><td>${esc(g.desc)}</td></tr>`;}).join('');
  return `<div class="prop"><div class="prop-h"><b class="ref">${esc(P.plr)}</b>${smpProj(P.project)}${P.requester?`<span class="muted">${esc(tx('by'))} ${esc(P.requester)}</span>`:''}
      ${P.canSplit?`<span class="sp"></span><span class="muted" style="font-size:13px">${esc(tx('prop_mode'))}</span><div class="seg" role="group" aria-label="${esc(tx('prop_mode'))}"><button type="button" data-sa="prop-mode" data-plr="${esc(P.plr)}" data-m="plr" aria-pressed="${P.mode==='plr'}">${esc(tx('prop_plr'))}</button><button type="button" data-sa="prop-mode" data-plr="${esc(P.plr)}" data-m="line" aria-pressed="${P.mode==='line'}">${esc(tx('prop_line'))}</button></div>`:''}</div>
    <div class="scroll-x"><table class="utbl"><thead><tr><th>${esc(tx('prop_code'))}</th><th>${esc(tx('prop_qtp'))}</th><th>${esc(tx('prop_units'))}</th><th>${esc(tx('prop_desc'))}</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
const smpPropActs=p=>`<button type="button" class="btn sm ghost" data-sa="prop-skip" data-plr="${esc(p)}">${esc(tx('prop_skip'))}</button><span class="sp"></span><button type="button" class="btn sm" data-sa="prop-ok" data-plr="${esc(p)}">${esc(tx('prop_ok'))}</button><button type="button" class="btn sm primary" data-sa="prop-ok-print" data-plr="${esc(p)}">🏷 ${esc(tx('prop_okPrint'))}</button>`;
function smpPropPanel(){
  if(S.ro||S.noDb) return ''; const Ps=smpProposals(); if(!Ps.length) return '';
  const next={n:smpNextSeq()};
  return `<details class="panel smp-prop" open><summary class="panel-h"><h2>${esc(tx('prop_h',Ps.length))}</h2><span class="muted">${esc(tx('prop_help'))}</span><span class="sp"></span>${Ps.length>1?`<button type="button" class="btn sm primary" data-sa="prop-all">${esc(tx('prop_all'))}</button>`:''}</summary>
    <div class="prop-list">${Ps.map(P=>`<div class="prop-item">${smpPropBlock(P,next)}<div class="row">${smpPropActs(P.plr)}</div></div>`).join('')}</div></details>`;
}
/* Validating creates the receptions with consecutive numbers and the counter in one commit; the units wait as "expected". */
async function smpValidate(plrs,print){
  if(S.ro||!db) return;
  let n=smpNextSeq()-1, made=0; const now=nowIso(), jobs=[], keys=[], skip={...(smpCfg().skip||{})};
  for(const p of plrs){ const P=smpProposal(p);
    for(const g of P.groups){ if(!(g.qty>0)) continue; n++; made++; const id=rid();
      const units=Array.from({length:g.qty},(_,i)=>({n:i+1,state:'expected',serial:'',loc:'',note:'',removed:false,printed:false}));
      jobs.push(db.doc(`${COL.samples}/${id}`).set({code:smpFmtCode(n),plrs:[P.plr],tests:g.tests,desc:g.desc,pn:'',phase:'',project:P.project,received:'',by:'',loc:'',comments:'',
        units,source:'ARAS',log:[smpLog('log_gen',g.qty)],created:now,updated:now}));
      units.forEach(u=>keys.push(`${id}:${u.n}`)); }
    delete skip[P.plr]; delete S.smp.prop[P.plr]; }
  if(!made) return toast(tx('propNone'));
  jobs.push(db.doc('config/samples').set({...smpCfg(),seq:n,skip,updated:now}));
  try{await Promise.all(jobs); if(dlg.open&&dlg.dataset.kind==='smp-gen') dlg.close(); toast(tx('propDone',made)); render(); if(print) smpOpenLabels(keys);}
  catch(e){toast(errMsg(e));}
}
async function smpSkip(p){
  if(S.ro||!db) return; p=smpPlrKey(p);
  try{await db.doc('config/samples').set({...smpCfg(),skip:{...(smpCfg().skip||{}),[p]:true},updated:nowIso()}); delete S.smp.prop[p]; toast(tx('propSkipped',p)); render();}catch(e){toast(errMsg(e));}
}
/* "Create codes" on a PLR card: the same proposal in a dialog, also for a dismissed PLR or one ARAS has changed. */
function smpOpenGen(p){
  if(S.ro) return; p=smpPlrKey(p); S.smp.prop[p]={...(S.smp.prop[p]||{}),force:true};
  dlg.dataset.kind='smp-gen'; dlg.dataset.id=p; smpGenRender(); if(!dlg.open) dlg.showModal();
}
function smpGenRender(){
  const P=smpProposal(dlg.dataset.id);
  dlg.innerHTML=smpShell(tx('gen_eyebrow'),tx('gen_title',P.plr),`<p class="note">${esc(tx('gen_help',P.have))}</p>${smpPropBlock(P,{n:smpNextSeq()})}`,
    `<span class="sp"></span><button type="button" class="btn ghost" data-act="close">${esc(tx('cancel'))}</button><button type="button" class="btn" data-sa="prop-ok" data-plr="${esc(P.plr)}">${esc(tx('prop_ok'))}</button><button type="button" class="btn primary" data-sa="prop-ok-print" data-plr="${esc(P.plr)}">🏷 ${esc(tx('prop_okPrint'))}</button>`);
}
const smpPropRerender=()=>dlg.open&&dlg.dataset.kind==='smp-gen'?smpGenRender():render();

/* Board cards and the test editor show the samples of the PLR. */
function smpTestChip(t){
  if(!t.plr) return ''; const p=smpPieces(t.plr), r=smpRecv(t.plr); if(!p&&!r) return '';
  return `<span class="chip smp-chip ${p&&r<p&&counts(t)?'warn':''}" title="${esc(tx('ed_title',t.plr))}">📦 ${esc(tx('chip',r,p))}</span>`;
}
function smpEditorBlock(t){
  if(!t||!t.plr) return '';
  const lots=S.samples.filter(l=>(l.plrs||[]).includes(smpPlrKey(t.plr))).sort((a,b)=>a.code.localeCompare(b.code));
  const p=smpPieces(t.plr), r=smpRecv(t.plr);
  return `<div><div class="row" style="margin-bottom:6px"><p class="eyebrow">${esc(tx('ed_title',t.plr))} · ${r}${p?` / ${p}`:''}</p><span class="sp"></span>${S.ro?'':`<button type="button" class="btn sm" data-sa="receive" data-plr="${esc(t.plr)}">${esc(tx('receiveFor'))}</button>`}</div>
    ${lots.length?`<div class="lots">${lots.map(l=>smpLotBtn(l,t.plr)).join('')}</div>`:`<p class="note">${esc(tx('ed_none'))}</p>`}</div>`;
}
function smpLotBtn(l,plr){
  const others=(l.plrs||[]).filter(p=>p!==smpPlrKey(plr));
  return `<button type="button" class="lot" data-sa="lot" data-id="${esc(l.id)}"><span class="ref">${esc(l.code)}</span><span class="ds">${esc(l.desc)}</span>${smpPhase(l.phase)}
    <span class="m2"><span class="uchips">${(l.units||[]).map(u=>smpChipU(l,u)).join('')}</span><span>${esc(tx('units',smpLive(l).length))}</span>${others.length?`<span class="chip">${esc(tx('alsoIn',others.join(', ')))}</span>`:''}<span>${fmt(l.received)}</span>${l.loc?`<span>📍 ${esc(l.loc)}</span>`:''}</span></button>`;
}

/* ---------- Samples view ---------- */
function vSamples(){
  const k=smpKpis(), V=S.smp;
  $('#smp-plr-list').innerHTML=[...new Map(S.tests.filter(x=>x.plr).map(x=>[smpPlrKey(x.plr),x])).values()].map(x=>`<option value="${esc(smpPlrKey(x.plr))}">${esc(projectNo(x))} · ${esc(x.title||'')}</option>`).join('');
  $('#smp-loc-list').innerHTML=[...new Set(S.samples.flatMap(l=>[l.loc,...(l.units||[]).map(u=>u.loc)]).filter(Boolean))].sort().map(v=>`<option value="${esc(v)}">`).join('');
  if(!S.tests.length&&!S.samples.length) return `<div class="empty"><p class="eyebrow">${esc(tx('title'))}</p><h3>${esc(tx('empty_h'))}</h3><p>${esc(tx('empty_p'))}</p>
    <div class="row">${S.ro||S.noDb?'':`<button class="btn primary" data-view="import">Import ARAS</button><button class="btn" data-sa="receive">${esc(tx('receive'))}</button>`}${smpLangSeg()}</div></div>`;
  const kpi=(act,lab,val,sub,cls='')=>`<button class="kpi ${cls}" data-sa="kpi" data-k="${act}"><span class="eyebrow">${esc(lab)}</span><b>${val}</b><span class="muted">${esc(sub)}</span></button>`;
  const chips=SMP.map(s=>`<button type="button" class="chipbtn st-${SMP_CLS[s]}" data-sa="sst" data-s="${s}" aria-pressed="${V.sst.has(s)}">${esc(smpSt(s))}</button>`).join('');
  return `<div class="view-h smp-h"><h2>${esc(tx('title'))}</h2>
    <input class="search" id="q" type="search" placeholder="${esc(tx('search'))}" value="${esc(S.q)}" aria-label="${esc(tx('search'))}">
    <div class="seg" role="group" aria-label="${esc(tx('title'))}"><button data-sa="sv" data-v="plr" aria-pressed="${V.sv==='plr'}">${esc(tx('byPlr'))}</button><button data-sa="sv" data-v="list" aria-pressed="${V.sv==='list'}">${esc(tx('list'))}</button></div>
    ${smpLangSeg()}
    <button class="btn" data-sa="labels-pending">🏷 ${esc(tx('labels',k.lbl))}</button>
    ${S.ro?'':`<button class="btn primary" data-sa="receive">${esc(tx('receive'))}</button>`}</div>
  ${smpPropPanel()}
  <section class="kpis">
    ${kpi('inlab',tx('k_inlab'),k.inlab,tx('k_inlab_s'))}
    ${kpi('wait',tx('k_wait'),k.wait,tx('k_wait_s'))}
    ${kpi('test',tx('k_test'),k.test,tx('k_test_s'))}
    ${kpi('done',tx('k_done'),k.done,tx('k_done_s'),k.done?'warn':'')}
    ${kpi('miss',tx('k_miss'),k.miss,tx('k_miss_s'),k.miss?'crit':'')}
    ${kpi('lbl',tx('k_lbl'),k.lbl,tx('k_lbl_s'),k.lbl?'warn':'')}
  </section>
  <div class="row smp-filters" role="group" aria-label="${esc(tx('show'))}"><span class="muted" style="font-size:13px">${esc(tx('show'))}</span>${chips}
    <select class="fsel" id="smp-phase" aria-label="${esc(tx('c_phase'))}"><option value="">${esc(tx('phaseAll'))}</option>${SMP_PHASES.map(p=>`<option ${V.phase===p?'selected':''}>${p}</option>`).join('')}</select>
    ${V.sv==='plr'?`<label class="check" style="font-size:13px"><input type="checkbox" id="smp-only-missing" ${V.onlyMissing?'checked':''}> ${esc(tx('onlyMissing'))}</label>`:''}</div>
  ${V.sv==='plr'?smpByPlr():smpList()}`;
}
const smpLangSeg=()=>`<div class="seg" role="group" aria-label="${esc(tx('lang'))}"><button data-sa="lang" data-l="es" aria-pressed="${SMP_LANG==='es'}">ES</button><button data-sa="lang" data-l="en" aria-pressed="${SMP_LANG==='en'}">EN</button></div>`;
function smpByPlr(){
  const q=S.q, V=S.smp;
  const gs=smpGroups().filter(g=>{
    const lotsOk=g.lots.filter(smpVisible);
    if(V.onlyMissing&&!(g.active&&g.pieces>g.recv)) return false;
    if(V.phase&&!lotsOk.length) return false;
    const textOk=!q||[g.plr,g.project,g.requester,...g.tests.flatMap(x=>[x.qtp,x.title])].some(v=>norm(v).includes(norm(q)))||g.lots.some(l=>smpMatch(l,q));
    if(!textOk) return false;
    return g.active||lotsOk.length;
  }).sort((a,b)=>a.rank-b.rank||b.plr.localeCompare(a.plr));
  if(!gs.length) return `<div class="empty-ok">${esc(tx('noPlr'))}</div>`;
  return `<div class="pgrid">${gs.map(smpCard).join('')}</div>`;
}
function smpCard(g){
  const V=S.smp, shown=g.lots.filter(l=>smpInState(l)&&(!V.phase||l.phase===V.phase)).sort((a,b)=>a.code.localeCompare(b.code)), hidden=g.lots.length-shown.length;
  const pct=g.pieces?Math.min(100,g.recv/g.pieces*100):(g.recv?100:0);
  const status=g.legacy?`<span class="wtag mut">${esc(tx('legacy'))}</span>`
    :!g.active?`<span class="wtag mut">${esc(tx('closedPlr'))}</span>`
    :g.recv===0?`<span class="wtag crit">${esc(tx('none'))}</span>`
    :g.pieces&&g.recv<g.pieces?`<span class="wtag">${esc(tx('missing',g.pieces-g.recv))}</span>`
    :g.pieces&&g.recv>g.pieces?`<span class="wtag mut">${esc(tx('extra',g.recv-g.pieces))}</span>`:`<span class="wtag ok">${esc(tx('complete'))}</span>`;
  return `<article class="pcard ${g.rc}">
    <div class="pc-h"><div class="who"><span class="plr">${esc(g.plr)}</span><div class="chips">${smpProj(g.project)}</div>${g.requester?`<span class="by">${esc(tx('by'))} ${esc(g.requester)}</span>`:''}</div>
      <div class="recv"><b>${g.recv}</b>${g.pieces?` / ${g.pieces}`:''}<br>${esc(g.pieces?tx('recvOf',g.recv,g.pieces):tx('recvN'))}<div class="prog"><span style="width:${pct}%"></span></div></div></div>
    ${g.tests.length?`<ol class="qlines">${g.tests.map(x=>`<li><span class="seq">${esc(x.sequence||'·')}</span><button type="button" class="link ref" data-act="edit" data-id="${esc(x.id)}">${esc(x.qtp)}</button><span class="tt" title="${esc(x.title)}">${esc(x.title)}</span>${estPill(x.status)}${resTag(x.result)}</li>`).join('')}</ol>`:''}
    <div class="lots">${shown.map(l=>smpLotBtn(l,g.plr)).join('')||(g.lots.length?'':`<p class="note">${esc(tx('noLots'))}</p>`)}${hidden?`<span class="hidden-n">${esc(tx('hiddenN',hidden))}</span>`:''}</div>
    <div class="pc-f">${status}${g.exp.length?`<span class="wtag mut">${esc(tx('expN',g.exp.length))}</span>`:''}<span class="sp"></span>${g.legacy||S.ro?'':`${g.exp.length?`<button class="btn sm primary" data-sa="recv-exp" data-plr="${esc(g.plr)}">${esc(tx('recvExp',g.exp.length))}</button>`:''}<button class="btn sm" data-sa="gen" data-plr="${esc(g.plr)}">${esc(tx('gen'))}</button><button class="btn sm" data-sa="receive" data-plr="${esc(g.plr)}">${esc(tx('receiveFor'))}</button>`}</div>
  </article>`;
}
function smpList(){
  const V=S.smp, lots=S.samples.filter(smpVisible).sort((a,b)=>b.code.localeCompare(a.code));
  const st=(u,k,c)=>u.removed?`<span class="rm-tag">${esc(tx('removed'))}</span>`:S.ro?`<span class="pill est st-${SMP_CLS[u.state]}">${esc(smpSt(u.state))}</span>`
    :`<select class="st-sel st-${SMP_CLS[u.state]}" data-setunit="${esc(k)}" aria-label="${esc(tx('c_state'))} ${esc(c)}">${SMP.map(s=>`<option value="${s}" ${s===u.state?'selected':''}>${esc(smpSt(s))}</option>`).join('')}</select>`;
  const rows=lots.map(l=>{
    const open=!V.collapsed.has(l.id), L=smpLive(l), allSel=L.length&&L.every(u=>V.sel.has(smpKey(l,u)));
    const serials=[...new Set(L.map(u=>u.serial).filter(Boolean))], qtps=smpLotTests(l).map(x=>x.qtp);
    const head=`<tr class="lot-row click" data-sa="lot" data-id="${esc(l.id)}">
      <td class="ck"><input type="checkbox" data-sellot="${esc(l.id)}" ${allSel?'checked':''} aria-label="${esc(l.code)}"></td>
      <td class="nowrap"><button type="button" class="tog" data-sa="tog" data-id="${esc(l.id)}" aria-expanded="${open}" aria-label="${esc(open?tx('collapseAll'):tx('expandAll'))}"><span>▾</span></button><span class="ref"><b>${esc(l.code)}</b></span><small style="padding-left:20px">${esc(tx('units',L.length))}</small></td>
      <td><div class="chips">${(l.plrs||[]).map(p=>`<span class="chip">${esc(p)}</span>`).join('')}</div><small>${esc(qtps.join(' · ')||'—')}</small></td>
      <td><b>${esc(l.desc)}</b></td>
      <td>${smpProj(l.project)}</td>
      <td>${smpPhase(l.phase)}</td>
      <td>${smpSummary(l)}</td>
      <td class="mono">${esc(l.pn||'—')}</td>
      <td class="mono">${serials.length>1?`<span class="muted">${esc(tx('several'))}</span>`:esc(serials[0]||'—')}</td>
      <td>${esc(l.loc||'—')}</td>
      <td class="nowrap">${fmt(l.received)}<small>${esc(smpWho(l.by))}</small></td>
      <td>${l.comments?`<span class="snip" title="${esc(l.comments)}">${esc(l.comments)}</span>`:''}</td></tr>`;
    const units=open?(l.units||[]).map(u=>{const k=smpKey(l,u), c=smpCode(l,u);
      return `<tr class="unit-row click ${u.removed?'rm':'strow st-'+SMP_CLS[u.state]}" data-sa="lot" data-id="${esc(l.id)}">
      <td class="ck">${u.removed?'':`<input type="checkbox" data-sel="${esc(k)}" ${V.sel.has(k)?'checked':''} aria-label="${esc(c)}">`}</td>
      <td class="ref nowrap u-code"><b>${esc(c)}</b>${!u.printed&&!u.removed?`<span class="np-tag">${esc(tx('notPrinted'))}</span>`:''}</td>
      <td colspan="4"><span class="snip muted">${esc(u.note||'')}</span></td>
      <td>${st(u,k,c)}</td><td></td><td class="mono">${esc(u.serial||'')}</td><td>${esc(u.loc||'')}</td><td></td><td></td></tr>`;}).join(''):'';
    return head+units;}).join('');
  const nsel=V.sel.size;
  return `${nsel?`<div class="selbar"><span>${esc(tx('selN',nsel))}</span>${S.ro?'':`<select class="fsel" id="smp-sel-state"><option value="">${esc(tx('setState'))}</option>${SMP.map(s=>`<option value="${s}">${esc(smpSt(s))}</option>`).join('')}</select>`}<button class="btn sm" data-sa="print-sel">🏷 ${esc(tx('printSel'))}</button><button class="btn sm ghost" data-sa="clear-sel">${esc(tx('clearSel'))}</button></div>`:''}
  <section class="panel"><div class="panel-h"><h2>${lots.length} · ${esc(tx('title').toLowerCase())}</h2><span class="muted">${esc(tx('listHelp'))}</span><button class="btn sm ghost" data-sa="tog-all">${esc(V.collapsed.size?tx('expandAll'):tx('collapseAll'))}</button></div>
  ${lots.length?`<div class="scroll-x"><table class="tbl compact smp-tbl"><thead><tr><th class="ck"></th><th>${esc(tx('c_sample'))}</th><th>${esc(tx('c_plr'))}</th><th>${esc(tx('c_desc'))}</th><th>${esc(tx('c_proj'))}</th><th>${esc(tx('c_phase'))}</th><th>${esc(tx('c_state'))}</th><th>${esc(tx('c_pn'))}</th><th>${esc(tx('c_sn'))}</th><th>${esc(tx('c_loc'))}</th><th>${esc(tx('c_recv'))}</th><th>${esc(tx('c_com'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="empty-ok">${esc(tx('noMatch'))}</div>`}
  </section>`;
}

/* ---------- Samples dialogs ---------- */
function smpShell(eyebrow,title,body,footer){
  return `<form class="dlg-form" id="dlg-form" novalidate><header class="dlg-h"><div><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2></div><button type="button" class="icon-btn" data-act="close" aria-label="${esc(tx('close'))}">×</button></header>
  <div class="dlg-body">${body}<div id="f-err" class="form-err" hidden></div></div><footer class="dlg-f">${footer}</footer></form>`;
}
const smpPeople=()=>[['',''],...[...S.people].sort(byName).map(p=>[p.id,p.nombre])];
const smpSplit=s=>[...new Set(String(s||'').split(/[,;\s]+/).map(smpPlrKey).filter(Boolean))];
const smpFd=()=>{const fd=new FormData($('#dlg-form')); return {fd,g:k=>String(fd.get(k)||'').trim()};};

function smpOpenReceive(plr){
  if(S.ro) return;
  S.smp.rc={units:[{serial:'',note:''}],qtyTouched:false};
  dlg.dataset.kind='smp-rc'; dlg.dataset.id='';
  const body=`<fieldset><legend>${esc(tx('f_plr'))}</legend>
      ${fld('f-plr',esc(tx('f_plr')),inp('plr',plr||'','text',`list="smp-plr-list" placeholder="${esc(tx('f_plr_ph'))}" autocomplete="off"`),'req',esc(tx('f_plr_help')))}
      ${fld('f-plr2',esc(tx('f_plr2')),inp('plr2','','text','placeholder="PLR003707, FLT-0179"'),'',esc(tx('f_plr2_help')))}
      <div class="span2" id="smp-rc-plr"></div></fieldset>
    <fieldset><legend>${esc(tx('lg_sample'))}</legend>
      ${fld('f-desc',esc(tx('f_desc')),inp('desc',''),'req span2')}
      ${fld('f-pn',esc(tx('f_pn')),inp('pn',''))}
      ${fld('f-phase',esc(tx('f_phase')),sel('phase','',[['',''],...SMP_PHASES]))}
      ${fld('f-project',esc(tx('f_project')),inp('project','','text','placeholder="25046 - PROJECT NAME"'))}
      ${fld('f-received',esc(tx('f_date')),inp('received',iso(todayMs()),'date'))}
      ${fld('f-by',esc(tx('f_by')),sel('by','',smpPeople()))}
      ${fld('f-loc',esc(tx('f_loc')),inp('loc','','text',`list="smp-loc-list" placeholder="${esc(tx('f_loc_ph'))}"`))}
      ${fld('f-comments',esc(tx('f_com')),`<textarea id="f-comments" name="comments"></textarea>`,'span2')}</fieldset>
    <fieldset><legend>${esc(tx('lg_units'))}</legend>
      <div class="field"><label for="smp-qty">${esc(tx('f_qty'))}</label><div class="qty"><button type="button" data-sa="qty" data-d="-1" aria-label="−">−</button><input id="smp-qty" type="number" min="1" max="200" value="1"><button type="button" data-sa="qty" data-d="1" aria-label="+">+</button></div></div>
      <p class="note span2">${tx('nextCode',smpFmtCode(smpNextSeq()))}</p>
      <div class="span2 scroll-x" id="smp-rc-units"></div></fieldset>`;
  dlg.innerHTML=smpShell(tx('rc_eyebrow'),tx('rc_title'),body,`<span class="sp"></span><button type="button" class="btn ghost" data-act="close">${esc(tx('cancel'))}</button><button class="btn" type="submit">${esc(tx('save'))}</button><button class="btn primary" type="button" data-sa="rc-save-print">🏷 ${esc(tx('savePrint'))}</button>`);
  if(!dlg.open) dlg.showModal();
  smpRcPlr(); smpRcUnits(); (plr?$('#f-desc'):$('#f-plr')).focus();
}
function smpRcPlr(){
  const p=smpPlrKey($('#f-plr').value), box=$('#smp-rc-plr');
  if(!p){box.innerHTML=`<p class="note">${esc(tx('plrPick'))}</p>`; return;}
  const ts=smpTestsOfPlr(p);
  if(!ts.length){box.innerHTML=`<p class="note">${esc(smpLegacy(p)?tx('legacy'):tx('plrUnknown'))}</p>`; return;}
  const pieces=smpPieces(p), recv=smpRecv(p);
  box.innerHTML=`<div class="plr-box"><div class="row"><b>${esc(p)}</b>${smpProj(ts[0].project)}<span class="by">${esc(tx('by'))} ${esc(ts[0].requester||'—')}</span></div>
    <span class="eyebrow">${esc(tx('qtpLines'))}</span>
    <ol class="qlines">${ts.map(x=>`<li><label><input type="checkbox" name="tests" value="${esc(x.id)}" ${ACTIVE.includes(x.status)?'checked':''}><span class="seq">${esc(x.sequence||'·')}</span><span class="ref">${esc(x.qtp)}</span><span class="tt">${esc(x.title||'')}</span></label>${estPill(x.status)}</li>`).join('')}</ol>
    <span class="note">${tx('piecesInfo',pieces,recv)}</span></div>`;
  if(!$('#f-project').value) $('#f-project').value=ts[0].project||'';
  if(!S.smp.rc.qtyTouched){ const n=Math.max(1,(pieces||1)-recv); $('#smp-qty').value=n; smpRcResize(n); }
}
function smpRcResize(n){ n=Math.max(1,Math.min(200,parseInt(n)||1)); const U=S.smp.rc.units; while(U.length<n) U.push({serial:'',note:''}); U.length=n; smpRcUnits(); }
function smpRcUnits(){
  const c=smpFmtCode(smpNextSeq());
  $('#smp-rc-units').innerHTML=`<table class="utbl"><thead><tr><th>${esc(tx('u_code'))}</th><th>${esc(tx('u_sn'))}</th><th>${esc(tx('u_note'))}</th></tr></thead><tbody>${S.smp.rc.units.map((u,i)=>`<tr><td class="ref nowrap">${c}-${i+1}</td><td><input data-rcu="${i}" data-f="serial" value="${esc(u.serial)}" aria-label="${esc(tx('u_sn'))} ${i+1}"></td><td><input data-rcu="${i}" data-f="note" value="${esc(u.note)}" aria-label="${esc(tx('u_note'))} ${i+1}"></td></tr>`).join('')}</tbody></table>`;
}
async function smpSaveReceive(print){
  if(S.ro||!db) return;
  const {fd,g}=smpFd(), p1=smpPlrKey(g('plr'));
  if(!p1) return formErr(tx('errPlr'));
  if(!g('desc')) return formErr(tx('errDesc'));
  if(!S.smp.rc.units.length) return formErr(tx('errQty'));
  const n=smpNextSeq(), code=smpFmtCode(n), id=rid(), now=nowIso();
  const units=S.smp.rc.units.map((u,i)=>({n:i+1,state:'received',serial:u.serial.trim(),loc:'',note:u.note.trim(),removed:false,printed:false}));
  const data={code,plrs:[...new Set([p1,...smpSplit(g('plr2'))])],tests:fd.getAll('tests').map(String),desc:g('desc'),pn:g('pn'),phase:g('phase'),project:g('project'),
    received:g('received')||iso(todayMs()),by:g('by'),loc:g('loc'),comments:g('comments'),units,log:[smpLog('log_recv',units.length)],created:now,updated:now};
  try{
    /* The reception and the counter go in the same commit. */
    await Promise.all([db.doc(`${COL.samples}/${id}`).set(data),db.doc('config/samples').set({...smpCfg(),seq:n,updated:now})]);
    dlg.close(); toast(tx('saved',code)); render();
    if(print) smpOpenLabels(units.map(u=>`${id}:${u.n}`));
  }catch(e){formErr(errMsg(e));}
}

function smpOpenLot(id,focusN){
  const l=S.samples.find(x=>x.id===id); if(!l) return;
  S.smp.edit=clone(l); dlg.dataset.kind='smp-lot'; dlg.dataset.id=id;
  const tests=smpLotTests(l), unlinked=(l.plrs||[]).filter(p=>!smpLegacy(p)&&!smpTestsOfPlr(p).length);
  const body=`<fieldset><legend>${esc(tx('lg_sample'))}</legend>
      ${fld('f-desc',esc(tx('f_desc')),inp('desc',l.desc),'req span2')}
      ${fld('f-plrs',esc(tx('f_plr')),inp('plrs',(l.plrs||[]).join(', ')),'',esc(tx('f_plr2_help')))}
      ${fld('f-pn',esc(tx('f_pn')),inp('pn',l.pn))}
      ${fld('f-phase',esc(tx('f_phase')),sel('phase',l.phase,[['',''],...SMP_PHASES]))}
      ${fld('f-project',esc(tx('f_project')),inp('project',l.project))}
      ${fld('f-received',esc(tx('f_date')),inp('received',l.received,'date'))}
      ${fld('f-by',esc(tx('f_by')),sel('by',l.by,[...smpPeople(),...(l.by&&!personById(l.by)?[[l.by,l.by]]:[])]))}
      ${fld('f-loc',esc(tx('f_loc')),inp('loc',l.loc,'text','list="smp-loc-list"'))}
      ${fld('f-comments',esc(tx('f_com')),`<textarea id="f-comments" name="comments" ${dis()}>${esc(l.comments||'')}</textarea>`,'span2')}</fieldset>
    <fieldset><legend>${esc(tx('lg_units'))}</legend><div class="span2 scroll-x" id="smp-lot-units"></div>
      ${S.ro?'':`<div class="span2 row"><button type="button" class="btn sm" data-sa="add-unit">${esc(tx('addUnit'))}</button>
        <select class="fsel" id="smp-all-to" aria-label="${esc(tx('allTo'))}"><option value="">${esc(tx('allTo'))}</option>${SMP.map(s=>`<option value="${s}">${esc(smpSt(s))}</option>`).join('')}</select>
        <span class="note">${esc(tx('unitsHelp'))}</span></div>`}</fieldset>
    <div><p class="eyebrow" style="margin-bottom:6px">${esc(tx('linked'))}</p>
      ${tests.length?`<ol class="qlines">${tests.map(x=>`<li><span class="seq">${esc(x.sequence||'·')}</span><button type="button" class="link ref" data-act="edit" data-id="${esc(x.id)}">${esc(x.plr)} · ${esc(x.qtp)}</button><span class="tt">${esc(x.title||'')}</span>${estPill(x.status)}${resTag(x.result)}</li>`).join('')}</ol>`:''}
      ${(l.plrs||[]).filter(smpLegacy).map(p=>`<p class="note">${esc(p)} · ${esc(tx('legacy'))}</p>`).join('')}
      ${unlinked.map(p=>`<p class="note">${esc(p)} · ${esc(tx('plrUnknown'))}</p>`).join('')}</div>
    <details><summary>${esc(tx('history'))} (${(l.log||[]).length})</summary><ul class="log">${[...(l.log||[])].reverse().map(e=>`<li><time>${fmt(String(e.at||'').slice(0,10))}</time>${esc(smpLogTxt(e))}${e.by?` <span class="muted">· ${esc(e.by)}</span>`:''}</li>`).join('')}</ul></details>`;
  dlg.innerHTML=smpShell(tx('lot_eyebrow',l.code),l.desc,body,`${S.ro?'':`<button type="button" class="btn ghost danger" data-sa="del">${esc(tx('del'))}</button>`}<button type="button" class="btn" data-sa="print-lot">🏷 ${esc(tx('printLot'))}</button><span class="sp"></span><button type="button" class="btn ghost" data-act="close">${esc(S.ro?tx('close'):tx('cancel'))}</button>${S.ro?'':`<button class="btn primary" type="submit">${esc(tx('save'))}</button>`}`);
  if(!dlg.open) dlg.showModal();
  smpLotUnits();
  if(focusN){const el=dlg.querySelector(`[data-un="${focusN}"][data-f="state"]`); if(el) el.focus();}
}
function smpLotUnits(){
  const l=S.smp.edit;
  $('#smp-lot-units').innerHTML=`<table class="utbl"><thead><tr><th>${esc(tx('u_code'))}</th><th>${esc(tx('u_state'))}</th><th>${esc(tx('u_sn'))}</th><th>${esc(tx('u_loc'))}</th><th>${esc(tx('u_note'))}</th><th>${esc(tx('u_lbl'))}</th><th></th></tr></thead><tbody>${(l.units||[]).map(u=>`<tr class="${u.removed?'rm':''}">
    <td class="ref nowrap">${esc(smpCode(l,u))}</td>
    <td>${u.removed?`<span class="rm-tag">${esc(tx('removed'))}</span>`:`<select class="st-sel st-${SMP_CLS[u.state]}" data-un="${u.n}" data-f="state" ${dis()}>${SMP.map(s=>`<option value="${s}" ${s===u.state?'selected':''}>${esc(smpSt(s))}</option>`).join('')}</select>`}</td>
    <td><input data-un="${u.n}" data-f="serial" value="${esc(u.serial)}" aria-label="${esc(tx('u_sn'))}" ${dis()}></td>
    <td><input data-un="${u.n}" data-f="loc" value="${esc(u.loc)}" list="smp-loc-list" placeholder="${esc(l.loc||'')}" aria-label="${esc(tx('u_loc'))}" ${dis()}></td>
    <td><input data-un="${u.n}" data-f="note" value="${esc(u.note)}" aria-label="${esc(tx('u_note'))}" ${dis()}></td>
    <td class="nowrap">${u.removed?'':u.printed?`<span class="wtag ok">${esc(tx('printed'))}</span>`:`<span class="wtag">${esc(tx('notPrintedS'))}</span>`}</td>
    <td>${S.ro?'':`<button type="button" class="btn sm ghost ${u.removed?'':'danger'}" data-sa="${u.removed?'restore-unit':'rm-unit'}" data-n="${u.n}">${esc(u.removed?tx('restore'):tx('withdraw'))}</button>`}</td></tr>`).join('')}</tbody></table>`;
}
async function smpSaveLot(){
  if(S.ro||!db) return;
  const old=S.samples.find(x=>x.id===dlg.dataset.id); if(!old) return;
  const {g}=smpFd();
  if(!g('desc')) return formErr(tx('errDesc'));
  const plrs=smpSplit(g('plrs')); if(!plrs.length) return formErr(tx('errPlr'));
  const e=S.smp.edit, log=[];
  const fields={desc:g('desc'),pn:g('pn'),phase:g('phase'),project:g('project'),received:g('received'),by:g('by'),loc:g('loc'),comments:g('comments')};
  if(Object.keys(fields).some(k=>String(old[k]||'')!==fields[k])||plrs.join()!==(old.plrs||[]).join()) log.push(smpLog('log_edit'));
  for(const u of e.units){ const o=(old.units||[]).find(x=>x.n===u.n), c=smpCode(e,u);
    if(!o){log.push(smpLog('log_add',c)); continue;}
    if(u.removed&&!o.removed) log.push(smpLog('log_rm',c));
    else if(!u.removed&&o.removed) log.push(smpLog('log_back',c));
    else if(u.state!==o.state) log.push(smpLog('log_state',c,{st:o.state},{st:u.state})); }
  /* Removing a PLR from the reception drops its ticked tests. */
  const keep=new Set(S.tests.filter(x=>plrs.includes(smpPlrKey(x.plr))).map(x=>x.id));
  if(!fields.received&&e.units.some(u=>u.state!=='expected'&&!u.removed&&((old.units||[]).find(x=>x.n===u.n)||{}).state==='expected')) fields.received=iso(todayMs());
  const patch={...fields,plrs,units:e.units.map(({n,state,serial,loc,note,removed,printed})=>({n,state,serial:String(serial||'').trim(),loc:String(loc||'').trim(),note:String(note||'').trim(),removed:!!removed,printed:!!printed})),
    tests:(old.tests||[]).filter(id=>keep.has(id)),log:[...(old.log||[]),...log],updated:nowIso()};
  try{await db.doc(`${COL.samples}/${old.id}`).update(patch); dlg.close(); toast(tx('saved',old.code));}catch(err){formErr(errMsg(err));}
}
async function smpDeleteLot(btn){
  if(!btn.classList.contains('armed')){btn.classList.add('armed'); btn.textContent=tx('delArm'); return;}
  const l=S.samples.find(x=>x.id===dlg.dataset.id); if(!l) return;
  try{await db.doc(`${COL.samples}/${l.id}`).delete(); [...S.smp.sel].forEach(k=>{if(k.startsWith(l.id+':')) S.smp.sel.delete(k);}); dlg.close(); toast(tx('deleted',l.code));}catch(e){formErr(errMsg(e));}
}
/* Status changes from the table: one update per reception, all saved in the same commit. */
async function smpSetStates(keys,state){
  if(S.ro||!db) return;
  const by=new Map(); keys.map(smpByKey).filter(Boolean).forEach(({l,u})=>{ if(!by.has(l)) by.set(l,[]); by.get(l).push(u.n); });
  const jobs=[...by].map(([l,ns])=>{const log=[]; let arrived=false; const units=(l.units||[]).map(u=>{ if(!ns.includes(u.n)||u.removed||u.state===state) return u; if(u.state==='expected') arrived=true; log.push(smpLog('log_state',smpCode(l,u),{st:u.state},{st:state})); return {...u,state}; });
    /* The first expected unit that arrives gives the reception its date. */
    return log.length?db.doc(`${COL.samples}/${l.id}`).update({units,log:[...(l.log||[]),...log],...(arrived&&!l.received?{received:iso(todayMs())}:{}),updated:nowIso()}):null;}).filter(Boolean);
  try{await Promise.all(jobs);}catch(e){toast(errMsg(e));}
}

/* ---------- Labels (DYMO LabelWriter 550) ----------
   The browser prints them with @page set to the label size, one label per page: nothing to install. */
const smpLblCfg=()=>{let c={}; try{c=JSON.parse(localStorage.getItem('tl.lbl')||'{}')||{};}catch(e){} return {size:'99012',code:'qr',plr:true,desc:true,proj:true,phase:true,date:true,...c};};
function smpQr(text){
  if(typeof qrcode!=='function') return `<div class="noqr">QR</div>`;
  const q=qrcode(0,'M'); q.addData(text); q.make(); const n=q.getModuleCount(); let p='';
  for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(q.isDark(r,c)) p+=`M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="-1 -1 ${n+2} ${n+2}" shape-rendering="crispEdges" role="img" aria-label="QR"><rect x="-1" y="-1" width="${n+2}" height="${n+2}" fill="#fff"/><path d="${p}" fill="#000"/></svg>`;
}
function smpBarcodes(root){
  root.querySelectorAll('svg[data-bc]').forEach(el=>{
    if(typeof JsBarcode!=='function') return;
    JsBarcode(el,el.dataset.bc,{format:'CODE128',displayValue:false,margin:0,height:60,width:2,background:'#ffffff'});
    const w=parseFloat(el.getAttribute('width')), h=parseFloat(el.getAttribute('height'));
    if(w&&h){el.setAttribute('viewBox',`0 0 ${w} ${h}`); el.removeAttribute('width'); el.removeAttribute('height'); el.setAttribute('preserveAspectRatio','none'); el.style.transform='';}
  });
}
const smpUrl=code=>location.href.split('#')[0]+'#m='+code;
function smpLabel(k,c){
  const x=smpByKey(k); if(!x) return ''; const {l,u}=x, code=smpCode(l,u), sz=SMP_LABELS[c.size]||SMP_LABELS['99012'];
  const qtps=smpLotTests(l).map(y=>y.qtp);
  const l2=[(l.plrs||[]).join(' · '),qtps.length?qtps[0]+(qtps.length>1?` +${qtps.length-1}`:''):''].filter(Boolean).join(' · ');
  const ft=[c.proj&&projectNo(l),c.phase&&l.phase,c.date&&l.received&&fmt(l.received)].filter(Boolean).join(' · ');
  /* Code height that fits the text column: the QR takes a square of the label height, the barcode a strip at the bottom. */
  const textW=sz.w-4.4-(c.code==='qr'?sz.h-3.2+2:0), fs=Math.min(sz.h*(c.code==='bar'?.13:.16),textW/(code.length*.62)).toFixed(2);
  return `<div class="dlbl ${c.code==='bar'?'wbar':''} ${sz.h<=28?'sm':''}" style="width:${sz.w}mm;height:${sz.h}mm;--fs:${fs}mm">
    ${c.code==='qr'?`<div class="qr">${smpQr(smpUrl(code))}</div>`:''}
    <div class="tx"><b class="id">${esc(code)}</b>${c.plr&&l2?`<span class="l2">${esc(l2)}</span>`:''}${c.desc?`<span class="ds">${esc(l.desc)}</span>`:''}${ft?`<span class="ft">${esc(ft)}</span>`:''}</div>
    ${c.code==='bar'?`<svg class="bc" data-bc="${esc(code)}"></svg>`:''}</div>`;
}
function smpOpenLabels(keys){
  keys=keys.filter(smpByKey); S.smp.lb={keys,checked:new Set(keys)}; dlg.dataset.kind='smp-lb'; dlg.dataset.id='';
  dlg.innerHTML=smpShell(tx('lb_eyebrow'),tx('lb_title',keys.length),`<div class="lb-grid"><div class="lb-side" id="smp-lb-side"></div><div><p class="eyebrow" style="margin-bottom:6px">${esc(tx('lb_preview'))}</p><div class="lb-prev" id="smp-lb-prev"></div><p class="note" style="margin-top:10px">${tx('lb_how')}</p></div></div>`,
    `<span class="sp"></span><button type="button" class="btn ghost" data-act="close">${esc(tx('close'))}</button><button type="button" class="btn primary" data-sa="do-print">🖨 ${esc(tx('lb_print'))}</button>`);
  if(!dlg.open) dlg.showModal(); smpLbSide(); smpLbPreview();
}
function smpLbSide(){
  const c=smpLblCfg(), ck=(k,lab)=>`<label><input type="checkbox" data-lbc="${k}" ${c[k]?'checked':''}> ${esc(lab)}</label>`;
  $('#smp-lb-side').innerHTML=`<div class="field"><span class="lbl">${esc(tx('lb_units'))} · <button type="button" class="link" data-sa="lb-all">${esc(tx('lb_all'))}</button> · <button type="button" class="link" data-sa="lb-none">${esc(tx('lb_noneSel'))}</button></span>
      <div class="lb-list">${S.smp.lb.keys.map(k=>{const {l,u}=smpByKey(k); return `<label><input type="checkbox" data-lbk="${esc(k)}" ${S.smp.lb.checked.has(k)?'checked':''}> ${esc(smpCode(l,u))}${u.printed?' ✓':''}</label>`;}).join('')}</div></div>
    ${fld('smp-lb-size',esc(tx('lb_size')),`<select id="smp-lb-size">${Object.entries(SMP_LABELS).map(([k,v])=>`<option value="${k}" ${c.size===k?'selected':''}>${esc(v.n)}</option>`).join('')}</select>`)}
    <div class="field"><span class="lbl">${esc(tx('lb_code'))}</span><div class="checks" style="flex-direction:column;align-items:flex-start">${[['qr',tx('qr')],['bar',tx('bar')],['none',tx('noCode')]].map(([v,lab])=>`<label><input type="radio" name="smp-lb-code" value="${v}" ${c.code===v?'checked':''}> ${esc(lab)}</label>`).join('')}</div></div>
    <div class="field"><span class="lbl">${esc(tx('lb_show'))}</span><div class="checks" style="flex-direction:column;align-items:flex-start">${ck('plr',tx('lb_plr'))}${ck('desc',tx('lb_desc'))}${ck('proj',tx('lb_proj'))}${ck('phase',tx('lb_phase'))}${ck('date',tx('lb_date'))}</div></div>`;
}
function smpLbPreview(){
  const c=smpLblCfg(), keys=S.smp.lb.keys.filter(k=>S.smp.lb.checked.has(k)), p=$('#smp-lb-prev');
  p.innerHTML=keys.length?keys.map(k=>smpLabel(k,c)).join(''):`<p class="note">${esc(tx('lb_empty'))}</p>`;
  smpBarcodes(p);
  const b=dlg.querySelector('[data-sa="do-print"]'); if(b) b.disabled=!keys.length;
  const h=dlg.querySelector('.dlg-h h2'); if(h) h.textContent=tx('lb_title',keys.length);
}
function smpLbSet(k,v){const c=smpLblCfg(); c[k]=v; try{localStorage.setItem('tl.lbl',JSON.stringify(c));}catch(e){} smpLbPreview();}
function smpPrint(){
  const c=smpLblCfg(), keys=S.smp.lb.keys.filter(k=>S.smp.lb.checked.has(k)); if(!keys.length) return toast(tx('lb_empty'));
  if((c.code==='qr'&&typeof qrcode!=='function')||(c.code==='bar'&&typeof JsBarcode!=='function')) toast(tx('lb_noLib'));
  const sz=SMP_LABELS[c.size]||SMP_LABELS['99012'];
  $('#smp-page-size').textContent=`@page{size:${sz.w}mm ${sz.h}mm;margin:0}`;
  const area=$('#smp-print'); area.innerHTML=keys.map(k=>smpLabel(k,c)).join(''); smpBarcodes(area);
  dlg.close();
  setTimeout(()=>{
    window.print(); area.innerHTML='';
    toast(tx('lb_done',keys.length));
    if(S.ro||!db) return;
    /* Printed units stop counting as "labels to print". */
    const by=new Map(); keys.map(smpByKey).filter(Boolean).forEach(({l,u})=>{ if(!by.has(l)) by.set(l,new Set()); by.get(l).add(u.n); });
    Promise.all([...by].map(([l,ns])=>db.doc(`${COL.samples}/${l.id}`).update({units:(l.units||[]).map(u=>ns.has(u.n)?{...u,printed:true}:u),log:[...(l.log||[]),smpLog('log_print',ns.size)]}))).catch(e=>toast(errMsg(e)));
  },60);
}

/* ---------- Samples events (data-sa, so they never reach the main handlers) ---------- */
function smpOpenCode(code){
  code=code.toUpperCase(); const base=code.match(/FLS-\d{5}/)[0], n=+(code.split('-')[2]||0);
  const l=S.samples.find(x=>x.code===base); if(!l) return toast(tx('notFound',code));
  if(S.view!=='samples'&&APP!=='occupancy'){S.view='samples'; render();}
  smpOpenLot(l.id,n||null);
}
function smpFromHash(){const m=decodeURIComponent(location.hash).match(SMP_CODE_RE); if(m&&S.samples.length) smpOpenCode(m[0]);}
window.addEventListener('hashchange',smpFromHash);
document.addEventListener('click',ev=>{
  if(ev.target.closest('input,select,textarea,label')) return;
  const el=ev.target.closest('[data-sa]'); if(!el) return;
  const a=el.dataset.sa, V=S.smp;
  if(a==='receive') smpOpenReceive(el.dataset.plr||'');
  else if(a==='lot') smpOpenLot(el.dataset.id);
  else if(a==='tog'){ev.stopPropagation(); const id=el.dataset.id; V.collapsed.has(id)?V.collapsed.delete(id):V.collapsed.add(id); render();}
  else if(a==='tog-all'){ if(V.collapsed.size) V.collapsed.clear(); else S.samples.forEach(l=>V.collapsed.add(l.id)); render();}
  else if(a==='sv'){V.sv=el.dataset.v; try{localStorage.setItem('tl.smp.view',V.sv);}catch(e){} render();}
  else if(a==='lang'){SMP_LANG=el.dataset.l; try{localStorage.setItem('tl.lang',SMP_LANG);}catch(e){} render();}
  else if(a==='sst'){const s=el.dataset.s; V.sst.has(s)?V.sst.delete(s):V.sst.add(s); render();}
  else if(a==='kpi'){const k=el.dataset.k;
    if(k==='lbl') return smpOpenLabels(smpPending());
    if(k==='miss'){V.sv='plr'; V.onlyMissing=true; V.sst=new Set(SMP_DEFAULT);}
    else {V.sv='list'; V.onlyMissing=false; V.sst=new Set({inlab:SMP_DEFAULT.filter(s=>s!=='expected'),wait:['received','waiting'],test:['testing'],done:['tested']}[k]);}
    render();}
  else if(a==='labels-pending'){const keys=smpPending(); smpOpenLabels(keys.length?keys:[...V.sel]);}
  else if(a==='print-sel') smpOpenLabels([...V.sel]);
  else if(a==='clear-sel'){V.sel.clear(); render();}
  else if(a==='qty'){const i=$('#smp-qty'); i.value=Math.max(1,(parseInt(i.value)||1)+ +el.dataset.d); V.rc.qtyTouched=true; smpRcResize(i.value);}
  else if(a==='rc-save-print'){el.disabled=true; Promise.resolve(smpSaveReceive(true)).finally(()=>{if(el.isConnected) el.disabled=false;});}
  else if(a==='add-unit'){const e=V.edit; e.units.push({n:Math.max(0,...e.units.map(u=>u.n))+1,state:'received',serial:'',loc:'',note:'',removed:false,printed:false}); smpLotUnits();}
  else if(a==='rm-unit'||a==='restore-unit'){const u=V.edit.units.find(x=>x.n===+el.dataset.n); if(u){u.removed=a==='rm-unit'; smpLotUnits();}}
  else if(a==='del') smpDeleteLot(el);
  else if(a==='print-lot'){const l=S.samples.find(x=>x.id===dlg.dataset.id); if(l) smpOpenLabels(smpLive(l).map(u=>smpKey(l,u)));}
  else if(a==='lb-all'){V.lb.checked=new Set(V.lb.keys); smpLbSide(); smpLbPreview();}
  else if(a==='lb-none'){V.lb.checked.clear(); smpLbSide(); smpLbPreview();}
  else if(a==='do-print') smpPrint();
  else if(a==='gen') smpOpenGen(el.dataset.plr);
  else if(a==='prop-mode'){const p=el.dataset.plr; V.prop[p]={...(V.prop[p]||{}),mode:el.dataset.m,qty:{}}; smpPropRerender();}
  else if(a==='prop-ok'||a==='prop-ok-print'){el.disabled=true; Promise.resolve(smpValidate([el.dataset.plr],a==='prop-ok-print')).finally(()=>{if(el.isConnected) el.disabled=false;});}
  else if(a==='prop-all'){ev.preventDefault(); el.disabled=true; Promise.resolve(smpValidate(smpProposals().map(P=>P.plr),false)).finally(()=>{if(el.isConnected) el.disabled=false;});}
  else if(a==='prop-skip') smpSkip(el.dataset.plr);
  else if(a==='recv-exp'){const g=smpGroups().find(x=>x.plr===el.dataset.plr); if(g&&g.exp.length){const n=g.exp.length; smpSetStates(g.exp,'received').then(()=>toast(tx('recvDone',n)));}}
});
document.addEventListener('input',ev=>{
  const el=ev.target;
  if(dlg.dataset.kind==='smp-rc'&&el.id==='f-plr') smpRcPlr();
  else if(el.id==='smp-qty'){S.smp.rc.qtyTouched=true; smpRcResize(el.value);}
  else if(el.dataset.rcu!=null) S.smp.rc.units[+el.dataset.rcu][el.dataset.f]=el.value;
  else if(el.dataset.un&&el.dataset.f!=='state'){const u=S.smp.edit.units.find(x=>x.n===+el.dataset.un); if(u) u[el.dataset.f]=el.value;}
});
document.addEventListener('change',ev=>{
  const el=ev.target, V=S.smp;
  if(el.dataset.setunit) smpSetStates([el.dataset.setunit],el.value);
  else if(el.dataset.sel){el.checked?V.sel.add(el.dataset.sel):V.sel.delete(el.dataset.sel); render();}
  else if(el.dataset.sellot){const l=S.samples.find(x=>x.id===el.dataset.sellot); if(l) smpLive(l).forEach(u=>el.checked?V.sel.add(smpKey(l,u)):V.sel.delete(smpKey(l,u))); render();}
  else if(el.id==='smp-sel-state'&&el.value){const n=V.sel.size; smpSetStates([...V.sel],el.value).then(()=>toast(tx('stateChanged',n)));}
  else if(el.id==='smp-phase'){V.phase=el.value; render();}
  else if(el.id==='smp-only-missing'){V.onlyMissing=el.checked; render();}
  else if(el.dataset.un&&el.dataset.f==='state'){const u=V.edit.units.find(x=>x.n===+el.dataset.un); if(u){u.state=el.value; smpLotUnits();}}
  else if(el.id==='smp-all-to'&&el.value){V.edit.units.forEach(u=>{if(!u.removed) u.state=el.value;}); el.value=''; smpLotUnits();}
  else if(el.dataset.lbk){el.checked?V.lb.checked.add(el.dataset.lbk):V.lb.checked.delete(el.dataset.lbk); smpLbPreview();}
  else if(el.dataset.lbc) smpLbSet(el.dataset.lbc,el.checked);
  else if(el.dataset.pq){const [p,k]=el.dataset.pq.split('|'), st=V.prop[p]=V.prop[p]||{}; st.qty={...(st.qty||{}),[k]:Math.max(0,Math.min(200,parseInt(el.value)||0))}; smpPropRerender();}
  else if(el.id==='smp-lb-size') smpLbSet('size',el.value);
  else if(el.name==='smp-lb-code') smpLbSet('code',el.value);
});
/* A barcode or QR scanner types the code and Enter in the search box: open that sample at once. */
document.addEventListener('keydown',ev=>{
  if(ev.key!=='Enter'||ev.target.id!=='q'||S.view!=='samples') return; const m=String(ev.target.value).match(SMP_CODE_RE); if(!m) return;
  ev.preventDefault(); S.q=''; render(); smpOpenCode(m[0]);
});

/* ---------- Events ---------- */
function setView(v){S.view=v; S.q=''; try{localStorage.setItem(VIEW_KEY,v)}catch(e){} render(); window.scrollTo(0,0);}
document.addEventListener('click',ev=>{
  if(ev.target.closest('.st-sel,.tech-sel,.cell-date')) return;
  const v=ev.target.closest('[data-view]'); if(v){setView(v.dataset.view); return;}
  const t=ev.target.closest('[data-act]'); if(!t) return;
  const a=t.dataset.act, id=t.dataset.id;
  if(a==='new') openEditor(null);
  else if(a==='edit'||a==='open-sib') openEditor(id);
  else if(a==='edit-p') openPerson(id); else if(a==='new-p') openPerson(null);
  else if(a==='edit-b') openEquipment(id); else if(a==='new-b') openEquipment(null);
  else if(a==='edit-q') openQtp(id); else if(a==='new-q') openQtp(null);
  else if(a==='close') dlg.close();
  else if(a==='del') deleteFromDialog(t);
  else if(a==='use-eq'){const s=$('#f-equipmentId'); if(s){s.value=id; liveHints();}}
  else if(a==='zoom'){S.dayW=+t.dataset.z; try{localStorage.setItem('tl.dayW',S.dayW)}catch(e){} render();}
  else if(a==='do-import') runArasImport();
  else if(a==='cancel-import'){S.imp=null; render();}
  else if(a==='sc-all'){const I=S.imp; if(I&&I.P){I.choice=I.choice||{}; I.P.recs.forEach(r=>{if(r._conflict) I.choice[r._conflict.id]=t.dataset.v;}); render();}}
  else if(a==='sc-apply') applyStatusChoices();
  else if(a==='do-qimport') runQtpImport();
  else if(a==='cancel-qimport'){S.qimp=null; render();}
  else if(a==='export') exportXlsx();
  else if(a==='gh') openGh();
  else if(a==='gh-off'){disconnectGh(); dlg.close();}
  else if(a==='sort'){const st=S.sort[t.dataset.table]; if(st.k===t.dataset.k) st.dir=-st.dir; else {st.k=t.dataset.k; st.dir=1;} render();}
  else if(a==='qst'){const s=t.dataset.s; S.qst=S.qst.includes(s)?S.qst.filter(x=>x!==s):[...S.qst,s]; try{localStorage.setItem('tl.qst',JSON.stringify(S.qst))}catch(e){} render();}
  else if(a==='occ-nav'){const dd=+t.dataset.d; S.occ.start=dd===0?mondayOf(todayMs()):(S.occ.start??mondayOf(todayMs()))+dd*7*DAY; render();}
  else if(a==='occ-weeks'){S.occ.weeks=+t.dataset.w; try{localStorage.setItem('tl.occw',S.occ.weeks)}catch(e){} render();}
  else if(a==='occ-cell'){const sl={type:t.dataset.type,id:t.dataset.id,day:+t.dataset.day}; const o=S.occ.sel; S.occ.sel=o&&o.type===sl.type&&o.id===sl.id&&o.day===sl.day?null:sl; render();}
});
document.addEventListener('keydown',ev=>{ if(ev.key==='Enter'&&ev.target.matches('.card[data-act="edit"]')) openEditor(ev.target.dataset.id); });
document.addEventListener('input',ev=>{
  if(ev.target.id==='q'){S.q=ev.target.value; const pos=ev.target.selectionStart; render(); const q=$('#q'); if(q){q.focus(); try{q.setSelectionRange(pos,pos)}catch(e){}}}
  else if(ev.target.id==='fle-q'){const q=norm(ev.target.value); let h=null, any=false; for(const el of $('#fle-list').children){ if(el.tagName==='H4'){ if(h) h.hidden=!any; h=el; any=false; } else { el.hidden=!!q&&!el.dataset.s.includes(q); any=any||!el.hidden; } } if(h) h.hidden=!any;}
  else if(dlg.open&&dlg.contains(ev.target)) liveHints();
});
document.addEventListener('change',ev=>{
  const el=ev.target;
  if(el.id==='file-aras') onFile(el.files[0],'aras');
  else if(el.id==='file-qtp') onFile(el.files[0],'qtp');
  else if(el.dataset.map){const I=el.dataset.kind==='qtp'?S.qimp:S.imp; if(el.value) I.map[el.dataset.map]=el.value; else delete I.map[el.dataset.map]; render();}
  else if(el.dataset.sc){const I=S.imp; if(I){(I.choice||(I.choice={}))[el.dataset.sc]=el.value; render();}}
  else if(el.dataset.eqmap!=null){S.imp.eqMap[el.dataset.eqmap]=el.value; render();}
  else if(el.id==='inc-closed'){S.incClosed=el.checked; render();}
  else if(el.name==='fle'&&dlg.open) $('#fle-sel').innerHTML=fleSel([...dlg.querySelectorAll('input[name="fle"]:checked')].map(x=>x.value));
  else if(el.id==='hide-idle'){S.hideIdle=el.checked; try{localStorage.setItem('tl.hideIdle',S.hideIdle?'1':'0')}catch(e){} render();}
  else if(el.id==='hist-st'){S.hist.st=el.value; render();}
  else if(el.id==='hist-res'){S.hist.res=el.value; render();}
  else if(el.dataset.setstatus){setStatus(el.dataset.setstatus,el.value);}
  else if(el.dataset.settech!=null){setTech(el.dataset.settech,el.value);}
  else if(el.dataset.setdate){setDate(el.dataset.setdate,el.dataset.field,el.value);}
  else if(dlg.open&&dlg.contains(el)){
    if(el.id==='f-profile'){const en=el.value==='endurance'; $('#endu-fields').hidden=!en; $('#even-fields').hidden=en;}
    if(el.id==='f-qtp'&&!$('#f-title').value){const L=S.qtps.find(q=>q.id===qid(el.value)); if(L&&L.name) $('#f-title').value=L.name;}
    liveHints();
  }
});
document.addEventListener('submit',ev=>{ if(ev.target.id!=='dlg-form') return; ev.preventDefault();
  const b=ev.target.querySelector('button[type="submit"]'), label=b&&b.textContent; if(b&&b.disabled) return;
  if(b&&dlg.dataset.kind!=='gh'){b.disabled=true; b.textContent='Saving…';}
  Promise.resolve(saveDialog()).finally(()=>{ if(b&&dlg.open&&dlg.dataset.kind!=='gh'){b.disabled=false; b.textContent=label;} }); });
/* file drag and drop */
const dzOf=ev=>ev.target.closest&&ev.target.closest('[data-dz]');
document.addEventListener('dragover',ev=>{const z=dzOf(ev); if(z&&ev.dataTransfer&&[...ev.dataTransfer.types].includes('Files')){ev.preventDefault(); z.classList.add('over');}});
document.addEventListener('dragleave',ev=>{const z=dzOf(ev); if(z) z.classList.remove('over');});
document.addEventListener('drop',ev=>{const z=dzOf(ev); if(z&&ev.dataTransfer.files.length){ev.preventDefault(); z.classList.remove('over'); onFile(ev.dataTransfer.files[0],z.dataset.dz);}});
/* board drag and drop */
let dragId=null;
document.addEventListener('dragstart',ev=>{const c=ev.target.closest&&ev.target.closest('.card'); if(c&&!S.ro){dragId=c.dataset.id; ev.dataTransfer.effectAllowed='move'; try{ev.dataTransfer.setData('text/plain',dragId)}catch(e){}}});
document.addEventListener('dragover',ev=>{const col=ev.target.closest&&ev.target.closest('[data-drop]'); if(col&&dragId){ev.preventDefault(); document.querySelectorAll('.drop').forEach(x=>x!==col&&x.classList.remove('drop')); col.classList.add('drop');}});
document.addEventListener('drop',async ev=>{
  const col=ev.target.closest&&ev.target.closest('[data-drop]'); if(!col||!dragId) return; ev.preventDefault();
  const id=dragId, status=col.dataset.drop; dragId=null; col.classList.remove('drop');
  setStatus(id,status);
});
document.addEventListener('dragend',()=>{dragId=null; document.querySelectorAll('.drop').forEach(x=>x.classList.remove('drop'));});
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1); if(VIEWS.some(x=>x[0]===h)) setView(h);});

/* ---------- Storage: one JSON file in the private data repository Polinya-LAB/lab-data (folder ensayos/) ----------
   Reading ensayos.json needs the key (token) of an account with read access; saving needs write access;
   every save is a commit. The key is shared with the durability pool app (same site, same browser storage). */
const APP_NAME=APP==='occupancy'?'Ocupación':APP==='samples'?'Muestras':'Control de ensayos';
const REPO={owner:'Polinya-LAB',repo:'lab-data',branch:'main',path:'ensayos/ensayos.json'};
const CAL_PATH='calibraciones/calibraciones.json';
const API=`https://api.github.com/repos/${REPO.owner}/${REPO.repo}`;
const RAW=`https://raw.githubusercontent.com/${REPO.owner}/${REPO.repo}/${REPO.branch}/${REPO.path}`;
const TOKEN_KEY='pd-gh-token', DATA_COLS=['tests','personas','bancos','qtps','config','muestras'];
const GH={token:'',login:null,push:false,invalid:false,saving:false};
try{GH.token=localStorage.getItem(TOKEN_KEY)||'';}catch(e){}
const remote={data:null,sha:null,etag:null};
/* Preview copy in new-projects: reads the real data from lab-data with the GitHub key but never writes to it; changes stay
   in this page until it is reloaded. Without a key it can run on the example data of demo-data.js, kept in this browser.
   Remove these lines (PREVIEW, DEMO and what uses them) in the copy that goes to management-tools. */
const PREVIEW=false, DEMO_KEY=APP==='samples'?'smp.preview.demo':'ce.preview.demo', DEMO_DATA_KEY=DEMO_KEY+'.data';
let DEMO=false; try{DEMO=!!window.CE_DEMO&&localStorage.getItem(DEMO_KEY)==='1';}catch(e){}
function demoLoad(){let s=null; try{s=JSON.parse(localStorage.getItem(DEMO_DATA_KEY)||'null');}catch(e){} return normData(s||window.CE_DEMO());}
function demoSave(){try{localStorage.setItem(DEMO_DATA_KEY,JSON.stringify(remote.data));}catch(e){}}
async function setDemo(on,reset){
  DEMO=!!on&&!!window.CE_DEMO; try{localStorage.setItem(DEMO_KEY,DEMO?'1':'0'); if(reset||!DEMO) localStorage.removeItem(DEMO_DATA_KEY);}catch(e){}
  Object.assign(remote,{data:null,sha:null,etag:null}); S.imp=null; S.qimp=null; S.ro=true; if(dlg.open) dlg.close();
  await refresh(); render(); toast(DEMO?(reset?'Example data reset.':'Preview with example data.'):'Example data closed.');
}
document.addEventListener('click',ev=>{const b=ev.target.closest('[data-pv]'); if(!b) return; const a=b.dataset.pv;
  if(a==='demo-on') setDemo(true); else if(a==='demo-reset') setDemo(true,true); else if(a==='demo-off'){ setDemo(false); if(!GH.token) openGh(); }});
let local=null, flushTimer=null, flushing=null;
const pendingOps=[], subs=new Map();
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const rid=()=>Array.from(crypto.getRandomValues(new Uint8Array(10)),x=>'abcdefghijklmnopqrstuvwxyz0123456789'[x%36]).join('');
const b64encode=str=>{const bytes=new TextEncoder().encode(str); let bin=''; for(let i=0;i<bytes.length;i+=0x8000) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); return btoa(bin);};
const b64decode=b=>new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g,'')),c=>c.charCodeAt(0)));
const ghFetch=(url,opts={})=>fetch(url,{cache:'no-store',...opts,headers:{Accept:'application/vnd.github+json',...(GH.token?{Authorization:`Bearer ${GH.token}`}:{}),...(opts.headers||{})}});
const httpError=res=>{const limited=res.status===429||(res.status===403&&res.headers.get('x-ratelimit-remaining')==='0'); return {code:res.status===401?'auth':limited?'rate':(res.status===403||res.status===404)?'forbidden':'unavailable',status:res.status};};
const emptyData=()=>Object.fromEntries(DATA_COLS.map(c=>[c,{}]));
const normData=x=>{const o=emptyData(); for(const c of DATA_COLS) if(x&&x[c]&&typeof x[c]==='object') o[c]=x[c]; return o;};

async function fetchApi(useEtag){
  const res=await ghFetch(`${API}/contents/${REPO.path}?ref=${REPO.branch}`,useEtag&&remote.etag?{headers:{'If-None-Match':remote.etag}}:{});
  if(res.status===304) return null;
  if(res.status===404) throw {code:'private',status:404};
  if(!res.ok) throw httpError(res);
  const j=await res.json(); let text;
  if(j.content) text=b64decode(j.content);
  else{const blob=await ghFetch(`${API}/git/blobs/${j.sha}`); if(!blob.ok) throw httpError(blob); text=b64decode((await blob.json()).content);}
  return {data:normData(JSON.parse(text)),sha:j.sha,etag:res.headers.get('etag')};
}
async function loadCal(){
  if(!GH.token||GH.invalid){CAL.err='auth'; return;}
  try{
    const res=await ghFetch(`${API}/contents/${CAL_PATH}?ref=${REPO.branch}`); if(!res.ok) throw httpError(res);
    const j=await res.json(); let text;
    if(j.content) text=b64decode(j.content);
    else{const blob=await ghFetch(`${API}/git/blobs/${j.sha}`); if(!blob.ok) throw httpError(blob); text=b64decode((await blob.json()).content);}
    CAL.eq=JSON.parse(text).equipment||{}; CAL.err=null;
  }catch(err){CAL.err=err.code||'unavailable';}
  render();
}
async function fetchRaw(){
  const res=await fetch(`${RAW}?t=${Date.now()}`,{cache:'no-store'});
  if(res.status===404) throw {code:'private',status:404};
  if(!res.ok) throw httpError(res);
  return {data:normData(await res.json()),sha:null,etag:null};
}
/* Applies writes to a copy of the data and skips updates to documents someone else deleted. */
function applyOps(data,ops){
  for(const o of ops){const c=data[o.col]||(data[o.col]={});
    if(o.op==='set') c[o.id]=clone(o.data);
    else if(o.op==='update'){ if(c[o.id]) Object.assign(c[o.id],clone(o.data)); }
    else if(o.op==='delete') delete c[o.id];}
  return data;
}
function snapOf(col){const docs=Object.entries((local&&local[col])||{}).map(([id,v])=>({id,exists:true,data:()=>clone(v),metadata:{}})); return {docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{}};}
function emitAll(){ if(!local) return; for(const [col,set] of subs) for(const fn of set){ try{fn(snapOf(col));}catch(e){console.error(e);} } }
function recompute(){ local=applyOps(clone(remote.data||emptyData()),pendingOps.map(p=>p.op)); emitAll(); }
function commitMessage(ops){
  const label=o=>{const d={...((remote.data||{})[o.col]||{})[o.id],...(o.data||{})};
    if(o.col==='tests') return `${d.plr||'—'} · ${d.qtp||'—'}`; if(o.col==='qtps'||o.col==='muestras') return d.code||o.id; if(o.col==='bancos'||o.col==='personas') return d.nombre||o.id; return o.id;};
  if(ops.length===1){const o=ops[0], verb=o.op==='delete'?'delete':o.op==='set'&&!((remote.data||{})[o.col]||{})[o.id]?'add':'update';
    const old=((remote.data||{})[o.col]||{})[o.id]||{}, fields=o.op==='update'?Object.keys(o.data).filter(k=>!['updated','actualizado','imported'].includes(k)&&JSON.stringify(old[k]??'')!==JSON.stringify(o.data[k]??'')):[];
    return `${APP_NAME}: ${verb} ${label(o)}${fields.length?` (${fields.join(', ')})`:''}`;}
  const n={}; ops.forEach(o=>n[o.col]=(n[o.col]||0)+1);
  const names={tests:'tests',personas:'people',bancos:'equipment',qtps:'QTPs',config:'settings',muestras:'samples'};
  return `${APP_NAME}: ${ops.length} changes (${Object.entries(n).map(([c,k])=>`${k} ${names[c]||c}`).join(', ')})`;
}
async function commitOps(ops){
  for(let i=0;i<4;i++){
    const cur=await fetchApi(false), next=applyOps(clone(cur.data),ops);
    const body={message:commitMessage(ops),branch:REPO.branch,content:b64encode(JSON.stringify(next,null,1)+'\n')}; if(cur.sha) body.sha=cur.sha;
    const res=await ghFetch(`${API}/contents/${REPO.path}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(res.ok){const j=await res.json(); Object.assign(remote,{data:next,sha:j.content.sha,etag:null}); return;}
    if(res.status!==409&&res.status!==422) throw httpError(res);
    await new Promise(r=>setTimeout(r,500+Math.random()*800));
  }
  throw {code:'conflict'};
}
/* Writes show up at once on screen and are saved together, one commit per burst of changes. */
function queueOp(op){
  return new Promise((res,rej)=>{
    if(PREVIEW){ if(!remote.data) return rej({code:'not_granted'}); applyOps(remote.data,[op]); if(DEMO) demoSave(); recompute(); return res(); }
    if(!GH.token||!GH.push||GH.invalid) return rej({code:'not_granted'});
    pendingOps.push({op,res,rej}); recompute();
    clearTimeout(flushTimer); flushTimer=setTimeout(flushOps,700);
  });
}
async function flushOps(){
  if(flushing) await flushing;
  if(!pendingOps.length) return;
  const batch=pendingOps.splice(0,pendingOps.length);
  GH.saving=true; renderGh();
  flushing=(async()=>{
    try{await commitOps(batch.map(b=>b.op)); batch.forEach(b=>b.res());}
    catch(err){ if(err.code==='auth'){GH.invalid=true; GH.push=false; S.ro=true;} batch.forEach(b=>b.rej(err)); }
    finally{flushing=null; GH.saving=!!pendingOps.length; recompute(); renderGh();}
  })();
  return flushing;
}
const docRef=path=>{const [col,id]=path.split('/'); return {id,path,
  get:async()=>({id,exists:!!(local&&local[col]&&local[col][id]),data:()=>clone(local&&local[col]&&local[col][id])}),
  set:data=>queueOp({op:'set',col,id,data}),update:data=>queueOp({op:'update',col,id,data}),delete:()=>queueOp({op:'delete',col,id})};};
db={doc:docRef,collection:col=>({path:col,doc:id=>docRef(`${col}/${id||rid()}`),
  add:async data=>{const id=rid(); await queueOp({op:'set',col,id,data}); return docRef(`${col}/${id}`);},
  onSnapshot:fn=>{if(!subs.has(col)) subs.set(col,new Set()); subs.get(col).add(fn); if(local) setTimeout(()=>fn(snapOf(col)),0); return ()=>subs.get(col).delete(fn);}})};

async function refresh(){
  if(pendingOps.length||flushing) return;
  if(PREVIEW&&DEMO){ if(!remote.data) remote.data=demoLoad(); S.noDb=false; S.privateData=false; S.ro=false; recompute(); return; }
  if(PREVIEW&&remote.data) return;
  try{
    const r=GH.token&&!GH.invalid?await fetchApi(true):await fetchRaw();
    if(r){Object.assign(remote,r); recompute();}
    S.noDb=false; S.privateData=false; if(PREVIEW) S.ro=false;
  }catch(err){
    if(err.code==='auth'){GH.invalid=true; GH.push=false; S.ro=true; return refresh();}
    if(!local){S.noDb=true; S.privateData=err.code==='private'; render();}
  }
}
async function connectGh(t){
  const h={Accept:'application/vnd.github+json',Authorization:`Bearer ${t}`};
  const [u,r]=await Promise.all([fetch('https://api.github.com/user',{headers:h,cache:'no-store'}),fetch(API,{headers:h,cache:'no-store'})]);
  if(u.status===401||r.status===401) throw {code:'auth'};
  if(!u.ok) throw httpError(u); if(!r.ok) throw httpError(r);
  const user=await u.json(), repo=await r.json();
  Object.assign(GH,{token:t,login:user.login,push:!!(repo.permissions&&repo.permissions.push),invalid:false});
  S.ro=PREVIEW?!remote.data:!GH.push;
}
function disconnectGh(){Object.assign(GH,{token:'',login:null,push:false,invalid:false}); S.ro=true; try{localStorage.removeItem(TOKEN_KEY);}catch(e){} remote.etag=null; render(); toast('Disconnected from GitHub. This browser no longer has the key.');}
function renderGh(){
  const b=$('#btn-gh'); if(!b) return;
  b.className='gh '+(GH.invalid?'bad':GH.saving?'busy':GH.login&&GH.push?'on':'');
  b.querySelector('span').textContent=GH.invalid?'GitHub key expired':GH.saving?'Saving…':GH.login?GH.login:'Connect GitHub';
  b.title=GH.login?(GH.push?'Connected with write access. Changes are saved as commits.':'Connected, but this account cannot edit the repository.'):'Connect GitHub to create and change tests';
  if(PREVIEW&&DEMO){b.className='gh on'; b.querySelector('span').textContent='Example data'; b.title='Preview with example data: nothing is read from or sent to GitHub.';}
  else if(PREVIEW&&GH.login){b.className='gh busy'; b.title='Preview: the data is read from GitHub, changes are not saved.';}
}
function openGh(){
  dlg.dataset.kind='gh'; dlg.dataset.id='';
  const body=`${GH.login?`<p class="note">Connected as <b>${esc(GH.login)}</b>${GH.push?' with write access.':', but this account cannot edit the repository.'}</p>`:''}
  <ol class="steps-plain">
    <li>Create an access key in GitHub: <a href="https://github.com/settings/tokens/new?scopes=repo&amp;description=Laboratorio%20Polinya" target="_blank" rel="noopener">open the form</a>. The <span class="mono">repo</span> permission is already ticked (needed because the lab data is private); choose an expiry and press <i>Generate token</i>.</li>
    <li>Copy the key and paste it here.</li>
  </ol>
  <div class="field"><label for="gh-token">Access key (token)</label><input id="gh-token" type="password" placeholder="ghp_…" autocomplete="off" spellcheck="false"></div>
  <p class="note">The key is kept only in this browser and is shared with the durability pool app. Your GitHub account must have access to the data repository <span class="mono">${REPO.owner}/${REPO.repo}</span>: Read to view, Write to edit. Every change is saved as a commit, so the history shows who changed what.</p>`;
  dlg.innerHTML=`<form class="dlg-form" id="dlg-form" novalidate><header class="dlg-h"><div><p class="eyebrow">Editing access</p><h2>Connect GitHub</h2></div><button type="button" class="icon-btn" data-act="close" aria-label="Close">×</button></header>
  <div class="dlg-body">${body}<div id="f-err" class="form-err" hidden></div></div>
  <footer class="dlg-f">${GH.token?'<button type="button" class="btn ghost danger" data-act="gh-off">Disconnect</button>':''}<span class="sp"></span><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn primary" type="submit">Connect</button></footer></form>`;
  if(!dlg.open) dlg.showModal(); $('#gh-token').focus();
}
async function saveGh(){
  const t=($('#gh-token').value||'').trim(); if(!t) return formErr('Paste the access key.');
  const btn=dlg.querySelector('button[type="submit"]'); btn.disabled=true; btn.textContent='Checking…';
  try{
    await connectGh(t); try{localStorage.setItem(TOKEN_KEY,t);}catch(e){}
    if(PREVIEW&&DEMO){DEMO=false; try{localStorage.setItem(DEMO_KEY,'0');}catch(e){} remote.data=null;}
    remote.etag=null; await refresh(); dlg.close(); render(); loadCal();
    toast(GH.push?`Connected as ${GH.login}. You can now edit.`:`Connected as ${GH.login}, but this account cannot edit the repository.`);
  }catch(err){ btn.disabled=false; btn.textContent='Connect'; formErr(err.code==='auth'?'That key is not valid or has expired.':err.code==='forbidden'?'That key cannot see the repository.':'Could not reach GitHub. Check your connection.'); }
}
window.addEventListener('beforeunload',e=>{ if(pendingOps.length||flushing){e.preventDefault(); e.returnValue='';} });

/* ---------- Boot ---------- */
S.ro=true;
dl={};
render();
(async()=>{
  let pending=false; const later=()=>{ if(pending) return; pending=true; requestAnimationFrame(()=>{pending=false; render(); if(dlg.open) liveHints();}); };
  const sub=(col,key)=>db.collection(col).onSnapshot(snap=>{S[key]=snap.docs.map(x=>({id:x.id,...x.data()})); S.loaded.add(key); later();});
  sub(COL.tests,'tests'); sub(COL.people,'people'); sub(COL.equipment,'equipment'); sub(COL.qtps,'qtps'); sub(COL.samples,'samples');
  db.collection('config').onSnapshot(snap=>{S.cfg={}; snap.docs.forEach(x=>S.cfg[x.id]=x.data()); S.loaded.add('cfg'); later();});
  if(GH.token&&!(PREVIEW&&DEMO)){ try{await connectGh(GH.token);}catch(err){ if(err.code==='auth') GH.invalid=true; } }
  await refresh(); render(); smpFromHash(); loadCal();
  let tick=0; setInterval(()=>{ if(document.hidden) return; refresh(); if(++tick%10===0&&GH.token) loadCal(); }, GH.token?30000:60000);
})();
