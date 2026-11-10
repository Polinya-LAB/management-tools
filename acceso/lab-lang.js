/* Language of the lab apps (ES / EN), shared by every page under polinya-lab.github.io/management-tools/.
   Load it before lab-auth.js and the app code:  <script src="../acceso/lab-lang.js?v=…"></script>

   LabLang.lang              'es' | 'en'. The viewer's choice, kept in localStorage ('lab.lang') for every app;
                             with no choice yet, the browser language (Spanish → 'es', anything else → 'en').
   LabLang.t(dict, key, …a)  dict = {es:{…}, en:{…}}. Entries are strings or functions of the arguments.
                             Falls back to the other language, then to the key.
   LabLang.apply(dict, root) fills elements marked data-i18n="key" (text), data-i18n-html="key" (HTML),
                             data-i18n-title / data-i18n-placeholder / data-i18n-aria="key" (those attributes).
   LabLang.set(l)            changes the language and calls the onChange handlers; a page with none is reloaded.
   LabLang.onChange(fn)      fn(lang) runs after each change: re-render what the page drew with t().
   The [ES | EN] switch goes into the first element marked data-lab-lang, else at the end of the page header. */
(function(){
  'use strict';
  const KEY='lab.lang';
  const read=()=>{
    try{
      const v=localStorage.getItem(KEY)||localStorage.getItem('tl.lang');   /* tl.lang: the earlier switch of Muestras */
      if(v==='es'||v==='en') return v;
    }catch(e){}
    return /^es\b/i.test(navigator.language||'')?'es':'en';
  };
  const handlers=[];
  const L={
    lang:read(),
    t(dict,key,...a){
      const v=(dict[L.lang]||{})[key]??(dict[L.lang==='es'?'en':'es']||{})[key]??key;
      return typeof v==='function'?v(...a):v;
    },
    apply(dict,root){
      const r=root||document;
      r.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=L.t(dict,el.dataset.i18n);});
      r.querySelectorAll('[data-i18n-html]').forEach(el=>{el.innerHTML=L.t(dict,el.dataset.i18nHtml);});
      [['i18nTitle','title'],['i18nPlaceholder','placeholder'],['i18nAria','aria-label']].forEach(([d,attr])=>
        r.querySelectorAll(`[data-${d.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}]`).forEach(el=>el.setAttribute(attr,L.t(dict,el.dataset[d]))));
    },
    set(l,fromOtherTab){
      if(l!=='es'&&l!=='en'||l===L.lang) return;
      L.lang=l; if(!fromOtherTab) try{localStorage.setItem(KEY,l);}catch(e){}
      document.documentElement.lang=l; paint();
      if(!handlers.length){location.reload(); return;}
      handlers.forEach(fn=>{try{fn(l);}catch(e){console.error(e);}});
    },
    onChange(fn){handlers.push(fn);},
    /* Locale for dates and numbers (toLocaleDateString etc.). */
    locale(){return L.lang==='es'?'es-ES':'en-GB';}
  };
  window.LabLang=L;
  document.documentElement.lang=L.lang;
  /* Other open tabs of the lab apps follow a change made in one of them. */
  window.addEventListener('storage',e=>{if(e.key===KEY) L.set(e.newValue,true);});

  const CSS=`.lab-lang{display:inline-flex;align-items:center;border:1px solid currentColor;border-radius:999px;overflow:hidden;font:600 11px/1 system-ui,sans-serif;letter-spacing:.04em;opacity:.85;flex:none;vertical-align:middle}
.lab-lang button{all:unset;cursor:pointer;padding:4px 8px;color:inherit}
.lab-lang button[aria-pressed="true"]{background:color-mix(in srgb,currentColor 20%,transparent);font-weight:800}
.lab-lang button:focus-visible{outline:2px solid currentColor;outline-offset:-3px}
@media print{.lab-lang{display:none!important}}`;
  let box=null;
  function paint(){
    if(!box) return;
    box.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.l===L.lang)));
    box.setAttribute('aria-label',L.lang==='es'?'Idioma':'Language');
  }
  function mount(){
    if(box&&box.isConnected) return;
    const st=document.createElement('style'); st.textContent=CSS; document.head.appendChild(st);
    box=document.createElement('div'); box.className='lab-lang'; box.setAttribute('role','group');
    box.innerHTML='<button type="button" data-l="es">ES</button><button type="button" data-l="en">EN</button>';
    box.addEventListener('click',e=>{const b=e.target.closest('button'); if(b) L.set(b.dataset.l);});
    const slot=document.querySelector('[data-lab-lang]');
    const head=slot||document.querySelector('header.top .top-in, header.top .actions, header.top, body>main>header, header');
    (head||document.body).appendChild(box); paint();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount); else mount();
})();
