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
const RESULTS=['Pass','Fail','N/A'];
const ARAS_STATUS={'in queue':'Queued','queued':'Queued','in progress':'In progress','completed':'Completed','complete':'Completed','cancelled':'Cancelled','canceled':'Cancelled','endurance running':'Endurance running','endurance':'Endurance running','not approved':'Not approved','not aproved':'Not approved','rejected':'Not approved'};
/* The same code runs three apps on the same data, chosen by <body data-app>: Control de ensayos (tests), Ocupación
   (equipment and technician load) and Muestras (samples: reception, PLR links and labels). Each app shows only its own views. */
const APP=['occupancy','samples'].includes(document.body.dataset.app)?document.body.dataset.app:'tests';
const VIEWS=(APP==='occupancy'?['overview','planning','occupancy','resources']
  :APP==='samples'?['samples','import']
  :['overview','board','queue','planning','history','resources','library','import']).map(k=>[k]);
const VIEW_KEY=APP==='occupancy'?'occ.view':APP==='samples'?'smp.view':'tl.view';
/* Muestras signed in by email: Import ARAS writes tests, so it is shown only with edit rights in ensayos. */
const importHidden=k=>k==='import'&&APP==='samples'&&GH.modo==='correo'&&(GH.noAccess||!GH.pushEnsayos);
const DAY=86400000, WEEKS_HEAT=8;
/* Firestore-style collections. People and equipment keep the collections created in the first version. */
const COL={tests:'tests',people:'personas',equipment:'bancos',qtps:'qtps',samples:'muestras'};

const ARAS_FIELDS=[
  {k:'plr',req:true,syn:['request number','request','plr','request no']},
  {k:'qtp',req:true,syn:['task item','qtp','task','procedure']},
  {k:'title',syn:['description','test','title','test name']},
  {k:'project',syn:['project']},
  {k:'requester',syn:['created by id','created by','requester','created by name','creator']},
  {k:'comments',syn:['comments','comment']},
  {k:'status',syn:['task status','status']},
  {k:'techName',syn:['lab resource lab manager use only','lab resource','technician']},
  {k:'equipmentName',syn:['equipment']},
  {k:'start',type:'date',syn:['start work date','start date']},
  {k:'requestedDue',type:'date',syn:['requested due date','due date']},
  {k:'flexible',type:'bool',syn:['due date flexible']},
  {k:'durVal',type:'num',syn:['duration']},
  {k:'durUnit',syn:['duration units']},
  {k:'pieces',type:'num',syn:['number of pieces requested','number of pieces','pieces']},
  {k:'sequence',type:'num',syn:['test sequence','sequence']},
  {k:'result',syn:['test result','result']},
  {k:'category',syn:['product category','category']},
  {k:'requestNote',syn:['request status']},
];
const QTP_FIELDS=[
  {k:'code',req:true,syn:['qtp','qtp code','code','task item','procedure','document number']},
  {k:'name',syn:['description','name','test name','title','test']},
  {k:'durVal',type:'num',syn:['duration','estimated duration','est duration','duration h','duration hours']},
  {k:'durUnit',syn:['unit','units','duration unit','duration units']},
  {k:'techHours',type:'num',syn:['technician hours','tech hours','labour hours','labor hours','man hours']},
  {k:'equipmentName',syn:['equipment','bench','testbench']},
  {k:'durBasis',syn:['basis','duration basis','per','time basis']},
  {k:'testType',syn:['lab test type','test type','type of test']},
  {k:'standard',syn:['lab agency standard','standard','norma','agency standard']},
  {k:'notes',syn:['notes','note','remarks']},
];

/* ---------- State ---------- */
const S={tests:[],people:[],equipment:[],qtps:[],cfg:{},loaded:new Set(),view:APP==='samples'?'samples':'overview',q:'',imp:null,qimp:null,ro:false,noDb:false,dayW:18,hist:{st:'',res:''},incClosed:true,sort:{queue:{k:'',dir:1},hist:{k:'',dir:1}},qst:['Not approved','Queued','Planned','In progress','Endurance running','On hold'],occ:{start:null,weeks:4,sel:null}};
let db=null, dl=null, IX=null;
try{const v=localStorage.getItem(VIEW_KEY); if(VIEWS.some(x=>x[0]===v)) S.view=v; S.hideIdle=localStorage.getItem('tl.hideIdle')==='1'; const z=+localStorage.getItem('tl.dayW'); if(z) S.dayW=z===30?32:z; const qs=JSON.parse(localStorage.getItem('tl.qst')||'null'); if(Array.isArray(qs)&&qs.length) S.qst=qs.filter(x=>ACTIVE.includes(x)); if(!localStorage.getItem('tl.qstv')){ if(!S.qst.includes('Not approved')) S.qst.unshift('Not approved'); localStorage.setItem('tl.qstv','2'); } if(localStorage.getItem('tl.qstv')==='2'){ if(!S.qst.includes('Endurance running')) S.qst.push('Endurance running'); localStorage.setItem('tl.qstv','3'); } localStorage.setItem('tl.qst',JSON.stringify(S.qst)); const ow=+localStorage.getItem('tl.occw'); if([2,4,6,8].includes(ow)) S.occ.weeks=ow;}catch(e){}
if(location.hash&&VIEWS.some(x=>'#'+x[0]===location.hash)) S.view=location.hash.slice(1);
/* The QR of a sample label opens Control de ensayos on the tests of its PLR: #queue?plr=PLR000000. The queue then shows every
   active status; once the tests load, a PLR whose tests are all closed goes to History. */
const DEEP=(m=>m&&APP==='tests'?{plr:decodeURIComponent(m[1]).trim().toUpperCase(),done:false}:null)(location.hash.match(/^#queue\?plr=([^&]+)/i));
if(DEEP){S.view='queue'; S.q=DEEP.plr; S.qst=[...ACTIVE]; try{history.replaceState(null,'',location.pathname+location.search+'#queue');}catch(e){}}

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
const eqName=b=>b?(b.nombre||tx('unnamed')):tx('delEq');
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
  if(!e) return {cls:'off',text:tx('fle_none')};
  if(e.state&&e.state!=='In use') return {cls:'off',text:tx('fleSt')[e.state]||e.state};
  if(e.calMode==='Not required') return {cls:'',text:tx('fle_nreq')};
  if(e.calMode==='Before use') return {cls:'',text:tx('fle_before')};
  const due=fleDue(e), di=calMonth(due), n=new Date(), now=n.getFullYear()*12+n.getMonth();
  if(di==null) return {cls:'warn',text:tx('fle_nodates')};
  const m=`${due.slice(5,7)}/${due.slice(2,4)}`;
  return di<now?{cls:'crit',text:tx('fle_over',m)}:di-now<=1?{cls:'warn',text:tx('fle_due',m)}:{cls:'ok',text:tx('fle_ok',m)};
}
const fleById=id=>CAL.eq&&CAL.eq[id];
const fleLabel=e=>[e.description||tx('noDesc'),[e.brand,e.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
const fleChip=id=>{const e=fleById(id), s=CAL.eq?fleState(e):{cls:'',text:tx('fle_noplan')}; return `<span class="chip fle ${s.cls}" title="${esc(`${e?fleLabel(e):id} · ${s.text}`)}">${esc(e?e.code:String(id).replace(/^eq-/,''))}</span>`;};
const eqCap=b=>Math.max(1,parseInt(b?.capacidad)||1);
const eqStateCls=s=>s==='Operational'?'ok':s==='Out of service'?'off':'no';
const byName=(a,b)=>String(a.nombre||a.name||a.id||'').localeCompare(String(b.nombre||b.name||b.id||''),'en');
const keyOf=t=>String(t.plr||'').trim().toUpperCase()+'|'+String(t.qtp||'').trim().toUpperCase();
const baseRef=t=>`${t.plr||'—'} · ${t.qtp||'—'}`;
const ref=t=>{const g=IX&&IX.tag.get(t.id); return g?`${baseRef(t)} (${g})`:baseRef(t)};
const projectNo=t=>{const m=String(t.project||'').match(/^\s*([A-Za-z0-9]+)\s*-\s+/); return m?m[1]:String(t.project||'')};
const daysTo=s=>s?Math.round((d(s)-todayMs())/DAY):null;
function toast(msg){const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>t.hidden=true,3800)}
function errMsg(e){const c=e&&e.code;
  if(byMail()&&(c==='auth'||c==='not_granted'&&GH.expired)) return ta('au_e_save');
  if(byMail()&&(c==='not_granted'||c==='forbidden')) return ta('au_e_perm');
  if(c==='not_granted'||c==='forbidden') return tx('e_perm'); if(c==='auth') return tx('e_auth'); if(c==='conflict') return tx('e_conflict'); if(c==='rate') return tx('e_rate'); if(c==='unavailable') return tx('e_net'); return tx('e_save',e&&e.message||e)}
const estPill=s=>`<span class="pill est st-${ST_CLS[s]||'cola'}">${esc(stName(s))}</span>`;
const prioTag=p=>`<span class="prio ${esc(p||'Medium')}">${esc(prioName(p||'Medium'))}</span>`;
const resTag=r=>r?`<span class="res ${r==='N/A'?'NA':esc(r)}">${esc(resName(r))}</span>`:'';
const projChip=t=>t.project?`<span class="chip proj" title="${esc(t.project)}">${esc(projectNo(t))}</span>`:'';
const projectName=t=>{const s=String(t.project||''); const m=s.match(/^\s*[A-Za-z0-9]+\s*-\s+(.*)$/); return m?m[1]:(projectNo(t)===s?'':s)};
const projCell=t=>t.project?`${projChip(t)}${projectName(t)?`<span class="pname">${esc(projectName(t))}</span>`:''}`:'<span class="muted">—</span>';
const isoWeek=ms=>{const dt=new Date(ms); const day=(dt.getUTCDay()+6)%7; const th=ms-day*DAY+3*DAY; const y=new Date(th).getUTCFullYear(); return 1+Math.round((th-Date.UTC(y,0,4))/DAY/7-((new Date(Date.UTC(y,0,4)).getUTCDay()+6)%7-3)/7)};
const wd=i=>tx('wd')[i];
/* Sortable table header. cols: [key,label,cls?] */
function sortHead(table,cols){const st=S.sort[table]; return `<tr>${cols.map(([k,l,c])=>k?`<th class="${c||''}"><button type="button" class="th-sort" data-act="sort" data-table="${table}" data-k="${k}" ${st.k===k?`aria-sort="${st.dir>0?'ascending':'descending'}"`:''}>${l}<span class="arr">${st.k===k?(st.dir>0?'▲':'▼'):'↕'}</span></button></th>`:`<th class="${c||''}">${l}</th>`).join('')}</tr>`;}
function sortBy(list,table,getters,fallback){
  const st=S.sort[table]; if(!st.k||!getters[st.k]) return list.sort(fallback);
  const g=getters[st.k];
  return list.sort((a,b)=>{const x=g(a), y=g(b), ex=x==null||x==='', ey=y==null||y===''; if(ex&&ey) return fallback(a,b); if(ex) return 1; if(ey) return -1;
    const c=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'en',{numeric:true,sensitivity:'base'}); return c*st.dir||fallback(a,b);});
}
function durHours(x){if(!x) return null; if(x.unit==='Hours') return x.val; if(x.unit==='Days') return x.val*24; if(x.unit==='Weeks') return x.val*168; if(x.unit==='Cycles') return x.cpd?x.val/x.cpd*24:null; return null;}
const techSel=t=>{const p=personById(t.techId); if(S.ro) return `<span class="tech-cell ${p?'':'none'}">${esc(p?p.nombre:tx('unassigned'))}</span>`;
  return `<select class="tech-sel ${p?'':'none'}" data-settech="${esc(t.id)}" aria-label="${esc(tx('a_techOf',baseRef(t)))}"><option value="">${esc(tx('unassigned'))}</option>${[...S.people].sort(byName).map(x=>`<option value="${esc(x.id)}" ${x.id===t.techId?'selected':''}>${esc(x.nombre)}</option>`).join('')}${t.techId&&!p?`<option value="${esc(t.techId)}" selected>${esc(tx('delPerson'))}</option>`:''}</select>`};
const statusSel=t=>S.ro?estPill(t.status):`<select class="st-sel st-${ST_CLS[t.status]||'cola'}" data-setstatus="${esc(t.id)}" aria-label="${esc(tx('a_stOf',baseRef(t)))}">${STATUSES.map(s=>`<option value="${s}" ${s===t.status?'selected':''}>${esc(stName(s))}</option>`).join('')}</select>`;

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
  if(+t.durVal>0) return {val:+t.durVal,unit:t.durUnit||'Hours',cont,cpd,src:tx('src_test')};
  /* Precedence: this test > QTP library per sample > QTP library per test > ARAS */
  if(L&&+L.durVal>0&&L.durBasis==='sample'){const unit=L.durUnit||'Hours', n=samplesOf(t);
    return {val:round2(+L.durVal*n),unit,cont,cpd,src:tx('src_libS',L.durVal,unitS(unit),n,piecesSet(t)),perSample:true};}
  if(L&&+L.durVal>0) return {val:+L.durVal,unit:L.durUnit||'Hours',cont,cpd,src:tx('src_lib')};
  if(+t.arasDurVal>0) return {val:+t.arasDurVal,unit:normUnit(t.arasDurUnit)||'Hours',cont,cpd,src:'ARAS'};
  return null;
}
const durLabel=x=>x?`${x.val} ${unitS(x.unit)}`:'—';
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
const enduBody=q=>tx('ld_endu',+q.setupH||0,+q.dailyH||0,+q.reviewEvery&&+q.reviewH?[q.reviewH,q.reviewEvery,unitS(q.reviewUnit||'Hours')]:null,+q.teardownH||0);
const loadSummary=q=>q.profile==='endurance'?`${tx('prof_endu')} · ${enduBody(q)}`
  :(+q.techHours?tx('ld_even',q.techHours,q.techBasis==='sample'):'—');

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
  const push=(sev,short,text,key,occ)=>out.push({sev,short:tx(short),text,key,occ});
  const T=todayMs(), b=eqById(t.equipmentId), p=personById(t.techId), ei=ix.END.get(t.id)||endInfo(t), s=d(t.start), e=ei.end, useEq=EQ_STATES.has(t.status);
  const stl=()=>stName(t.status).toLowerCase();
  if((t.status==='Planned'||RUNNING.has(t.status))&&s==null) push('warn','al_noStart',tx('al_noStart_t',ref(t),stl()));
  if(useEq&&s!=null&&ei.kind==='open') push('warn','al_noDur',tx('al_noDur_t',ref(t)));
  if(t.end&&s!=null&&d(t.end)<s) push('crit','al_dates',tx('al_dates_t',ref(t)));
  if(useEq&&b){
    const oc=ix.over.get(b.id);
    if(oc&&oc.ids.has(t.id)) push('crit','al_cap',tx('al_cap_t',eqName(b),oc.max,fmtMs(oc.first),eqCap(b)),'cap:'+b.id,true);
    const st=eqStatus(b); if(st!=='Operational'&&(e==null||e>=T)) push('crit','al_eqOff',tx('al_eqOff_t',ref(t),eqName(b),eqStName(st)));
    if(b.proximaCalibracion&&e!=null){const c=d(b.proximaCalibracion);
      if(c<T) push('crit','al_calx',tx('al_calx_t',eqName(b),fmt(b.proximaCalibracion),ref(t)),'calx:'+b.id);
      else if(c<=e) push('warn','al_cald',tx('al_cald_t',eqName(b),fmt(b.proximaCalibracion),ref(t),fmtMs(e)));}
  }
  if(p&&b&&(p.habilitaciones||[]).length&&!p.habilitaciones.includes(b.id)) push('warn','al_qual',tx('al_qual_t',p.nombre,eqName(b),ref(t)));
  const due=t.agreedDue||t.requestedDue;
  if(due){
    const r=d(due), sev=t.flexible&&!t.agreedDue?'warn':'crit', ag=!!t.agreedDue, fl=t.flexible&&!t.agreedDue?tx('flexP'):'';
    if(t.status!=='Report'&&e!=null&&ei.kind!=='open'&&e>r) push(sev,'al_late',tx('al_late_t',ref(t),fmtMs(e),ag,fmt(due),fl));
    else if(r<T) push(sev,'al_over',tx('al_over_t',ref(t),Math.round((T-r)/DAY),ag,fmt(due),fl));
    else if(t.status==='Queued'&&r-T<=10*DAY) push('warn','al_soon',tx('al_soon_t',ref(t),fmt(due)));
  }
  if(RUNNING.has(t.status)&&e!=null&&ei.kind!=='open'&&e<T) push('warn','al_past',tx('al_past_t',ref(t),fmtMs(e),stl()));
  if(t.status==='On hold') push('warn','al_hold',tx('al_hold_t',ref(t),t.holdReason));
  if(p&&s!=null&&e!=null&&TECH_STATES.has(t.status)&&+p.horasSemana){
    for(let w=mondayOf(Math.max(s,mondayOf(T)));w<=e&&w<mondayOf(T)+WEEKS_HEAT*7*DAY;w+=7*DAY){
      const h=personHours(ix,p.id,w); if(h>+p.horasSemana*1.001){out.push({sev:'warn',short:tx('al_tech'),text:tx('al_tech_t',p.nombre,Math.round(h/p.horasSemana*100),fmtMs(w)),skipGlobal:true,occ:true}); break;}
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
    for(let i=0;i<WEEKS_HEAT;i++){const w=mondayOf(T)+i*7*DAY, h=personHours(ix,p.id,w); if(h>cap*1.001){global.push({sev:h>cap*1.2?'crit':'warn',text:tx('al_techG',p.nombre,Math.round(h),fmtMs(w),cap,Math.round(h/cap*100)),occ:true}); break;}}}
  for(const b of S.equipment){ if(!b.proximaCalibracion||seen.has('calx:'+b.id)) continue; const c=d(b.proximaCalibracion);
    if(c<T) global.push({sev:'crit',text:tx('al_calxG',eqName(b),fmt(b.proximaCalibracion))});
    else if(c-T<=30*DAY) global.push({sev:'warn',text:tx('al_caldG',eqName(b),fmt(b.proximaCalibracion),Math.round((c-T)/DAY))}); }
  for(const [id,al] of per) per.set(id,al.filter(mine));
  global.sort((x,y)=>(x.sev==='crit'?0:1)-(y.sev==='crit'?0:1));
  return {global:global.filter(mine),per};
}

/* ---------- Render ---------- */
function render(){
  if(DEEP&&!DEEP.done&&S.loaded.has('tests')){DEEP.done=true; const ts=S.tests.filter(t=>String(t.plr||'').toUpperCase()===DEEP.plr);
    if(ts.length&&!ts.some(t=>ACTIVE.includes(t.status))){S.view='history'; try{history.replaceState(null,'',location.pathname+location.search+'#history');}catch(e){}}}
  IX=buildIndex(S.tests); const A=computeAlerts(IX); S.A=A;
  $('#qtp-list').innerHTML=[...S.qtps].sort(byName).map(q=>`<option value="${esc(q.code||q.id)}">${esc(q.name||'')}</option>`).join('');
  const crit=A.global.filter(a=>a.sev==='crit').length, nq=S.tests.filter(t=>t.status==='Queued').length, nh=S.tests.filter(t=>CLOSED.includes(t.status)).length, ns=APP!=='occupancy'?smpMissingCount():0;
  const views=VIEWS.filter(([k])=>!importHidden(k)); if(importHidden(S.view)) S.view=views[0][0];
  $('#tabs').innerHTML=views.map(([k])=>`<button data-view="${k}" ${S.view===k?'aria-current="page"':''}>${esc(tx('v_'+k))}${k==='samples'&&ns?`<span class="n warn" title="${esc(tx('k_miss'))}">${ns}</span>`:''}${k==='overview'&&A.global.length?`<span class="n ${crit?'crit':''}">${A.global.length}</span>`:''}${k==='queue'&&nq?`<span class="n">${nq}</span>`:''}${k==='history'&&nh?`<span class="n">${nh}</span>`:''}</button>`).join('');
  $('#btn-new').hidden=S.ro||S.noDb||APP!=='tests';
  let banner='';
  const pvTry=PREVIEW?tx('b_pvTry'):'';
  if(byMail()&&GH.noAccess) banner=`<div class="banner crit"><b>${ta('au_noapp')}</b></div>`;
  else if(byMail()&&GH.expired) banner=`<div class="banner crit">${ta('au_expired')} <button class="link" data-act="gh">${ta('au_again')}</button></div>`;
  else if(S.noDb&&LA&&!GH.login&&S.privateData) banner=`<div class="banner crit"><b>${ta('au_private')}</b> <button class="link" data-act="gh">${ta('au_btn')}</button></div>`;
  else if(S.noDb) banner=S.privateData
    ? (GH.login
      ? `<div class="banner crit">${tx('b_noRead',esc(GH.login),`${REPO.owner}/${REPO.repo}`)}</div>`
      : `<div class="banner crit">${tx('b_private',pvTry)}</div>`)
    : `<div class="banner crit">${tx('b_noLoad',pvTry)}</div>`;
  else if(PREVIEW&&DEMO) banner=`<div class="banner">${tx('b_demo')}</div>`;
  else if(PREVIEW&&remote.data) banner=`<div class="banner">${tx('b_pvReal')}</div>`;
  else if(GH.invalid) banner=`<div class="banner crit">${tx('b_invalid')}</div>`;
  else if(!byMail()&&GH.login&&!GH.push) banner=`<div class="banner">${tx('b_noPush',esc(GH.login))}</div>`;
  else if(byMail()&&GH.login&&!GH.push) banner=`<div class="banner">${ta('au_ro',esc(GH.login))}</div>`;
  else if(S.ro&&LA&&!GH.login) banner=`<div class="banner">${ta('au_ro_out')} <button class="link" data-act="gh">${ta('au_btn')}</button></div>`;
  else if(S.ro) banner=`<div class="banner">${tx('b_ro')}</div>`;
  renderGh();
  const loading=!S.noDb&&S.loaded.size<6;
  const fn={overview:vOverview,board:vBoard,queue:vQueue,planning:vPlanning,samples:vSamples,occupancy:vOccupancy,history:vHistory,resources:vResources,library:vLibrary,import:vImport}[S.view]||vOverview;
  $('#view').innerHTML=banner+(loading?`<div class="empty"><h3>${tx('loading')}</h3></div>`:fn(A));
}
function noTests(){
  if(APP==='occupancy') return `<div class="empty"><p class="eyebrow">${tx('nt_eyebrow')}</p><h3>${tx('nt_occ_h')}</h3><p>${tx('nt_occ_p')}</p></div>`;
  return `<div class="empty"><p class="eyebrow">${tx('nt_eyebrow')}</p><h3>${tx('nt_h')}</h3>
  <p>${tx('nt_p')}</p>
  <div class="row">${S.ro||S.noDb?'':`<button class="btn primary" data-view="import">${tx('nt_imp')}</button><button class="btn" data-view="resources">${tx('nt_res')}</button><button class="btn ghost" data-view="library">${tx('nt_lib')}</button>`}</div></div>`;
}
const active=()=>S.tests.filter(counts);
const searchBox=()=>`<input class="search" id="q" type="search" placeholder="${esc(tx('search_ph'))}" value="${esc(S.q)}" aria-label="${esc(tx('a_search'))}">`;
function matchQ(t){ if(!S.q) return true; const q=S.q.toLowerCase(); return [t.plr,t.qtp,t.title,t.project,t.requester,t.comments,eqName(eqById(t.equipmentId)),personById(t.techId)?.nombre,t.arasEquipment].some(v=>String(v||'').toLowerCase().includes(q)); }

/* Alerts panel. In each app it lists only that app's alerts (see computeAlerts). */
function alertsPanel(A){
  const none=tx(APP==='occupancy'?'al_none_occ':'al_none');
  return `<section class="panel"><div class="panel-h"><h2>${tx('alerts')}</h2><span class="muted">${tx('alerts_sub',A.global.length)}</span></div>
    ${A.global.length?`<ul class="alerts">${A.global.map(a=>`<li class="${a.sev}" ${a.tid?`data-act="edit" data-id="${esc(a.tid)}"`:''}><span class="sev">${tx(a.sev==='crit'?'sev_crit':'sev_warn')}</span><span>${esc(a.text)}</span></li>`).join('')}</ul>`:`<div class="empty-ok">${none}</div>`}
  </section>`;
}
const kpiBtn=(view,lab,val,sub,cls='')=>`<button class="kpi ${cls}" data-view="${view}"><span class="eyebrow">${esc(lab)}</span><b>${val}</b><span class="muted">${esc(sub)}</span></button>`;
function vOverview(A){
  if(!S.tests.length) return noTests();
  const T=todayMs(), act=active(), n=s=>act.filter(t=>t.status===s).length;
  const overdue=act.filter(t=>{const due=t.agreedDue||t.requestedDue; return due&&d(due)<T}).length;
  const date=new Date().toLocaleDateString(LL.locale(),{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  if(APP==='occupancy') return vLoadOverview(A,date);
  return `<div class="view-h"><h2>${tx('ov_h')}</h2><span class="muted">${date}</span></div>
  <section class="kpis">
    ${kpiBtn('board',stName('In progress'),n('In progress'),tx('ov_planned',n('Planned')))}
    ${kpiBtn('board',stName('Endurance running'),n('Endurance running'),tx('ov_endu'))}
    ${kpiBtn('queue',stName('Queued'),n('Queued'),tx('ov_queued'))}
    ${kpiBtn('board',stName('Report'),n('Report'),tx('ov_report'))}
    ${kpiBtn('board',stName('On hold'),n('On hold'),tx('ov_hold'),n('On hold')?'warn':'')}
    ${kpiBtn('queue',tx('ov_overdue'),overdue,tx('ov_overdue_s'),overdue?'crit':'')}
  </section>
  ${alertsPanel(A)}`;
}
const heatLegend=(extra='')=>`<div class="legend"><span><i style="background:var(--h1)"></i>≤ 40%</span><span><i style="background:var(--h2)"></i>41–75%</span><span><i style="background:var(--h3)"></i>76–100%</span><span><i style="background:var(--crit)"></i>&gt; 100% ${tx('lg_over')}</span>${extra}</div>`;
/* Occupancy app overview: load this week, weekly heat maps for the team and the equipment, and load alerts. */
function vLoadOverview(A,date){
  const T=todayMs(), M=mondayOf(T);
  const weeks=[...Array(WEEKS_HEAT)].map((_,i)=>M+i*7*DAY);
  const cls=p=>p<=0?'':p<=40?'h1':p<=75?'h2':p<=100?'h3':'hx';
  const head=`<tr><th></th>${weeks.map((w,i)=>`<th class="wk ${i===0?'now':''}">${i===0?tx('thisWk'):fmtMs(w).slice(0,5)}</th>`).join('')}</tr>`;
  const pRows=[...S.people].sort(byName).map(p=>{const cap=+p.horasSemana||0; return `<tr><th class="rl" title="${esc(p.nombre)}">${esc(p.nombre)}</th>${weeks.map(w=>{const h=personHours(IX,p.id,w), pc=cap?h/cap*100:0; return `<td class="${cls(pc)}" title="${esc(tx('hOf',Math.round(h),cap))}">${pc?Math.round(pc)+'%':'·'}</td>`}).join('')}</tr>`}).join('');
  const bRows=[...S.equipment].sort(byName).map(b=>`<tr><th class="rl" title="${esc(eqName(b))} · ${esc(tx('capN',eqCap(b)))}">${esc(eqName(b))}</th>${weeks.map(w=>{const pc=eqWeekPct(IX,b.id,w); return `<td class="${cls(pc)}" title="${esc(tx('slotPct',Math.round(pc),eqCap(b)))}">${pc?Math.round(pc)+'%':'·'}</td>`}).join('')}</tr>`).join('');
  const hours=S.people.reduce((a,p)=>a+personHours(IX,p.id,M),0), capH=S.people.reduce((a,p)=>a+(+p.horasSemana||0),0);
  const inUse=S.equipment.filter(b=>eqCount(IX,b.id,T)>0).length, over=IX.over.size;
  const overP=S.people.filter(p=>+p.horasSemana&&personHours(IX,p.id,M)>+p.horasSemana*1.001).length;
  return `<div class="view-h"><h2>${tx('ovo_h')}</h2><span class="muted">${date}</span></div>
  <section class="kpis">
    ${kpiBtn('occupancy',tx('ovo_team'),`${capH?Math.round(hours/capH*100):0}%`,tx('hOf',fmtH(hours),fmtH(capH)))}
    ${kpiBtn('occupancy',tx('ovo_overP'),overP,tx('ovo_thisWk'),overP?'warn':'')}
    ${kpiBtn('resources',tx('ovo_inUse'),inUse,tx('ofN',S.equipment.length))}
    ${kpiBtn('planning',tx('al_cap'),over,tx('ovo_over_s'),over?'crit':'')}
  </section>
  <div class="grid2">
    ${alertsPanel(A)}
    <section class="panel"><div class="panel-h"><h2>${tx('ovo_next',WEEKS_HEAT)}</h2></div>
      <p class="eyebrow" style="margin-bottom:4px">${tx('ovo_teamH')}</p>
      ${pRows?`<div class="scroll-x"><table class="heat">${head}${pRows}</table></div>`:`<p class="muted">${tx('noPeople')}</p>`}
      <p class="eyebrow" style="margin:14px 0 4px">${tx('ovo_eqH')}</p>
      ${bRows?`<div class="scroll-x"><table class="heat">${head}${bRows}</table></div>`:`<p class="muted">${tx('noEq')}</p>`}
      ${heatLegend()}
    </section>
  </div>`;
}

function planText(t){
  const ei=IX.END.get(t.id)||endInfo(t);
  if(ei.kind==='none'){const x=effDur(t); return tx('pl_ns',x?durLabel(x):'');}
  return `${fmt(t.start)} → ${ei.kind==='auto'?'~':ei.kind==='open'?'?':''}${fmtMs(ei.end)}`;
}
function dueText(t){const due=t.agreedDue||t.requestedDue; return due?`${fmt(due)}${t.agreedDue?esc(tx('agreedP')):''}${t.flexible&&!t.agreedDue?`<span class="flex">${esc(tx('flex'))}</span>`:''}`:'—';}
function card(t,al){
  const b=eqById(t.equipmentId), p=personById(t.techId), cls=ST_CLS[t.status]||'cola', g=IX.tag.get(t.id);
  const uniq=[...new Map(al.map(x=>[x.short,x])).values()];
  return `<article class="card st-${cls} ${al.some(x=>x.sev==='crit')?'has-crit':''}" draggable="${!S.ro}" data-act="edit" data-id="${esc(t.id)}" tabindex="0">
    <div class="card-top"><span class="ref">${esc(baseRef(t))}</span>${prioTag(t.priority)}</div>
    ${g?`<div class="tagline">${esc(g)}</div>`:''}
    <h4>${esc(t.title||tx('noDesc'))}</h4>
    <div class="chips">${projChip(t)}${t.requester?`<span class="by">${esc(tx('by'))} ${esc(t.requester)}</span>`:''}${smpTestChip(t)}</div>
    <dl class="meta"><div><dt>${tx('c_eq')}</dt><dd>${esc(b?eqName(b):(t.arasEquipment?t.arasEquipment+' (ARAS)':'—'))}</dd></div><div><dt>${tx('c_tech')}</dt><dd>${esc(p?p.nombre:'—')}</dd></div>
    <div><dt>${tx('c_planL')}</dt><dd>${esc(planText(t))}</dd></div><div><dt>${tx('c_due')}</dt><dd>${dueText(t)}</dd></div></dl>
    ${['In progress','Endurance running','Report','On hold'].includes(t.status)?`<div class="prog" title="${+t.progress||0}%"><span style="width:${Math.min(100,+t.progress||0)}%"></span></div>`:''}
    ${uniq.length?`<ul class="card-al">${uniq.map(x=>`<li class="${x.sev}">${esc(x.short)}</li>`).join('')}</ul>`:''}
  </article>`;
}
const sortQueue=(a,b)=>(PRIO_RANK[a.priority]??2)-(PRIO_RANK[b.priority]??2)||(d(a.agreedDue||a.requestedDue)??9e15)-(d(b.agreedDue||b.requestedDue)??9e15)||String(a.plr).localeCompare(String(b.plr));
function vBoard(A){
  if(!S.tests.length) return noTests();
  const cols=ACTIVE.map(s=>{const list=S.tests.filter(t=>t.status===s&&matchQ(t)).sort(sortQueue);
    return `<section class="col st-${ST_CLS[s]}" data-drop="${s}"><div class="col-h"><h3>${esc(stName(s))}</h3><span class="mono">${list.length}</span></div>${list.map(t=>card(t,A.per.get(t.id)||[])).join('')}</section>`}).join('');
  return `<div class="view-h"><h2>${tx('bd_h')}</h2>${searchBox()}</div>
  <p class="muted" style="margin:0">${S.ro?'':tx('bd_help')}</p>
  <div class="board">${cols}</div>
  ${S.ro?'':`<div class="close-row"><div class="close-zone st-cerr" data-drop="Completed">${tx('bd_done')}</div><div class="close-zone st-canc" data-drop="Cancelled">${tx('bd_canc')}</div></div>`}`;
}

function vQueue(){
  if(!S.tests.length) return noTests();
  const T=todayMs();
  const due=t=>{const dd=t.agreedDue||t.requestedDue, n=daysTo(dd); if(n==null) return '<span class="muted">—</span>'; const c=n<0?(t.flexible&&!t.agreedDue?'warn':'crit'):n<=10?'warn':''; return `<span class="due ${c}">${dueText(t)}<br><small>${esc(n<0?tx('d_over',-n):n===0?tx('today'):tx('d_in',n))}</small></span>`};
  const counts=Object.fromEntries(ACTIVE.map(s=>[s,S.tests.filter(t=>t.status===s).length]));
  const list=S.tests.filter(t=>S.qst.includes(t.status)&&matchQ(t));
  const G={tech:t=>personById(t.techId)?.nombre||null,id:t=>baseRef(t),project:t=>t.project||null,test:t=>t.title||null,requester:t=>t.requester||null,
    due:t=>d(t.agreedDue||t.requestedDue),dur:t=>durHours(effDur(t)),equipment:t=>t.equipmentId?eqName(eqById(t.equipmentId)):(t.arasEquipment||null),
    start:t=>d(t.start),end:t=>{const ei=IX.END.get(t.id); return ei&&ei.kind!=='open'&&ei.kind!=='none'?ei.end:null},status:t=>STATUSES.indexOf(t.status),priority:t=>PRIO_RANK[t.priority]??2};
  const fallback=(a,b)=>STATUSES.indexOf(b.status)-STATUSES.indexOf(a.status)||sortQueue(a,b);
  sortBy(list,'queue',G,fallback);
  const dateIn=(t,field,val,cls,extra='')=>`<input type="date" class="cell-date ${cls}" data-setdate="${esc(t.id)}" data-field="${field}" value="${esc(val||'')}" aria-label="${esc(tx(field==='start'?'a_startOf':'a_endOf',baseRef(t)))}" ${extra}>`;
  const startCell=t=>{if(t.status==='Not approved') return '<span class="muted">—</span>';
    const fr=APP==='occupancy'&&!t.start&&t.equipmentId?freeFrom(IX,t.equipmentId,t.id):null, hint=fr==null?'':`<span class="sub">${esc(tx('freeFrom',fr===T?tx('today'):fmtMs(fr)))}</span>`;
    return S.ro?(t.start?fmt(t.start):'<span class="muted">—</span>')+hint:dateIn(t,'start',t.start,'')+hint};
  const endCell=t=>{if(t.status==='Not approved') return '<span class="muted">—</span>'; const ei=IX.END.get(t.id)||endInfo(t), manual=!!t.end;
    const val=manual?t.end:ei.kind==='auto'?iso(ei.end):'';
    const sub=manual?tx('end_manual'):ei.kind==='auto'?tx('end_auto'):t.start?tx('end_nodur'):'';
    if(S.ro) return (val?(manual?'':'~')+fmt(val):'<span class="muted">—</span>');
    return dateIn(t,'end',val,manual?'':'auto',t.start?`title="${esc(tx('end_t_clear'))}"`:`disabled title="${esc(tx('end_t_first'))}"`)+(sub?`<span class="sub" title="${esc(tx(manual?'end_t_manual':'end_t_auto'))}">${esc(sub)}</span>`:'')};
  const rows=list.map(t=>{const b=eqById(t.equipmentId), x=effDur(t);
    return `<tr class="click strow st-${ST_CLS[t.status]||'cola'}" data-act="edit" data-id="${esc(t.id)}"><td class="ref nowrap">${esc(baseRef(t))}${IX.tag.get(t.id)?`<small>${esc(IX.tag.get(t.id))}</small>`:''}</td><td>${techSel(t)}</td><td>${statusSel(t)}</td><td>${projCell(t)}</td><td><b>${esc(t.title||'')}</b>${t.comments?`<span class="snip" title="${esc(t.comments)}">${esc(t.comments.replace(/\s+/g,' '))}</span>`:''}</td><td class="nowrap">${startCell(t)}</td><td class="nowrap">${endCell(t)}</td><td class="nowrap">${x?`${durLabel(x)}<br><small class="muted">${esc(x.src)}</small>`:`<span class="muted">${tx('noEst')}</span>`}</td><td class="nowrap">${due(t)}</td><td>${esc(t.requester||'—')}</td></tr>`}).join('');
  return `<div class="view-h"><h2>${tx('q_h')}</h2>${searchBox()}</div>
  <div class="row" role="group" aria-label="${esc(tx('a_stShown'))}"><span class="muted" style="font-size:13px">${tx('show')}</span>${ACTIVE.map(s=>`<button type="button" class="chipbtn st-${ST_CLS[s]}" data-act="qst" data-s="${s}" aria-pressed="${S.qst.includes(s)}">${esc(stName(s))} · ${counts[s]}</button>`).join('')}</div>
  <section class="panel"><div class="panel-h"><h2>${tx('nTests',list.length)}</h2><span class="muted">${tx('q_help')}</span></div>
  ${list.length?`<div class="scroll-x"><table class="tbl compact"><thead>${sortHead('queue',[['id','PLR · QTP'],['tech',tx('col_tech')],['status',tx('col_status')],['project',tx('col_project')],['test',tx('col_test')],['start',tx('col_start')],['end',tx('col_end')],['dur',tx('col_dur')],['due',tx('col_due')],['requester',tx('col_req')]])}</thead><tbody>${rows}</tbody></table></div>`:`<div class="empty-ok">${tx('q_none')}</div>`}
  </section>`;
}
function lanes(items){const ends=[],out=[]; for(const it of [...items].sort((a,b)=>a.s-b.s)){let l=ends.findIndex(x=>x<it.s); if(l<0){l=ends.length; ends.push(it.e);} else ends[l]=it.e; out.push({...it,lane:l});} return {out,n:Math.max(1,ends.length)};}
function vPlanning(){
  if(!S.tests.length) return noTests();
  const T=todayMs(), W=S.dayW, dayMode=W>=26, start=mondayOf(T)-7*DAY, nW=dayMode?8:14, days=nW*7, end=start+(days-1)*DAY, labW=window.innerWidth<600?130:220;
  const item=t=>{const s=d(t.start), ei=IX.END.get(t.id); if(s==null||!ei||ei.end==null) return null; const e=Math.max(s,ei.end); if(e<start||s>end) return null; return {t,s,e,kind:ei.kind}};
  const bar=(x,light)=>{const a=Math.max(x.s,start), b=Math.min(x.e,end), left=(a-start)/DAY*W, w=((b-a)/DAY+1)*W-2, eq=eqById(x.t.equipmentId), p=personById(x.t.techId);
    return `<button class="bar st-${ST_CLS[x.t.status]} ${x.kind==='open'?'open':''} ${light?'light':''}" style="left:${left+1}px;width:${Math.max(w,6)}px;top:${x.lane*26+4}px" data-act="edit" data-id="${esc(x.t.id)}" title="${esc(`${ref(x.t)} · ${x.t.title||''}\n${fmtMs(x.s)} → ${x.kind==='open'?tx('endUnknown'):fmtMs(x.e)} · ${stName(x.t.status)}\n${eq?eqName(eq):tx('noEqL')} · ${p?p.nombre:tx('noTechL')}`)}">${esc(baseRef(x.t))} · ${esc(x.t.title||'')}</button>`};
  let weekend=''; for(let t=start;t<=end;t+=DAY) if(!isWork(t)) weekend+=`<div class="weekend" style="left:${(t-start)/DAY*W}px;width:${W}px"></div>`;
  const todayL=`<div class="today" style="left:${(T-start)/DAY*W+W/2}px"></div>`;
  const row=(label,sub,items,conf,lightFn)=>{const L=lanes(items.filter(Boolean)), h=Math.max(46,L.n*26+8);
    return `<div class="g-lab ${conf?'conf':''}" style="height:${h}px"><b title="${esc(label)}">${esc(label)}</b><small>${sub}</small></div><div class="g-track" style="height:${h}px">${weekend}${todayL}${L.out.map(o=>bar(o,lightFn&&lightFn(o.t))).join('')}</div>`};
  const head=`<div class="g-lab" style="height:30px"><small>${tx(dayMode?'wk':'wkOf')}</small></div><div class="g-head">${[...Array(nW)].map((_,i)=>{const w=start+i*7*DAY; return `<div style="width:${7*W}px" class="${w===mondayOf(T)?'now':''}">${dayMode?`${tx('wkP')}${isoWeek(w)} · ${new Date(w).toLocaleDateString(LL.locale(),{month:'short',year:'numeric',timeZone:'UTC'})}`:fmtMs(w).slice(0,5)}</div>`}).join('')}</div>`
    +(dayMode?`<div class="g-lab" style="height:34px"><small>${tx('day')}</small></div><div class="g-days">${[...Array(days)].map((_,i)=>{const t=start+i*DAY, dt=new Date(t); return `<div style="width:${W}px" class="${t===T?'now':''} ${isWork(t)?'':'we'} ${dt.getUTCDay()===1?'mon':''}"><small>${wd(dt.getUTCDay())}</small>${dt.getUTCDate()}</div>`}).join('')}</div>`:'');
  /* "Hide idle equipment" leaves out equipment with no test bar inside the visible period. */
  const eqItems=[...S.equipment].sort(byName).map(b=>({b,items:S.tests.filter(t=>t.equipmentId===b.id&&EQ_STATES.has(t.status)).map(item).filter(Boolean)}));
  const shownEq=S.hideIdle?eqItems.filter(x=>x.items.length):eqItems, hiddenEq=eqItems.length-shownEq.length;
  const bRows=shownEq.map(({b,items})=>row(eqName(b),`<span class="bstate ${eqStateCls(eqStatus(b))}">${esc(eqStName(eqStatus(b)))}</span> · ${esc(tx('capN',eqCap(b)))}`,items,IX.over.has(b.id))).join('');
  const pRows=[...S.people].sort(byName).map(p=>{const h=personHours(IX,p.id,mondayOf(T)), cap=+p.horasSemana||0; return row(p.nombre,`${esc(p.rol||'')}${APP==='occupancy'&&cap?` · ${esc(tx('pl_thisWk',Math.round(h),cap))}`:''}`,S.tests.filter(t=>t.techId===p.id&&TECH_STATES.has(t.status)).map(item),false,t=>t.status==='Report')}).join('');
  const missing=S.tests.filter(t=>EQ_STATES.has(t.status)&&(!t.start)).length;
  return `<div class="view-h"><h2>${tx('pl_h')}</h2>
    <div class="zoom" role="group" aria-label="${esc(tx('a_zoom'))}">${[[10,'z_q'],[18,'z_w'],[32,'z_d']].map(([z,l])=>`<button data-act="zoom" data-z="${z}" aria-pressed="${S.dayW===z}">${tx(l)}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" id="hide-idle" ${S.hideIdle?'checked':''}> ${tx('pl_hide')}</label></div>
  <p class="muted" style="margin:0">${tx('pl_help')}${missing?tx('pl_missing',missing):''}</p>
  <div class="gantt" style="--wk:${7*W}px;--day:${W}px"><div class="g-grid ${dayMode?'days':''}" style="grid-template-columns:${labW}px ${days*W}px">
    ${head}
    <div class="g-sec"><span>${tx('eqs')}${hiddenEq?` <small style="text-transform:none;font-weight:400">· ${tx('pl_hidden',hiddenEq)}</small>`:''}</span></div>${bRows||`<div class="g-sec" style="text-transform:none;font-weight:400"><span>${tx(eqItems.length?'pl_noEqP':'noEq')}</span></div>`}
    <div class="g-sec"><span>${tx('team')}</span></div>${pRows||`<div class="g-sec" style="text-transform:none;font-weight:400"><span>${tx('noPeople')}</span></div>`}
  </div></div>
  <div class="legend">${['Planned','In progress','Endurance running','On hold','Report'].map(s=>`<span><i style="background:var(--st-${ST_CLS[s]})"></i>${esc(stName(s))}</span>`).join('')}<span><i style="background:var(--crit);width:2px"></i>${tx('todayC')}</span></div>`;
}

function vHistory(){
  const all=S.tests.filter(t=>CLOSED.includes(t.status));
  if(!all.length) return `<div class="view-h"><h2>${tx('history')}</h2></div><div class="empty"><h3>${tx('hi_none_h')}</h3><p>${tx('hi_none_p')}</p></div>`;
  const H=S.hist, list=all.filter(t=>(!H.st||t.status===H.st)&&(!H.res||(H.res==='none'?!t.result:t.result===H.res))&&matchQ(t));
  const techOf=t=>personById(t.techId)?.nombre||t.arasTech||'';
  const G={tech:t=>techOf(t)||null,result:t=>t.result||null,id:t=>baseRef(t),project:t=>t.project||null,test:t=>t.title||null,requester:t=>t.requester||null,
    equipment:t=>t.equipmentId?eqName(eqById(t.equipmentId)):(t.arasEquipment||null),start:t=>d(t.start),closed:t=>d(t.closedAt),status:t=>t.status};
  sortBy(list,'hist',G,(a,b)=>String(b.closedAt||b.start||'').localeCompare(String(a.closedAt||a.start||''))||String(b.plr).localeCompare(String(a.plr)));
  const comp=all.filter(t=>t.status==='Completed'), pass=comp.filter(t=>t.result==='Pass').length, fail=comp.filter(t=>t.result==='Fail').length;
  const rows=list.map(t=>{const b=eqById(t.equipmentId), tn=techOf(t);
    return `<tr class="click" data-act="edit" data-id="${esc(t.id)}"><td class="tech-cell ${tn?'':'none'}">${esc(tn||'—')}</td><td>${resTag(t.result)||'<span class="muted">—</span>'}</td><td class="ref nowrap">${esc(baseRef(t))}${IX.tag.get(t.id)?`<small>${esc(IX.tag.get(t.id))}</small>`:''}</td><td style="min-width:200px"><span class="chip proj">${esc(projectNo(t))}</span> ${esc(projectName(t))}</td><td><b>${esc(t.title||'')}</b>${t.comments?`<span class="snip" title="${esc(t.comments)}">${esc(t.comments.replace(/\s+/g,' '))}</span>`:''}</td><td>${esc(t.requester||'—')}</td><td>${esc(b?eqName(b):t.arasEquipment||'—')}</td><td class="nowrap">${fmt(t.start)}</td><td class="nowrap">${fmt(t.closedAt)}</td><td>${estPill(t.status)}</td></tr>`}).join('');
  return `<div class="view-h"><h2>${tx('history')}</h2>${searchBox()}
    <select class="fsel" id="hist-st" aria-label="${esc(tx('col_status'))}"><option value="">${tx('hi_allSt')}</option>${CLOSED.map(s=>`<option value="${s}" ${H.st===s?'selected':''}>${esc(stName(s))}</option>`).join('')}</select>
    <select class="fsel" id="hist-res" aria-label="${esc(tx('col_result'))}"><option value="">${tx('hi_allRes')}</option>${RESULTS.map(r=>`<option value="${r}" ${H.res===r?'selected':''}>${esc(resName(r))}</option>`).join('')}<option value="none" ${H.res==='none'?'selected':''}>${tx('hi_noRes')}</option></select></div>
  <p class="muted" style="margin:0">${tx('hi_sum',comp.length,all.length-comp.length,pass,fail)}</p>
  <section class="panel">${list.length?`<div class="scroll-x"><table class="tbl compact"><thead>${sortHead('hist',[['tech',tx('col_tech')],['result',tx('col_result')],['id','PLR · QTP'],['project',tx('col_project')],['test',tx('col_test')],['requester',tx('col_req')],['equipment',tx('col_eq')],['start',tx('col_startS')],['closed',tx('col_closed')],['status',tx('col_status')]])}</thead><tbody>${rows}</tbody></table></div>`:`<div class="empty-ok">${tx('hi_nomatch')}</div>`}</section>`;
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
  const tagTxt=(tags,j)=>tags.map(x=>tx('ptag')[x]||x).join(j);
  const head1=`<tr><th class="rh" rowspan="2"><small>${fmtMs(O.start)} – ${fmtMs(end)}</small></th>${[...Array(O.weeks)].map((_,w)=>{const m=O.start+w*7*DAY; return `<th class="wkh" colspan="7">${tx('wkP')}${isoWeek(m)} · ${new Date(m).toLocaleDateString(LL.locale(),{day:'numeric',month:'short',timeZone:'UTC'})}</th>`}).join('')}<th class="tot" rowspan="2">${tx('period')}</th></tr>`;
  const head2=`<tr>${days.map(t=>{const dt=new Date(t); return `<th class="dh ${t===T?'now':''} ${isWork(t)?'':'we'} ${dt.getUTCDay()===1?'wkst':''}"><small>${wd(dt.getUTCDay())}</small>${dt.getUTCDate()}</th>`}).join('')}</tr>`;
  const queuedFor=pid=>S.tests.filter(t=>t.techId===pid&&t.status==='Queued');
  const pRows=[...S.people].sort(byName).map(p=>{
    const daily=(+p.horasSemana||0)/5; let tot=0,cap=0;
    const cells=days.map(t=>{const r=personDay(IX,p.id,t); tot+=r.h; if(isWork(t)) cap+=daily; const pc=daily?r.h/daily*100:0;
      const unk=r.items.length&&!r.h; const txt=r.h?fmtH(r.h):unk?'?':'';
      const tip=r.items.length?`${wd(new Date(t).getUTCDay())} ${fmtMs(t)}: ${tx('hOf',fmtH(r.h),fmtH(daily))}\n`+r.items.map(x=>`${baseRef(x.t)} · ${x.t.title||''} (${x.h?fmtH(x.h)+' h'+(x.tags.length&&!x.tags.includes('work')?' '+tagTxt(x.tags,'+'):''):tx('hNotSet')})`).join('\n'):`${fmtMs(t)}: ${tx('freeD')}`;
      return `<td class="${isWork(t)?'':'we'} ${new Date(t).getUTCDay()===1?'wkst':''}"><button type="button" class="cell ${unk?'unk':lvl(pc)} ${isSel('p',p.id,t)?'sel':''}" data-act="occ-cell" data-type="p" data-id="${esc(p.id)}" data-day="${t}" title="${esc(tip)}">${txt}</button></td>`}).join('');
    const q=queuedFor(p.id), qh=q.reduce((a,t)=>a+effTech(t),0);
    return `<tr><th class="rh"><b title="${esc(p.nombre)}">${esc(p.nombre)}</b><small>${esc(tx('occ_pSub',+p.horasSemana||0,q.length,qh?fmtH(qh):''))}</small></th>${cells}<td class="tot"><b>${fmtH(tot)} h</b> / ${fmtH(cap)} h<br><span class="due ${cap&&tot>cap?'crit':''}">${cap?Math.round(tot/cap*100):0}%</span></td></tr>`}).join('');
  const bRows=[...S.equipment].sort(byName).map(b=>{
    const cap=eqCap(b); let used=0;
    const cells=days.map(t=>{const on=eqDay(IX,b.id,t); used+=on.length; const pc=on.length/cap*100;
      const tip=on.length?`${wd(new Date(t).getUTCDay())} ${fmtMs(t)}: ${tx('slotsOf',on.length,cap)}\n`+on.map(x=>`${baseRef(x)} · ${x.title||''}`).join('\n'):`${fmtMs(t)}: ${tx('freeD')}`;
      return `<td class="${isWork(t)?'':'we'} ${new Date(t).getUTCDay()===1?'wkst':''}"><button type="button" class="cell ${lvl(pc)} ${isSel('e',b.id,t)?'sel':''}" data-act="occ-cell" data-type="e" data-id="${esc(b.id)}" data-day="${t}" title="${esc(tip)}">${on.length?(cap>1?`${on.length}/${cap}`:'●'):''}</button></td>`}).join('');
    return `<tr><th class="rh"><b title="${esc(eqName(b))}">${esc(eqName(b))}</b><small><span class="bstate ${eqStateCls(eqStatus(b))}">${esc(eqStName(eqStatus(b)))}</span> · ${esc(tx('capN',cap))}</small></th>${cells}<td class="tot"><b>${Math.round(used/(n*cap)*100)}%</b><br><span class="muted">${esc(tx('slotDays',used))}</span></td></tr>`}).join('');
  const span=n+2;
  let detail=`<p class="muted" style="margin:0">${tx('occ_click')}</p>`;
  if(sel){
    if(sel.type==='p'){const p=personById(sel.id); if(p){const r=personDay(IX,p.id,sel.day), daily=(+p.horasSemana||0)/5;
      detail=`<div class="panel-h" style="margin:0"><h2>${esc(p.nombre)} · ${wd(new Date(sel.day).getUTCDay())} ${fmtMs(sel.day)}</h2><span class="muted">${esc(tx('occ_avail',fmtH(r.h),fmtH(daily)))}${isWork(sel.day)?'':` · ${tx('weekend')}`}</span></div>`+
      (r.items.length?`<div class="occ-detail">${r.items.map(x=>{const b=eqById(x.t.equipmentId); return `<button type="button" data-act="edit" data-id="${esc(x.t.id)}"><span class="ref">${esc(ref(x.t))}</span><b>${esc(x.t.title||'')}</b>${estPill(x.t.status)}<span class="muted">${b?esc(eqName(b)):tx('noEqL')}</span><span class="sp"></span><span>${x.h?esc(tx('hDay',fmtH(x.h)))+(x.tags.length&&!x.tags.includes('work')?` · ${esc(tagTxt(x.tags,' + '))}`:''):`<span class="due warn">${tx('techHNotSet')}</span>`}</span></button>`}).join('')}</div>`:`<div class="empty-ok">${tx('occ_noP')}</div>`);}}
    else {const b=eqById(sel.id); if(b){const on=eqDay(IX,b.id,sel.day);
      detail=`<div class="panel-h" style="margin:0"><h2>${esc(eqName(b))} · ${wd(new Date(sel.day).getUTCDay())} ${fmtMs(sel.day)}</h2><span class="muted">${esc(tx('occ_inUse',on.length,eqCap(b)))}</span></div>`+
      (on.length?`<div class="occ-detail">${on.map(t=>{const p=personById(t.techId), ei=IX.END.get(t.id)||{}; return `<button type="button" data-act="edit" data-id="${esc(t.id)}"><span class="ref">${esc(ref(t))}</span><b>${esc(t.title||'')}</b>${estPill(t.status)}<span class="muted">${esc(p?p.nombre:tx('noTechL'))}</span><span class="sp"></span><span class="mono">${fmt(t.start)} → ${ei.kind==='open'?tx('endUnknown'):(ei.kind==='auto'?'~':'')+fmtMs(ei.end)}</span></button>`}).join('')}</div>`:`<div class="empty-ok">${tx('occ_free')}</div>`);}}
  }
  return `<div class="view-h"><h2>${tx('v_occupancy')}</h2>
    <div class="occ-ctl"><button class="btn sm" data-act="occ-nav" data-d="-1" aria-label="${esc(tx('a_prevWk'))}">◀</button><button class="btn sm" data-act="occ-nav" data-d="0">${tx('occ_thisWk')}</button><button class="btn sm" data-act="occ-nav" data-d="1" aria-label="${esc(tx('a_nextWk'))}">▶</button>
    <div class="zoom" role="group" aria-label="${esc(tx('period'))}">${[2,4,6,8].map(w=>`<button data-act="occ-weeks" data-w="${w}" aria-pressed="${O.weeks===w}">${tx('nWk',w)}</button>`).join('')}</div></div></div>
  <p class="muted" style="margin:0;max-width:110ch">${tx('occ_help')}</p>
  <div class="occ-wrap"><table class="occ"><thead>${head1}${head2}</thead><tbody>
    <tr class="sec"><th colspan="${span}"><span>${tx('techs')}</span></th></tr>${pRows||`<tr><td colspan="${span}" class="muted" style="padding:10px">${tx('noPeople')}</td></tr>`}
    <tr class="sec"><th colspan="${span}"><span>${tx('eqs')}</span></th></tr>${bRows||`<tr><td colspan="${span}" class="muted" style="padding:10px">${tx('noEq')}</td></tr>`}
  </tbody></table></div>
  ${heatLegend(`<span><i style="background:var(--surface-2)"></i>${tx('weekend')}</span>`)}
  <section class="panel">${detail}</section>`;
}
/* Equipment & team. The load columns (in use, free from, hours and load per week) only show in the occupancy app. */
function vResources(){
  const T=todayMs(), M=mondayOf(T), load=APP==='occupancy', opt=(on,html)=>on?html:'';
  const bRows=[...S.equipment].sort(byName).map(b=>{const cap=eqCap(b), now=eqCount(IX,b.id,T), fr=freeFrom(IX,b.id), c=b.proximaCalibracion?daysTo(b.proximaCalibracion):null;
    return `<tr class="click" data-act="edit-b" data-id="${esc(b.id)}"><td><b>${esc(eqName(b))}</b><br><small class="muted">${esc(b.descripcion||'')}${b.nombreAras&&norm(b.nombreAras)!==norm(b.nombre)?` · ARAS: ${esc(b.nombreAras)}`:''}</small></td><td><span class="bstate ${eqStateCls(eqStatus(b))}">${esc(eqStName(eqStatus(b)))}</span></td><td class="num">${cap}</td>${opt(load,`<td class="num"><span class="due ${now>cap?'crit':''}">${now} / ${cap}</span></td><td class="nowrap">${fr==null?'—':fr===T?tx('today'):fmtMs(fr)}</td>`)}<td><div class="chips">${(b.instrumentos||[]).map(fleChip).join('')||'<span class="muted">—</span>'}</div></td><td class="nowrap"><span class="due ${c!=null&&c<0?'crit':c!=null&&c<=30?'warn':''}">${fmt(b.proximaCalibracion)}</span></td></tr>`}).join('');
  const pRows=[...S.people].sort(byName).map(p=>{const cap=+p.horasSemana||0, h=personHours(IX,p.id,M), n=S.tests.filter(t=>t.techId===p.id&&TECH_STATES.has(t.status)).length, pc=cap?Math.round(h/cap*100):0;
    return `<tr class="click" data-act="edit-p" data-id="${esc(p.id)}"><td><b>${esc(p.nombre)}</b><br><small class="muted">${esc(p.rol||'')}</small></td>${opt(load,`<td class="num">${cap||'—'} h</td><td class="num"><span class="due ${pc>100?'crit':pc>85?'warn':''}">${pc}%</span></td>`)}<td class="num">${n}</td><td><div class="chips">${(p.habilitaciones||[]).map(eqById).filter(Boolean).map(b=>`<span class="chip">${esc(eqName(b))}</span>`).join('')||`<span class="muted">${tx('notSet')}</span>`}</div></td></tr>`}).join('');
  return `<div class="view-h"><h2>${tx('v_resources')}</h2></div>
  <section class="panel"><div class="panel-h"><h2>${tx('eqs')}</h2><span class="muted">${tx('rs_capHelp')}</span>${S.ro||S.noDb?'':`<button class="btn sm" data-act="new-b">${tx('rs_addEq')}</button>`}</div>
    ${bRows?`<div class="scroll-x"><table class="tbl"><thead><tr><th>${tx('col_eq')}</th><th>${tx('col_status')}</th><th class="num">${tx('rs_cap')}</th>${opt(load,`<th class="num">${tx('rs_inUse')}</th><th>${tx('rs_freeFrom')}</th>`)}<th>${tx('fle_h')}</th><th>${tx('rs_nextCal')}</th></tr></thead><tbody>${bRows}</tbody></table></div>`:`<div class="empty-ok">${tx('rs_noEq')}</div>`}
  </section>
  <section class="panel"><div class="panel-h"><h2>${tx('team')}</h2>${S.ro||S.noDb?'':`<button class="btn sm" data-act="new-p">${tx('rs_addP')}</button>`}</div>
    ${pRows?`<div class="scroll-x"><table class="tbl"><thead><tr><th>${tx('rs_person')}</th>${opt(load,`<th class="num">${tx('rs_hWk')}</th><th class="num">${tx('rs_loadWk')}</th>`)}<th class="num">${tx('rs_active')}</th><th>${tx('rs_qual')}</th></tr></thead><tbody>${pRows}</tbody></table></div>`:`<div class="empty-ok">${tx('rs_noP')}</div>`}
  </section>`;
}

function vLibrary(){
  const list=[...S.qtps].sort((a,b)=>String(a.code||a.id).localeCompare(String(b.code||b.id)));
  const use=new Map(); for(const t of S.tests) if(counts(t)&&t.qtp){const k=qid(t.qtp); use.set(k,(use.get(k)||0)+1);}
  const noDur=list.filter(q=>!(+q.durVal>0)).length;
  const rows=list.map(q=>{const b=eqById(q.equipmentId);
    return `<tr class="click ${+q.durVal>0?'':'miss'}" data-act="edit-q" data-id="${esc(q.id)}"><td class="ref nowrap">${esc(q.code||q.id)}</td><td><b>${esc(q.name||'')}</b>${q.testType||q.standard?`<span class="snip">${esc([q.testType,q.standard].filter(Boolean).join(' · '))}</span>`:''}${q.notes?`<span class="snip">${esc(q.notes)}</span>`:''}</td><td>${esc(b?eqName(b):'—')}</td><td><div class="chips">${(q.instrumentos||[]).map(fleChip).join('')||'<span class="muted">—</span>'}</div></td><td class="nowrap">${+q.durVal>0?`${esc(q.durVal)} ${esc(unitS(q.durUnit||'Hours'))}${q.durBasis==='sample'?` <small class="muted">${tx('perSample')}</small>`:''}${q.durUnit==='Cycles'&&q.cyclesPerDay?` <small class="muted">${esc(tx('perDay',q.cyclesPerDay))}</small>`:''}`:`<span class="due warn">${tx('notSet')}</span>`}</td><td>${q.continuous===false?tx('workH'):'24/7'}</td><td>${esc(loadSummary(q))}</td><td class="num">${use.get(q.id)||0}</td></tr>`}).join('');
  const I=S.qimp;
  return `<div class="view-h"><h2>${tx('v_library')}</h2>${S.ro||S.noDb?'':`<button class="btn" data-act="new-q">${tx('lib_addQ')}</button>`}</div>
  <p class="muted" style="margin:0;max-width:90ch">${tx('lib_help')}</p>
  ${S.ro||S.noDb?'':`<section class="panel"><div class="panel-h"><h2>${tx('lib_impH')}</h2><span class="muted">${tx('lib_impSub')}</span></div>
    <label class="drop-zone" data-dz="qtp"><input type="file" id="file-qtp" accept=".xlsx,.xls,.csv"><b>${tx('lib_drop')}</b><span class="muted">${tx('lib_dropSub')}</span></label>
    ${I?qtpImportPanel(I):''}</section>`}
  <section class="panel"><div class="panel-h"><h2>${tx('lib_procs')}</h2><span class="muted">${tx('nQtps',list.length)}${noDur?` · <b class="due warn">${tx('lib_noDur',noDur)}</b>`:''}</span></div>
    ${list.length?`<div class="scroll-x"><table class="tbl"><thead><tr><th>QTP</th><th>${tx('col_tname')}</th><th>${tx('col_defEq')}</th><th>${tx('fle_h')}</th><th>${tx('col_dur')}</th><th>${tx('col_runs')}</th><th>${tx('col_tload')}</th><th class="num">${tx('rs_active')}</th></tr></thead><tbody>${rows}</tbody></table></div>`:`<div class="empty-ok">${tx('lib_empty')}</div>`}
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
  if(!window.XLSX) throw new Error(tx('e_xlsx'));
  const buf=await f.arrayBuffer(), isCsv=/\.csv$/i.test(f.name);
  const wb=XLSX.read(buf,{type:'array',raw:isCsv});
  const ws=fixSheet(wb.Sheets[wb.SheetNames[0]]);
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true});
  const hi=aoa.findIndex(r=>r.filter(c=>String(c).trim()!=='').length>=2);
  if(hi<0) throw new Error(tx('e_head'));
  /* "Column N" names an empty header; it is saved in the column mapping, so it stays in English. */
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
  return `<div class="map-grid">${fields.map(f=>`<div class="field ${f.req?'req':''}"><label for="map-${kind}-${f.k}">${tx((kind==='aras'?'af_':'qf_')+f.k)}</label><select id="map-${kind}-${f.k}" data-map="${f.k}" data-kind="${kind}"><option value="">${tx('notImp')}</option>${I.headers.map(h=>`<option ${I.map[f.k]===h?'selected':''}>${esc(h)}</option>`).join('')}</select></div>`).join('')}</div>`;
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
  if(!list.length) return I.done?`<section class="panel"><div class="panel-h"><h2>${tx('sp_h')}</h2></div><div class="empty-ok">${tx('sp_same')}</div></section>`:'';
  const n=list.filter(r=>ch[r._conflict.id]).length;
  return `<section class="panel"><div class="panel-h"><h2>${tx('sp_h')} · ${list.length}</h2><span class="muted">${tx('sp_sub')}</span>
    <span class="sp"></span><button class="btn sm ghost" data-act="sc-all" data-v="app">${tx('sp_allApp')}</button><button class="btn sm ghost" data-act="sc-all" data-v="aras">${tx('sp_allAras')}</button></div>
    <div class="scroll-x"><table class="tbl"><thead><tr><th>PLR · QTP</th><th>${tx('col_testS')}</th><th>${tx('sp_keep')}</th><th>${tx('sp_use')}</th></tr></thead><tbody>
    ${list.map(r=>{const c=r._conflict, v=ch[c.id]; return `<tr><td class="ref nowrap">${esc(r.plr+' · '+r.qtp)}${r.equipmentName?`<br><small class="muted">${esc(r.equipmentName)}</small>`:''}</td><td>${esc(r.title||'')}</td>
      <td><label class="check"><input type="radio" name="sc-${esc(c.id)}" data-sc="${esc(c.id)}" value="app" ${v==='app'?'checked':''} ${dis()}><span class="pill est st-${ST_CLS[c.from]||''}">${esc(stName(c.from))}</span></label></td>
      <td><label class="check"><input type="radio" name="sc-${esc(c.id)}" data-sc="${esc(c.id)}" value="aras" ${v==='aras'?'checked':''} ${dis()}><span class="pill est st-${ST_CLS[c.to]||''}">${esc(stName(c.to))}</span>${c.aras!==c.to?` <small class="muted">(${esc(c.aras)})</small>`:''}</label></td></tr>`}).join('')}
    </tbody></table></div>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-act="sc-apply" ${n&&!S.ro?'':'disabled'}>${tx('sp_apply',n,list.length)}</button></div>
    <p class="note" style="margin-top:10px">${tx('sp_note')}</p></section>`;
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
  try{await Promise.all(jobs); toast(tx('sp_done',nA,nK));}catch(e){toast(errMsg(e));}
  render();
}
/* Field names of the import "Changes" column. */
const chgTxt=a=>(a||[]).map(k=>tx('chg')[k]||k).join(', ');
function importPanelAras(){
  const I=S.imp, P=arasPreview(); I.P=P;
  if(I.done) return `<section class="panel"><div class="panel-h"><h2>${tx('imp_doneH')}</h2><span class="muted">${esc(I.fileName)}</span><span class="sp"></span><button class="btn sm ghost" data-act="cancel-import">${tx('close')}</button></div>
    <div class="imp-sum"><span class="tag-st new">${tx('nNew',I.done.nNew)}</span><span class="tag-st update">${tx('nUpd',I.done.nUpd)}</span></div>
    ${(n=>n&&!S.ro?`<div class="row" style="margin-top:8px"><span>📦 ${esc(tx('impProp',n))}</span>${APP==='samples'?`<button class="btn sm primary" data-view="samples">${esc(tx('impGo'))}</button>`:`<a class="btn sm primary" href="../muestras/">${esc(tx('impGo'))}</a>`}</div>`:'')(smpProposals().length)}
    ${I.done.rows.length?`<div class="scroll-x" style="margin-top:8px"><table class="tbl"><thead><tr><th>${tx('imp_res')}</th><th>PLR · QTP</th><th>${tx('col_testS')}</th><th>${tx('imp_chg')}</th></tr></thead><tbody>${I.done.rows.slice(0,250).map(r=>`<tr><td><span class="tag-st ${r.st}">${tx(r.st==='update'?'imp_updated':r.st==='hist'?'imp_newHist':'imp_new')}</span></td><td class="ref nowrap">${esc(r.ref)}</td><td>${esc(r.title||'')}</td><td><small class="muted">${esc(chgTxt(r.changes))}</small></td></tr>`).join('')}</tbody></table></div>`:''}</section>
  ${statusPanel(P)}`;
  const c=k=>P.recs.filter(r=>r._st===k).length, upd=P.recs.filter(r=>r._st==='update'&&!r._quiet).length, stch=P.recs.filter(r=>r._patch&&r._patch.status).length;
  const label=tx('imp_st');
  const show=P.recs.filter(r=>r._st!=='same'||r._quiet).filter(r=>!r._quiet).slice(0,250);
  const eqOpts=[...S.equipment].sort(byName);
  return `<section class="panel"><div class="panel-h"><h2>${tx('imp_mapH')}</h2><span class="muted">${esc(I.fileName)} · ${tx('nRows',I.rows.length)}</span></div>
    <p class="note" style="margin-bottom:10px">${tx('imp_mapNote')}</p>
    ${mappingGrid(I,ARAS_FIELDS,'aras')}</section>
  ${P.unknownEq.size?`<section class="panel"><div class="panel-h"><h2>${tx('imp_eqH')}</h2><span class="muted">${tx('imp_eqSub')}</span></div>
    <div class="eqmap">${[...P.unknownEq].map(([n,o])=>`<div class="from">${esc(o.name)} <small>· ${tx('nTasks',o.count)}</small></div><select class="fsel" data-eqmap="${esc(n)}" aria-label="${esc(tx('a_eqFor',o.name))}"><option value="__new" ${P.eqMap[n]==='__new'?'selected':''}>${esc(tx('eq_new',o.name))}</option><option value="__none" ${P.eqMap[n]==='__none'?'selected':''}>${tx('eq_none')}</option>${eqOpts.map(b=>`<option value="${esc(b.id)}" ${P.eqMap[n]===b.id?'selected':''}>${esc(tx('eq_use',eqName(b)))}</option>`).join('')}</select>`).join('')}</div></section>`:''}
  <section class="panel"><div class="panel-h"><h2>${tx('imp_prevH')}</h2>
    <div class="imp-sum"><span class="tag-st new">${tx('imp_nNewAct',c('new'))}</span><span class="tag-st hist">${tx('imp_nNewHist',c('hist'))}</span><span class="tag-st update">${tx('imp_nUpd',upd,stch)}</span><span class="tag-st same">${tx('imp_nSame',c('same')+P.recs.filter(r=>r._quiet).length)}</span>${c('skip')?`<span class="tag-st skip">${tx('imp_nSkip',c('skip'))}</span>`:''}${c('error')?`<span class="tag-st error">${tx('imp_nErr',c('error'))}</span>`:''}</div></div>
    <label class="check" style="margin-bottom:8px"><input type="checkbox" id="inc-closed" ${S.incClosed?'checked':''}> ${tx('imp_incClosed')}</label>
    ${P.newPeople.size||P.newQtps.size?`<p class="note" style="margin-bottom:8px">${P.newPeople.size?tx('imp_newP',esc([...P.newPeople.values()].join(', '))):''}${P.newQtps.size?tx('imp_newQ',P.newQtps.size,esc([...P.newQtps.values()].map(x=>x.code).join(', '))):''}</p>`:''}
    ${!I.map.plr||!I.map.qtp?`<p class="form-err">${tx('imp_needKeys')}</p>`:''}
    <div class="scroll-x"><table class="tbl"><thead><tr><th>${tx('imp_res')}</th><th>PLR · QTP</th><th>${tx('col_testS')}</th><th>${tx('col_project')}</th><th>${tx('col_req')}</th><th>${tx('imp_arasSt')}</th><th>${tx('imp_chg')}</th></tr></thead><tbody>
    ${show.map(r=>`<tr><td><span class="tag-st ${r._st}">${label[r._st]}</span></td><td class="ref nowrap">${esc((r.plr||'—')+' · '+(r.qtp||'—'))}${r.equipmentName?`<br><small class="muted">${esc(r.equipmentName)}</small>`:''}</td><td>${esc(r.title||'')}</td><td>${esc(r.project||'')}</td><td>${esc(r.requester||'')}</td><td class="nowrap">${esc(r.status||'—')}${r._status&&r._st!=='update'&&r._st!=='same'?` → ${esc(stName(r._status))}`:''}</td><td><small class="muted">${esc(chgTxt(r._changes))}</small></td></tr>`).join('')}
    </tbody></table></div>${show.length===250?`<p class="muted">${tx('imp_first250')}</p>`:''}
    <div class="row" style="margin-top:12px"><button class="btn primary" data-act="do-import" ${!I.map.plr||!I.map.qtp||!(c('new')+c('hist')+upd+P.recs.filter(r=>r._quiet).length)||S.ro?'disabled':''}>${tx('imp_btn',c('new')+c('hist'),upd)}</button><button class="btn ghost" data-act="cancel-import">${tx('imp_discard')}</button></div>
    <p class="note" style="margin-top:10px">${tx('imp_note')}</p>
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
  const btn=$('[data-act="do-import"]'); if(btn){btn.disabled=true; btn.textContent=tx('imp_busy');}
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
        jobs.push(()=>db.doc(`${COL.tests}/${r._match.id}`).update(patch)); if(!r._quiet){nUpd++; doneRows.push({st:'update',ref:`${r.plr} · ${r.qtp}`,title:r.title,changes:r._changes});}
      }
    }
    /* The import queues all writes together so it becomes one commit. */
    const keepEq={...((S.cfg.importAras&&S.cfg.importAras.eqMap)||{}),...P.eqMap};
    jobs.push(()=>db.doc('config/importAras').set({map:I.map,eqMap:keepEq,lastFile:I.fileName,date:now,includeClosed:S.incClosed}));
    await Promise.all(jobs.map(j=>j()));
    I.done={nNew,nUpd,rows:doneRows}; toast(tx('imp_done',nNew,nUpd)); render();
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
  const recs=qtpPreview(); I.recs=recs; const c=k=>recs.filter(r=>r._st===k).length, label={...tx('imp_st'),error:tx('qi_noCode')};
  return `<div style="display:grid;gap:12px;margin-top:14px">
    <p class="note">${esc(I.fileName)} · ${tx('nRows',I.rows.length)}. ${tx('qi_note')}</p>
    ${mappingGrid(I,QTP_FIELDS,'qtp')}
    <div class="imp-sum"><span class="tag-st new">${tx('nNew',c('new'))}</span><span class="tag-st update">${tx('nUpd',c('update'))}</span><span class="tag-st same">${tx('imp_nSame',c('same'))}</span>${c('error')?`<span class="tag-st error">${tx('qi_nErr',c('error'))}</span>`:''}</div>
    <div class="scroll-x"><table class="tbl"><thead><tr><th>${tx('imp_res')}</th><th>QTP</th><th>${tx('col_tname')}</th><th>${tx('col_dur')}</th><th class="num">${tx('qi_techH')}</th><th>${tx('col_eq')}</th></tr></thead><tbody>
    ${recs.slice(0,200).map(r=>`<tr><td><span class="tag-st ${r._st}">${label[r._st]}</span></td><td class="ref">${esc(r.code||'—')}</td><td>${esc(r.name||'')}</td><td class="nowrap">${r.durVal!==''?esc(r.durVal+' '+(r._unit?unitS(r._unit):''))+(r._basis==='sample'?` <small class="muted">${tx('perSample')}</small>`:''):'—'}</td><td class="num">${r.techHours!==''?esc(r.techHours):'—'}</td><td>${esc(r.equipmentName||'')}${r.equipmentName&&!r._eq?` <small class="muted">${tx('qi_notFound')}</small>`:''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row"><button class="btn primary" data-act="do-qimport" ${!I.map.code||!(c('new')+c('update'))||S.ro?'disabled':''}>${tx('imp_btn',c('new'),c('update'))}</button><button class="btn ghost" data-act="cancel-qimport">${tx('imp_discard')}</button></div>
  </div>`;
}
async function runQtpImport(){
  const I=S.qimp; if(!I||!db) return; const now=nowIso(), jobs=[];
  for(const r of I.recs||qtpPreview()){
    if(r._st==='new') jobs.push(()=>db.doc(`${COL.qtps}/${qid(r.code)}`).set({code:r.code.trim(),name:r.name||'',durVal:r.durVal,durUnit:r._unit,continuous:true,techHours:r.techHours,durBasis:r._basis||'test',techBasis:'test',equipmentId:r._eq||'',testType:r.testType||'',standard:r.standard||'',notes:r.notes||'',actualizado:now}));
    else if(r._st==='update') jobs.push(()=>db.doc(`${COL.qtps}/${r._q.id}`).update({...r._patch,actualizado:now}));
  }
  try{const n=jobs.length; jobs.push(()=>db.doc('config/importQtp').set({map:I.map,date:now})); await Promise.all(jobs.map(j=>j())); S.qimp=null; toast(tx('qi_done',n)); render();}catch(e){toast(errMsg(e));}
}

function vImport(){
  return `<div class="view-h"><h2>${tx('im_h')}</h2>${S.tests.length?`<button class="btn" data-act="export">${tx('im_export')}</button>`:''}</div>
  <ol class="steps">${tx('im_steps')}</ol>
  ${S.ro||S.noDb?'':`<label class="drop-zone" data-dz="aras"><input type="file" id="file-aras" accept=".xlsx,.xls,.csv"><b>${tx('im_drop')}</b><span class="muted">${tx('im_dropSub')}</span></label>`}
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
  }catch(e){toast(tx('e_read',e.message||e));}
}

/* ---------- Export ---------- */
/* Lab-only spreadsheet (nothing imports it back): headers and display values follow the chosen language. */
async function exportXlsx(){
  if(!window.XLSX) return;
  const H=tx('xl_cols');
  const rows=[...S.tests].sort((a,b)=>STATUSES.indexOf(a.status)-STATUSES.indexOf(b.status)||String(a.plr).localeCompare(String(b.plr))).map(t=>{const ei=endInfo(t), x=effDur(t);
    const v=[t.plr||'',t.qtp||'',t.title||'',t.project||'',t.requester||'',stName(t.status||''),t.arasStatus||'',prioName(t.priority||''),t.equipmentId?eqName(eqById(t.equipmentId)):'',personById(t.techId)?.nombre||'',t.start||'',ei.end!=null?iso(ei.end):'',tx('xl_end')[ei.kind]||ei.kind,x?x.val:'',x?unitName(x.unit):'',x?x.src:'',effTech(t)||'',+t.progress||0,t.requestedDue||'',t.agreedDue||'',tx(t.flexible?'yes':'no'),resName(t.result||''),t.closedAt||'',t.pieces??'',t.sequence??'',t.comments||'',t.labNotes||'',t.holdReason||''];
    return Object.fromEntries(H.map((h,i)=>[h,v[i]]));});
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),tx('xl_sheet'));
  const buf=XLSX.write(wb,{type:'array',bookType:'xlsx'});
  const url=URL.createObjectURL(new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})), a=document.createElement('a');
  a.href=url; a.download=`${tx('xl_file')}_${iso(todayMs())}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),2000);
}

/* ---------- Dialogs ---------- */
const dlg=$('#dlg');
const dis=()=>S.ro?'disabled':'';
function fld(id,label,inner,cls='',help=''){return `<div class="field ${cls}"><label for="${id}">${label}</label>${inner}${help?`<span class="help" id="${id}-help">${help}</span>`:''}</div>`}
function inp(name,val,type='text',extra=''){return `<input id="f-${name}" name="${name}" type="${type}" value="${esc(val??'')}" ${extra} ${dis()}>`}
function sel(name,val,opts,extra=''){return `<select id="f-${name}" name="${name}" ${extra} ${dis()}>${opts.map(o=>{const [v,l]=Array.isArray(o)?o:[o,o]; return `<option value="${esc(v)}" ${String(val??'')===String(v)?'selected':''}>${esc(l)}</option>`}).join('')}</select>`}
/* Options whose stored value stays in English and whose label follows the language. */
const optsOf=(list,name)=>list.map(v=>[v,name(v)]);
function dlgShell(eyebrow,title,body,footerLeft=''){
  return `<form class="dlg-form" id="dlg-form" novalidate><header class="dlg-h"><div><p class="eyebrow">${eyebrow}</p><h2>${esc(title)}</h2></div><button type="button" class="icon-btn" data-act="close" aria-label="${esc(tx('close'))}">×</button></header>
  <div class="dlg-body">${body}<div id="f-err" class="form-err" hidden></div></div>
  <footer class="dlg-f">${S.ro?'':footerLeft}<span class="sp"></span><button type="button" class="btn ghost" data-act="close">${tx(S.ro?'close':'cancel')}</button>${S.ro?'':`<button class="btn primary" type="submit">${tx('save')}</button>`}</footer></form>`;
}
const delBtn=()=>`<button type="button" class="btn ghost danger" data-act="del">${tx('delete')}</button>`;
function openEditor(id){
  const isNew=!id, t=isNew?{status:'Queued',priority:'Medium',source:'Manual'}:S.tests.find(x=>x.id===id);
  if(!t) return;
  dlg.dataset.kind='test'; dlg.dataset.id=id||'';
  const eqOpts=[['',tx('none_o')],...[...S.equipment].sort(byName).map(b=>[b.id,eqName(b)+(eqStatus(b)!=='Operational'?` (${eqStName(eqStatus(b))})`:'')+` · ${tx('capS',eqCap(b))}`])];
  if(t.equipmentId&&!eqById(t.equipmentId)) eqOpts.push([t.equipmentId,tx('delEq')]);
  const pOpts=[['',tx('none_o')],...[...S.people].sort(byName).map(p=>[p.id,p.nombre])];
  const fromAras=t.source==='ARAS';
  const sibs=isNew?[]:S.tests.filter(x=>x.id!==t.id&&x.plr&&String(x.plr).toUpperCase()===String(t.plr).toUpperCase()).sort((a,b)=>(a.sequence||99)-(b.sequence||99)||String(a.qtp).localeCompare(String(b.qtp)));
  const body=`<fieldset><legend>${tx('ed_req')}${fromAras?tx('fromAras'):''}</legend>
    ${fld('f-plr',tx('ed_plr'),inp('plr',t.plr,'text','placeholder="PLR000000"'),'req')}
    ${fld('f-qtp',tx('ed_qtp'),inp('qtp',t.qtp,'text','list="qtp-list" placeholder="QTP0000"'),'req')}
    ${fld('f-title',tx('ed_desc'),inp('title',t.title),'span2')}
    ${fld('f-project',tx('col_project'),inp('project',t.project,'text',`placeholder="${esc(tx('ph_project'))}"`))}
    ${fld('f-requester',tx('ed_requester'),inp('requester',t.requester))}
    ${fld('f-pieces',tx('ed_pieces'),inp('pieces',t.pieces,'number','min="0" step="1"'),'','<span id="pieces-help"></span>')}
    ${fld('f-sequence',tx('ed_seq'),inp('sequence',t.sequence,'number','min="0" step="1"'))}
    ${fld('f-requestedDue',tx('ed_reqDue'),inp('requestedDue',t.requestedDue,'date'))}
    <div class="field"><span class="lbl">${tx('ed_flexQ')}</span><label class="check"><input type="checkbox" id="f-flexible" name="flexible" value="1" ${t.flexible?'checked':''} ${dis()}> ${tx('ed_flex')}</label></div>
    ${fld('f-comments',tx('ed_com'),`<textarea id="f-comments" name="comments" class="tall" ${dis()}>${esc(t.comments||'')}</textarea>`,'span2')}
    ${t.category?`<div class="field span2"><span class="lbl">${tx('ed_cat')}</span><span>${esc(t.category)}</span></div>`:''}
    ${fromAras?`<p class="note span2">${tx('ed_arasNote',esc(t.arasStatus||'—'),esc(t.arasEquipment||'—'),esc(t.arasTech||'—'),t.arasDurVal?`${esc(t.arasDurVal)} ${esc(t.arasDurUnit?unitName(t.arasDurUnit):'')}`:'',t.requestNote?esc(t.requestNote):'')}</p>`:''}
  </fieldset>
  <fieldset><legend>${tx('ed_plan')}</legend>
    ${fld('f-status',tx('col_status'),sel('status',t.status,optsOf(STATUSES,stName)),'',tx('ed_reportHelp'))}
    ${fld('f-priority',tx('ed_prio'),sel('priority',t.priority||'Medium',optsOf(PRIOS,prioName)))}
    ${fld('f-equipmentId',tx('col_eq'),sel('equipmentId',t.equipmentId||'',eqOpts),'','<span id="eq-sug"></span>')}
    ${fld('f-techId',tx('col_tech'),sel('techId',t.techId||'',pOpts))}
    ${fld('f-start',tx('col_startS'),inp('start',t.start,'date'))}
    ${fld('f-end',tx('ed_end'),inp('end',t.end,'date'),'','<span id="end-help"></span>')}
    <div class="field"><label for="f-durVal">${tx('ed_dur')}</label><div class="inline">${inp('durVal',t.durVal,'number','min="0" step="any" style="flex:1"')}${sel('durUnit',t.durUnit||'Hours',optsOf(UNITS,unitName),'style="flex:1"')}</div><span class="help" id="dur-help"></span></div>
    ${fld('f-continuous',tx('col_runs'),sel('continuous',t.continuous||'',[['',tx('run_def')],['yes',tx('run_yes')],['no',tx('run_no')]]))}
    ${fld('f-techHours',tx('ed_techH'),inp('techHours',isEndu(t)?'':t.techHours,'number',`min="0" step="0.5" ${isEndu(t)?'readonly':''}`),'','<span id="tech-help"></span>')}
    ${fld('f-progress',tx('ed_prog'),inp('progress',t.progress,'number','min="0" max="100" step="5"'))}
    ${fld('f-agreedDue',tx('ed_agreed'),inp('agreedDue',t.agreedDue,'date'),'',tx('ed_agreedHelp'))}
    ${fld('f-result',tx('ed_result'),sel('result',t.result||'',[['','—'],...optsOf(RESULTS,resName)]))}
    ${fld('f-holdReason',tx('ed_hold'),inp('holdReason',t.holdReason,'text',`placeholder="${esc(tx('ed_holdPh'))}"`),'span2')}
    ${fld('f-labNotes',tx('ed_notes'),`<textarea id="f-labNotes" name="labNotes" ${dis()}>${esc(t.labNotes||'')}</textarea>`,'span2')}
    <div class="span2 note" id="f-hint"></div>
  </fieldset>
  <div id="f-warn"></div>
  ${sibs.length?`<div><p class="eyebrow" style="margin-bottom:6px">${tx('ed_sibs',esc(t.plr))}</p><div class="siblings">${sibs.map(x=>`<button type="button" data-act="open-sib" data-id="${esc(x.id)}"><span class="ref">${esc(ref(x))}</span><span>${esc(x.title||'')}</span>${x.sequence?`<span class="chip">${esc(tx('seqN',x.sequence))}</span>`:''}<span class="sp"></span>${estPill(x.status)}${resTag(x.result)}</button>`).join('')}</div></div>`:''}
  ${isNew||APP==='occupancy'?'':smpEditorBlock(t)}`;
  dlg.innerHTML=dlgShell(tx(isNew?'ed_eyNew':fromAras?'ed_eyAras':'ed_eyManual'),isNew?tx('ed_new'):`${baseRef(t)} · ${t.title||''}`,body,isNew?'':delBtn());
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
  $('#f-warn').innerHTML=al.length?`<ul class="alerts">${al.map(a=>`<li class="${a.sev}"><span class="sev">${tx(a.sev==='crit'?'sev_crit':'sev_warn')}</span><span>${esc(a.text)}</span></li>`).join('')}</ul>`:'';
  const tdef={...t,durVal:''}, def=effDur(tdef);
  $('#dur-help').textContent=+t.durVal>0?tx('h_durOver',def?tx('xFrom',durLabel(def),def.src):tx('theDefault')):def?tx('h_durUse',tx('xFrom',durLabel(def),def.src)):tx('h_durNone');
  $('#f-durVal').placeholder=def?String(def.val):'';
  const ph=$('#pieces-help'); if(ph){const per=L&&(L.durBasis==='sample'||(L.techBasis==='sample'&&!isEndu(t))); ph.textContent=per?(piecesSet(t)?tx('h_perS',samplesOf(t)):tx('h_perS0')):'';}
  const lt=libTech(t), ltNote=L&&L.techBasis==='sample'&&lt?tx('h_ltNote',L.techHours,samplesOf(t)):''; if(isEndu(t)){const ti=$('#f-techHours'); ti.readOnly=true; ti.value=''; ti.placeholder=fmtH(effTech(t)); $('#tech-help').textContent=tx('h_endu',enduBody(L));} else {$('#f-techHours').readOnly=false; $('#tech-help').textContent=+t.techHours?(lt?tx('h_thOver',fmtH(lt),ltNote):''):lt?tx('h_thUse',fmtH(lt),ltNote):tx('h_thNone');
  $('#f-techHours').placeholder=lt?String(lt):'';}
  const ei=endInfo(t); $('#end-help').textContent=t.end?tx('h_endSet'):ei.kind==='auto'?tx('h_endAuto',fmtMs(ei.end)):t.start?tx('h_endUnk'):tx('h_endEmpty');
  const sug=$('#eq-sug'); if(sug){ const lb=L&&eqById(L.equipmentId); sug.innerHTML=!t.equipmentId&&lb?`${tx('h_qtpDef')} <button type="button" class="link" data-act="use-eq" data-id="${esc(lb.id)}">${esc(eqName(lb))}</button>`:''; }
  let hint=''; if(t.status==='Not approved') hint=tx('h_noap'); else if(APP==='occupancy'&&t.equipmentId){const fr=freeFrom(ix,t.equipmentId,t.id); hint+=tx('h_free',fr==null?'—':fr===todayMs()?tx('today'):fmtMs(fr),eqCap(eqById(t.equipmentId)));}
  const s=d(t.start); if(t.status!=='Not approved'&&s!=null&&ei.end!=null&&ei.kind!=='open'){const wdn=workdays(s,ei.end); hint+=tx('h_days',(ei.end-s)/DAY+1,wdn);
    if(isEndu(t)){const pl=techPlan(t,s,Math.max(s,ei.end),false), P=pl.parts, Lq=libOf(t); hint+=tx('h_enduLoad',+Lq.setupH||0,P.setupDays,+Lq.dailyH||0,P.dailyDays,P.reviews,+Lq.reviewH||0,+Lq.teardownH||0,P.teardownDays,fmtH(planTotal(pl)));}
    else {const th=effTech(t); if(th) hint+=tx('h_perDay',(th/(wdn||1)).toLocaleString(LL.locale(),{minimumFractionDigits:1,maximumFractionDigits:1}));} hint+='.';}
  $('#f-hint').innerHTML=hint;
}
function openPerson(id){
  const p=id?personById(id):{nombre:'',rol:tx('pe_rolDef'),horasSemana:40,habilitaciones:[]}; if(!p) return;
  dlg.dataset.kind='person'; dlg.dataset.id=id||'';
  const body=`<fieldset><legend>${tx('rs_person')}</legend>
    ${fld('f-nombre',tx('pe_name'),inp('nombre',p.nombre,'text','required'),'req')}
    ${fld('f-rol',tx('pe_rol'),inp('rol',p.rol))}
    ${fld('f-horasSemana',tx('pe_hours'),inp('horasSemana',p.horasSemana,'number','min="0" max="60" step="1"'))}
    <div class="field span2"><span class="lbl">${tx('pe_qual')}</span><div class="checks">${[...S.equipment].sort(byName).map(b=>`<label><input type="checkbox" name="hab" value="${esc(b.id)}" ${(p.habilitaciones||[]).includes(b.id)?'checked':''} ${dis()}>${esc(eqName(b))}</label>`).join('')||`<span class="muted">${tx('pe_addEq')}</span>`}</div></div>
    <p class="note span2">${tx('pe_note')}</p>
  </fieldset>`;
  dlg.innerHTML=dlgShell(tx(id?'pe_edit':'pe_new'),id?p.nombre:tx('pe_new'),body,id?delBtn():'');
  if(!dlg.open) dlg.showModal();
}
function openEquipment(id){
  const b=id?eqById(id):{nombre:'',nombreAras:'',descripcion:'',estado:'Operational',capacidad:1,proximaCalibracion:''}; if(!b) return;
  dlg.dataset.kind='equipment'; dlg.dataset.id=id||'';
  const body=`<fieldset><legend>${tx('col_eq')}</legend>
    ${fld('f-nombre',tx('pe_name'),inp('nombre',b.nombre,'text','required'),'req')}
    ${fld('f-nombreAras',tx('eq_aras'),inp('nombreAras',b.nombreAras,'text',`placeholder="${esc(tx('eq_arasPh'))}"`),'',tx('eq_arasHelp'))}
    ${fld('f-capacidad',tx('eq_cap'),inp('capacidad',eqCap(b),'number','min="1" max="200" step="1"'),'',tx('eq_capHelp'))}
    ${fld('f-estado',tx('col_status'),sel('estado',eqStatus(b),optsOf(EQ_STATUS,eqStName)))}
    ${fld('f-proximaCalibracion',tx('rs_nextCal'),inp('proximaCalibracion',b.proximaCalibracion,'date'))}
    ${fld('f-descripcion',tx('eq_desc'),inp('descripcion',b.descripcion),'span2')}
  </fieldset>
  <fieldset><legend>${tx('fle_h')}</legend>${flePicker(b.instrumentos||[])}</fieldset>`;
  dlg.innerHTML=dlgShell(tx(id?'eq_edit':'eq_newT'),id?eqName(b):tx('eq_newT'),body,id?delBtn():'');
  if(!dlg.open) dlg.showModal();
}
function flePicker(ids,what='fle_thisEq'){
  const picked=new Set(ids);
  if(!CAL.eq) return `<p class="note span2">${tx('fle_conn',CAL.err?tx('fle_loadErr'):tx('fle_loading'),`${REPO.owner}/${REPO.repo}`,ids.length>0)}</p>${ids.length?`<div class="chips span2">${ids.map(fleChip).join('')}</div>`:''}`;
  const all=Object.entries(CAL.eq).map(([id,e])=>({...e,id})).filter(e=>picked.has(e.id)||!['Reserved','Retired'].includes(e.state));
  ids.filter(id=>!CAL.eq[id]).forEach(id=>all.push({id,code:String(id).replace(/^eq-/,''),group:'',missing:true}));
  const grp=e=>e.group==='Test equipment'?0:e.group==='Auxiliary equipment'?1:2;
  all.sort((a,b)=>grp(a)-grp(b)||String(a.code).localeCompare(String(b.code),'en',{numeric:true})||a.id.localeCompare(b.id));
  let last=null; const rows=all.map(e=>{const s=fleState(e.missing?null:e), g=grp(e), h=g!==last?`<h4>${tx('fle_grp')[g]}</h4>`:''; last=g;
    return `${h}<label data-s="${esc(norm([e.code,e.description,e.brand,e.model,e.serial].join(' ')))}"><input type="checkbox" name="fle" value="${esc(e.id)}" ${picked.has(e.id)?'checked':''} ${dis()}><span class="mono">${esc(e.code)}</span><span>${esc(e.missing?tx('fle_del'):fleLabel(e))}</span><span class="due ${s.cls==='off'?'':s.cls}">${esc(s.text)}</span></label>`}).join('');
  return `<p class="note span2">${tx('fle_note',tx(what))}</p>
    <div class="field span2"><input id="fle-q" type="search" placeholder="${esc(tx('fle_ph'))}" autocomplete="off" aria-label="${esc(tx('fle_a'))}">
    <div class="fle-list" id="fle-list">${rows}</div><div class="chips" id="fle-sel">${fleSel(ids)}</div></div>`;
}
const fleSel=ids=>ids.length?`<span class="muted">${tx('fle_n',ids.length)}</span> ${ids.map(fleChip).join('')}`:`<span class="muted">${tx('fle_none0')}</span>`;
function openQtp(id){
  const q=id?S.qtps.find(x=>x.id===id):{code:'',name:'',durVal:'',durUnit:'Hours',continuous:true,cyclesPerDay:'',techHours:'',equipmentId:'',notes:''}; if(!q) return;
  dlg.dataset.kind='qtp'; dlg.dataset.id=id||'';
  const eqOpts=[['',tx('none_o')],...[...S.equipment].sort(byName).map(b=>[b.id,eqName(b)])];
  const basis=[['test',tx('perTest')],['sample',tx('perSample')]], runs=[['yes',tx('run_yes')],['no',tx('run_no')]];
  const body=`<fieldset><legend>${tx('qt_leg')}</legend>
    ${fld('f-code',tx('qf_code'),inp('code',q.code||q.id,'text',id?'readonly':'placeholder="QTP0000"'),'req')}
    ${fld('f-name',tx('col_tname'),inp('name',q.name),'span2')}
    ${fld('f-testType',tx('qf_testType'),inp('testType',q.testType))}
    ${fld('f-standard',tx('qf_standard'),inp('standard',q.standard,'text',`placeholder="${esc(tx('qt_stdPh'))}"`))}
    <div class="field span2"><label for="f-durVal">${tx('ed_dur')}</label><div class="inline">${inp('durVal',q.durVal,'number','min="0" step="any" style="flex:1"')}${sel('durUnit',q.durUnit||'Hours',optsOf(UNITS,unitName),'style="flex:1"')}${sel('durBasis',q.durBasis==='sample'?'sample':'test',basis,`style="flex:1.2" aria-label="${esc(tx('qt_durBasis'))}"`)}</div><span class="help">${tx('qt_perSHelp')}</span></div>
    ${fld('f-continuous',tx('col_runs'),sel('continuous',q.continuous===false?'no':'yes',runs))}
    ${fld('f-cyclesPerDay',tx('qt_cpd'),inp('cyclesPerDay',q.cyclesPerDay,'number','min="0" step="any"'),'',tx('qt_cpdHelp'))}
    ${fld('f-equipmentId',tx('col_defEq'),sel('equipmentId',q.equipmentId||'',eqOpts))}
    ${fld('f-profile',tx('qt_prof'),sel('profile',q.profile==='endurance'?'endurance':'even',[['even',tx('qt_profEven')],['endurance',tx('qt_profEndu')]]),'span2')}
    <div class="field span2" id="even-fields" ${q.profile==='endurance'?'hidden':''}><label for="f-techHours">${tx('qf_techHours')}</label><div class="inline" style="max-width:420px">${inp('techHours',q.techHours,'number','min="0" step="0.5" style="flex:1"')}${sel('techBasis',q.techBasis==='sample'?'sample':'test',basis,`style="flex:1.2" aria-label="${esc(tx('qt_techBasis'))}"`)}</div><span class="help">${tx('qt_perSHelp')}</span></div>
    <div class="span2" id="endu-fields" ${q.profile==='endurance'?'':'hidden'}><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">
      ${fld('f-setupH',tx('qt_setupH'),inp('setupH',q.setupH,'number','min="0" step="0.5"'),'',tx('qt_setupHelp',LOAD_DAY))}
      ${fld('f-dailyH',tx('qt_dailyH'),inp('dailyH',q.dailyH,'number','min="0" step="0.25"'),'',tx('qt_dailyHelp'))}
      <div class="field"><label for="f-reviewEvery">${tx('qt_revEvery')}</label><div class="inline">${inp('reviewEvery',q.reviewEvery,'number','min="0" step="any" style="flex:1"')}${sel('reviewUnit',q.reviewUnit||'Hours',optsOf(['Hours','Days','Weeks'],unitName),'style="flex:1"')}</div><span class="help">${tx('qt_revHelp')}</span></div>
      ${fld('f-reviewH',tx('qt_revH'),inp('reviewH',q.reviewH,'number','min="0" step="0.5"'))}
      ${fld('f-teardownH',tx('qt_tearH'),inp('teardownH',q.teardownH,'number','min="0" step="0.5"'),'',tx('qt_tearHelp',LOAD_DAY))}
    </div></div>
    ${fld('f-notes',tx('qf_notes'),`<textarea id="f-notes" name="notes" ${dis()}>${esc(q.notes||'')}</textarea>`,'span2')}
    <p class="note span2">${tx('qt_note')}</p>
  </fieldset>
  <fieldset><legend>${tx('fle_h')}</legend>${flePicker(q.instrumentos||[],'fle_thisQtp')}</fieldset>`;
  dlg.innerHTML=dlgShell(tx(id?'qt_edit':'qt_new'),id?`${q.code||q.id} · ${q.name||''}`:tx('qt_new'),body,id?delBtn():'');
  if(!dlg.open) dlg.showModal();
}
const num=v=>v===''||v==null||isNaN(+v)?'':+v;
function formErr(m){const el=$('#f-err'); el.textContent=m; el.hidden=!m; return null;}
async function saveDialog(){
  if(dlg.dataset.kind==='gh') return saveGh();
  if(dlg.dataset.kind==='smp-rc') return smpSaveReceive(false);
  if(dlg.dataset.kind==='smp-lot') return smpSaveLot();
  if(dlg.dataset.kind==='smp-lb'||dlg.dataset.kind==='smp-gen'||dlg.dataset.kind==='smp-as') return;
  if(!db||S.ro) return;
  const kind=dlg.dataset.kind, id=dlg.dataset.id, f=readForm(), now=nowIso(), T=iso(todayMs());
  try{
    if(kind==='test'){
      if(!f.plr&&!f.qtp) return formErr(tx('e_plrQtp'));
      if(!f.qtp) return formErr(tx('e_qtp'));
      if(f.start&&f.end&&d(f.end)<d(f.start)) return formErr(tx('e_endStart'));
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
      if(!f.nombre) return formErr(tx('e_name'));
      const data={nombre:f.nombre,rol:f.rol||'',horasSemana:+f.horasSemana||0,habilitaciones:[...dlg.querySelectorAll('input[name="hab"]:checked')].map(x=>x.value),actualizado:now};
      if(id) await db.doc(`${COL.people}/${id}`).update(data); else await db.collection(COL.people).add(data);
    }else if(kind==='equipment'){
      if(!f.nombre) return formErr(tx('e_name'));
      const data={nombre:f.nombre,nombreAras:f.nombreAras||'',descripcion:f.descripcion||'',estado:f.estado||'Operational',capacidad:Math.max(1,parseInt(f.capacidad)||1),proximaCalibracion:f.proximaCalibracion||'',actualizado:now};
      if(CAL.eq) data.instrumentos=[...dlg.querySelectorAll('input[name="fle"]:checked')].map(x=>x.value); else if(!id) data.instrumentos=[];
      if(id) await db.doc(`${COL.equipment}/${id}`).update(data); else await db.collection(COL.equipment).add(data);
    }else if(kind==='qtp'){
      const code=(f.code||'').trim(); if(!code) return formErr(tx('e_code'));
      if(!id&&S.qtps.some(q=>q.id===qid(code))) return formErr(tx('e_codeDup',code));
      const data={code:id?(S.qtps.find(q=>q.id===id).code||code):code.toUpperCase(),name:f.name||'',durVal:f.durVal===''?'':+f.durVal,durUnit:f.durUnit||'Hours',continuous:f.continuous!=='no',cyclesPerDay:f.cyclesPerDay===''?'':+f.cyclesPerDay,techHours:f.techHours===''?'':+f.techHours,durBasis:f.durBasis==='sample'?'sample':'test',techBasis:f.techBasis==='sample'?'sample':'test',equipmentId:f.equipmentId||'',testType:f.testType||'',standard:f.standard||'',notes:f.notes||'',profile:f.profile==='endurance'?'endurance':'even',
        setupH:num(f.setupH),dailyH:num(f.dailyH),reviewEvery:num(f.reviewEvery),reviewUnit:f.reviewUnit||'Hours',reviewH:num(f.reviewH),teardownH:num(f.teardownH),actualizado:now};
      if(CAL.eq) data.instrumentos=[...dlg.querySelectorAll('input[name="fle"]:checked')].map(x=>x.value); else if(!id) data.instrumentos=[];
      if(id) await db.doc(`${COL.qtps}/${id}`).update(data); else await db.doc(`${COL.qtps}/${qid(code)}`).set(data);
    }
    dlg.close(); toast(tx('savedT'));
  }catch(e){formErr(errMsg(e));}
}
async function deleteFromDialog(btn){
  if(!btn.classList.contains('armed')){btn.classList.add('armed'); btn.textContent=tx('delConfirm'); return;}
  const kind=dlg.dataset.kind, id=dlg.dataset.id, col={test:COL.tests,person:COL.people,equipment:COL.equipment,qtp:COL.qtps}[kind];
  try{await db.doc(`${col}/${id}`).delete(); dlg.close(); toast(tx('deletedT'));}catch(e){formErr(errMsg(e));}
}

/* ---------- Status changes ---------- */
async function setStatus(id,status,{openHold=true}={}){
  const t=S.tests.find(x=>x.id===id); if(!t||t.status===status||!db) return;
  const T=iso(todayMs()), patch={status,updated:nowIso()};
  if(RUNNING.has(status)&&!t.start) patch.start=T;
  if(CLOSED.includes(status)) patch.closedAt=t.closedAt||T; else if(t.closedAt) patch.closedAt='';
  if(status==='Completed') patch.progress=100;
  try{await db.doc(`${COL.tests}/${id}`).update(patch); toast(`${baseRef(t)} → ${stName(status)}${CLOSED.includes(status)?tx('toHist'):''}`); if(openHold&&status==='On hold'&&!t.holdReason) openEditor(id);}catch(err){toast(errMsg(err)); render();}
}

async function setDate(id,field,value){
  const t=S.tests.find(x=>x.id===id); if(!t||!db) return;
  const patch={updated:nowIso()}; let msg='';
  if(field==='start'){
    if((t.start||'')===value) return;
    if(value&&t.end&&d(t.end)<d(value)){toast(tx('e_startAfter')); render(); return;}
    patch.start=value; msg=value?tx('m_start',fmt(value)):tx('m_startClr');
    if(value&&t.status==='Queued'){patch.status='Planned'; msg+=tx('m_toPlanned');}
  }else{
    const ei=endInfo(t), auto=ei.kind==='auto'?iso(ei.end):'';
    if(!value){ if(!t.end) {render(); return;} patch.end=''; msg=tx('m_endAuto'); }
    else{
      if(t.start&&d(value)<d(t.start)){toast(tx('e_endBefore')); render(); return;}
      if(value===(t.end||'')||(!t.end&&value===auto)) return;
      patch.end=value; msg=tx('m_end',fmt(value));
    }
  }
  try{await db.doc(`${COL.tests}/${id}`).update(patch); toast(`${baseRef(t)}: ${msg}`);}catch(e){toast(errMsg(e)); render();}
}
async function setTech(id,techId){
  const t=S.tests.find(x=>x.id===id); if(!t||!db||(t.techId||'')===techId) return;
  try{await db.doc(`${COL.tests}/${id}`).update({techId,updated:nowIso()}); const p=personById(techId); toast(`${baseRef(t)} → ${p?p.nombre:tx('unassigned')}`);}catch(e){toast(errMsg(e)); render();}
}

/* ---------- Samples (muestras) ----------
   Each reception of samples is one document in the collection "muestras": one QTS-xxxxx number per reception and
   one suffix per physical unit (-1, -2…), which keeps its number when it is withdrawn. A reception is linked to one or
   more PLRs; its tests are the ARAS tests (PLR · QTP) of those PLRs, so an ARAS import updates them here too.
   Units whose codes come from an ARAS request start as "expected" and count as received once someone receives them.
   All its texts go through tx(). */
const SMP=['expected','received','waiting','testing','tested','stored','returned','scrapped'];
const SMP_CLS={expected:'exp',received:'plan',waiting:'cola',testing:'curso',tested:'inf',stored:'cerr',returned:'endu',scrapped:'canc'};
const SMP_DEFAULT=['expected','received','waiting','testing','tested','stored'];
/* Sample codes started on this date: PLRs already imported before it and still without receptions are not chased for samples. */
const SMP_SINCE='2026-11-01';
const SMP_PHASES=['Feasibility','MSL','ESL','Pilot','Production','N/A'];
/* Labels are designed lying down (w = long side, h = short side). The LabelWriter feeds them short side first, so the
   printed page is h wide and w long and the label is turned 90° on it (see smpPrint).
   Sizes in mm: qr = side of the QR (about 0.35 mm per module at 14 mm with error correction L); id, l2 (PLR · QTP),
   ds (description) and ft (footer) = font sizes. */
const SMP_LABELS={
  /* Font sizes in mm: id = QTS code, plr / qtp = the PLR and QTP lines, ds = description, ft = date. */
  '99012':{w:89,h:36,n:'99012 Large Address · 36 × 89 mm',qr:22,id:6.4,plr:5.4,qtp:4.8,ds:3.6,ft:3},
  '99010':{w:89,h:28,n:'99010 Standard Address · 28 × 89 mm',qr:18,id:5.2,plr:4.4,qtp:3.8,ds:3,ft:2.6},
  '11354':{w:57,h:32,n:'11354 Multi-purpose · 32 × 57 mm',qr:15,id:4.8,plr:4.8,qtp:4.2,ds:3,ft:2.6},
  '11352':{w:54,h:25,n:'11352 Return Address · 25 × 54 mm',qr:14,id:4.5,plr:4.2,qtp:3.6,ds:2.6,ft:2.4}};
const SMP_CODE_RE=/QTS-\d{5}(?:-\d+)?/i;
const SMP_I18N={
es:{
  au_btn:'Entrar', au_btn_t:'Entra con tu correo para ver y cambiar los datos', au_eyebrow:'Acceso', au_title:'Entrar con tu correo',
  au_mail:'Correo', au_pass:'Contraseña', au_enter:'Entrar',
  au_forgot:'¿Has olvidado la contraseña? Pídesela a un administrador.', au_wait:'Comprobando…', au_key:'Usar una clave de GitHub', au_cancel:'Cancelar', au_close:'Cerrar', au_signout:'Salir',
  au_as:(n,m)=>`Has entrado como <b>${n}</b> (${m}).`, au_in:n=>`Has entrado como ${n}.`, au_edit:'Puedes editar.', au_view:'Solo puedes consultar.',
  au_none:'No tienes acceso a esta app.', au_noapp:'No tienes acceso a esta app. Pídeselo a un administrador.',
  au_again:'Vuelve a entrar', au_expired:'Tu sesión ha caducado.', au_saving:'Guardando…', au_out:'Has salido. Este navegador ya no tiene tu sesión.',
  au_private:'Los datos del laboratorio son privados.', au_ro:n=>`<b>${n}</b>: puedes consultar los datos, pero no cambiarlos. Pide permiso de edición a un administrador.`,
  au_ro_out:'Solo lectura. Para hacer cambios,',
  au_e_mail:'Escribe un correo válido.', au_e_pass:'Escribe tu contraseña.', au_e_cred:'Correo o contraseña incorrectos.', au_e_rate:'Demasiados intentos. Espera unos minutos y vuelve a probar.',
  au_e_net:'No se ha podido conectar. Revisa la conexión y vuelve a probar.',
  au_e_sess:'No se ha podido abrir la sesión. Vuelve a entrar.', au_e_busy:'El servicio del laboratorio está limitando las peticiones. Espera un minuto y vuelve a probar.',
  au_e_down:'La contraseña es correcta, pero el servicio del laboratorio no responde ahora. Vuelve a probar en un momento; la app lo reintenta sola.',
  au_e_save:'Tu sesión ha caducado y el cambio no se ha guardado. Vuelve a entrar y repítelo.', au_e_perm:'No puedes cambiar datos: tu cuenta no tiene permiso de edición en esta app. Pídeselo a un administrador.',
  tab:'Muestras', title:'Muestras',
  search:'Buscar o escanear: QTS, PLR, QTP, proyecto, nº serie…',
  byPlr:'Por PLR', list:'Lista',
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
  closedPlr:'Ensayos cerrados', oldPlr:'Anterior al 1/11/2026: sin códigos QTS', legacy:'Referencia antigua (FLT): no está en Control de ensayos',
  alsoIn:p=>`también en ${p}`, noLots:'Aún no ha llegado ninguna muestra.', hiddenN:n=>`${n} recepción${n===1?'':'es'} oculta${n===1?'':'s'} por el filtro`,
  by:'por', units:n=>`${n} ud${n===1?'':'s'}.`, notPrinted:'sin etiqueta', receiveFor:'+ Recibir',
  noMatch:'Ninguna muestra cumple el filtro.', noPlr:'Ningún PLR cumple el filtro.',
  empty_h:'Aún no hay muestras ni ensayos', empty_p:'Importa el Excel de ARAS en Importar ARAS: cada PLR aparecerá aquí, listo para recibir sus muestras. También puedes recibir muestras de un PLR escribiéndolo a mano.',
  c_sample:'Muestra', c_plr:'PLR · QTP', c_desc:'Descripción', c_proj:'Proyecto', c_phase:'Fase proyecto', c_state:'Estado', c_pn:'Part number', c_sn:'Nº serie', c_loc:'Ubicación', c_recv:'Recepción', c_com:'Comentarios',
  several:'varios', expandAll:'Desplegar todo', collapseAll:'Contraer todo', listHelp:'Cada recepción (QTS-xxxxx) agrupa sus unidades (-1, -2…). El estado de cada unidad se cambia en la tabla; el resto, abriendo la recepción.',
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
  errPlr:'Indica el PLR.', errLinked:p=>`Deja al menos un ensayo de ${p} marcado, o pulsa «Quitar este PLR».`, errDesc:'Escribe la descripción de la muestra.', errQty:'Tiene que haber al menos una unidad.',
  saved:c=>`Recepción ${c} guardada.`,
  lot_eyebrow:c=>`Recepción ${c}`, addUnit:'+ Añadir unidad', allTo:'Todas a…', withdraw:'Retirar', restore:'Recuperar',
  printed:'Impresa', notPrintedS:'Pendiente', history:'Historial', del:'Eliminar recepción', delArm:'Pulsa otra vez para eliminar',
  deleted:c=>`Recepción ${c} eliminada. Su número no se vuelve a usar.`, unitsHelp:'Las unidades retiradas conservan su número: no se reutiliza. Una unidad nueva recibe el siguiente sufijo libre.',
  linked:'Ensayos enlazados', linkedHelp:'Desmarca los ensayos que no usan estas muestras. Para reutilizarlas en otra petición, asígnalas a otro PLR.', ltAdd:'Asignar a otro PLR', ltRm:'Quitar este PLR', assign:'Usar muestras existentes', as_eyebrow:'Reutilizar muestras', as_title:p=>`Muestras existentes para ${p}`, as_help:'Elige las recepciones QTS que se vuelven a usar en este PLR. Mantienen sus códigos y etiquetas; quedan enlazadas a todos los ensayos del PLR (puedes desmarcar alguno en la ficha de cada recepción).', as_ok:'Asignar al PLR', as_n:n=>`${n} recepci${n===1?'ón':'ones'} elegida${n===1?'':'s'}`, as_done:(n,p)=>`${n} recepci${n===1?'ón asignada':'ones asignadas'} a ${p}`, printLot:'Imprimir etiquetas',
  log_recv:n=>`Recibida (${n} ud${n===1?'':'s'}.)`, log_state:(c,a,b)=>`${c}: ${a} → ${b}`, log_add:c=>`${c} añadida`, log_rm:c=>`${c} retirada`, log_back:c=>`${c} recuperada`, log_edit:'Datos de la recepción editados', log_plrAdd:p=>`Asignada también a ${p}`, log_plrRm:p=>`Quitada de ${p}`, log_tests:'Ensayos enlazados cambiados', log_print:n=>`${n} etiqueta${n===1?'':'s'} impresa${n===1?'':'s'}`,
  lb_eyebrow:'Etiquetas · DYMO LabelWriter 550', lb_title:n=>`Imprimir ${n} etiqueta${n===1?'':'s'}`, lb_units:'Unidades', lb_all:'Todas', lb_noneSel:'Ninguna',
  lb_size:'Etiqueta', lb_rot:'Giro al imprimir', lb_rot90:'90° a la derecha', lb_rot270:'90° a la izquierda', lb_rot0:'Sin giro (horizontal)', lb_rot180:'180°', lb_code:'Código', qr:'QR (abre los ensayos del PLR en Control de ensayos)', bar:'Código de barras (Code 128)', noCode:'Sin código',
  lb_show:'Contenido', lb_plr:'PLR · QTP', lb_desc:'Descripción', lb_date:'Fecha de recepción',
  lb_preview:'Vista previa a tamaño real',
  lb_how:'<b>Una vez por equipo:</b> en Windows, Preferencias de impresión de la <b>DYMO LabelWriter 550</b> → tamaño de papel el de la etiqueta y orientación <b>vertical</b>; el navegador usa ese papel, no el de la app.<br><b>En el cuadro de impresión:</b> impresora <b>DYMO LabelWriter 550</b>, tamaño de papel el de la etiqueta (p. ej. <i>11354 Multi-Purpose</i>), orientación <b>vertical</b> (u <b>horizontal</b> si eliges giro 0° o 180°), márgenes <b>ninguno</b>, escala <b>100 %</b> y sin encabezados ni pies de página. Sale una etiqueta por página.',
  imp_dest:'Dónde imprimir', imp_lab:'Impresora del laboratorio', imp_here:'Imprimir aquí (cuadro de impresión de este ordenador)',
  imp_loading:'Consultando la impresora del laboratorio…', imp_on:'Conectada', imp_off:t=>`Sin señal de la estación${t?` desde ${t}`:''}`,
  imp_nocfg:'Sin configurar: un administrador tiene que generar la clave de la estación en la página de accesos.', imp_nodymo:'La estación no encuentra la DYMO',
  imp_roll:'Rollo puesto en la impresora', imp_rollHelp:'Cámbialo solo si cambias el rollo: vale para todo el equipo.', imp_rollSet:n=>`Rollo puesto: ${n}`,
  imp_send:'Enviar a la impresora del laboratorio', imp_render:'Preparando etiquetas…',
  imp_sent:n=>`${n} etiqueta${n===1?'':'s'} en la cola de la impresora del laboratorio.`, imp_sentOff:n=>`${n} etiqueta${n===1?'':'s'} en cola: la estación no da señal, se imprimirán cuando vuelva.`,
  imp_how:'Se imprimen en la DYMO del ordenador fijo del laboratorio con el rollo puesto. Las unidades quedan marcadas como impresas cuando la estación lo confirma.',
  imp_recent:'Tus últimos envíos', imp_st_pendiente:'En cola', imp_st_imprimiendo:(h,n)=>`Imprimiendo ${h}/${n}`, imp_st_impreso:'Enviado a la impresora', imp_st_error:'Error', imp_retry:'Reintentar',
  imp_e_roll:r=>`El rollo puesto ha cambiado (${r}): revisa la vista previa y vuelve a enviar.`, imp_e_render:'Este navegador no puede preparar las etiquetas para la impresora del laboratorio. Usa Chrome o Edge, o «Imprimir aquí».', imp_int:'Interrumpido: la estación dejó de responder a mitad de trabajo', imp_perr:'Error de impresión', imp_e:m=>`No se ha podido enviar a la impresora del laboratorio${m?`: ${m}`:'.'}`,
  lb_print:'Imprimir', lb_done:n=>`${n} etiqueta${n===1?'':'s'} enviada${n===1?'':'s'} a la impresora.`, lb_empty:'Marca al menos una unidad.', lb_noLib:'No se ha podido cargar la librería del código. Revisa la conexión.',
  prop_h:n=>`Códigos por validar · ${n} PLR`, prop_help:'PLR activos con piezas pedidas en ARAS que aún no tienen código. Revisa la propuesta y valida: los números QTS se asignan al validar y las unidades quedan pendientes de recibir.',
  prop_all:'Validar todos', prop_ok:'Validar', prop_okPrint:'Validar e imprimir etiquetas', prop_skip:'Descartar',
  prop_mode:'Piezas', prop_plr:'Las mismas para todo el PLR', prop_line:'Distintas por QTP',
  prop_code:'Código', prop_qtp:'Ensayos (QTP)', prop_units:'Unidades', prop_desc:'Descripción',
  propDone:n=>`${n} código${n===1?'':'s'} QTS creado${n===1?'':'s'}.`, propNone:'No hay ninguna unidad que generar.',
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
  au_btn:'Sign in', au_btn_t:'Sign in with your email to view and change the data', au_eyebrow:'Access', au_title:'Sign in with your email',
  au_mail:'Email', au_pass:'Password', au_enter:'Sign in',
  au_forgot:'Forgot your password? Ask an administrator.', au_wait:'Checking…', au_key:'Use a GitHub key', au_cancel:'Cancel', au_close:'Close', au_signout:'Sign out',
  au_as:(n,m)=>`Signed in as <b>${n}</b> (${m}).`, au_in:n=>`Signed in as ${n}.`, au_edit:'You can edit.', au_view:'You can only view.',
  au_none:'You don\'t have access to this app.', au_noapp:'You don\'t have access to this app. Ask an administrator.',
  au_again:'Sign in again', au_expired:'Your session has expired.', au_saving:'Saving…', au_out:'Signed out. This browser no longer has your session.',
  au_private:'The lab data is private.', au_ro:n=>`<b>${n}</b>: you can view the data but cannot change it. Ask an administrator for edit access.`,
  au_ro_out:'Read-only. To make changes,',
  au_e_mail:'Enter a valid email address.', au_e_pass:'Enter your password.', au_e_cred:'Wrong email or password.', au_e_rate:'Too many attempts. Wait a few minutes and try again.',
  au_e_net:'Could not connect. Check your connection and try again.',
  au_e_sess:'Your session could not be started. Sign in again.', au_e_busy:'The lab service is limiting requests. Wait a minute and try again.',
  au_e_down:'Your password is correct, but the lab service is not responding right now. Try again in a moment; the app also retries on its own.',
  au_e_save:'Your session has expired and the change was not saved. Sign in again and repeat it.', au_e_perm:'You cannot change data: your account does not have edit access to this app. Ask an administrator.',
  tab:'Samples', title:'Samples',
  search:'Search or scan: QTS, PLR, QTP, project, serial no.…',
  byPlr:'By PLR', list:'List',
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
  closedPlr:'Tests closed', oldPlr:'Before 1/11/2026: no QTS codes', legacy:'Old reference (FLT): not in Control de ensayos',
  alsoIn:p=>`also in ${p}`, noLots:'No samples have arrived yet.', hiddenN:n=>`${n} reception${n===1?'':'s'} hidden by the filter`,
  by:'by', units:n=>`${n} unit${n===1?'':'s'}`, notPrinted:'no label', receiveFor:'+ Receive',
  noMatch:'No samples match the filter.', noPlr:'No PLRs match the filter.',
  empty_h:'No samples or tests yet', empty_p:'Import the ARAS export in Import ARAS: each PLR will show up here, ready to receive its samples. You can also receive samples for a PLR by typing it.',
  c_sample:'Sample', c_plr:'PLR · QTP', c_desc:'Description', c_proj:'Project', c_phase:'Project phase', c_state:'Status', c_pn:'Part number', c_sn:'Serial no.', c_loc:'Location', c_recv:'Received', c_com:'Comments',
  several:'several', expandAll:'Expand all', collapseAll:'Collapse all', listHelp:'Each reception (QTS-xxxxx) groups its units (-1, -2…). Change the status of a unit in the table; everything else by opening the reception.',
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
  errPlr:'Enter the PLR.', errLinked:p=>`Keep at least one test of ${p} ticked, or press “Remove this PLR”.`, errDesc:'Enter the sample description.', errQty:'There must be at least one unit.',
  saved:c=>`Reception ${c} saved.`,
  lot_eyebrow:c=>`Reception ${c}`, addUnit:'+ Add unit', allTo:'Set all to…', withdraw:'Withdraw', restore:'Restore',
  printed:'Printed', notPrintedS:'Pending', history:'History', del:'Delete reception', delArm:'Press again to delete',
  deleted:c=>`Reception ${c} deleted. Its number is not used again.`, unitsHelp:'Withdrawn units keep their number: it is never reused. A new unit gets the next free suffix.',
  linked:'Linked tests', linkedHelp:'Untick the tests these samples are not for. To reuse them in another request, assign them to another PLR.', ltAdd:'Assign to another PLR', ltRm:'Remove this PLR', assign:'Use existing samples', as_eyebrow:'Reuse samples', as_title:p=>`Existing samples for ${p}`, as_help:'Pick the QTS receptions that are used again in this PLR. They keep their codes and labels and are linked to all the tests of the PLR (untick any in each reception).', as_ok:'Assign to PLR', as_n:n=>`${n} reception${n===1?'':'s'} picked`, as_done:(n,p)=>`${n} reception${n===1?'':'s'} assigned to ${p}`, printLot:'Print labels',
  log_recv:n=>`Received (${n} unit${n===1?'':'s'})`, log_state:(c,a,b)=>`${c}: ${a} → ${b}`, log_add:c=>`${c} added`, log_rm:c=>`${c} withdrawn`, log_back:c=>`${c} restored`, log_edit:'Reception details edited', log_plrAdd:p=>`Also assigned to ${p}`, log_plrRm:p=>`Removed from ${p}`, log_tests:'Linked tests changed', log_print:n=>`${n} label${n===1?'':'s'} printed`,
  lb_eyebrow:'Labels · DYMO LabelWriter 550', lb_title:n=>`Print ${n} label${n===1?'':'s'}`, lb_units:'Units', lb_all:'All', lb_noneSel:'None',
  lb_size:'Label', lb_rot:'Print rotation', lb_rot90:'90° clockwise', lb_rot270:'90° counter-clockwise', lb_rot0:'No rotation (landscape)', lb_rot180:'180°', lb_code:'Code', qr:'QR (opens the PLR tests in Control de ensayos)', bar:'Barcode (Code 128)', noCode:'No code',
  lb_show:'Content', lb_plr:'PLR · QTP', lb_desc:'Description', lb_date:'Reception date',
  lb_preview:'Preview at real size',
  lb_how:'<b>Once per computer:</b> in Windows, <b>DYMO LabelWriter 550</b> Printing Preferences → paper size of the label and <b>portrait</b> orientation; the browser uses that paper, not the app\'s.<br><b>In the print dialog:</b> printer <b>DYMO LabelWriter 550</b>, paper size of the label (e.g. <i>11354 Multi-Purpose</i>), orientation <b>portrait</b> (or <b>landscape</b> with a 0° or 180° turn), margins <b>none</b>, scale <b>100%</b> and no headers or footers. One label per page.',
  imp_dest:'Where to print', imp_lab:'Lab printer', imp_here:'Print here (this computer’s print dialog)',
  imp_loading:'Checking the lab printer…', imp_on:'Connected', imp_off:t=>`No signal from the station${t?` since ${t}`:''}`,
  imp_nocfg:'Not set up: an administrator has to generate the station key on the access page.', imp_nodymo:'The station cannot find the DYMO',
  imp_roll:'Roll loaded in the printer', imp_rollHelp:'Change it only when you change the roll: it applies to the whole team.', imp_rollSet:n=>`Roll loaded: ${n}`,
  imp_send:'Send to the lab printer', imp_render:'Preparing labels…',
  imp_sent:n=>`${n} label${n===1?'':'s'} queued for the lab printer.`, imp_sentOff:n=>`${n} label${n===1?'':'s'} queued: the station has no signal, they will print when it is back.`,
  imp_how:'They print on the DYMO of the lab’s fixed computer with the roll loaded. The units are marked printed when the station confirms it.',
  imp_recent:'Your recent jobs', imp_st_pendiente:'Queued', imp_st_imprimiendo:(h,n)=>`Printing ${h}/${n}`, imp_st_impreso:'Sent to the printer', imp_st_error:'Error', imp_retry:'Retry',
  imp_e_roll:r=>`The loaded roll has changed (${r}): check the preview and send again.`, imp_e_render:'This browser cannot prepare the labels for the lab printer. Use Chrome or Edge, or “Print here”.', imp_int:'Interrupted: the station stopped answering mid-job', imp_perr:'Print error', imp_e:m=>`Could not send to the lab printer${m?`: ${m}`:'.'}`,
  lb_print:'Print', lb_done:n=>`${n} label${n===1?'':'s'} sent to the printer.`, lb_empty:'Tick at least one unit.', lb_noLib:'Could not load the code library. Check the connection.',
  prop_h:n=>`Codes to validate · ${n} PLR${n===1?'':'s'}`, prop_help:'Active PLRs with pieces requested in ARAS that have no code yet. Check the proposal and validate: the QTS numbers are assigned when you validate, and the units wait to be received.',
  prop_all:'Validate all', prop_ok:'Validate', prop_okPrint:'Validate and print labels', prop_skip:'Dismiss',
  prop_mode:'Pieces', prop_plr:'Same for the whole PLR', prop_line:'Different per QTP',
  prop_code:'Code', prop_qtp:'Tests (QTP)', prop_units:'Units', prop_desc:'Description',
  propDone:n=>`${n} QTS code${n===1?'':'s'} created.`, propNone:'There are no units to create.',
  propSkipped:p=>`${p} dismissed. You can create its codes later from its card.`,
  gen:'Create codes', gen_eyebrow:'Sample codes from ARAS', gen_title:p=>`Create codes · ${p}`,
  gen_help:n=>n?`This PLR already has ${n} unit${n===1?'':'s'} with a code. The proposal covers the ARAS pieces still missing; change the units if needed.`:'The proposal comes from the pieces requested in ARAS; change the units if needed.',
  recvExp:n=>`✓ Mark received (${n})`, recvDone:n=>`${n} unit${n===1?'':'s'} marked as received.`,
  expN:n=>`${n} expected`,
  impProp:n=>`${n} PLR${n===1?'':'s'} with sample codes to validate.`, impGo:'Go to Samples',
  log_gen:n=>`Codes created from ARAS (${n} unit${n===1?'':'s'})`,
  ed_title:p=>`Samples of ${p}`, ed_none:'No samples of this PLR have been received yet.', chip:(r,p)=>p?`Samples ${r}/${p}`:`Samples ${r}`, notFound:c=>`There is no sample ${c}.`
}};
/* Texts of Control de ensayos and Ocupación (and the parts Muestras shares with them), as key:[es,en]. Values written to
   the data (statuses, priorities, units, results…) stay in English: the display maps below only change how they are shown. */
const CE_I18N={
  /* Display maps of stored values */
  stl:[{'Not approved':'No aprobado','Queued':'En cola','Planned':'Planificado','In progress':'En curso','Endurance running':'Endurance en curso','On hold':'Bloqueado','Report':'Informe','Completed':'Completado','Cancelled':'Cancelado'},{}],
  prio:[{Urgent:'Urgente',High:'Alta',Medium:'Media',Low:'Baja'},{}],
  res:[{Pass:'Apto',Fail:'No apto','N/A':'N/A'},{}],
  unit:[{Hours:'Horas',Days:'Días',Weeks:'Semanas',Cycles:'Ciclos'},{}],
  unitS:[{Hours:'h',Days:'d',Weeks:'sem',Cycles:'ciclos'},{Hours:'h',Days:'d',Weeks:'wk',Cycles:'cycles'}],
  eqst:[{'Operational':'Operativo','Maintenance':'Mantenimiento','Calibration':'Calibración','Out of service':'Fuera de servicio'},{}],
  fleSt:[{'Out of service':'Fuera de servicio','Retired':'Retirado','Reserved':'Reservado'},{}],
  ptag:[{setup:'montaje',daily:'control diario',review:'revisión',teardown:'desmontaje'},{}],
  wd:[['Do','Lu','Ma','Mi','Ju','Vi','Sá'],['Su','Mo','Tu','We','Th','Fr','Sa']],
  chg:[{title:'descripción',project:'proyecto',requester:'solicitante',comments:'comentarios',pieces:'piezas',requestedDue:'fecha solicitada',flexible:'fecha flexible',sequence:'secuencia',category:'categoría',requestNote:'nota de la petición',result:'resultado',duration:'duración',equipment:'banco',technician:'técnico',start:'inicio'},
    {title:'description',requestedDue:'requested due date',flexible:'due date flexible',requestNote:'request note'}],

  /* Page header and tabs */
  doc_tests:['Test Lab Control','Test Lab Control'], doc_occupancy:['Ocupación del laboratorio','Lab Occupancy'], doc_samples:['Muestras','Samples'],
  tag_tests:['LAB I+D','R&D LAB'], tag_occupancy:['BANCOS Y EQUIPO','EQUIPMENT & TEAM'], tag_samples:['MUESTRAS','SAMPLES'],
  newTest:['+ Nuevo ensayo','+ New test'], inst:['⤓ Instalar app','⤓ Install app'], a_views:['Vistas','Views'],
  loading:['Cargando datos del laboratorio…','Loading lab data…'],
  v_overview:['Resumen','Overview'], v_board:['Tablero','Board'], v_queue:['Cola','Queue'], v_planning:['Planificación','Planning'], v_history:['Historial','History'],
  v_resources:['Bancos y equipo','Equipment & team'], v_library:['Biblioteca de QTP','QTP library'], v_import:['Importar ARAS','Import ARAS'],
  v_occupancy:['Ocupación','Occupancy'], v_samples:['Muestras','Samples'],

  /* Common words */
  today:['hoy','today'], todayC:['Hoy','Today'], delete:['Eliminar','Delete'], none_o:['— ninguno —','— none —'], notSet:['sin definir','not set'],
  unassigned:['Sin asignar','Unassigned'], unnamed:['(sin nombre)','(unnamed)'], delEq:['(banco eliminado)','(deleted equipment)'], delPerson:['(persona eliminada)','(deleted person)'],
  noDesc:['(sin descripción)','(no description)'], eqs:['Bancos','Equipment'], team:['Equipo','Team'], techs:['Técnicos','Technicians'],
  noEq:['Aún no hay bancos.','No equipment yet.'], noPeople:['Aún no hay nadie en el equipo.','No team members yet.'],
  noEqL:['sin banco','no equipment'], noTechL:['sin técnico','no technician'], endUnknown:['fin desconocido','end unknown'],
  capN:[n=>`capacidad ${n}`,n=>`capacity ${n}`], capS:[n=>`cap. ${n}`,n=>`cap ${n}`], ofN:[n=>`de ${n}`,n=>`of ${n}`],
  hOf:[(a,b)=>`${a} h de ${b} h`,(a,b)=>`${a} h of ${b} h`], perSample:['por muestra','per sample'], perTest:['por ensayo','per test'],
  perDay:[n=>`(${n}/día)`,n=>`(${n}/day)`], workH:['Horario laboral','Working hours'], prof_endu:['Endurance','Endurance'],
  nTests:[n=>`${n} ensayo${n===1?'':'s'}`,n=>`${n} test${n===1?'':'s'}`], nQtps:[n=>`${n} QTP`,n=>`${n} QTPs`],
  nRows:[n=>`${n} fila${n===1?'':'s'}`,n=>`${n} row${n===1?'':'s'}`], nTasks:[n=>`${n} tarea${n===1?'':'s'}`,n=>`${n} task${n===1?'':'s'}`],
  nNew:[n=>`${n} nuevo${n===1?'':'s'}`,n=>`${n} new`], nUpd:[n=>`${n} actualizado${n===1?'':'s'}`,n=>`${n} updated`],
  nWk:[n=>`${n} sem`,n=>`${n} wk`], wkP:['S','W'], wk:['Semana','Week'], wkOf:['Semana del','Week of'], day:['Día','Day'], period:['Periodo','Period'],
  thisWk:['Esta sem.','This wk'], weekend:['fin de semana','weekend'], yes:['Sí','Yes'], no:['No','No'],
  sev_crit:['Crítica','Critical'], sev_warn:['Aviso','Warning'], lg_over:['sobrecarga','overbooked'],
  flex:['flex.','flex'], flexP:[' (flexible)',' (flexible)'], agreedP:[' (acordada)',' (agreed)'],
  src_test:['este ensayo','this test'], src_lib:['biblioteca de QTP','QTP library'],
  src_libS:[(v,u,n,set)=>`biblioteca de QTP · ${v} ${u} × ${n}${set?'':' (piezas sin indicar)'}`,(v,u,n,set)=>`QTP library · ${v} ${u} × ${n}${set?'':' (pieces not set)'}`],
  ld_endu:[(s,d,r,t)=>`montaje ${s} h · diario ${d} h${r?` · revisión ${r[0]} h cada ${r[1]} ${r[2]}`:''} · desmontaje ${t} h`,(s,d,r,t)=>`setup ${s} h · daily ${d} h${r?` · review ${r[0]} h every ${r[1]} ${r[2]}`:''} · teardown ${t} h`],
  ld_even:[(h,ps)=>`${h} h ${ps?'por muestra':'en total'}, repartidas por igual`,(h,ps)=>`${h} h ${ps?'per sample':'total'}, spread evenly`],

  /* Instruments (FLE) from the calibration plan */
  fle_h:['Instrumentos (FLE)','Instruments (FLE)'], fle_none:['no está en el plan de calibración','not in the calibration plan'],
  fle_nreq:['no necesita calibración','no calibration required'], fle_before:['se comprueba antes de usarlo','checked before use'],
  fle_nodates:['faltan las fechas de calibración','calibration dates missing'], fle_over:[m=>`calibración vencida desde ${m}`,m=>`calibration overdue since ${m}`],
  fle_due:[m=>`calibración en ${m}`,m=>`calibration due ${m}`], fle_ok:[m=>`calibrado hasta ${m}`,m=>`calibrated until ${m}`],
  fle_noplan:['plan de calibración sin cargar','calibration plan not loaded'], fle_loadErr:['No se ha podido leer el plan de calibración','The calibration plan could not be read'],
  fle_loading:['El plan de calibración se está cargando','The calibration plan is loading'],
  fle_conn:[(a,repo,has)=>`${a}. Conecta GitHub con una cuenta que pueda leer <span class="mono">${repo}</span> para asignar instrumentos.${has?' Asignados ahora:':''}`,(a,repo,has)=>`${a}. Connect GitHub with an account that can read <span class="mono">${repo}</span> to assign instruments.${has?' Assigned now:':''}`],
  fle_grp:[['Equipos de ensayo','Equipos auxiliares','Otros'],['Test equipment','Auxiliary equipment','Other']],
  fle_del:['(eliminado del plan de calibración)','(deleted from the calibration plan)'],
  fle_note:[w=>`Instrumentos del plan de calibración que se suelen usar en ${w}.`,w=>`Instruments from the calibration plan that are usually used on ${w}.`],
  fle_thisEq:['este banco','this equipment'], fle_thisQtp:['este procedimiento','this test procedure'],
  fle_ph:['Filtrar por código, descripción, marca o modelo','Filter by code, description, brand or model'], fle_a:['Filtrar instrumentos','Filter instruments'],
  fle_n:[n=>`${n} asignado${n===1?'':'s'}:`,n=>`${n} assigned:`], fle_none0:['Ninguno asignado.','None assigned.'],

  /* Alerts: short label (al_x) and text (al_x_t) */
  al_noStart:['Sin fecha de inicio','No start date'], al_noStart_t:[(r,s)=>`${r}: ${s} sin fecha de inicio.`,(r,s)=>`${r}: ${s} without a start date.`],
  al_noDur:['Sin duración','No duration'], al_noDur_t:[r=>`${r}: sin duración estimada en el ensayo ni en la biblioteca de QTP, así que no se sabe cuándo termina.`,r=>`${r}: no estimated duration on the test or in the QTP library, so the end date is unknown.`],
  al_dates:['Fechas incoherentes','Dates inconsistent'], al_dates_t:[r=>`${r}: el fin previsto es anterior al inicio.`,r=>`${r}: the planned end is before the start.`],
  al_cap:['Capacidad superada','Over capacity'], al_cap_t:[(b,n,f,c)=>`${b}: ${n} ensayos a la vez desde el ${f} (capacidad ${c}).`,(b,n,f,c)=>`${b}: ${n} tests at the same time from ${f} (capacity ${c}).`],
  al_eqOff:['Banco no operativo','Equipment not operational'], al_eqOff_t:[(r,b,s)=>`${r}: ${b} está en estado «${s}».`,(r,b,s)=>`${r}: ${b} is in status "${s}".`],
  al_calx:['Calibración caducada','Calibration expired'], al_calx_t:[(b,d,r)=>`${b}: calibración caducada el ${d} (lo usa ${r}).`,(b,d,r)=>`${b}: calibration expired on ${d} (used by ${r}).`],
  al_cald:['Calibración próxima','Calibration due'], al_cald_t:[(b,d,r,e)=>`${b}: calibración el ${d}, antes de que termine ${r} (${e}).`,(b,d,r,e)=>`${b}: calibration due on ${d}, before ${r} ends (${e}).`],
  al_qual:['Sin habilitación','Not qualified'], al_qual_t:[(p,b,r)=>`${p} no tiene habilitación en ${b} (${r}).`,(p,b,r)=>`${p} is not qualified on ${b} (${r}).`],
  al_late:['Termina después de la fecha','Ends after due date'], al_late_t:[(r,e,ag,d,fl)=>`${r}: el fin previsto ${e} es posterior a la fecha ${ag?'acordada':'solicitada'} ${d}${fl}.`,(r,e,ag,d,fl)=>`${r}: planned end ${e} is after the ${ag?'agreed':'requested'} date ${d}${fl}.`],
  al_over:['Fuera de plazo','Overdue'], al_over_t:[(r,n,ag,d,fl)=>`${r}: ${n} días después de la fecha ${ag?'acordada':'solicitada'} ${d}${fl}.`,(r,n,ag,d,fl)=>`${r}: ${n} days past the ${ag?'agreed':'requested'} date ${d}${fl}.`],
  al_soon:['Vence pronto','Due soon'], al_soon_t:[(r,d)=>`${r}: sigue en cola y vence el ${d}.`,(r,d)=>`${r}: still queued and due on ${d}.`],
  al_past:['Fin previsto superado','Past planned end'], al_past_t:[(r,e,s)=>`${r}: el fin previsto era el ${e} y sigue ${s}.`,(r,e,s)=>`${r}: planned end was ${e} and it is still ${s}.`],
  al_hold:['Bloqueado','On hold'], al_hold_t:[(r,why)=>`${r} está bloqueado${why?': '+why:' (sin motivo)'}.`,(r,why)=>`${r} is on hold${why?': '+why:' (no reason given)'}.`],
  al_tech:['Técnico sobrecargado','Technician overloaded'], al_tech_t:[(p,pc,w)=>`${p} llega al ${pc} % de su capacidad la semana del ${w}.`,(p,pc,w)=>`${p} reaches ${pc}% of capacity in the week of ${w}.`],
  al_techG:[(p,h,w,c,pc)=>`${p}: ${h} h asignadas la semana del ${w} (capacidad ${c} h, ${pc} %).`,(p,h,w,c,pc)=>`${p}: ${h} h assigned in the week of ${w} (capacity ${c} h, ${pc}%).`],
  al_calxG:[(b,d)=>`${b}: calibración caducada el ${d}.`,(b,d)=>`${b}: calibration expired on ${d}.`],
  al_caldG:[(b,d,n)=>`${b}: calibración el ${d} (dentro de ${n} días).`,(b,d,n)=>`${b}: calibration due on ${d} (in ${n} days).`],
  alerts:['Alertas','Alerts'], alerts_sub:[n=>`${n} activa${n===1?'':'s'} · los ensayos completados, cancelados y no aprobados nunca generan alertas`,n=>`${n} active · completed, cancelled and not approved tests never raise alerts`],
  al_none:['Ningún ensayo fuera de fecha y ningún ensayo bloqueado o incoherente.','No tests past their dates and no blocked or inconsistent tests.'],
  al_none_occ:['Sin conflictos: ningún banco por encima de su capacidad y ningún técnico sobrecargado.','No conflicts: no equipment over capacity and no overloaded technicians.'],

  /* Banners */
  b_noRead:[(l,repo)=>`<b>Tu cuenta ${l} no puede ver los datos del laboratorio.</b> Pide al propietario que te añada al repositorio privado <span class="mono">${repo}</span>.`,(l,repo)=>`<b>Your account ${l} cannot see the lab data.</b> Ask the owner to add you to the private repository <span class="mono">${repo}</span>.`],
  b_private:[pv=>`<b>Los datos del laboratorio son privados.</b> Pulsa Conectar GitHub con una cuenta que tenga acceso para verlos${pv}.`,pv=>`<b>The lab data is private.</b> Press Connect GitHub with an account that has access to see it${pv}.`],
  b_noLoad:[pv=>`<b>No se han podido cargar los datos del laboratorio desde GitHub.</b> Revisa la conexión y recarga la página${pv}.`,pv=>`<b>Could not load the lab data from GitHub.</b> Check your connection and reload the page${pv}.`],
  b_pvTry:[', o <button class="link" data-pv="demo-on">prueba la vista previa con datos de ejemplo</button>',', or <button class="link" data-pv="demo-on">try the preview with example data</button>'],
  b_demo:['<b>Vista previa con datos de ejemplo.</b> Los datos son inventados y los cambios se guardan solo en este navegador; no se lee ni se envía nada a GitHub. También puedes importar un Excel de ARAS para probarlo. <button class="link" data-pv="demo-reset">Restablecer los datos de ejemplo</button> · <button class="link" data-pv="demo-off">Usar los datos reales</button>',
    '<b>Preview with example data.</b> The data is invented and changes are kept only in this browser; nothing is read from or sent to GitHub. You can also import an ARAS export to try it. <button class="link" data-pv="demo-reset">Reset the example data</button> · <button class="link" data-pv="demo-off">Use the real data</button>'],
  b_pvReal:['<b>Versión de vista previa.</b> Muestra los datos reales de <span class="mono">lab-data</span>, pero los cambios no se guardan en GitHub: se quedan en esta página hasta que la recargues.','<b>Preview version.</b> It shows the real data from <span class="mono">lab-data</span>, but changes are not saved to GitHub: they stay in this page until you reload it.'],
  b_invalid:['Tu clave de GitHub ya no es válida o ha caducado. <button class="link" data-act="gh">Conecta GitHub</button> y pega una nueva.','Your GitHub key is no longer valid or has expired. <button class="link" data-act="gh">Connect GitHub</button> and paste a new one.'],
  b_noPush:[l=>`Tu cuenta de GitHub <b>${l}</b> no puede editar este repositorio. Pide que te añadan como colaborador con el rol Write.`,l=>`Your GitHub account <b>${l}</b> cannot edit this repository. Ask to be added as a collaborator with the Write role.`],
  b_ro:['Solo lectura. Para crear o cambiar ensayos, <button class="link" data-act="gh">conecta GitHub</button> con una cuenta con permiso de escritura en el repositorio.','Read-only. To create or change tests, <button class="link" data-act="gh">connect GitHub</button> with an account that has write access to the repository.'],

  /* Empty states */
  nt_eyebrow:['Aún no hay ensayos','No tests yet'], nt_occ_h:['Aún no hay nada que planificar','Nothing to plan yet'],
  nt_occ_p:['Los ensayos se crean en <a href="../control-ensayos/">Control de ensayos</a>, a mano o desde el Excel de ARAS. Aparecen aquí en cuanto se guardan.','Tests are created in <a href="../control-ensayos/">Control de ensayos</a>, by hand or from the ARAS export. They appear here as soon as they are saved.'],
  nt_h:['Importa el Excel de ARAS para empezar','Import your ARAS export to get started'],
  nt_p:['Exporta a Excel la búsqueda de peticiones del laboratorio en ARAS y cárgala en <b>Importar ARAS</b>. Cada fila se convierte en un ensayo identificado por su PLR y su QTP. También puedes crear ensayos a mano con <b>+ Nuevo ensayo</b>.','Export the lab request search from ARAS to Excel and load it in <b>Import ARAS</b>. Each row becomes one test identified by its PLR and QTP. You can also create tests by hand with <b>+ New test</b>.'],
  nt_imp:['Importar desde ARAS','Import from ARAS'], nt_res:['Revisar bancos y equipo','Check equipment & team'], nt_lib:['Abrir la biblioteca de QTP','Open QTP library'],
  search_ph:['Buscar PLR, QTP, proyecto, solicitante…','Search PLR, QTP, project, requester…'], a_search:['Buscar','Search'],

  /* Overview */
  ov_h:['Resumen del laboratorio','Lab overview'], ov_planned:[n=>`${n} planificado${n===1?'':'s'}`,n=>`${n} planned`], ov_endu:['ensayos de larga duración','long-running tests'],
  ov_queued:['pendientes de planificar','waiting to be planned'], ov_report:['ensayos terminados, informe en redacción','tests finished, report in writing'],
  ov_hold:['ensayos bloqueados','blocked tests'], ov_overdue:['Fuera de plazo','Overdue'], ov_overdue_s:['pasada la fecha solicitada o acordada','past requested or agreed date'],
  ovo_h:['Resumen de ocupación','Occupancy overview'], ovo_team:['Carga del equipo esta semana','Team load this week'], ovo_overP:['Técnicos sobrecargados','Overloaded technicians'],
  ovo_thisWk:['esta semana','this week'], ovo_inUse:['Bancos en uso hoy','Equipment in use today'], ovo_over_s:['bancos con más ensayos que su capacidad','equipment double-booked'],
  ovo_next:[n=>`Ocupación, próximas ${n} semanas`,n=>`Occupancy, next ${n} weeks`], ovo_teamH:['Equipo · horas asignadas / capacidad semanal','Team · assigned hours / weekly capacity'],
  ovo_eqH:['Bancos · puestos-día usados / disponibles (capacidad × 7)','Equipment · slot-days used / available (capacity × 7)'],
  slotPct:[(p,c)=>`${p} % de ${c} puesto(s)`,(p,c)=>`${p}% of ${c} slot(s)`],

  /* Board and queue */
  c_eq:['Banco','Equipment'], c_tech:['Técnico','Technician'], c_planL:['Plan','Plan'], c_due:['Fecha límite','Due'],
  pl_ns:[d=>d?`sin planificar · est. ${d}`:'sin planificar',d=>d?`not scheduled · est. ${d}`:'not scheduled'],
  bd_h:['Tablero de ensayos','Test board'], bd_help:['Arrastra una tarjeta para cambiar su estado, o ábrela para editarla. Informe = ensayo terminado, informe en redacción.','Drag a card to change its status, or open it to edit. Report = test finished, report being written.'],
  bd_done:['Suelta aquí para marcarlo como <b>Completado</b> y pasarlo al Historial','Drop here to mark as <b>Completed</b> and move it to History'],
  bd_canc:['Suelta aquí para marcarlo como <b>Cancelado</b> y pasarlo al Historial','Drop here to mark as <b>Cancelled</b> and move it to History'],
  q_h:['Cola de ensayos','Test queue'], a_stShown:['Estados mostrados','Statuses shown'],
  q_help:['Pulsa la cabecera de una columna para ordenar. El técnico, el estado y las fechas de inicio y fin se cambian directamente en la tabla. Al poner fecha de inicio a un ensayo en cola pasa a Planificado.','Click a column header to sort. Technician, status, start and end dates can be changed directly in the table. Setting a start date on a queued test moves it to Planned.'],
  q_none:['No hay ensayos con los estados elegidos.','No tests with the selected statuses.'],
  d_over:[n=>`${n} d de retraso`,n=>`${n} d overdue`], d_in:[n=>`dentro de ${n} d`,n=>`in ${n} d`], freeFrom:[x=>`libre ${x}`,x=>`free ${x}`],
  a_techOf:[r=>`Técnico de ${r}`,r=>`Technician of ${r}`], a_stOf:[r=>`Estado de ${r}`,r=>`Status of ${r}`],
  a_startOf:[r=>`Fecha de inicio de ${r}`,r=>`Start date of ${r}`], a_endOf:[r=>`Fecha de fin de ${r}`,r=>`End date of ${r}`],
  end_manual:['manual','manual'], end_auto:['auto','auto'], end_nodur:['sin duración','no duration'],
  end_t_clear:['Borra la fecha para calcularla con inicio + duración','Clear the date to compute it from start + duration'], end_t_first:['Pon antes una fecha de inicio','Set a start date first'],
  end_t_manual:['Puesta a mano. Borra la fecha para volver a inicio + duración estimada.','Set by hand. Clear the date to go back to start + estimated duration.'], end_t_auto:['Inicio + duración estimada','Start + estimated duration'],
  noEst:['sin estimación','no estimate'],
  col_tech:['Técnico','Technician'], col_status:['Estado','Status'], col_project:['Proyecto','Project'], col_test:['Ensayo · comentarios','Test · comments'], col_testS:['Ensayo','Test'],
  col_start:['Fecha de inicio','Start date'], col_end:['Fecha de fin','End date'], col_dur:['Duración est.','Est. duration'], col_due:['Fecha límite','Due'], col_req:['Solicitante','Requester'],
  col_result:['Resultado','Result'], col_eq:['Banco','Equipment'], col_startS:['Inicio','Start'], col_closed:['Cierre','Closed'],
  col_tname:['Nombre del ensayo','Test name'], col_defEq:['Banco por defecto','Default equipment'], col_runs:['Régimen','Runs'], col_tload:['Carga de técnico','Technician load'],

  /* Planning */
  pl_h:['Planificación por recurso','Planning by resource'], a_zoom:['Zoom','Zoom'], z_q:['Trimestre','Quarter'], z_w:['Semanas','Weeks'], z_d:['Días','Days'],
  pl_hide:['Ocultar bancos sin ensayos en este periodo','Hide equipment with no tests in this period'],
  pl_help:['Cada fila de banco muestra un carril por ensayo en paralelo; un borde rojo indica más ensayos que la capacidad del banco. Las fechas de fin con ~ son inicio + duración estimada (Horas y Días cuentan 24/7 salvo que el QTP diga horario laboral). Las barras atenuadas no tienen fin conocido.',"Equipment rows show one lane per test running in parallel; a red edge means more tests than the equipment's capacity. End dates marked ~ are start + estimated duration (Hours and Days run 24/7 unless the QTP says working hours). Faded bars have no known end."],
  pl_missing:[n=>` <b>${n} ensayo(s) planificados o en curso no tienen fecha de inicio y no se muestran.</b>`,n=>` <b>${n} planned or running test(s) have no start date and are not shown.</b>`],
  pl_hidden:[n=>`${n} sin ensayos ocultos`,n=>`${n} without tests hidden`], pl_noEqP:['Ningún banco tiene ensayos en este periodo','No equipment has tests in this period'],
  pl_thisWk:[(h,c)=>`esta semana ${h}/${c} h`,(h,c)=>`this week ${h}/${c} h`],

  /* History */
  hi_none_h:['Aún no hay ensayos completados ni cancelados','No completed or cancelled tests yet'],
  hi_none_p:['Los ensayos pasan aquí cuando su estado es Completado o Cancelado, en esta app o con una importación de ARAS. Nunca generan alertas.','Tests move here when their status becomes Completed or Cancelled, either in this app or through an ARAS import. They never raise alerts.'],
  hi_allSt:['Todos los estados','All statuses'], hi_allRes:['Todos los resultados','All results'], hi_noRes:['Sin resultado','No result'],
  hi_sum:[(c,x,p,f)=>`${c} completado${c===1?'':'s'} · ${x} cancelado${x===1?'':'s'}${p+f?` · aptos a la primera ${Math.round(p/(p+f)*100)} % (${p} aptos, ${f} no aptos)`:''}. Los ensayos cerrados no generan alertas. Pulsa una cabecera para ordenar; abre un ensayo y cambia su estado para devolverlo al tablero.`,
    (c,x,p,f)=>`${c} completed · ${x} cancelled${p+f?` · first-time pass rate ${Math.round(p/(p+f)*100)}% (${p} pass, ${f} fail)`:''}. Closed tests do not raise alerts. Click a column header to sort; open a test and change its status to bring it back to the board.`],
  hi_nomatch:['Ningún ensayo cumple estos filtros.','No tests match these filters.'],

  /* Occupancy */
  hNotSet:['horas sin definir','hours not set'], freeD:['libre','free'], slotsOf:[(n,c)=>`${n} de ${c} puesto(s)`,(n,c)=>`${n} of ${c} slot(s)`], slotDays:[n=>`${n} puestos-día`,n=>`${n} slot-days`],
  occ_pSub:[(h,n,qh)=>`${h} h/semana${n?` · ${n} en cola${qh?` (${qh} h)`:''}`:''}`,(h,n,qh)=>`${h} h/week${n?` · ${n} queued${qh?` (${qh} h)`:''}`:''}`],
  occ_click:['Pulsa un día para ver qué ensayos ocupan a ese técnico o ese banco.','Click a day to see which tests occupy that technician or piece of equipment.'],
  occ_avail:[(h,d)=>`${h} h de ${d} h disponibles`,(h,d)=>`${h} h of ${d} h available`], hDay:[h=>`${h} h este día`,h=>`${h} h this day`],
  techHNotSet:['horas de técnico sin definir','technician hours not set'], occ_noP:['Ningún ensayo asignado este día.','No tests assigned this day.'],
  occ_inUse:[(n,c)=>`${n} de ${c} puesto(s) en uso`,(n,c)=>`${n} of ${c} slot(s) in use`], occ_free:['Libre este día.','Free this day.'],
  a_prevWk:['Semana anterior','Previous week'], a_nextWk:['Semana siguiente','Next week'], occ_thisWk:['Esta semana','This week'],
  occ_help:['Técnicos: horas por día, a partir de las horas de técnico de cada ensayo repartidas en sus días laborables, frente a las horas semanales ÷ 5. <b>?</b> = asignado a un ensayo sin horas de técnico. Bancos: ensayos en marcha ese día frente a su capacidad (● = en uso si la capacidad es 1). Solo cuentan los ensayos planificados, en curso, bloqueados y en informe con fecha de inicio.',
    "Technicians: hours per day, from each test's technician hours spread over its working days, against the weekly hours ÷ 5. <b>?</b> = assigned to a test without technician hours. Equipment: tests running that day against its capacity (● = in use when capacity is 1). Only planned, running, on-hold and report tests with a start date count."],

  /* Equipment & team */
  rs_capHelp:['Capacidad = número de ensayos que el banco puede llevar a la vez','Capacity = number of tests the equipment can run at the same time'],
  rs_addEq:['+ Añadir banco','+ Add equipment'], rs_cap:['Capacidad','Capacity'], rs_inUse:['En uso hoy','In use today'], rs_freeFrom:['Puesto libre desde','Slot free from'], rs_nextCal:['Próxima calibración','Next calibration'],
  rs_noEq:['Aún no hay bancos. Añádelos aquí, o deja que la importación de ARAS los cree desde la columna Equipment.','No equipment yet. Add it here, or let the ARAS import create it from the Equipment column.'],
  rs_addP:['+ Añadir persona','+ Add person'], rs_person:['Persona','Person'], rs_hWk:['Horas/semana','Hours/week'], rs_loadWk:['Carga esta semana','Load this week'], rs_active:['Ensayos activos','Active tests'], rs_qual:['Habilitado en','Qualified on'],
  rs_noP:['Aún no hay nadie en el equipo. La importación de ARAS crea a las personas desde la columna Lab Resource.','No team members yet. The ARAS import creates them from the Lab Resource column.'],

  /* QTP library */
  lib_addQ:['+ Añadir QTP','+ Add QTP'],
  lib_help:['Duración estimada y horas de técnico de cada procedimiento de ensayo, por ensayo o por muestra. Son solo valores por defecto para planificar: cada línea de ensayo los usa salvo que le pongas su propia duración u horas. La duración de la biblioteca manda sobre la que viene de ARAS, que solo se usa cuando el QTP no tiene; una duración por muestra se multiplica siempre por el número de piezas del ensayo.',
    "Estimated duration and technician hours for each test procedure, per test or per sample. They are planning defaults only: every test line uses them unless you set its own duration or hours in the test. A library duration takes precedence over the duration that comes from ARAS, which is only used when the QTP has none; a per-sample library duration is always multiplied by the test's number of pieces."],
  lib_impH:['Importar la lista de QTP desde Excel','Import QTP list from Excel'], lib_impSub:['Columnas como QTP, nombre del ensayo, duración estimada, unidad, horas de técnico, banco','Columns such as QTP, test name, estimated duration, unit, technician hours, equipment'],
  lib_drop:['Suelta aquí la lista de QTP','Drop the QTP list here'], lib_dropSub:['o pulsa para elegir un archivo','or click to choose a file'], lib_procs:['Procedimientos','Procedures'],
  lib_noDur:[n=>`${n} sin duración estimada`,n=>`${n} without estimated duration`],
  lib_empty:['La biblioteca está vacía. Importa arriba tu lista de QTP; la importación de ARAS también añade cada QTP que encuentra.','The library is empty. Import your QTP list above; the ARAS import also adds every QTP it finds.'],

  /* Import (ARAS and QTP list). af_/qf_ = field names of the column mapping (the header matching itself uses ARAS_FIELDS.syn) */
  af_plr:['Petición (PLR)','Request number (PLR)'], af_qtp:['Tarea (QTP)','Task item (QTP)'], af_title:['Descripción del ensayo','Test description'], af_project:['Proyecto','Project'],
  af_requester:['Creador de la petición','Request creator'], af_comments:['Comentarios','Comments'], af_status:['Estado de la tarea','Task status'], af_techName:['Recurso del laboratorio (técnico)','Lab resource (technician)'],
  af_equipmentName:['Banco','Equipment'], af_start:['Fecha de inicio del trabajo','Start work date'], af_requestedDue:['Fecha solicitada','Requested due date'], af_flexible:['¿Fecha flexible?','Due date flexible?'],
  af_durVal:['Duración','Duration'], af_durUnit:['Unidades de duración','Duration units'], af_pieces:['Número de piezas','Number of pieces'], af_sequence:['Secuencia del ensayo','Test sequence'],
  af_result:['Resultado del ensayo','Test result'], af_category:['Categoría de producto','Product category'], af_requestNote:['Nota de estado de la petición','Request status note'],
  qf_code:['Código QTP','QTP code'], qf_name:['Nombre del ensayo','Test name'], qf_durVal:['Duración estimada','Estimated duration'], qf_durUnit:['Unidad de duración','Duration unit'],
  qf_techHours:['Horas de técnico','Technician hours'], qf_equipmentName:['Banco por defecto','Default equipment'], qf_durBasis:['Base de la duración (por ensayo / por muestra)','Duration basis (per test / per sample)'],
  qf_testType:['Tipo de ensayo','Test type'], qf_standard:['Norma','Standard'], qf_notes:['Notas','Notes'],
  notImp:['— no se importa —','— not imported —'],
  e_xlsx:['no se ha cargado el lector de Excel. Recarga la página.','the Excel reader did not load. Reload the page.'], e_head:['no se encuentra la fila de cabeceras.','no header row found.'],
  e_read:[m=>`No se ha podido leer el archivo: ${m}`,m=>`Could not read the file: ${m}`],
  sp_h:['Diferencias de estado','Status differences'], sp_same:['Todos los ensayos importados tienen el mismo estado en la app y en ARAS.','Every imported test has the same status in the app and in ARAS.'],
  sp_sub:['Estos ensayos ya existen y ARAS muestra otro estado. Elige cuál conservar.','These tests already exist and ARAS shows a different status. Choose which one to keep.'],
  sp_allApp:['Conservar todos los de la app','Keep all app'], sp_allAras:['Usar todos los de ARAS','Use all ARAS'], sp_keep:['Conservar el estado de la app','Keep app status'], sp_use:['Usar el estado de ARAS','Use ARAS status'],
  sp_apply:[(n,m)=>`Aplicar ${n} de ${m} elección${m===1?'':'es'}`,(n,m)=>`Apply ${n} of ${m} choice${m===1?'':'s'}`],
  sp_note:['Los ensayos sin elección conservan el estado de la app y se vuelven a preguntar en la próxima importación. Si conservas el estado de la app, no se vuelve a preguntar hasta que ARAS muestre otro estado. Planificado cuenta como In Queue, y Endurance en curso, Bloqueado e Informe cuentan como In Progress.',
    'Tests left without a choice keep their app status and are asked again on the next import. When you keep the app status, it is not asked again until ARAS shows another status. Planned counts as In Queue, and Endurance running, On hold and Report count as In Progress.'],
  sp_done:[(a,k)=>`Estado: ${a} cambiado${a===1?'':'s'} al de ARAS, ${k} conservado${k===1?'':'s'}.`,(a,k)=>`Status: ${a} changed to the ARAS status, ${k} kept.`],
  imp_doneH:['Importado','Imported'], imp_res:['Resultado','Result'], imp_chg:['Cambios','Changes'],
  imp_updated:['Actualizado','Updated'], imp_newHist:['Nuevo → Historial','New → History'], imp_new:['Nuevo','New'],
  imp_st:[{new:'Nuevo',hist:'Nuevo → Historial',update:'Actualizar',same:'Sin cambios',skip:'Omitido (cerrado)',error:'Falta PLR o QTP'},{new:'New',hist:'New → History',update:'Update',same:'No change',skip:'Skipped (closed)',error:'Missing PLR or QTP'}],
  imp_mapH:['Correspondencia de columnas','Column mapping'], imp_mapNote:['Cada columna del Excel se asigna a un campo. La asignación se recuerda para la próxima importación.','Each column of the export is matched to a field. The mapping is remembered for the next import.'],
  imp_eqH:['Bancos de ARAS que no están en la app','ARAS equipment not found in the app'], imp_eqSub:['Elige a qué corresponde cada nombre. La elección se recuerda.','Choose what each name means. The choice is remembered.'],
  a_eqFor:[n=>`Banco para ${n}`,n=>`Equipment for ${n}`], eq_new:[n=>`Crear el banco nuevo «${n}»`,n=>`Create new equipment "${n}"`], eq_none:['Dejar los ensayos sin banco','Leave tests without equipment'],
  eq_use:[n=>`Usar el existente: ${n}`,n=>`Use existing: ${n}`], imp_prevH:['Vista previa','Preview'],
  imp_nNewAct:[n=>`${n} nuevo${n===1?'':'s'} activo${n===1?'':'s'}`,n=>`${n} new active`], imp_nNewHist:[n=>`${n} nuevo${n===1?'':'s'} al Historial`,n=>`${n} new to History`],
  imp_nUpd:[(n,s)=>`${n} actualizado${n===1?'':'s'}${s?` (${s} con cambio de estado)`:''}`,(n,s)=>`${n} updated${s?` (${s} status change)`:''}`],
  imp_nSame:[n=>`${n} sin cambios`,n=>`${n} no change`], imp_nSkip:[n=>`${n} omitido${n===1?'':'s'}`,n=>`${n} skipped`], imp_nErr:[n=>`${n} sin PLR o QTP`,n=>`${n} missing PLR or QTP`],
  imp_incClosed:['Importar también las tareas completadas y canceladas como Historial','Also import completed and cancelled tasks as History'],
  imp_newP:[x=>`Personas nuevas en el equipo: <b>${x}</b>. `,x=>`New team members: <b>${x}</b>. `],
  imp_newQ:[(n,c)=>`QTP nuevos que se añaden a la biblioteca: <b>${n}</b> (${c}).`,(n,c)=>`New QTPs added to the library: <b>${n}</b> (${c}).`],
  imp_needKeys:['Asigna las columnas de PLR y de QTP: juntas identifican cada ensayo.','Map both the PLR and the QTP columns: together they identify each test.'],
  imp_arasSt:['Estado en ARAS','ARAS status'], imp_first250:['Se muestran las primeras 250 filas.','Showing the first 250 rows.'],
  imp_btn:[(a,b)=>`Importar ${a} nuevo${a===1?'':'s'} y actualizar ${b}`,(a,b)=>`Import ${a} new and update ${b}`], imp_discard:['Descartar el archivo','Discard file'],
  imp_note:['Una vez fijadas las columnas y los nombres de bancos, los archivos siguientes se importan en cuanto se cargan. Al volver a importar, ARAS actualiza los datos de la petición (descripción, proyecto, solicitante, comentarios, fecha, resultado…). El banco, el técnico y la fecha de inicio solo se rellenan si están vacíos. Un estado distinto nunca se cambia solo: lo eliges después de importar.',
    'Once the columns and equipment names are set, later files are imported as soon as they are loaded. On re-import, ARAS updates the request data (description, project, requester, comments, due date, result…). Equipment, technician and start date are only filled when empty. A different status is never changed on its own: you choose it after the import.'],
  imp_busy:['Importando…','Importing…'], imp_done:[(a,b)=>`Importación terminada: ${a} nuevo${a===1?'':'s'}, ${b} actualizado${b===1?'':'s'}.`,(a,b)=>`Import finished: ${a} new, ${b} updated.`],
  qi_note:['Las celdas vacías nunca sobrescriben valores que ya están en la biblioteca.','Empty cells never overwrite values already in the library.'],
  qi_nErr:[n=>`${n} sin código QTP`,n=>`${n} without QTP code`], qi_noCode:['Sin código','No code'], qi_techH:['Horas técnico','Tech hours'], qi_notFound:['(no encontrado)','(not found)'],
  qi_done:[n=>`Biblioteca de QTP actualizada: ${n} procedimiento${n===1?'':'s'}.`,n=>`QTP library updated: ${n} procedure(s).`],
  im_h:['Importar desde ARAS','Import from ARAS'], im_export:['Exportar ensayos a Excel','Export tests to Excel'],
  im_steps:['<li>En ARAS, lanza la búsqueda de peticiones del laboratorio (a_Lab_Dashboard) y expórtala a Excel.</li><li>Carga aquí el archivo (.xlsx, .xls o .csv).</li><li>Las tareas nuevas se crean y las existentes se actualizan a la vez. La primera vez, o cuando ARAS trae un banco desconocido, revisa la correspondencia y confirma.</li><li>Elige qué estado conservar en los ensayos cuyo estado no coincide con ARAS.</li>',
    '<li>In ARAS, run the lab request search (a_Lab_Dashboard) and export it to Excel.</li><li>Load the file here (.xlsx, .xls or .csv).</li><li>New tasks are created and existing ones updated at once. The first time, or when ARAS brings an unknown equipment name, check the mapping and confirm.</li><li>Choose the status to keep for tests whose status differs from ARAS.</li>'],
  im_drop:['Suelta aquí el Excel de ARAS','Drop the ARAS export here'], im_dropSub:['o pulsa para elegir el archivo','or click to choose the file'],

  /* Excel export (read by people only) */
  xl_cols:[['PLR','QTP','Ensayo','Proyecto','Solicitante','Estado','Estado en ARAS','Prioridad','Banco','Técnico','Inicio','Fin','Tipo de fin','Duración est.','Unidad','Origen de la duración','Horas de técnico','Progreso %','Fecha solicitada','Fecha acordada','Fecha flexible','Resultado','Cierre','Piezas','Secuencia','Comentarios','Notas del laboratorio','Motivo del bloqueo'],
    ['PLR','QTP','Test','Project','Requester','Status','ARAS status','Priority','Equipment','Technician','Start','End','End type','Est. duration','Unit','Duration source','Technician hours','Progress %','Requested due','Agreed due','Due flexible','Result','Closed','Pieces','Sequence','Comments','Lab notes','Hold reason']],
  xl_end:[{set:'manual',auto:'auto',open:'abierto',none:'sin fecha'},{}], xl_sheet:['Ensayos','Tests'], xl_file:['ensayos_laboratorio','lab_tests'],

  /* Test editor */
  ed_req:['Petición','Request'], fromAras:[' · desde ARAS',' · from ARAS'], ed_plr:['Petición (PLR)','Request (PLR)'], ed_qtp:['Tarea (QTP)','Task item (QTP)'], ed_desc:['Descripción del ensayo','Test description'],
  ph_project:['25046 - NOMBRE DEL PROYECTO','25046 - PROJECT NAME'], ed_requester:['Creador de la petición','Request creator'], ed_pieces:['Número de piezas (muestras)','Number of pieces (samples)'],
  ed_seq:['Secuencia del ensayo','Test sequence'], ed_reqDue:['Fecha solicitada','Requested due date'], ed_flexQ:['¿Fecha flexible?','Due date flexible?'], ed_flex:['Flexible','Flexible'],
  ed_com:['Comentarios','Comments'], ed_cat:['Categoría de producto','Product category'],
  ed_arasNote:[(st,eq,te,du,rn)=>`ARAS: estado <b>${st}</b> · banco <b>${eq}</b> · recurso del laboratorio <b>${te}</b>${du?` · duración <b>${du}</b>`:''}${rn?`<br>Nota de estado de la petición: ${rn}`:''}<br>Los campos de esta sección se actualizan desde ARAS en cada importación.`,
    (st,eq,te,du,rn)=>`ARAS: status <b>${st}</b> · equipment <b>${eq}</b> · lab resource <b>${te}</b>${du?` · duration <b>${du}</b>`:''}${rn?`<br>Request status note: ${rn}`:''}<br>The fields in this section are refreshed from ARAS on each import.`],
  ed_plan:['Planificación del laboratorio','Lab planning'], ed_reportHelp:['Informe = ensayo terminado, informe en redacción','Report = test finished, report being written'], ed_prio:['Prioridad','Priority'],
  ed_end:['Fin previsto','Planned end'], ed_dur:['Duración estimada','Estimated duration'],
  run_def:['Según la biblioteca de QTP','Default from QTP library'], run_yes:['Continuo 24/7','Continuous 24/7'], run_no:['Horario laboral (8 h/día)','Working hours (8 h/day)'],
  ed_techH:['Horas de técnico (total)','Technician hours (total)'], ed_prog:['Progreso (%)','Progress (%)'], ed_agreed:['Fecha acordada','Agreed due date'],
  ed_agreedHelp:['Sustituye a la fecha solicitada en las alertas','Overrides the requested date for alerts'], ed_result:['Resultado del ensayo','Test result'],
  ed_hold:['Motivo del bloqueo','On hold reason'], ed_holdPh:['Solo si está bloqueado','Only when on hold'], ed_notes:['Notas del laboratorio','Lab notes'],
  ed_sibs:[p=>`Otras tareas de ${p}`,p=>`Other tasks in ${p}`], seqN:[n=>`sec. ${n}`,n=>`seq ${n}`],
  ed_eyNew:['Ensayo manual nuevo','New manual test'], ed_eyAras:['Tarea de ARAS','ARAS task'], ed_eyManual:['Ensayo manual','Manual test'], ed_new:['Nuevo ensayo','New test'],
  xFrom:[(a,b)=>`${a} (${b})`,(a,b)=>`${a} from ${b}`], theDefault:['el valor por defecto','the default'],
  h_durOver:[x=>`Sustituye a ${x}. Bórralo para usar el valor por defecto.`,x=>`Overrides ${x}. Clear it to use the default.`],
  h_durUse:[x=>`Se usa ${x}. Escribe un valor para cambiarlo solo en este ensayo.`,x=>`Using ${x}. Type a value to override it for this test only.`],
  h_durNone:['Sin valor por defecto: ponlo aquí o en la biblioteca de QTP.','No default: set it here or in the QTP library.'],
  h_perS:[n=>`La biblioteca de QTP cuenta el tiempo por muestra: × ${n}.`,n=>`The QTP library counts time per sample: × ${n}.`],
  h_perS0:['La biblioteca de QTP cuenta el tiempo por muestra: indica las piezas (de momento cuenta 1).','The QTP library counts time per sample: set the pieces (counted as 1 for now).'],
  h_ltNote:[(h,n)=>` (${h} h × ${n} muestras)`,(h,n)=>` (${h} h × ${n} samples)`],
  h_endu:[b=>`Perfil endurance de la biblioteca de QTP: ${b}.`,b=>`Endurance profile from the QTP library: ${b}.`],
  h_thOver:[(h,n)=>`Sustituye a ${h} h de la biblioteca de QTP${n}.`,(h,n)=>`Overrides ${h} h from the QTP library${n}.`],
  h_thUse:[(h,n)=>`Se usan ${h} h de la biblioteca de QTP${n}.`,(h,n)=>`Using ${h} h from the QTP library${n}.`],
  h_thNone:['Sirve para calcular la carga del técnico.','Used to compute technician load.'],
  h_endSet:['Puesto a mano. Bórralo para calcular inicio + duración.','Set by hand. Clear it to compute start + duration.'],
  h_endAuto:[d=>`Auto: ${d} (inicio + duración estimada)`,d=>`Auto: ${d} (start + estimated duration)`],
  h_endUnk:['Desconocido: no hay duración','Unknown: no duration available'], h_endEmpty:['Déjalo vacío para calcularlo con inicio + duración','Leave empty to compute it from start + duration'],
  h_qtpDef:['Banco por defecto del QTP:','QTP default:'],
  h_noap:['No aprobado: las alertas, la planificación y la ocupación ignoran este ensayo hasta que cambie su estado. ','Not approved: this test is ignored by alerts, planning and occupancy until its status changes. '],
  h_free:[(x,c)=>`Puesto del banco libre desde <b>${x}</b> (capacidad ${c}). `,(x,c)=>`Equipment slot free from <b>${x}</b> (capacity ${c}). `],
  h_days:[(n,w)=>`${n} días naturales · ${w} días laborables`,(n,w)=>`${n} calendar days · ${w} working days`],
  h_enduLoad:[(a,b,c,d,e,f,g,h,t)=>`. Carga del técnico: montaje ${a} h en ${b} día(s) · control diario ${c} h × ${d} día(s) · ${e} revisión(es) × ${f} h · desmontaje ${g} h en ${h} día(s) = <b>${t} h</b>`,
    (a,b,c,d,e,f,g,h,t)=>`. Technician load: setup ${a} h over ${b} day(s) · daily check ${c} h × ${d} day(s) · ${e} review(s) × ${f} h · teardown ${g} h over ${h} day(s) = <b>${t} h</b>`],
  h_perDay:[x=>` · ${x} h de técnico/día`,x=>` · ${x} technician h/day`],

  /* Person, equipment and QTP dialogs */
  pe_name:['Nombre','Name'], pe_rol:['Puesto','Role'], pe_rolDef:['Técnico de laboratorio','Lab technician'], pe_hours:['Horas por semana disponibles para ensayos','Hours per week available for tests'],
  pe_qual:['Habilitado en (déjalo vacío para no comprobar habilitaciones)','Qualified on (leave empty to skip the qualification check)'], pe_addEq:['Añade primero los bancos.','Add equipment first.'],
  pe_note:['El nombre tiene que coincidir con el de Lab Resource en ARAS (no importan tildes ni mayúsculas) para que las tareas importadas se asignen solas.','The name must match the ARAS Lab Resource name (accents and capitals are ignored) so imported tasks are assigned automatically.'],
  pe_edit:['Editar persona','Edit person'], pe_new:['Persona nueva','New person'],
  eq_aras:['Nombre en ARAS (columna Equipment)','Name in ARAS (Equipment column)'], eq_arasPh:['Igual que el nombre','Same as name'], eq_arasHelp:['Varios nombres: sepáralos con ;','Several names: separate them with ;'],
  eq_cap:['Ensayos simultáneos (capacidad)','Simultaneous tests (capacity)'], eq_capHelp:['Cuántos ensayos pueden ir a la vez en él','How many tests can run on it at the same time'],
  eq_desc:['Laboratorio / descripción','Lab / description'], eq_edit:['Editar banco','Edit equipment'], eq_newT:['Banco nuevo','New equipment'],
  qt_leg:['Procedimiento de ensayo','Test procedure'], qt_stdPh:['p. ej. IEC 60068','e.g. IEC 60068'], qt_durBasis:['Base de la duración','Duration basis'], qt_techBasis:['Base de las horas de técnico','Technician hours basis'],
  qt_perSHelp:['Por muestra: se multiplica por el número de piezas de cada ensayo','Per sample: multiplied by the number of pieces of each test'],
  qt_cpd:['Ciclos por día','Cycles per day'], qt_cpdHelp:['Solo para duraciones en ciclos','Only for durations in cycles'], qt_prof:['Perfil de carga del técnico','Technician load profile'],
  qt_profEven:['Uniforme: horas totales repartidas en los días laborables','Even: total hours spread over the working days'], qt_profEndu:['Endurance: montaje + control diario + revisiones + desmontaje','Endurance: setup + daily check + reviews + teardown'],
  qt_setupH:['Horas de montaje','Setup hours'], qt_setupHelp:[n=>`En bloques de ${n} h por día laborable desde el inicio`,n=>`In blocks of ${n} h per working day from the start`],
  qt_dailyH:['Horas de control diario','Daily check hours'], qt_dailyHelp:['Cada día laborable entre montaje y desmontaje','Every working day between setup and teardown'],
  qt_revEvery:['Revisión cada','Review every'], qt_revHelp:['Cuenta desde el inicio; las revisiones en fin de semana pasan al lunes','Counted from the start; weekend reviews move to Monday'],
  qt_revH:['Horas por revisión','Hours per review'], qt_tearH:['Horas de desmontaje','Teardown hours'], qt_tearHelp:[n=>`En bloques de ${n} h por día laborable, terminando en la fecha de fin`,n=>`In blocks of ${n} h per working day, ending on the end date`],
  qt_note:['Son valores por defecto para planificar. Cada ensayo puede cambiar la duración y el régimen; con el perfil uniforme también las horas totales de técnico. Los fines de semana nunca llevan horas de técnico.','These values are planning defaults. Each test can override duration and running mode; with the even profile it can also override the total technician hours. Weekends never carry technician hours.'],
  qt_edit:['Editar QTP','Edit QTP'], qt_new:['QTP nuevo','New QTP'],

  /* Saving, errors and messages */
  e_perm:['No puedes cambiar datos: conecta GitHub con una cuenta con permiso de escritura en el repositorio.','You cannot change data: connect GitHub with an account that has write access to the repository.'],
  e_auth:['Tu clave de GitHub ya no es válida. Vuelve a conectar GitHub con una clave nueva.','Your GitHub key is no longer valid. Connect GitHub again with a new key.'],
  e_conflict:['Otra persona ha guardado a la vez. Tu cambio no se ha guardado; vuelve a probar.','Someone else saved at the same time. Your change was not saved; try again.'],
  e_rate:['GitHub está limitando las peticiones ahora mismo. Espera un minuto y vuelve a probar.','GitHub is limiting requests right now. Wait a minute and try again.'],
  e_net:['No se ha podido conectar con GitHub. Revisa la conexión y vuelve a probar.','Could not reach GitHub. Check your connection and try again.'],
  e_save:[m=>`No se ha podido guardar: ${m}`,m=>`Could not save: ${m}`],
  e_plrQtp:['Escribe el PLR y el QTP: juntos identifican el ensayo.','Enter the PLR and the QTP: together they identify the test.'], e_qtp:['Escribe el código QTP.','Enter the QTP code.'],
  e_endStart:['El fin previsto no puede ser anterior al inicio.','The planned end cannot be before the start.'], e_name:['El nombre es obligatorio.','The name is required.'],
  e_code:['El código QTP es obligatorio.','The QTP code is required.'], e_codeDup:[c=>`${c} ya está en la biblioteca.`,c=>`${c} is already in the library.`],
  savedT:['Guardado.','Saved.'], delConfirm:['Confirmar eliminación','Confirm delete'], deletedT:['Eliminado.','Deleted.'], toHist:[' (pasa al Historial)',' (moved to History)'],
  e_startAfter:['La fecha de inicio no puede ser posterior a la de fin.','The start date cannot be after the end date.'], e_endBefore:['La fecha de fin no puede ser anterior a la de inicio.','The end date cannot be before the start date.'],
  m_start:[d=>`inicio ${d}`,d=>`start ${d}`], m_startClr:['fecha de inicio borrada','start date cleared'], m_toPlanned:[' · pasa a Planificado',' · moved to Planned'],
  m_endAuto:['fecha de fin de nuevo automática','end date back to automatic'], m_end:[d=>`fin ${d}`,d=>`end ${d}`],

  /* GitHub key and preview */
  gh_connect:['Conectar GitHub','Connect GitHub'], gh_connectBtn:['Conectar','Connect'], gh_disc:['Desconectar','Disconnect'], gh_eyebrow:['Acceso de edición','Editing access'],
  gh_expired:['Clave de GitHub caducada','GitHub key expired'], gh_off:['Desconectado de GitHub. Este navegador ya no tiene la clave.','Disconnected from GitHub. This browser no longer has the key.'],
  gh_t_push:['Conectado con permiso de escritura. Los cambios se guardan como commits.','Connected with write access. Changes are saved as commits.'],
  gh_t_nopush:['Conectado, pero esta cuenta no puede editar el repositorio.','Connected, but this account cannot edit the repository.'], gh_t:['Conecta GitHub para crear y cambiar ensayos','Connect GitHub to create and change tests'],
  gh_as:[(l,p)=>`Conectado como <b>${l}</b>${p?' con permiso de escritura.':', pero esta cuenta no puede editar el repositorio.'}`,(l,p)=>`Connected as <b>${l}</b>${p?' with write access.':', but this account cannot edit the repository.'}`],
  gh_steps:['<li>Crea una clave de acceso en GitHub: <a href="https://github.com/settings/tokens/new?scopes=repo&amp;description=Laboratorio%20Polinya" target="_blank" rel="noopener">abre el formulario</a>. El permiso <span class="mono">repo</span> ya viene marcado (hace falta porque los datos del laboratorio son privados); elige una caducidad y pulsa <i>Generate token</i>.</li><li>Copia la clave y pégala aquí.</li>',
    '<li>Create an access key in GitHub: <a href="https://github.com/settings/tokens/new?scopes=repo&amp;description=Laboratorio%20Polinya" target="_blank" rel="noopener">open the form</a>. The <span class="mono">repo</span> permission is already ticked (needed because the lab data is private); choose an expiry and press <i>Generate token</i>.</li><li>Copy the key and paste it here.</li>'],
  gh_keyL:['Clave de acceso (token)','Access key (token)'],
  gh_keyNote:[r=>`La clave se guarda solo en este navegador y la comparte la app de la piscina de durabilidad. Tu cuenta de GitHub necesita acceso al repositorio de datos <span class="mono">${r}</span>: Read para consultar, Write para editar. Cada cambio se guarda como un commit, así que el historial muestra quién cambió qué.`,
    r=>`The key is kept only in this browser and is shared with the durability pool app. Your GitHub account must have access to the data repository <span class="mono">${r}</span>: Read to view, Write to edit. Every change is saved as a commit, so the history shows who changed what.`],
  gh_e_paste:['Pega la clave de acceso.','Paste the access key.'], gh_e_auth:['Esa clave no es válida o ha caducado.','That key is not valid or has expired.'],
  gh_e_repo:['Esa clave no puede ver el repositorio.','That key cannot see the repository.'], gh_e_net:['No se ha podido conectar con GitHub. Revisa la conexión.','Could not reach GitHub. Check your connection.'],
  gh_ok:[(l,p)=>p?`Conectado como ${l}. Ya puedes editar.`:`Conectado como ${l}, pero esta cuenta no puede editar el repositorio.`,(l,p)=>p?`Connected as ${l}. You can now edit.`:`Connected as ${l}, but this account cannot edit the repository.`],
  pv_btn:['Datos de ejemplo','Example data'], pv_btn_t:['Vista previa con datos de ejemplo: no se lee ni se envía nada a GitHub.','Preview with example data: nothing is read from or sent to GitHub.'],
  pv_t:['Vista previa: los datos se leen de GitHub y los cambios no se guardan.','Preview: the data is read from GitHub, changes are not saved.'],
  pv_reset:['Datos de ejemplo restablecidos.','Example data reset.'], pv_on:['Vista previa con datos de ejemplo.','Preview with example data.'], pv_off:['Datos de ejemplo cerrados.','Example data closed.'],
};
/* One dictionary for the three apps; the language is the shared one of acceso/lab-lang.js. */
const I18N={es:{...SMP_I18N.es},en:{...SMP_I18N.en}};
for(const [k,[es,en]] of Object.entries(CE_I18N)){I18N.es[k]=es; I18N.en[k]=en;}
const LL=window.LabLang||{lang:'en',t:(D,k,...a)=>{const v=D.en[k]??k; return typeof v==='function'?v(...a):v;},apply(){},onChange(){},locale:()=>'en-GB'};
const tx=(k,...a)=>LL.t(I18N,k,...a);
/* Sign-in texts (au_*), shared with the email access. */
const ta=tx;
const stName=s=>tx('stl')[s]||s, prioName=p=>tx('prio')[p]||p, resName=r=>tx('res')[r]||r, unitName=u=>tx('unit')[u]||u, unitS=u=>tx('unitS')[u]||u, eqStName=s=>tx('eqst')[s]||s;
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
/* The preview's example data is dated relative to today, so the cut-off does not apply to it. */
const smpOld=p=>{if(PREVIEW&&DEMO) return false; const ts=smpTestsOfPlr(p); return ts.length>0&&ts.every(x=>String(x.created||x.imported||'').slice(0,10)<SMP_SINCE)&&!S.samples.some(l=>(l.plrs||[]).includes(smpPlrKey(p)));};
const smpRecv=p=>S.samples.filter(l=>(l.plrs||[]).includes(smpPlrKey(p))).reduce((a,l)=>a+smpIn(l).length,0);
const smpNum=l=>+((String(l.code||'').match(/\d{5}/)||[0])[0]);
const smpNextSeq=()=>Math.max(+((S.cfg.samples||{}).seq)||0,0,...S.samples.map(smpNum))+1;
const smpFmtCode=n=>`QTS-${String(n).padStart(5,'0')}`;
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
    g.active=g.tests.some(x=>ACTIVE.includes(x.status)&&x.status!=='Not approved'); g.legacy=!g.tests.length; g.old=!g.legacy&&!g.lots.length&&smpOld(g.plr);
    g.pieces=smpPieces(g.plr); g.recv=g.lots.reduce((a,l)=>a+smpIn(l).length,0); g.exp=g.lots.flatMap(l=>smpLive(l).filter(u=>u.state==='expected').map(u=>smpKey(l,u)));
    g.project=(g.tests[0]||{}).project||(g.lots[0]||{}).project||''; g.requester=(g.tests[0]||{}).requester||'';
    g.rc=g.legacy?'rc-legacy':!g.active||g.old?'rc-closed':g.recv===0?'rc-none':g.pieces&&g.recv<g.pieces?'rc-part':'rc-ok';
    g.rank=g.legacy?4:!g.active||g.old?3:g.rc==='rc-ok'?2:g.rc==='rc-part'?0:1; return g;});
}
function smpKpis(){
  const U=S.samples.flatMap(smpLive), n=s=>U.filter(u=>u.state===s).length;
  return {inlab:U.filter(u=>!['expected','returned','scrapped'].includes(u.state)).length,wait:n('received')+n('waiting'),test:n('testing'),done:n('tested'),
    miss:smpMissingCount(),lbl:U.filter(u=>!u.printed).length};
}
const smpChased=g=>g.active&&!g.old;
const smpMissingCount=()=>smpGroups().filter(g=>smpChased(g)&&g.pieces>g.recv).length;
const smpPending=()=>S.samples.flatMap(l=>smpLive(l).filter(u=>!u.printed).map(u=>smpKey(l,u)));

/* ---------- Codes from the ARAS requests ----------
   Every active PLR with pieces in ARAS and no codes gets a proposal: one reception for the whole PLR when its QTP lines
   share the samples, or one per line when each line has its own pieces (the default when the lines ask for different
   numbers of pieces). A proposal takes no number: the next free QTS numbers go to it when someone validates it. */
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
const smpProposals=()=>smpGroups().filter(g=>smpChased(g)&&!g.legacy&&!smpSkipped(g.plr)).map(g=>smpProposal(g.plr)).filter(P=>P.groups.some(g=>g.need>0));
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
  if(!t.plr) return ''; const p=smpPieces(t.plr), r=smpRecv(t.plr); if(!p&&!r||!r&&smpOld(t.plr)) return '';
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
  if(impOn()&&!IMP.loaded){IMP.loaded=true; impLoad();} // jobs printed while this page was closed mark their units
  const k=smpKpis(), V=S.smp;
  $('#smp-plr-list').innerHTML=[...new Map(S.tests.filter(x=>x.plr).map(x=>[smpPlrKey(x.plr),x])).values()].map(x=>`<option value="${esc(smpPlrKey(x.plr))}">${esc(projectNo(x))} · ${esc(x.title||'')}</option>`).join('');
  $('#smp-loc-list').innerHTML=[...new Set(S.samples.flatMap(l=>[l.loc,...(l.units||[]).map(u=>u.loc)]).filter(Boolean))].sort().map(v=>`<option value="${esc(v)}">`).join('');
  if(!S.tests.length&&!S.samples.length) return `<div class="empty"><p class="eyebrow">${esc(tx('title'))}</p><h3>${esc(tx('empty_h'))}</h3><p>${esc(tx('empty_p'))}</p>
    <div class="row">${S.ro||S.noDb?'':`<button class="btn primary" data-view="import">${esc(tx('v_import'))}</button><button class="btn" data-sa="receive">${esc(tx('receive'))}</button>`}</div></div>`;
  const kpi=(act,lab,val,sub,cls='')=>`<button class="kpi ${cls}" data-sa="kpi" data-k="${act}"><span class="eyebrow">${esc(lab)}</span><b>${val}</b><span class="muted">${esc(sub)}</span></button>`;
  const chips=SMP.map(s=>`<button type="button" class="chipbtn st-${SMP_CLS[s]}" data-sa="sst" data-s="${s}" aria-pressed="${V.sst.has(s)}">${esc(smpSt(s))}</button>`).join('');
  return `<div class="view-h smp-h"><h2>${esc(tx('title'))}</h2>
    <input class="search" id="q" type="search" placeholder="${esc(tx('search'))}" value="${esc(S.q)}" aria-label="${esc(tx('search'))}">
    <div class="seg" role="group" aria-label="${esc(tx('title'))}"><button data-sa="sv" data-v="plr" aria-pressed="${V.sv==='plr'}">${esc(tx('byPlr'))}</button><button data-sa="sv" data-v="list" aria-pressed="${V.sv==='list'}">${esc(tx('list'))}</button></div>
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
const smpDefaultStates=()=>S.smp.sst.size===SMP_DEFAULT.length&&SMP_DEFAULT.every(s=>S.smp.sst.has(s));
function smpByPlr(){
  const q=S.q, V=S.smp;
  const gs=smpGroups().filter(g=>{
    const lotsOk=g.lots.filter(smpVisible);
    if(V.onlyMissing&&!(smpChased(g)&&g.pieces>g.recv)) return false;
    const textOk=!q||[g.plr,g.project,g.requester,...g.tests.flatMap(x=>[x.qtp,x.title])].some(v=>norm(v).includes(norm(q)))||g.lots.some(l=>smpMatch(l,q));
    if(!textOk) return false;
    if(lotsOk.length) return true;
    /* A PLR with nothing to show passes only while the state and phase filters are untouched (PLRs still waiting for samples),
       and a PLR from before SMP_SINCE only when searched for. */
    return g.active&&!V.phase&&smpDefaultStates()&&(!g.old||!!q);
  }).sort((a,b)=>a.rank-b.rank||b.plr.localeCompare(a.plr));
  if(!gs.length) return `<div class="empty-ok">${esc(tx('noPlr'))}</div>`;
  return `<div class="pgrid">${gs.map(smpCard).join('')}</div>`;
}
function smpCard(g){
  const V=S.smp, shown=g.lots.filter(l=>smpInState(l)&&(!V.phase||l.phase===V.phase)).sort((a,b)=>a.code.localeCompare(b.code)), hidden=g.lots.length-shown.length;
  const pct=g.pieces?Math.min(100,g.recv/g.pieces*100):(g.recv?100:0);
  const status=g.legacy?`<span class="wtag mut">${esc(tx('legacy'))}</span>`
    :!g.active?`<span class="wtag mut">${esc(tx('closedPlr'))}</span>`
    :g.old?`<span class="wtag mut">${esc(tx('oldPlr'))}</span>`
    :g.recv===0?`<span class="wtag crit">${esc(tx('none'))}</span>`
    :g.pieces&&g.recv<g.pieces?`<span class="wtag">${esc(tx('missing',g.pieces-g.recv))}</span>`
    :g.pieces&&g.recv>g.pieces?`<span class="wtag mut">${esc(tx('extra',g.recv-g.pieces))}</span>`:`<span class="wtag ok">${esc(tx('complete'))}</span>`;
  return `<article class="pcard ${g.rc}">
    <div class="pc-h"><div class="who"><span class="plr">${esc(g.plr)}</span><div class="chips">${smpProj(g.project)}</div>${g.requester?`<span class="by">${esc(tx('by'))} ${esc(g.requester)}</span>`:''}</div>
      <div class="recv"><b>${g.recv}</b>${g.pieces?` / ${g.pieces}`:''}<br>${esc(g.pieces?tx('recvOf',g.recv,g.pieces):tx('recvN'))}<div class="prog"><span style="width:${pct}%"></span></div></div></div>
    ${g.tests.length?`<ol class="qlines">${g.tests.map(x=>`<li><span class="seq">${esc(x.sequence||'·')}</span><button type="button" class="link ref" data-act="edit" data-id="${esc(x.id)}">${esc(x.qtp)}</button><span class="tt" title="${esc(x.title)}">${esc(x.title)}</span>${estPill(x.status)}${resTag(x.result)}</li>`).join('')}</ol>`:''}
    <div class="lots">${shown.map(l=>smpLotBtn(l,g.plr)).join('')||(g.lots.length?'':`<p class="note">${esc(tx('noLots'))}</p>`)}${hidden?`<span class="hidden-n">${esc(tx('hiddenN',hidden))}</span>`:''}</div>
    <div class="pc-f">${status}${g.exp.length?`<span class="wtag mut">${esc(tx('expN',g.exp.length))}</span>`:''}<span class="sp"></span>${g.legacy||S.ro?'':`${g.exp.length?`<button class="btn sm primary" data-sa="recv-exp" data-plr="${esc(g.plr)}">${esc(tx('recvExp',g.exp.length))}</button>`:''}<button class="btn sm" data-sa="gen" data-plr="${esc(g.plr)}">${esc(tx('gen'))}</button><button class="btn sm" data-sa="assign" data-plr="${esc(g.plr)}">${esc(tx('assign'))}</button><button class="btn sm" data-sa="receive" data-plr="${esc(g.plr)}">${esc(tx('receiveFor'))}</button>`}</div>
  </article>`;
}
function smpList(){
  const V=S.smp, lots=S.samples.filter(smpVisible).sort((a,b)=>b.code.localeCompare(a.code));
  const st=(u,k,c)=>u.removed?`<span class="rm-tag">${esc(tx('removed'))}</span>`:S.ro?`<span class="pill est st-${SMP_CLS[u.state]}">${esc(smpSt(u.state))}</span>`
    :`<select class="st-sel st-${SMP_CLS[u.state]}" data-setunit="${esc(k)}" aria-label="${esc(tx('c_state'))} ${esc(c)}">${SMP.map(s=>`<option value="${s}" ${s===u.state?'selected':''}>${esc(smpSt(s))}</option>`).join('')}</select>`;
  const rows=lots.map(l=>{
    /* Units outside the state filter stay hidden; removed units only show while the state filter is untouched. */
    const open=!V.collapsed.has(l.id), L=smpLive(l), shownU=(l.units||[]).filter(u=>u.removed?smpDefaultStates():V.sst.has(u.state)), LS=L.filter(u=>V.sst.has(u.state)), allSel=LS.length&&LS.every(u=>V.sel.has(smpKey(l,u)));
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
    const units=open?shownU.map(u=>{const k=smpKey(l,u), c=smpCode(l,u);
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
      ${fld('f-project',esc(tx('f_project')),inp('project','','text',`placeholder="${esc(tx('ph_project'))}"`))}
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
      ${S.ro?'':`<p class="note" style="margin:0 0 6px">${esc(tx('linkedHelp'))}</p>`}
      <div id="smp-lot-tests"></div>
      ${S.ro?'':`<div class="row lt-add"><input id="smp-lt-add" list="smp-lt-plrs" placeholder="${esc(tx('f_plr_ph'))}" aria-label="${esc(tx('ltAdd'))}" autocomplete="off"><datalist id="smp-lt-plrs">${smpPlrOptions()}</datalist><button type="button" class="btn sm" data-sa="lt-add-plr">${esc(tx('ltAdd'))}</button></div>`}
      ${S.ro&&tests.length?`<ol class="qlines">${tests.map(x=>`<li><span class="seq">${esc(x.sequence||'·')}</span><button type="button" class="link ref" data-act="edit" data-id="${esc(x.id)}">${esc(x.plr)} · ${esc(x.qtp)}</button><span class="tt">${esc(x.title||'')}</span>${estPill(x.status)}${resTag(x.result)}</li>`).join('')}</ol>`:''}
      ${S.ro?`${(l.plrs||[]).filter(smpLegacy).map(p=>`<p class="note">${esc(p)} · ${esc(tx('legacy'))}</p>`).join('')}
      ${unlinked.map(p=>`<p class="note">${esc(p)} · ${esc(tx('plrUnknown'))}</p>`).join('')}`:''}</div>
    <details><summary>${esc(tx('history'))} (${(l.log||[]).length})</summary><ul class="log">${[...(l.log||[])].reverse().map(e=>`<li><time>${fmt(String(e.at||'').slice(0,10))}</time>${esc(smpLogTxt(e))}${e.by?` <span class="muted">· ${esc(e.by)}</span>`:''}</li>`).join('')}</ul></details>`;
  dlg.innerHTML=smpShell(tx('lot_eyebrow',l.code),l.desc,body,`${S.ro?'':`<button type="button" class="btn ghost danger" data-sa="del">${esc(tx('del'))}</button>`}<button type="button" class="btn" data-sa="print-lot">🏷 ${esc(tx('printLot'))}</button><span class="sp"></span><button type="button" class="btn ghost" data-act="close">${esc(S.ro?tx('close'):tx('cancel'))}</button>${S.ro?'':`<button class="btn primary" type="submit">${esc(tx('save'))}</button>`}`);
  S.smp.edit.linked=new Set(tests.map(x=>x.id)); S.smp.edit.plrs=[...(l.plrs||[])];
  if(!dlg.open) dlg.showModal();
  smpLotUnits(); smpLotTestsBox();
  if(focusN){const el=dlg.querySelector(`[data-un="${focusN}"][data-f="state"]`); if(el) el.focus();}
}
/* Every test of the reception's PLRs with a tick: unticking one unlinks it from these samples. */
function smpLotTestsBox(){
  const box=$('#smp-lot-tests'); if(!box||S.ro) return; const e=S.smp.edit;
  box.innerHTML=e.plrs.map(p=>{const all=smpTestsOfPlr(p), t0=all[0]||{};
    return `<div class="lt-plr"><div class="row"><b class="ref">${esc(p)}</b>${t0.project?smpProj(t0.project):''}<span class="sp"></span>${e.plrs.length>1?`<button type="button" class="btn sm ghost danger" data-sa="lt-rm-plr" data-plr="${esc(p)}">${esc(tx('ltRm'))}</button>`:''}</div>
    ${all.length?`<ol class="qlines lt-pick">${all.map(x=>{const on=e.linked.has(x.id);
      return `<li class="${on?'':'off'}"><input type="checkbox" data-lt="${esc(x.id)}" ${on?'checked':''} aria-label="${esc(x.plr)} · ${esc(x.qtp)}"><span class="seq">${esc(x.sequence||'·')}</span><button type="button" class="link ref" data-act="edit" data-id="${esc(x.id)}">${esc(x.qtp)}</button><span class="tt">${esc(x.title||'')}</span>${estPill(x.status)}${resTag(x.result)}</li>`;}).join('')}</ol>`
      :`<p class="note">${esc(smpLegacy(p)?tx('legacy'):tx('plrUnknown'))}</p>`}</div>`;}).join('');
}
/* PLRs known from the tests, for the "assign to another PLR" pickers. */
const smpPlrOptions=()=>[...new Map(S.tests.filter(x=>x.plr).map(x=>[smpPlrKey(x.plr),x])).values()].sort((a,b)=>smpPlrKey(b.plr).localeCompare(smpPlrKey(a.plr))).map(x=>`<option value="${esc(smpPlrKey(x.plr))}">${esc(projectNo(x))} · ${esc(x.title||'')}</option>`).join('');
function smpLtAdd(){
  const i=$('#smp-lt-add'), p=smpPlrKey(i&&i.value), e=S.smp.edit; if(!p) return;
  if(!e.plrs.includes(p)){e.plrs.push(p); smpTestsOfPlr(p).forEach(x=>e.linked.add(x.id));}
  i.value=''; smpLotTestsBox();
}
function smpLtRm(p){const e=S.smp.edit; if(e.plrs.length<2) return; e.plrs=e.plrs.filter(x=>x!==p); smpTestsOfPlr(p).forEach(x=>e.linked.delete(x.id)); smpLotTestsBox();}
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
/* "Use existing samples" on a PLR card: samples already coded for other PLRs are reused in this one.
   The PLR joins each reception linked to all its tests; its own codes, units and states stay as they are. */
function smpOpenAssign(p){
  if(S.ro) return; p=smpPlrKey(p); S.smp.as={plr:p,q:'',sel:new Set()};
  dlg.dataset.kind='smp-as'; dlg.dataset.id=p;
  dlg.innerHTML=smpShell(tx('as_eyebrow'),tx('as_title',p),`<p class="note">${esc(tx('as_help'))}</p>
    <input class="search" id="smp-as-q" type="search" placeholder="${esc(tx('search'))}" aria-label="${esc(tx('search'))}" style="width:100%;margin:8px 0">
    <div class="as-list" id="smp-as-list"></div>`,
    `<span class="note" id="smp-as-n"></span><span class="sp"></span><button type="button" class="btn ghost" data-act="close">${esc(tx('cancel'))}</button><button type="button" class="btn primary" data-sa="assign-ok" disabled>${esc(tx('as_ok'))}</button>`);
  if(!dlg.open) dlg.showModal(); smpAssignList();
}
function smpAssignList(){
  const A=S.smp.as, q=A.q, box=$('#smp-as-list'); if(!box) return;
  const lots=S.samples.filter(l=>!(l.plrs||[]).includes(A.plr)&&smpLive(l).length&&smpMatch(l,q)).sort((a,b)=>b.code.localeCompare(a.code));
  box.innerHTML=lots.length?lots.map(l=>`<label class="as-row"><input type="checkbox" data-as="${esc(l.id)}" ${A.sel.has(l.id)?'checked':''}>
    <span class="ref"><b>${esc(l.code)}</b></span><span class="ds">${esc(l.desc)}</span><span class="chips">${(l.plrs||[]).map(p=>`<span class="chip">${esc(p)}</span>`).join('')}</span>${smpSummary(l)}</label>`).join('')
    :`<p class="note">${esc(tx('noMatch'))}</p>`;
  smpAssignCount();
}
function smpAssignCount(){const n=S.smp.as.sel.size, b=dlg.querySelector('[data-sa="assign-ok"]'), c=$('#smp-as-n'); if(b) b.disabled=!n; if(c) c.textContent=n?tx('as_n',n):'';}
async function smpSaveAssign(){
  if(S.ro||!db) return; const A=S.smp.as, now=nowIso();
  const lots=[...A.sel].map(id=>S.samples.find(x=>x.id===id)).filter(l=>l&&!(l.plrs||[]).includes(A.plr));
  try{
    await Promise.all(lots.map(l=>db.doc(`${COL.samples}/${l.id}`).update({plrs:[...(l.plrs||[]),A.plr],log:[...(l.log||[]),smpLog('log_plrAdd',A.plr)],updated:now})));
    dlg.close(); toast(tx('as_done',lots.length,A.plr)); render();
  }catch(e){formErr(errMsg(e));}
}
async function smpSaveLot(){
  if(S.ro||!db) return;
  const old=S.samples.find(x=>x.id===dlg.dataset.id); if(!old) return;
  const {g}=smpFd();
  if(!g('desc')) return formErr(tx('errDesc'));
  const e=S.smp.edit, log=[], plrs=[...e.plrs]; if(!plrs.length) return formErr(tx('errPlr'));
  const fields={desc:g('desc'),pn:g('pn'),phase:g('phase'),project:g('project'),received:g('received'),by:g('by'),loc:g('loc'),comments:g('comments')};
  if(Object.keys(fields).some(k=>String(old[k]||'')!==fields[k])) log.push(smpLog('log_edit'));
  plrs.filter(p=>!(old.plrs||[]).includes(p)).forEach(p=>log.push(smpLog('log_plrAdd',p)));
  (old.plrs||[]).filter(p=>!plrs.includes(p)).forEach(p=>log.push(smpLog('log_plrRm',p)));
  for(const u of e.units){ const o=(old.units||[]).find(x=>x.n===u.n), c=smpCode(e,u);
    if(!o){log.push(smpLog('log_add',c)); continue;}
    if(u.removed&&!o.removed) log.push(smpLog('log_rm',c));
    else if(!u.removed&&o.removed) log.push(smpLog('log_back',c));
    else if(u.state!==o.state) log.push(smpLog('log_state',c,{st:o.state},{st:u.state})); }
  /* Linked tests: a PLR with every test ticked stores none, which means "all of them" (tests ARAS adds later too).
     A PLR kept in the reception needs at least one test; to unlink it completely, take it out of the PLR field.
     Removing a PLR from the reception drops its tests. */
  const ticked=[];
  for(const p of plrs){ const all=smpTestsOfPlr(p); if(!all.length) continue;
    const mine=all.filter(x=>e.linked.has(x.id));
    if(!mine.length) return formErr(tx('errLinked',p));
    if(mine.length<all.length) ticked.push(...mine.map(x=>x.id)); }
  const prevT=smpLotTests(old).map(x=>x.id).sort().join(), nextT=smpLotTests({...old,plrs,tests:ticked}).map(x=>x.id).sort().join();
  if(prevT!==nextT&&plrs.join()===(old.plrs||[]).join()) log.push(smpLog('log_tests'));
  if(!fields.received&&e.units.some(u=>u.state!=='expected'&&!u.removed&&((old.units||[]).find(x=>x.n===u.n)||{}).state==='expected')) fields.received=iso(todayMs());
  const patch={...fields,plrs,units:e.units.map(({n,state,serial,loc,note,removed,printed})=>({n,state,serial:String(serial||'').trim(),loc:String(loc||'').trim(),note:String(note||'').trim(),removed:!!removed,printed:!!printed})),
    tests:ticked,log:[...(old.log||[]),...log],updated:nowIso()};
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
const smpLblCfg=()=>{let c={}; try{c=JSON.parse(localStorage.getItem('tl.lbl')||'{}')||{};}catch(e){} return {size:'99012',code:'qr',rot:'90',plr:true,desc:true,date:true,...c};};
function smpQr(text){
  if(typeof qrcode!=='function') return `<div class="noqr">QR</div>`;
  const q=qrcode(0,'L'); q.addData(text); q.make(); const n=q.getModuleCount(); let p='';
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
/* The label QR opens Control de ensayos filtered by the sample's PLR (the first one when it has several); an old FLT reference
   has no tests there, so its QR opens the sample in this app. */
const CE_URL='https://polinya-lab.github.io/management-tools/control-ensayos/';
const smpQrUrl=(l,code)=>{const p=(l.plrs||[]).find(x=>!smpLegacy(x)); return p?`${CE_URL}#queue?plr=${encodeURIComponent(p)}`:smpUrl(code);};
function smpLabel(k,c){
  const x=smpByKey(k); if(!x) return ''; const {l,u}=x, code=smpCode(l,u), sz=SMP_LABELS[c.size]||SMP_LABELS['99012'];
  const qtps=smpLotTests(l).map(y=>y.qtp);
  const plr=(l.plrs||[]).join(' · '), qtp=qtps.length?qtps[0]+(qtps.length>1?` +${qtps.length-1}`:''):'';
  const date=c.date&&l.received?fmt(l.received):'';
  /* Each monospaced line shrinks only if it would not fit the text column next to the QR (the barcode takes a strip at
     the bottom instead, so everything is a little smaller with it). */
  const textW=sz.w-4.4-(c.code==='qr'?sz.qr+2:0), kb=c.code==='bar'?.8:1;
  const f=(txt,v)=>(Math.min(v*kb,textW/(Math.max(1,txt.length)*.62))).toFixed(2)+'mm';
  return `<div class="dlbl ${c.code==='bar'?'wbar':''} ${sz.h<=28?'sm':''}" style="width:${sz.w}mm;height:${sz.h}mm;--qr:${sz.qr}mm;--fs:${f(code,sz.id)};--fs-plr:${f(plr,sz.plr)};--fs-qtp:${f(qtp,sz.qtp)};--fs-ds:${(sz.ds*kb).toFixed(2)}mm;--fs-ft:${(sz.ft*kb).toFixed(2)}mm">
    ${c.code==='qr'?`<div class="qr">${smpQr(smpQrUrl(l,code))}</div>`:''}
    <div class="tx"><b class="id">${esc(code)}</b>${c.plr&&plr?`<b class="plr">${esc(plr)}</b>`:''}${c.plr&&qtp?`<b class="qtp">${esc(qtp)}</b>`:''}${c.desc&&l.desc?`<span class="ds">${esc(l.desc)}</span>`:''}${date?`<span class="ft">${esc(date)}</span>`:''}</div>
    ${c.code==='bar'?`<svg class="bc" data-bc="${esc(code)}"></svg>`:''}</div>`;
}
function smpOpenLabels(keys){
  keys=keys.filter(smpByKey); S.smp.lb={keys,checked:new Set(keys)}; dlg.dataset.kind='smp-lb'; dlg.dataset.id='';
  dlg.innerHTML=smpShell(tx('lb_eyebrow'),tx('lb_title',keys.length),`<div class="lb-grid"><div class="lb-side" id="smp-lb-side"></div><div><p class="eyebrow" style="margin-bottom:6px">${esc(tx('lb_preview'))}</p><div class="lb-prev" id="smp-lb-prev"></div><p class="note lb-how" style="margin-top:10px">${tx('lb_how')}</p></div></div>`,
    `<span class="sp"></span><button type="button" class="btn ghost" data-act="close">${esc(tx('close'))}</button><button type="button" class="btn primary" data-sa="do-print">🖨 ${esc(tx('lb_print'))}</button>`);
  if(!dlg.open) dlg.showModal(); smpLbSide(); smpLbPreview();
  if(impOn()){impLoad(); if(impDest(smpLblCfg())==='lab') impPoll();}
}
function smpLbSide(){
  const c=smpLblCfg(), ck=(k,lab)=>`<label><input type="checkbox" data-lbc="${k}" ${c[k]?'checked':''}> ${esc(lab)}</label>`;
  const lab=impDest(c)==='lab', E=IMP.est;
  const dest=impAvail()?`<div class="field"><span class="lbl">${esc(tx('imp_dest'))}</span><div class="checks" style="flex-direction:column;align-items:flex-start">
      <label><input type="radio" name="smp-lb-dest" value="lab" ${lab?'checked':''}> ${esc(tx('imp_lab'))}</label>
      <label><input type="radio" name="smp-lb-dest" value="here" ${lab?'':'checked'}> ${esc(tx('imp_here'))}</label></div>
      ${lab?`<div id="imp-status" class="imp-status">${impStatusHtml()}</div>`:''}</div>`:'';
  const size=lab?fld('smp-imp-rollo',esc(tx('imp_roll')),`<select id="smp-imp-rollo">${Object.entries(SMP_LABELS).map(([k,v])=>`<option value="${k}" ${(E?E.rollo:c.size)===k?'selected':''}>${esc(v.n)}</option>`).join('')}</select>`,'',esc(tx('imp_rollHelp')))
    :fld('smp-lb-size',esc(tx('lb_size')),`<select id="smp-lb-size">${Object.entries(SMP_LABELS).map(([k,v])=>`<option value="${k}" ${c.size===k?'selected':''}>${esc(v.n)}</option>`).join('')}</select>`);
  $('#smp-lb-side').innerHTML=dest+`<div class="field"><span class="lbl">${esc(tx('lb_units'))} · <button type="button" class="link" data-sa="lb-all">${esc(tx('lb_all'))}</button> · <button type="button" class="link" data-sa="lb-none">${esc(tx('lb_noneSel'))}</button></span>
      <div class="lb-list">${S.smp.lb.keys.map(k=>{const {l,u}=smpByKey(k); return `<label><input type="checkbox" data-lbk="${esc(k)}" ${S.smp.lb.checked.has(k)?'checked':''}> ${esc(smpCode(l,u))}${u.printed?' ✓':''}</label>`;}).join('')}</div></div>
    ${size}
    <div class="field"><span class="lbl">${esc(tx('lb_code'))}</span><div class="checks" style="flex-direction:column;align-items:flex-start">${[['qr',tx('qr')],['bar',tx('bar')],['none',tx('noCode')]].map(([v,lab])=>`<label><input type="radio" name="smp-lb-code" value="${v}" ${c.code===v?'checked':''}> ${esc(lab)}</label>`).join('')}</div></div>
    ${lab?'':fld('smp-lb-rot',esc(tx('lb_rot')),`<select id="smp-lb-rot">${['90','270','0','180'].map(v=>`<option value="${v}" ${c.rot===v?'selected':''}>${esc(tx('lb_rot'+v))}</option>`).join('')}</select>`)}
    <div class="field"><span class="lbl">${esc(tx('lb_show'))}</span><div class="checks" style="flex-direction:column;align-items:flex-start">${ck('plr',tx('lb_plr'))}${ck('desc',tx('lb_desc'))}${ck('date',tx('lb_date'))}</div></div>`;
}
function smpLbPreview(){
  const c0=smpLblCfg(), lab=impDest(c0)==='lab', c=lab&&IMP.est?{...c0,size:IMP.est.rollo}:c0;
  const keys=S.smp.lb.keys.filter(k=>S.smp.lb.checked.has(k)), p=$('#smp-lb-prev');
  p.innerHTML=keys.length?keys.map(k=>smpLabel(k,c)).join(''):`<p class="note">${esc(tx('lb_empty'))}</p>`;
  smpBarcodes(p);
  const b=dlg.querySelector('[data-sa="do-print"]'); if(b){b.disabled=!keys.length||IMP.busy; if(!IMP.busy) b.textContent='🖨 '+tx(lab?'imp_send':'lb_print');}
  const h=dlg.querySelector('.dlg-h h2'); if(h) h.textContent=tx('lb_title',keys.length);
  const how=dlg.querySelector('.lb-how'); if(how) how.innerHTML=lab?esc(tx('imp_how')):tx('lb_how');
  let j=$('#imp-jobs'); if(lab&&!j){j=document.createElement('div'); j.id='imp-jobs'; p.parentElement.appendChild(j);} if(j){j.hidden=!lab; if(lab) j.innerHTML=impJobsHtml();}
  /* The lab printer prints the 1-bit image: the preview shows that image (what you see is what prints). */
  if(lab&&keys.length){const seq=++IMP.prev, slice=keys.slice(0,12);
    Promise.all(slice.map(k=>impLabelPng(k,c))).then(pngs=>{ if(seq!==IMP.prev||!p.isConnected) return;
      const sz=SMP_LABELS[c.size]||SMP_LABELS['99012'];
      p.querySelectorAll('.dlbl').forEach((el,i)=>{ if(i<pngs.length) el.outerHTML=`<img class="dlbl-img" alt="" src="data:image/png;base64,${pngs[i]}" style="width:${sz.w}mm;height:${sz.h}mm">`; });
    }).catch(e=>{ if(seq===IMP.prev&&e.code==='render') toast(tx('imp_e_render')); });
  }
}
function smpLbSet(k,v){const c=smpLblCfg(); c[k]=v; try{localStorage.setItem('tl.lbl',JSON.stringify(c));}catch(e){} smpLbPreview();}
function smpPrint(){
  const c=smpLblCfg(), keys=S.smp.lb.keys.filter(k=>S.smp.lb.checked.has(k)); if(!keys.length) return toast(tx('lb_empty'));
  if((c.code==='qr'&&typeof qrcode!=='function')||(c.code==='bar'&&typeof JsBarcode!=='function')) toast(tx('lb_noLib'));
  const sz=SMP_LABELS[c.size]||SMP_LABELS['99012'];
  /* One page per label. Printer drivers differ in how they feed the label, so the turn is chosen in the dialog:
     90/270 print on a portrait page (short side across the head), 0/180 on a landscape page. */
  const rot=['90','270','0','180'].includes(c.rot)?c.rot:'90', tall=rot==='90'||rot==='270';
  const pw=tall?sz.h:sz.w, ph=tall?sz.w:sz.h;
  const tf={'90':`translateX(${sz.h}mm) rotate(90deg)`,'270':`translateY(${sz.w}mm) rotate(-90deg)`,'0':'none','180':`translate(${sz.w}mm,${sz.h}mm) rotate(180deg)`}[rot];
  /* The real DYMO stock is a fraction of a mm off the nominal size (11354 is 31.75 × 57.15 mm), so each label box is
     kept 0.8 mm under the page: a box even slightly taller than the paper spills onto a second, blank label. */
  $('#smp-page-size').textContent=`@page{size:${pw}mm ${ph}mm;margin:0}`;
  const area=$('#smp-print'); area.innerHTML=keys.map(k=>`<div class="pg" style="width:${pw-.8}mm;height:${ph-.8}mm"><div class="rot" style="width:${sz.w}mm;height:${sz.h}mm;transform:${tf}">${smpLabel(k,c)}</div></div>`).join(''); smpBarcodes(area);
  dlg.close();
  setTimeout(()=>{
    window.print(); area.innerHTML='';
    toast(tx('lb_done',keys.length));
    smpMarkPrinted(keys).catch(e=>toast(errMsg(e)));
  },60);
}
/* Printed units stop counting as "labels to print". */
function smpMarkPrinted(keys){
  if(S.ro||!db) return Promise.resolve();
  const by=new Map(); keys.map(smpByKey).filter(Boolean).forEach(({l,u})=>{ if(u.printed) return; if(!by.has(l)) by.set(l,new Set()); by.get(l).add(u.n); });
  return Promise.all([...by].map(([l,ns])=>db.doc(`${COL.samples}/${l.id}`).update({units:(l.units||[]).map(u=>ns.has(u.n)?{...u,printed:true}:u),log:[...(l.log||[]),smpLog('log_print',ns.size)]})));
}

/* ---------- Lab printer: the labels go to the DYMO of the lab's fixed PC through the print queue (Supabase function
   `impresion`); the station program there (estacion-dymo.exe) prints them. Design:
   docs/superpowers/specs/2026-11-10-impresion-remota-dymo-design.md. Each label travels as a 1-bit PNG drawn from the
   same HTML as the preview, at the printer's 300 dpi. The units are marked printed when the station confirms. ---------- */
const IMP={est:null,trab:[],impresos:[],loaded:false,busy:false,timer:0,css:null,prev:0,ids:null};
const IMP_APL='tl.imp.apl';
const impOn=()=>APP==='samples'&&!!LA&&typeof LA.apiImpresion==='function'&&byMail()&&canWrite()&&!S.ro;
/* The lab printer is offered once the queue answers and the station has a key; until then (or if the queue is not
   there) the dialog stays as before, printing here. */
const impAvail=()=>impOn()&&!!IMP.est&&IMP.est.configurada;
const impDest=c=>impAvail()&&c.dest!=='here'?'lab':'here';
async function impFetch(path,opt={}){
  const h=await LA.cabeceras(), init={method:opt.method||'GET',headers:h};
  if(opt.body!==undefined){h['Content-Type']='application/json'; init.body=JSON.stringify(opt.body);}
  let r; try{r=await fetch(LA.apiImpresion()+path,init);}catch(e){const x=new Error(tx('e_net')); x.code='unavailable'; throw x;}
  const j=await r.json().catch(()=>({}));
  if(!r.ok){const x=new Error(j.message||('HTTP '+r.status)); x.status=r.status; x.code=r.status===401?'auth':j.code; x.args=j.args; throw x;}
  return j;
}
const impErr=e=>{
  if(e.code==='auth'){mailExpired(); return ta('au_e_save');}
  return e.code==='roll_changed'?tx('imp_e_roll',(e.args||[])[0]||''):e.code==='no_edit'||e.status===403?ta('au_e_perm'):e.code==='unavailable'?ta('au_e_net'):e.code==='render'?tx('imp_e_render'):tx('imp_e',e.message);
};
/* Errors the server stores as a code; the station's own messages (DYMO) are shown as they come. */
const impErrTxt=m=>m==='interrupted'?tx('imp_int'):m==='print_error'?tx('imp_perr'):m;
/* Reads the station and the person's recent jobs; jobs the station confirmed mark their units printed (once). */
async function impLoad(){
  if(!impOn()) return; const antes=impAvail();
  try{const j=await impFetch('/estado'); IMP.est=j.estacion; IMP.trab=j.trabajos||[]; IMP.impresos=j.impresos||[]; IMP.loaded=true; IMP.err='';}
  catch(e){IMP.loaded=true; if(e.status===404) IMP.est=null; IMP.err=e.status===404?'':impErr(e);}
  if(antes!==impAvail()&&dlg.open&&dlg.dataset.kind==='smp-lb'){smpLbSide(); smpLbPreview(); if(impAvail()) impPoll();}
  if(!IMP.err&&IMP.est) await impApply();
  impPaint();
}
async function impApply(){
  let apl=[]; try{apl=JSON.parse(localStorage.getItem(IMP_APL)||'[]')||[];}catch(e){}
  const done=(IMP.impresos||[]).filter(t=>!apl.includes(t.id));
  if(!done.length) return;
  try{await smpMarkPrinted(done.flatMap(t=>t.unidades||[])); apl=[...done.map(t=>t.id),...apl].slice(0,400); try{localStorage.setItem(IMP_APL,JSON.stringify(apl));}catch(e){}}
  catch(e){toast(errMsg(e));}
}
/* While the label dialog is open, the status refreshes every 5 s. */
function impPoll(){
  clearInterval(IMP.timer);
  IMP.timer=setInterval(()=>{ if(!dlg.open||dlg.dataset.kind!=='smp-lb'){clearInterval(IMP.timer); return;}
    if(!document.hidden&&impDest(smpLblCfg())==='lab') impLoad(); },5000);
}
const impTime=iso=>iso?new Date(iso).toLocaleString(LL.locale(),{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
function impStatusHtml(){
  const E=IMP.est; if(IMP.err) return `<span class="imp-st off">${esc(IMP.err)}</span>`;
  if(!E) return `<span class="imp-st">${esc(tx('imp_loading'))}</span>`;
  if(!E.configurada) return `<span class="imp-st off">${esc(tx('imp_nocfg'))}</span>`;
  if(!E.conectada) return `<span class="imp-st off">● ${esc(tx('imp_off',impTime(E.visto)))}</span>`;
  const s=E.estado||{};
  if(!s.dymo||!s.conectada) return `<span class="imp-st warn">● ${esc(tx('imp_nodymo'))}${s.error?` · ${esc(s.error)}`:''}</span>`;
  return `<span class="imp-st ok">● ${esc(tx('imp_on'))}${s.impresora?` · ${esc(s.impresora)}`:''}</span>`;
}
function impJobsHtml(){
  if(!IMP.trab.length) return '';
  const st=t=>t.estado==='imprimiendo'?tx('imp_st_imprimiendo',t.hechas,t.n):tx('imp_st_'+t.estado);
  return `<p class="eyebrow" style="margin:14px 0 6px">${esc(tx('imp_recent'))}</p><ul class="imp-jobs">${IMP.trab.map(t=>`<li class="imp-${t.estado}"><time>${esc(impTime(t.creado))}</time>
    <span class="cods">${esc((t.codigos||[]).slice(0,3).join(', '))}${t.n>3?` +${t.n-3}`:''}</span><span class="sp"></span>
    <span class="imp-tag">${esc(st(t))}</span>${t.estado==='error'?`${t.error?`<span class="imp-msg">${esc(impErrTxt(t.error))}</span>`:''}<button type="button" class="btn sm" data-sa="imp-retry" data-id="${esc(t.id)}">${esc(tx('imp_retry'))}</button>`:''}</li>`).join('')}</ul>`;
}
/* Repaints the parts of the open label dialog that depend on the station. */
function impPaint(){
  if(!dlg.open||dlg.dataset.kind!=='smp-lb') return;
  const a=$('#imp-status'); if(a) a.innerHTML=impStatusHtml();
  const b=$('#imp-jobs'); if(b) b.innerHTML=impJobsHtml();
  const r=$('#smp-imp-rollo'); if(r&&IMP.est&&r.value!==IMP.est.rollo&&document.activeElement!==r){r.value=IMP.est.rollo; smpLbPreview();}
}
/* The .dlbl rules of app.css and the fonts, embedded so the label can be drawn as an image (SVG foreignObject). */
const impB64=buf=>{const b=new Uint8Array(buf); let s=''; for(let i=0;i<b.length;i+=0x8000) s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000)); return btoa(s);};
function impCss(){
  if(IMP.css) return IMP.css;
  IMP.css=(async()=>{
    const rules=[];
    for(const sh of document.styleSheets){let rs; try{rs=sh.cssRules;}catch(e){continue;} for(const ru of rs) if(ru.selectorText&&/\.dlbl/.test(ru.selectorText)) rules.push(ru.cssText);}
    const cs=getComputedStyle(document.documentElement), vars=`:root{--f-body:${cs.getPropertyValue('--f-body')};--f-mono:${cs.getPropertyValue('--f-mono')}}`;
    let fonts='';
    const link=[...document.querySelectorAll('link[rel="stylesheet"]')].find(l=>/fonts\.googleapis\.com/.test(l.href));
    if(link) try{
      const css=await (await fetch(link.href)).text();
      const blocks=(css.match(/@font-face\s*{[^}]*}/g)||[]).filter(b=>!/unicode-range/.test(b)||/U\+0000-00FF/i.test(b));
      fonts=(await Promise.all(blocks.map(async b=>{const m=b.match(/url\((https:[^)]+)\)/); if(!m) return ''; const buf=await (await fetch(m[1])).arrayBuffer(); return b.replace(m[1],'data:font/woff2;base64,'+impB64(buf));}))).join('\n');
    }catch(e){fonts='';}
    return `${fonts}\n${vars}\n${rules.join('\n')}\n.dlbl{border-radius:0!important;box-shadow:none!important}`;
  })();
  return IMP.css;
}
/* PNG with 1-bit greyscale pixels (0 = black), deflated with the browser's CompressionStream. */
const IMP_CRC=(()=>{const t=new Uint32Array(256); for(let n=0;n<256;n++){let c=n; for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1; t[n]=c>>>0;} return t;})();
function impChunk(type,data){
  const out=new Uint8Array(12+data.length), dv=new DataView(out.buffer);
  dv.setUint32(0,data.length); for(let i=0;i<4;i++) out[4+i]=type.charCodeAt(i); out.set(data,8);
  let c=~0; for(let i=4;i<8+data.length;i++) c=IMP_CRC[(c^out[i])&255]^(c>>>8);
  dv.setUint32(8+data.length,(~c)>>>0); return out;
}
async function impPng1(w,h,dark){
  const row=Math.ceil(w/8)+1, raw=new Uint8Array(row*h).fill(0xff);
  for(let y=0;y<h;y++){raw[y*row]=0; for(let x=0;x<w;x++) if(dark[y*w+x]) raw[y*row+1+(x>>3)]&=~(0x80>>(x&7));}
  const z=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const ih=new Uint8Array(13), dv=new DataView(ih.buffer); dv.setUint32(0,w); dv.setUint32(4,h); ih[8]=1; ih[9]=0;
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),impChunk('IHDR',ih),impChunk('IDAT',z),impChunk('IEND',new Uint8Array(0))];
  const png=new Uint8Array(parts.reduce((a,p)=>a+p.length,0)); let o=0; for(const p of parts){png.set(p,o); o+=p.length;}
  return impB64(png.buffer);
}
/* One label as base64 PNG, landscape (long side across), 300 dpi, pure black and white. */
async function impLabelPng(k,c){
  const sz=SMP_LABELS[c.size]||SMP_LABELS['99012'], css=await impCss();
  const host=document.createElement('div'); host.style.cssText='position:fixed;left:-10000px;top:0'; host.innerHTML=smpLabel(k,c); document.body.appendChild(host); smpBarcodes(host);
  const html=new XMLSerializer().serializeToString(host.firstElementChild); host.remove();
  const W=Math.round(sz.w/25.4*300), H=Math.round(sz.h/25.4*300), cw=sz.w/25.4*96, ch=sz.h/25.4*96;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${cw} ${ch}"><foreignObject x="0" y="0" width="${cw}" height="${ch}"><div xmlns="http://www.w3.org/1999/xhtml" style="margin:0"><style>${css.replace(/&/g,'\\26 ').replace(/</g,'\\3c ')}</style>${html}</div></foreignObject></svg>`;
  let d;
  try{
    const img=new Image(); img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg); await img.decode();
    const cv=document.createElement('canvas'); cv.width=W; cv.height=H; const g=cv.getContext('2d');
    g.fillStyle='#fff'; g.fillRect(0,0,W,H); g.drawImage(img,0,0,W,H);
    d=g.getImageData(0,0,W,H).data; // Safari blocks reading a canvas with foreignObject drawn on it
  }catch(e){const x=new Error(e.message); x.code='render'; throw x;}
  const dark=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++) dark[i]=(d[i*4]*299+d[i*4+1]*587+d[i*4+2]*114)/1000<150?1:0;
  return impPng1(W,H,dark);
}
async function impSend(){
  if(IMP.busy) return; const c=smpLblCfg(), keys=S.smp.lb.keys.filter(k=>S.smp.lb.checked.has(k)&&smpByKey(k)); if(!keys.length) return toast(tx('lb_empty'));
  if(!IMP.est) await impLoad(); if(!IMP.est) return toast(IMP.err||tx('imp_e',''));
  const cfg={...c,size:IMP.est.rollo}, btn=dlg.querySelector('[data-sa="do-print"]');
  /* The job ids stay the same while the same labels are sent again (lost answer, failed second part): the server
     ignores a job it already has, so nothing prints twice. They change when what is sent changes. */
  const firma=JSON.stringify([keys,cfg.size,cfg.code,cfg.plr,cfg.desc,cfg.date]);
  if(!IMP.ids||IMP.ids.firma!==firma) IMP.ids={firma,ids:[]};
  IMP.busy=true; if(btn){btn.disabled=true; btn.textContent=tx('imp_render');}
  try{
    for(let i=0;i<keys.length;i+=100){
      const part=keys.slice(i,i+100), etiquetas=[];
      for(const k of part){const {l,u}=smpByKey(k); etiquetas.push({codigo:smpCode(l,u),png:await impLabelPng(k,cfg)});}
      const id=IMP.ids.ids[i/100]||(IMP.ids.ids[i/100]=crypto.randomUUID());
      const t=await impFetch('/trabajos',{method:'POST',body:{id,rollo:cfg.size,etiquetas,unidades:part}});
      IMP.trab=[t,...IMP.trab.filter(x=>x.id!==t.id)].slice(0,10);
    }
    IMP.ids=null; toast(tx(IMP.est.conectada?'imp_sent':'imp_sentOff',keys.length)); impPaint();
  }catch(e){ toast(impErr(e)); if(e.code==='roll_changed'){await impLoad(); smpLbPreview();} }
  finally{IMP.busy=false; if(btn&&btn.isConnected){btn.disabled=false; btn.textContent='🖨 '+tx('imp_send');}}
}
async function impRetry(id){try{await impFetch(`/trabajos/${id}/reintentar`,{method:'POST'}); await impLoad();}catch(e){toast(impErr(e));}}
async function impSetRoll(v){
  try{const j=await impFetch('/rollo',{method:'PUT',body:{rollo:v}}); if(IMP.est) IMP.est.rollo=j.rollo; IMP.ids=null; toast(tx('imp_rollSet',SMP_LABELS[j.rollo].n)); smpLbPreview();}
  catch(e){toast(impErr(e)); const r=$('#smp-imp-rollo'); if(r&&IMP.est) r.value=IMP.est.rollo; await impLoad();}
}

/* ---------- Samples events (data-sa, so they never reach the main handlers) ---------- */
function smpOpenCode(code){
  code=code.toUpperCase(); const base=code.match(/QTS-\d{5}/)[0], n=+(code.split('-')[2]||0);
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
  else if(a==='lt-add-plr') smpLtAdd();
  else if(a==='lt-rm-plr') smpLtRm(el.dataset.plr);
  else if(a==='assign') smpOpenAssign(el.dataset.plr);
  else if(a==='assign-ok'){el.disabled=true; Promise.resolve(smpSaveAssign()).finally(()=>{if(el.isConnected) el.disabled=false;});}
  else if(a==='tog'){ev.stopPropagation(); const id=el.dataset.id; V.collapsed.has(id)?V.collapsed.delete(id):V.collapsed.add(id); render();}
  else if(a==='tog-all'){ if(V.collapsed.size) V.collapsed.clear(); else S.samples.forEach(l=>V.collapsed.add(l.id)); render();}
  else if(a==='sv'){V.sv=el.dataset.v; try{localStorage.setItem('tl.smp.view',V.sv);}catch(e){} render();}
  else if(a==='sst'){const s=el.dataset.s; V.sst.has(s)?V.sst.delete(s):V.sst.add(s); render();}
  else if(a==='kpi'){const k=el.dataset.k;
    if(k==='lbl') return smpOpenLabels(smpPending());
    S.q=''; V.phase='';
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
  else if(a==='do-print'){ if(impDest(smpLblCfg())==='lab') impSend(); else smpPrint(); }
  else if(a==='imp-retry') impRetry(el.dataset.id);
  else if(a==='gen') smpOpenGen(el.dataset.plr);
  else if(a==='prop-mode'){const p=el.dataset.plr; V.prop[p]={...(V.prop[p]||{}),mode:el.dataset.m,qty:{}}; smpPropRerender();}
  else if(a==='prop-ok'||a==='prop-ok-print'){el.disabled=true; Promise.resolve(smpValidate([el.dataset.plr],a==='prop-ok-print')).finally(()=>{if(el.isConnected) el.disabled=false;});}
  else if(a==='prop-all'){ev.preventDefault(); el.disabled=true; Promise.resolve(smpValidate(smpProposals().map(P=>P.plr),false)).finally(()=>{if(el.isConnected) el.disabled=false;});}
  else if(a==='prop-skip') smpSkip(el.dataset.plr);
  else if(a==='recv-exp'){const g=smpGroups().find(x=>x.plr===el.dataset.plr); if(g&&g.exp.length){const n=g.exp.length; smpSetStates(g.exp,'received').then(()=>toast(tx('recvDone',n)));}}
});
document.addEventListener('keydown',ev=>{ if(ev.key==='Enter'&&ev.target.id==='smp-lt-add'){ev.preventDefault(); smpLtAdd();} });
document.addEventListener('input',ev=>{
  const el=ev.target;
  if(dlg.dataset.kind==='smp-rc'&&el.id==='f-plr') smpRcPlr();
  else if(el.id==='smp-qty'){S.smp.rc.qtyTouched=true; smpRcResize(el.value);}
  else if(el.dataset.rcu!=null) S.smp.rc.units[+el.dataset.rcu][el.dataset.f]=el.value;
  else if(el.dataset.un&&el.dataset.f!=='state'){const u=S.smp.edit.units.find(x=>x.n===+el.dataset.un); if(u) u[el.dataset.f]=el.value;}
  else if(el.id==='smp-as-q'){S.smp.as.q=el.value; smpAssignList();}
});
document.addEventListener('change',ev=>{
  const el=ev.target, V=S.smp;
  if(el.dataset.setunit) smpSetStates([el.dataset.setunit],el.value);
  else if(el.dataset.sel){el.checked?V.sel.add(el.dataset.sel):V.sel.delete(el.dataset.sel); render();}
  else if(el.dataset.sellot){const l=S.samples.find(x=>x.id===el.dataset.sellot); if(l) smpLive(l).filter(u=>V.sst.has(u.state)).forEach(u=>el.checked?V.sel.add(smpKey(l,u)):V.sel.delete(smpKey(l,u))); render();}
  else if(el.id==='smp-sel-state'&&el.value){const n=V.sel.size; smpSetStates([...V.sel],el.value).then(()=>toast(tx('stateChanged',n)));}
  else if(el.id==='smp-phase'){V.phase=el.value; render();}
  else if(el.id==='smp-only-missing'){V.onlyMissing=el.checked; render();}
  else if(el.dataset.as){const A=S.smp.as.sel; el.checked?A.add(el.dataset.as):A.delete(el.dataset.as); smpAssignCount();}
  else if(el.dataset.lt){const L=S.smp.edit.linked; el.checked?L.add(el.dataset.lt):L.delete(el.dataset.lt); el.closest('li').classList.toggle('off',!el.checked);}
  else if(el.dataset.un&&el.dataset.f==='state'){const u=V.edit.units.find(x=>x.n===+el.dataset.un); if(u){u.state=el.value; smpLotUnits();}}
  else if(el.id==='smp-all-to'&&el.value){V.edit.units.forEach(u=>{if(!u.removed) u.state=el.value;}); el.value=''; smpLotUnits();}
  else if(el.dataset.lbk){el.checked?V.lb.checked.add(el.dataset.lbk):V.lb.checked.delete(el.dataset.lbk); smpLbPreview();}
  else if(el.dataset.lbc) smpLbSet(el.dataset.lbc,el.checked);
  else if(el.dataset.pq){const [p,k]=el.dataset.pq.split('|'), st=V.prop[p]=V.prop[p]||{}; st.qty={...(st.qty||{}),[k]:Math.max(0,Math.min(200,parseInt(el.value)||0))}; smpPropRerender();}
  else if(el.id==='smp-lb-size') smpLbSet('size',el.value);
  else if(el.name==='smp-lb-code') smpLbSet('code',el.value);
  else if(el.id==='smp-lb-rot') smpLbSet('rot',el.value);
  else if(el.name==='smp-lb-dest'){smpLbSet('dest',el.value); smpLbSide(); if(el.value==='lab'&&impOn()){impLoad(); impPoll();}}
  else if(el.id==='smp-imp-rollo') impSetRoll(el.value);
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
  else if(a==='gh-out'){dlg.close(); mailSignOut();}
  else if(a==='gh-key') saveKey();
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
  if(b&&dlg.dataset.kind!=='gh'){b.disabled=true; b.textContent=tx('au_saving');}
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
const GH_API=`https://api.github.com/repos/${REPO.owner}/${REPO.repo}`;
/* Email sign-in (acceso/lab-auth.js): with an email session the data goes through the lab's Supabase function, which
   checks the person's role in this app; with a GitHub key, straight to api.github.com as before. Without the Supabase
   configuration (LabAuth.activo false) only the key exists, exactly as before. */
const LA=window.LabAuth&&window.LabAuth.activo?window.LabAuth:null;
const APP_ID=APP==='occupancy'?'ocupacion':APP==='samples'?'muestras':'ensayos';
const mailRepo=app=>`${LA.api(app)}/repos/${REPO.owner}/${REPO.repo}`;
/* The API base follows the mode, so an email session always targets the function and a key always api.github.com. */
const apiBase=()=>GH.modo==='correo'?mailRepo(APP_ID):GH_API;
const RAW=`https://raw.githubusercontent.com/${REPO.owner}/${REPO.repo}/${REPO.branch}/${REPO.path}`;
const TOKEN_KEY='pd-gh-token', DATA_COLS=['tests','personas','bancos','qtps','config','muestras'];
/* modo: 'correo' (email session), 'clave' (GitHub key) or null. With 'correo': email, pushEnsayos (Muestras: edit
   rights in ensayos, for Import ARAS), noAccess (no role in this app) and expired (the function answered 401). */
const GH={token:'',login:null,push:false,invalid:false,saving:false,modo:null,email:'',pushEnsayos:false,noAccess:false,expired:false};
try{GH.token=localStorage.getItem(TOKEN_KEY)||'';}catch(e){}
if(GH.token) GH.modo='clave';
const byMail=()=>GH.modo==='correo';
let mailBusy=false; // own sign-in/sign-out in progress: LabAuth.onCambio is not a session loss
/* Data can be read through the API (key or email session); otherwise the anonymous raw file (key mode only). */
const viaApi=()=>byMail()?!GH.expired&&!GH.noAccess:!!GH.token&&!GH.invalid;
const canWrite=()=>GH.push&&(byMail()?!GH.expired&&!GH.noAccess:!!GH.token&&!GH.invalid);
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
  await refresh(); render(); toast(tx(DEMO?(reset?'pv_reset':'pv_on'):'pv_off'));
}
document.addEventListener('click',ev=>{const b=ev.target.closest('[data-pv]'); if(!b) return; const a=b.dataset.pv;
  if(a==='demo-on') setDemo(true); else if(a==='demo-reset') setDemo(true,true); else if(a==='demo-off'){ setDemo(false); if(!GH.token) openGh(); }});
let local=null, flushTimer=null, flushing=null;
const pendingOps=[], subs=new Map();
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const rid=()=>Array.from(crypto.getRandomValues(new Uint8Array(10)),x=>'abcdefghijklmnopqrstuvwxyz0123456789'[x%36]).join('');
const b64encode=str=>{const bytes=new TextEncoder().encode(str); let bin=''; for(let i=0;i<bytes.length;i+=0x8000) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000)); return btoa(bin);};
const b64decode=b=>new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g,'')),c=>c.charCodeAt(0)));
/* Credentials only for their own service: the email session for the lab's function, the key for api.github.com. */
const ghAuth=async url=>LA&&url.startsWith(LA.api(APP_ID).replace(/[^/]+$/,''))?await LA.cabeceras():url.startsWith('https://api.github.com/')&&GH.token?{Authorization:`Bearer ${GH.token}`}:{};
const ghFetch=async(url,opts={})=>fetch(url,{cache:'no-store',...opts,headers:{Accept:'application/vnd.github+json',...await ghAuth(url),...(opts.headers||{})}});
const httpError=res=>{const limited=res.status===429||(res.status===403&&res.headers.get('x-ratelimit-remaining')==='0'); return {code:res.status===401?'auth':limited?'rate':(res.status===403||res.status===404)?'forbidden':'unavailable',status:res.status};};
const emptyData=()=>Object.fromEntries(DATA_COLS.map(c=>[c,{}]));
const normData=x=>{const o=emptyData(); for(const c of DATA_COLS) if(x&&x[c]&&typeof x[c]==='object') o[c]=x[c]; return o;};

async function fetchApi(useEtag){
  const res=await ghFetch(`${apiBase()}/contents/${REPO.path}?ref=${REPO.branch}`,useEtag&&remote.etag?{headers:{'If-None-Match':remote.etag}}:{});
  if(res.status===304) return null;
  if(res.status===404) throw {code:'private',status:404};
  if(!res.ok) throw httpError(res);
  const j=await res.json(); let text;
  if(j.content) text=b64decode(j.content);
  else{const blob=await ghFetch(`${apiBase()}/git/blobs/${j.sha}`); if(!blob.ok) throw httpError(blob); text=b64decode((await blob.json()).content);}
  return {data:normData(JSON.parse(text)),sha:j.sha,etag:res.headers.get('etag')};
}
async function loadCal(){
  if(!viaApi()){CAL.err='auth'; return;}
  try{
    const res=await ghFetch(`${apiBase()}/contents/${CAL_PATH}?ref=${REPO.branch}`); if(!res.ok) throw httpError(res);
    const j=await res.json(); let text;
    if(j.content) text=b64decode(j.content);
    else{const blob=await ghFetch(`${apiBase()}/git/blobs/${j.sha}`); if(!blob.ok) throw httpError(blob); text=b64decode((await blob.json()).content);}
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
    /* The session may have expired between the save and this commit: reject it, never fall back to an anonymous read. */
    if(byMail()&&!viaApi()) throw {code:'auth'};
    const cur=await fetchApi(false), next=applyOps(clone(cur.data),ops);
    const body={message:commitMessage(ops),branch:REPO.branch,content:b64encode(JSON.stringify(next,null,1)+'\n')}; if(cur.sha) body.sha=cur.sha;
    const res=await ghFetch(`${apiBase()}/contents/${REPO.path}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
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
    if(!canWrite()) return rej({code:'not_granted'});
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
    catch(err){ if(err.code==='auth'){ if(byMail()) mailExpired(); else {GH.invalid=true; GH.push=false; S.ro=true;} } batch.forEach(b=>b.rej(err)); }
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
  /* Email session not connected yet (the function failed at boot or right after signing in): try again here, on every poll. */
  if(byMail()&&!GH.login&&!GH.expired){
    try{await connectMail(GH.email); render(); loadCal();}
    catch(err){ if(err.code==='auth') mailExpired(); if(!local){S.noDb=true; S.privateData=err.code==='auth';} render(); return; }
  }
  /* Email session without a role in this app, or expired: no reading; what is on screen stays. */
  if(byMail()&&!viaApi()){ if(!local){S.noDb=true; S.privateData=true;} return; }
  try{
    const r=viaApi()?await fetchApi(true):await fetchRaw();
    if(r){Object.assign(remote,r); recompute();}
    S.noDb=false; S.privateData=false; if(PREVIEW) S.ro=false;
  }catch(err){
    if(err.code==='auth'&&byMail()){mailExpired(); if(!local){S.noDb=true; S.privateData=true;} render(); return;}
    if(err.code==='auth'){GH.invalid=true; GH.push=false; S.ro=true; return refresh();}
    if(!local){S.noDb=true; S.privateData=err.code==='private'; render();}
  }
}
async function connectGh(t){
  const h={Accept:'application/vnd.github+json',Authorization:`Bearer ${t}`};
  const [u,r]=await Promise.all([fetch('https://api.github.com/user',{headers:h,cache:'no-store'}),fetch(GH_API,{headers:h,cache:'no-store'})]);
  if(u.status===401||r.status===401) throw {code:'auth'};
  if(!u.ok) throw httpError(u); if(!r.ok) throw httpError(r);
  const user=await u.json(), repo=await r.json();
  Object.assign(GH,{token:t,login:user.login,push:!!(repo.permissions&&repo.permissions.push),invalid:false,modo:'clave',email:'',pushEnsayos:false,noAccess:false,expired:false});
  S.ro=PREVIEW?!remote.data:!GH.push;
}
/* Email session: the function answers GET /user with the person's name and GET /repos with push = edit role in this app,
   or 403 when the person has no role in it (then no data is read). Muestras also asks the ensayos role (Import ARAS). */
async function connectMail(email){
  const h={Accept:'application/vnd.github+json',...await LA.cabeceras()}, get=url=>fetch(url,{headers:h,cache:'no-store'}).catch(()=>{throw {code:'unavailable'};});
  const [u,r,e]=await Promise.all([get(`${LA.api(APP_ID)}/user`),get(mailRepo(APP_ID)),APP==='samples'?get(mailRepo('ensayos')):null]);
  if(u.status===401||r.status===401) throw {code:'auth'};
  if(!u.ok&&u.status!==403) throw httpError(u); if(!r.ok&&r.status!==403) throw httpError(r);
  const user=u.ok?await u.json():{}, repo=r.ok?await r.json():{}, ens=e&&e.ok?await e.json():null;
  Object.assign(GH,{modo:'correo',email,login:user.login||email,push:!!(repo.permissions&&repo.permissions.push),invalid:false,
    noAccess:!r.ok,expired:false,pushEnsayos:APP==='samples'?!!(ens&&ens.permissions&&ens.permissions.push):!!(repo.permissions&&repo.permissions.push)});
  S.ro=PREVIEW?!remote.data:!GH.push;
}
/* The function answered 401 (session expired, or the person was removed): what is on screen stays, read-only,
   and the header button offers to sign in again. */
function mailExpired(){dlg.dataset.verified=''; GH.expired=true; GH.push=false; S.ro=true; renderGh();}
async function mailSignOut(){
  mailBusy=true; try{await LA.salir();}catch(e){} mailBusy=false;
  Object.assign(GH,{modo:null,email:'',login:null,push:false,pushEnsayos:false,noAccess:false,expired:false}); S.ro=true; remote.etag=null;
  if(GH.token){GH.modo='clave'; try{await connectGh(GH.token);}catch(err){ if(err.code==='auth') GH.invalid=true; } await refresh();}
  else forgetPrivate(); /* No key left: the private data leaves memory and screen, so the next person on this browser does not see it. */
  render(); toast(ta('au_out'));
}
function forgetPrivate(){
  clearTimeout(flushTimer); pendingOps.splice(0).forEach(b=>b.rej({code:'auth'}));
  remote.data=null; remote.sha=null; remote.etag=null; local=null; CAL.eq=null; CAL.err=null;
  Object.assign(S,{tests:[],people:[],equipment:[],qtps:[],samples:[],cfg:{},loaded:new Set(),noDb:true,privateData:true});
}
/* Someone else signed in on another tab (or the same person again after the session expired here): the tab follows the
   session, so name, role and data match it. What the previous person had on screen leaves memory first. */
async function mailSwitch(email){
  if(email!==GH.email) forgetPrivate();
  Object.assign(GH,{modo:'correo',email,login:null,push:false,pushEnsayos:false,noAccess:false,expired:false}); S.ro=true; render();
  try{await connectMail(email);}catch(err){ if(err.code==='auth') mailExpired(); }
  remote.etag=null; await refresh(); render(); loadCal();
}
function disconnectGh(){Object.assign(GH,{token:'',login:null,push:false,invalid:false,modo:null}); S.ro=true; try{localStorage.removeItem(TOKEN_KEY);}catch(e){} remote.etag=null; render(); toast(tx('gh_off'));}
function renderGh(){
  const b=$('#btn-gh'); if(!b) return;
  if(LA&&GH.modo!=='clave'){
    b.className='gh '+(GH.expired?'bad':GH.saving?'busy':GH.login&&GH.push?'on':'');
    b.querySelector('span').textContent=GH.expired?ta('au_again'):GH.saving?ta('au_saving'):GH.login||(byMail()&&GH.email)||ta('au_btn');
    b.title=GH.expired?ta('au_expired'):GH.login?`${GH.email} · ${ta(GH.noAccess?'au_none':GH.push?'au_edit':'au_view')}`:ta('au_btn_t');
    return;
  }
  b.className='gh '+(GH.invalid?'bad':GH.saving?'busy':GH.login&&GH.push?'on':'');
  b.querySelector('span').textContent=GH.invalid?tx('gh_expired'):GH.saving?tx('au_saving'):GH.login?GH.login:tx('gh_connect');
  b.title=GH.login?tx(GH.push?'gh_t_push':'gh_t_nopush'):tx('gh_t');
  if(PREVIEW&&DEMO){b.className='gh on'; b.querySelector('span').textContent=tx('pv_btn'); b.title=tx('pv_btn_t');}
  else if(PREVIEW&&GH.login){b.className='gh busy'; b.title=tx('pv_t');}
}
function openGh(){
  dlg.dataset.kind='gh'; dlg.dataset.id='';
  if(LA) return openMail();
  const body=`${GH.login?`<p class="note">${tx('gh_as',esc(GH.login),GH.push)}</p>`:''}
  <ol class="steps-plain">${tx('gh_steps')}</ol>
  ${keyFields()}`;
  dlg.innerHTML=`<form class="dlg-form" id="dlg-form" novalidate><header class="dlg-h"><div><p class="eyebrow">${tx('gh_eyebrow')}</p><h2>${tx('gh_connect')}</h2></div><button type="button" class="icon-btn" data-act="close" aria-label="${esc(tx('close'))}">×</button></header>
  <div class="dlg-body">${body}<div id="f-err" class="form-err" hidden></div></div>
  <footer class="dlg-f">${GH.token?`<button type="button" class="btn ghost danger" data-act="gh-off">${tx('gh_disc')}</button>`:''}<span class="sp"></span><button type="button" class="btn ghost" data-act="close">${tx('cancel')}</button><button class="btn primary" type="submit">${tx('gh_connectBtn')}</button></footer></form>`;
  if(!dlg.open) dlg.showModal(); $('#gh-token').focus();
}
const keyFields=()=>`<div class="field"><label for="gh-token">${tx('gh_keyL')}</label><input id="gh-token" type="password" placeholder="ghp_…" autocomplete="off" spellcheck="false"></div>
  <p class="note">${tx('gh_keyNote',`${REPO.owner}/${REPO.repo}`)}</p>`;
/* With email sign-in configured: "Sign in with your email" first (email + password, one step), "Use a GitHub key" below. */
function openMail(){
  const signed=byMail()&&GH.login&&!GH.expired, keyOn=GH.modo==='clave'&&GH.login;
  const mail=signed
    ?`<p class="note">${ta('au_as',esc(GH.login),esc(GH.email))} ${ta(GH.noAccess?'au_none':GH.push?'au_edit':'au_view')}</p>`
    :`<section class="gh-mail"><h3>${ta('au_title')}</h3>${GH.expired?`<p class="note">${ta('au_expired')}</p>`:''}
    <div class="field"><label for="gh-mail">${ta('au_mail')}</label><input id="gh-mail" type="email" autocomplete="username" spellcheck="false" value="${esc(dlg.dataset.email||GH.email||'')}"></div>
    <div class="field"><label for="gh-pass">${ta('au_pass')}</label><input id="gh-pass" type="password" autocomplete="current-password" spellcheck="false"></div>
    <p class="note">${ta('au_forgot')}</p></section>`;
  const key=signed?'':`<details class="gh-key" ${keyOn?'open':''}><summary>${ta('au_key')}</summary>
    ${keyOn?`<p class="note">${tx('gh_as',esc(GH.login),GH.push)}</p>`:''}
    <ol class="steps-plain">${tx('gh_steps')}</ol>
    ${keyFields()}<p>${keyOn?`<button type="button" class="btn ghost danger" data-act="gh-off">${tx('gh_disc')}</button> `:''}<button type="button" class="btn" data-act="gh-key">${tx('gh_connectBtn')}</button></p></details>`;
  const main=signed?'':`<button class="btn primary" type="submit">${ta('au_enter')}</button>`;
  dlg.innerHTML=`<form class="dlg-form" id="dlg-form" novalidate><header class="dlg-h"><div><p class="eyebrow">${ta('au_eyebrow')}</p><h2>${ta('au_btn')}</h2></div><button type="button" class="icon-btn" data-act="close" aria-label="${esc(tx('close'))}">×</button></header>
  <div class="dlg-body">${mail}${key}<div id="f-err" class="form-err" hidden></div></div>
  <footer class="dlg-f">${signed?`<button type="button" class="btn ghost danger" data-act="gh-out">${ta('au_signout')}</button>`:''}<span class="sp"></span><button type="button" class="btn ghost" data-act="close">${ta(signed?'au_close':'au_cancel')}</button>${main}</footer></form>`;
  if(!dlg.open) dlg.showModal(); const m=$('#gh-mail'); if(m) (m.value?$('#gh-pass'):m).focus();
}
/* The password is read and the field emptied at once, so it is not left in the page. dlg.dataset.verified = the email
   whose sign-in already worked: if only the connection to the lab service failed, "Sign in" with the password field empty
   retries the connection without asking for the password again. */
async function saveMail(){
  const btn=dlg.querySelector('button[type="submit"]'), pw=$('#gh-pass'); if(!btn||!pw) return;
  const password=pw.value||''; pw.value='';
  const label=btn.textContent, busy=on=>{btn.disabled=on; btn.textContent=on?ta('au_wait'):label;};
  const email=($('#gh-mail').value||'').trim().toLowerCase();
  if(!/^[^@\s]+@[^@\s]+$/.test(email)) return formErr(ta('au_e_mail'));
  busy(true); // before any await, so a second Enter does not start another sign-in
  const s=!password&&dlg.dataset.verified===email?await LA.sesion():null, again=!!s&&s.email===email;
  if(!password&&!again){ busy(false); return formErr(ta('au_e_pass')); }
  dlg.dataset.email=email; let phase='login';
  try{
    mailBusy=true;
    if(!again){ dlg.dataset.verified=''; await LA.entrar(email,password); dlg.dataset.verified=email; }
    /* From here the session exists: stay in email mode, so the polling retries if the function fails now. */
    phase='connect'; Object.assign(GH,{modo:'correo',email,login:null,push:false,pushEnsayos:false,noAccess:false,expired:false}); S.ro=true;
    await connectMail(email);
    if(PREVIEW&&DEMO){DEMO=false; try{localStorage.setItem(DEMO_KEY,'0');}catch(e){} remote.data=null;}
    remote.etag=null; await refresh(); dlg.dataset.verified=''; dlg.close(); render(); loadCal();
    toast(GH.noAccess?ta('au_none'):`${ta('au_in',GH.login)} ${ta(GH.push?'au_edit':'au_view')}`);
  }catch(err){ busy(false); const c=err&&err.code;
    if(phase==='login') formErr(ta(c==='bad_credentials'?'au_e_cred':c==='rate'?'au_e_rate':'au_e_net'));
    else if(c==='auth'){ mailExpired(); render(); dlg.dataset.verified=''; openMail(); formErr(ta('au_e_sess')); }
    else { render(); formErr(ta(c==='forbidden'?'au_none':c==='rate'?'au_e_busy':'au_e_down')); }
  }
  finally{mailBusy=false;}
}
function saveGh(){ return LA&&document.activeElement!==$('#gh-token')?saveMail():saveKey(); }
async function saveKey(){
  const t=($('#gh-token').value||'').trim(); if(!t) return formErr(tx('gh_e_paste'));
  const btn=LA?dlg.querySelector('[data-act="gh-key"]'):dlg.querySelector('button[type="submit"]'); btn.disabled=true; btn.textContent=tx('au_wait');
  try{
    await connectGh(t); try{localStorage.setItem(TOKEN_KEY,t);}catch(e){}
    if(LA){ dlg.dataset.verified=''; if(await LA.sesion()){mailBusy=true; try{await LA.salir();}catch(e){} mailBusy=false;} }
    if(PREVIEW&&DEMO){DEMO=false; try{localStorage.setItem(DEMO_KEY,'0');}catch(e){} remote.data=null;}
    remote.etag=null; await refresh(); dlg.close(); render(); loadCal();
    toast(tx('gh_ok',GH.login,GH.push));
  }catch(err){ btn.disabled=false; btn.textContent=tx('gh_connectBtn'); formErr(tx(err.code==='auth'?'gh_e_auth':err.code==='forbidden'?'gh_e_repo':'gh_e_net')); }
}
window.addEventListener('beforeunload',e=>{ if(pendingOps.length||flushing){e.preventDefault(); e.returnValue='';} });

/* ---------- Language (ES / EN switch of acceso/lab-lang.js) ----------
   Redraws the page and an open dialog in the new language, keeping what was typed in it. */
const fkey=el=>el.type==='checkbox'||el.type==='radio'?(el.name||el.id?`${el.name||el.id}=${el.value}`:''):el.id;
function relang(){
  LL.apply(I18N); document.title=`${tx('doc_'+APP)} · Laboratorio Polinyà`;
  render();
  if(!dlg.open) return;
  const k=dlg.dataset.kind, id=dlg.dataset.id||null, V=S.smp, keep={rc:V.rc,edit:V.edit,lb:V.lb}, snap=new Map();
  dlg.querySelectorAll('input,select,textarea').forEach(el=>{const key=fkey(el); if(key) snap.set(key,{v:el.value,c:el.checked});});
  const put=()=>dlg.querySelectorAll('input,select,textarea').forEach(el=>{const s=snap.get(fkey(el)); if(!s) return;
    if(el.type==='checkbox'||el.type==='radio') el.checked=s.c; else if(el.type!=='file') el.value=s.v;});
  if(k==='test') openEditor(id); else if(k==='person') openPerson(id); else if(k==='equipment') openEquipment(id); else if(k==='qtp') openQtp(id);
  else if(k==='gh') openGh();
  else if(k==='smp-rc'){smpOpenReceive(''); V.rc=keep.rc; put(); smpRcPlr(); smpRcUnits();}
  else if(k==='smp-lot'){smpOpenLot(id); V.edit=keep.edit; smpLotUnits(); smpLotTestsBox();}
  else if(k==='smp-as'){const as=V.as; smpOpenAssign(id); V.as=as; const q=$('#smp-as-q'); if(q) q.value=as.q; smpAssignList();}
  else if(k==='smp-lb'){smpOpenLabels(keep.lb.keys); V.lb=keep.lb; smpLbSide(); smpLbPreview();}
  else if(k==='smp-gen') smpGenRender();
  put();
  if(k==='qtp'){const en=$('#f-profile').value==='endurance'; $('#endu-fields').hidden=!en; $('#even-fields').hidden=en;}
  if(k==='test') liveHints();
}
LL.onChange(relang);

/* ---------- Boot ---------- */
S.ro=true;
dl={};
relang();
(async()=>{
  let pending=false; const later=()=>{ if(pending) return; pending=true; requestAnimationFrame(()=>{pending=false; render(); if(dlg.open) liveHints();}); };
  const sub=(col,key)=>db.collection(col).onSnapshot(snap=>{S[key]=snap.docs.map(x=>({id:x.id,...x.data()})); S.loaded.add(key); later();});
  sub(COL.tests,'tests'); sub(COL.people,'people'); sub(COL.equipment,'equipment'); sub(COL.qtps,'qtps'); sub(COL.samples,'samples');
  db.collection('config').onSnapshot(snap=>{S.cfg={}; snap.docs.forEach(x=>S.cfg[x.id]=x.data()); S.loaded.add('cfg'); later();});
  if(LA&&!(PREVIEW&&DEMO)){ await LA.listo; const s=await LA.sesion();
    if(s){ GH.modo='correo'; GH.email=s.email; try{await connectMail(s.email);}catch(err){ if(err.code==='auth') mailExpired(); } }
    /* Signed out in another tab, or the session could not be renewed: same as a 401. Signed in as someone else in another
       tab: reconnect with that session. */
    LA.onCambio(x=>{ if(mailBusy||!byMail()) return;
      if(!x){ if(!GH.expired){mailExpired(); render();} }
      else if(x.email!==GH.email||GH.expired) mailSwitch(x.email); }); }
  if(GH.modo==='clave'&&GH.token&&!(PREVIEW&&DEMO)){ try{await connectGh(GH.token);}catch(err){ if(err.code==='auth') GH.invalid=true; } }
  await refresh(); render(); smpFromHash(); loadCal();
  /* Polling: 30 s with a GitHub key, 60 s with an email session (free plan limits), only while the tab is visible. */
  const every=LA?()=>byMail()?60000:GH.token?30000:60000:(ms=>()=>ms)(GH.token?30000:60000);
  let tick=0; const poll=()=>setTimeout(()=>{ if(!document.hidden){ refresh(); if(++tick%10===0&&viaApi()) loadCal(); } poll(); }, every()); poll();
})();
