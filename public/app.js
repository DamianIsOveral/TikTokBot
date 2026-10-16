'use strict';
const $ = s => document.querySelector(s);
const defaults = {links:true,spam:true,swearing:true,words:'sukkel, idioot'};
let settings;try{settings={...defaults,...JSON.parse(localStorage.getItem('fay-settings')||'{}')}}catch{settings={...defaults}}
let messages=[], nextId=1, filter='Alle', page='Livechat', activity=[];
const escapeHTML = v => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function classify(text){if(settings.links&&/(https?:\/\/|www\.|klik op deze link)/i.test(text))return 'Links';if(settings.spam&&(/(.{4,}?)\1{2,}/i.test(text)||/volg mij.*volg mij/i.test(text)))return 'Spam';if(settings.swearing&&settings.words.split(',').map(w=>w.trim().toLowerCase()).filter(Boolean).some(w=>text.toLowerCase().includes(w)))return 'Schelden';return null}
function add(user,text,time){messages.push({id:nextId++,user,text,time:time||new Date().toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}),resolved:false});if(messages.length>500)messages.shift()}
function loadDemo(){messages=[];activity=[];[['Daan','Welke settings gebruik je?','01:37'],['bozekijker','Jij bent echt een sukkel','01:38'],['Julia','Zo gezellig hier 💕','01:38'],['chatspammer','VOLG MIJ! VOLG MIJ! VOLG MIJ!','01:39'],['Tim','Wat een skills zeg 👏','01:39'],['Sanne','Deze game is echt ziek!','01:39'],['promo_account','Gratis volgers? Klik op deze link!','01:40'],['Mike','Wanneer ga je weer live?','01:40'],['Naomi','Hahaha geweldig 😂','01:41'],['Sem','!discord','01:41'],['Kevin','Wat een lekkere stream 🔥','01:42'],['Lisa','Goedenavond allemaal! 👋','01:42']].forEach(a=>add(...a));}
loadDemo();
function pending(){return messages.filter(m=>!m.resolved&&classify(m.text))}
function render(){const query=$('#search').value.toLowerCase();let rows=messages.filter(m=>(m.user+' '+m.text).toLowerCase().includes(query));if($('#sort').value==='new')rows=rows.slice().reverse();$('#chat').innerHTML=rows.map(m=>`<div class="row ${!m.resolved&&classify(m.text)?'flagged':''}"><time>${escapeHTML(m.time)}</time><div class="avatar">${escapeHTML(m.user[0].toUpperCase())}</div><strong>${escapeHTML(m.user)}</strong><p>${escapeHTML(m.text)}</p><span class="warning">${!m.resolved&&classify(m.text)?'⚠':''}</span></div>`).join('')||'<div class="empty">Geen berichten gevonden.</div>';const items=pending();$('#total').textContent=messages.length;$('#count').textContent=items.length;$('#badge').textContent=items.length;$('#reviews').innerHTML=items.filter(m=>filter==='Alle'||classify(m.text)===filter).slice().reverse().map(m=>`<div class="card"><div class="cardtop"><div class="avatar">${escapeHTML(m.user[0].toUpperCase())}</div><div class="cardbody"><time>${escapeHTML(m.time)}</time><strong>@${escapeHTML(m.user)}</strong><p>${escapeHTML(m.text)}</p><span class="tag">${escapeHTML(classify(m.text))}</span></div></div><div class="actions"><button class="mute" data-action="mute" data-id="${m.id}">♬ Dempen · demo</button><button data-action="ignore" data-id="${m.id}">Negeren</button><select aria-label="Demptijd voor ${escapeHTML(m.user)}"><option>5 minuten</option><option>30 minuten</option><option>Hele LIVE</option></select></div></div>`).join('')||'<div class="empty">✓ Geen berichten om te beoordelen.</div>';$('#activity').textContent=activity[0]||'Nog geen acties in deze demo.';if(page==='Overzicht'||page==='Moderatie')renderOther()}
let toastTimer;function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',4500)}
$('#reviews').addEventListener('click',e=>{const button=e.target.closest('[data-action]');if(!button)return;const m=messages.find(m=>m.id===Number(button.dataset.id));if(!m||m.resolved)return;const duration=button.parentElement.querySelector('select').value;m.resolved=true;const line=button.dataset.action==='mute'?`DEMO: @${m.user} gedempt voor ${duration}. Er is niets naar TikTok verzonden.`:`@${m.user}: bericht genegeerd in de demo.`;activity.unshift(line);if(activity.length>100)activity.pop();toast(line);render()});
$('#search').addEventListener('input',render);$('#sort').addEventListener('change',render);$('#tabs').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));render()});
let sample=0;$('#add').addEventListener('click',()=>{const samples=[['NieuweKijker','Hoi allemaal! 👋'],['link_account','Check https://voorbeeld.nl'],['test_spam','VOLG MIJ! VOLG MIJ! VOLG MIJ!'],['test_kijker','Wat een sukkel']];add(...samples[sample++%samples.length]);render()});
function renderOther(){const el=$('#otherpage');if(page==='Overzicht'){el.innerHTML=`<h2>Overzicht</h2><p>Faynominaal LIVE Dashboard · demo of LIVE-chat</p><p>${messages.length} berichten · ${pending().length} te beoordelen · ${activity.length} demoacties.</p><p>Livechat en herkenning van verdachte berichten zijn lokaal uit te proberen. TikTok LIVE is beschikbaar via Verbinden. Gedeelde moderatoraccounts en echte dempacties zijn nog niet aangesloten.</p>`}else if(page==='Moderatie'){el.innerHTML='<h2>Moderatiegeschiedenis · demo</h2>'+ (activity.length?activity.map(a=>`<p>${escapeHTML(a)}</p>`).join(''):'<p>Nog geen acties. Beoordeel een bericht op de pagina Livechat.</p>')}else if(page==='Filters'){el.innerHTML=`<h2>Filters</h2><p>Deze regels markeren berichten voor beoordeling. Er wordt niemand automatisch gedempt.</p><label><input id="links" type="checkbox" ${settings.links?'checked':''}>Links markeren</label><label><input id="spam" type="checkbox" ${settings.spam?'checked':''}>Herhaalde teksten markeren</label><label><input id="swearing" type="checkbox" ${settings.swearing?'checked':''}>Woordenlijst inschakelen</label><label>Woorden gescheiden door komma’s<textarea id="words">${escapeHTML(settings.words)}</textarea></label><button id="save">Filters opslaan</button>`;$('#save').onclick=()=>{settings={links:$('#links').checked,spam:$('#spam').checked,swearing:$('#swearing').checked,words:$('#words').value};try{localStorage.setItem('fay-settings',JSON.stringify(settings));toast('Filters opgeslagen.')}catch{toast('Filters actief voor deze sessie; opslaan is niet gelukt.')}render()}}else{el.innerHTML='<h2>Instellingen</h2><p>Kanaal: @faynominaal<br>Modus: lokaal webdashboard<br>TikTok-verbinding: zie status bovenaan</p><p>Klik bovenaan op Verbinden om de chat van @faynominaal te laden zodra hij live is. Echte dempacties en synchronisatie tussen moderators vereisen daarna een afzonderlijk geteste koppeling.</p><p>TikTok-cookies en API-sleutels worden uitsluitend op de server ingesteld.</p>'}}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>{page=b.dataset.page;document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x===b));$('#chatpage').classList.toggle('hidden',page!=='Livechat');$('#otherpage').classList.toggle('hidden',page==='Livechat');if(page!=='Livechat')renderOther()}));render();

let liveMode=false;
let connectionPhase='idle';
let renderTimer;
function scheduleRender(){
 if(renderTimer)return;
 renderTimer=setTimeout(()=>{renderTimer=undefined;render()},100);
}
function updateMode(live){
 liveMode=live;
 $('#add').disabled=live;
 $('.demo span').textContent=live
  ? 'Livechat van de server. Laatste 500 berichten; dempen blijft een demoactie.'
  : 'Lokale voorbeeldberichten. Een eventuele serververbinding blijft actief.';
 $('#demo').disabled=!live;
}
function updateConnection(data){
 $('#live-status').textContent=data.text;
 connectionPhase=data.phase||connectionPhase;
 $('#connect').disabled=connectionPhase==='connecting';
 $('#connect').textContent=connectionPhase==='connected'?'Livechat tonen':'Verbinden';
 $('#stop').disabled=!['connecting','connected','error'].includes(connectionPhase);
}
$('#demo').onclick=()=>{updateMode(false);loadDemo();render()};
$('#connect').onclick=async()=>{
 $('#connect').disabled=true;
 try{await window.liveChat.connect()}
 catch{toast('Verbinden mislukt. Controleer de serververbinding.')}
 finally{$('#connect').disabled=connectionPhase==='connecting'}
};
$('#stop').onclick=async()=>{
 try{await window.liveChat.stop()}
 catch{toast('Stoppen mislukt. Controleer de serververbinding.')}
};
window.liveChat.onEvent(data=>{
 if(data.type==='transport'){
  $('#live-status').textContent=data.text;
  $('#connect').disabled=true;$('#stop').disabled=true;
 }
 if(data.type==='snapshot'){
  updateConnection(data);updateMode(data.mode==='live');
  if(liveMode){
   messages=[];activity=[];
   for(const message of data.messages){
    const time=new Date(message.time).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
    add(message.user,message.text,time);
   }
  }else{loadDemo()}
  render();
 }
 if(data.type==='status'){
  updateConnection(data);
  if(data.phase==='connecting'){messages=[];activity=[];updateMode(true);render()}
 }
 if(data.type==='chat'&&liveMode){
  const time=new Date(data.time).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
  add(data.user,data.text,time);scheduleRender();
 }
});
