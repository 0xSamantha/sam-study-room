import {createClient} from '@supabase/supabase-js';
const $=id=>document.getElementById(id);
let invite=new URL(location.href).searchParams.get('invite'), socket, state, owner=false, offset=0, stopped=false;
let supabase,accessToken,selectedSeat=null,currentUserId=null;
let sessions=[];
let activeVideoId=null,previewTimer=null;
const guestColors=['#59b8ff','#66db9b','#ffc65b','#b995ff','#56dce2','#ff965b'];
const notify=t=>$('notice').textContent=t;
const escapeNode=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(accessToken?{'X-Study-Token':accessToken}:{})},body:body?JSON.stringify(body):undefined});const d=await r.json();if(r.status===423||d.paused){pause();return d;}if(!r.ok)throw Error(d.error||'Request failed');return d;}
if(invite)$('inviteHint').textContent='Your invitation is ready. Pull up a chair.';
function pause(){clearVideo();stopped=true;supabase?.auth.stopAutoRefresh();supabase?.realtime.disconnect();socket?.close();socket=null;state=null;$('entry').hidden=true;$('sync').textContent='Room paused';notify('Study room paused. The owner must review usage before reopening. No live connection is active.');disable();}
function disable(){for(const id of ['start','reset','focusMode','breakMode'])$(id).disabled=!owner||!socket||socket.readyState!==1;$('chatInput').disabled=!socket||socket.readyState!==1;$('videoAdd').disabled=!socket||socket.readyState!==1;$('queueNext').disabled=!owner||!socket||socket.readyState!==1;}
disable();
$('joinForm').onsubmit=async e=>{e.preventDefault();try{
 if(!invite)throw Error('Open an invitation link first.');
 const config=await api(`/api/status?invite=${encodeURIComponent(invite)}`);
 if(config.paused)return pause();if(!config.configured)throw Error('Supabase is not connected yet. The owner needs to complete server setup.');
 stopped=false;
 if(!supabase){supabase=createClient(config.url,config.key);supabase.auth.onAuthStateChange((_event,s)=>{accessToken=s?.access_token;});}
 let session=(await supabase.auth.getSession()).data.session;
 if(!session){const result=await supabase.auth.signInAnonymously();if(result.error)throw result.error;session=result.data.session;}
 accessToken=session.access_token;currentUserId=session.user.id;supabase.auth.startAutoRefresh();
 const joined=await api(`/api/join?invite=${encodeURIComponent(invite)}`,{name:$('displayName').value.trim(),seat:selectedSeat,color:$('ledColor').value});if(joined.paused)return pause();
 state=joined;offset=joined.serverTime-Date.now();render();
 socket=await connection();$('entry').hidden=true;$('sync').textContent='● Together in real time';notify('');disable();
 }catch(e){if(!socket||socket.readyState!==1)supabase?.auth.stopAutoRefresh();if(e.message.includes('usage')||e.message.includes('threshold'))pause();else notify(e.message);}};
async function connection(){
 const transport={readyState:1,channel:null,heartbeat:null,send:async raw=>{try{const m=JSON.parse(raw);if(m.type==='pause')m.type='pauseTimer';const result=await api(`/api/action?invite=${encodeURIComponent(invite)}`,m);if(result.paused)return pause();if(state&&result.serverTime<state.serverTime)return;state=result;offset=result.serverTime-Date.now();render();return result;}catch(e){notify(e.message);$('videoFeedback').textContent=e.message;return null;}},close(){this.readyState=3;clearInterval(this.heartbeat);if(this.channel)supabase.removeChannel(this.channel);supabase.realtime.disconnect();supabase.auth.stopAutoRefresh();}};
 transport.channel=supabase.channel('reading-room').on('postgres_changes',{event:'UPDATE',schema:'public',table:'study_room',filter:'id=eq.1'},e=>{const d=e.new.payload;if(d.paused)return pause();if(state&&d.serverTime<state.serverTime)return;state=d;offset=d.serverTime-Date.now();render();}).subscribe(status=>{if(status==='SUBSCRIBED')transport.send(JSON.stringify({type:'heartbeat'}));if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){transport.close();disable();$('entry').hidden=false;$('sync').textContent='○ Connection closed';notify('Live connection ended. Rejoin to synchronize.');}});
 transport.heartbeat=setInterval(()=>{transport.send(JSON.stringify({type:'heartbeat'}));},120000);
 return transport;
}
function send(m){if(socket?.readyState===1)return socket.send(JSON.stringify(m));return Promise.resolve(null);}
function tick(){const t=state?.timer||previewTimer||{mode:'focus',remaining:1500000};const remaining=Math.max(0,t.end?t.end-(Date.now()+offset):t.remaining);const seconds=Math.ceil(remaining/1000);$('clock').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;$('clock').setAttribute('aria-label',`${Math.floor(seconds/60)} minutes ${seconds%60} seconds`);$('start').textContent=t.end&&remaining>0?'Ⅱ  Pause':remaining===0?'Session complete':t.mode==='focus'?'▶  Begin focus':'▶  Begin break';if(remaining===0)$('timerCaption').textContent='A page of progress. Take a breath.';}
setInterval(tick,250);
function render(){const t=state.timer;renderTimerDurations(t);renderQueue();$('focusMode').classList.toggle('selected',t.mode==='focus');$('breakMode').classList.toggle('selected',t.mode==='break');$('timerCaption').textContent=t.mode==='focus'?'A small commitment. A little more clarity.':'Rest your eyes. Stretch your legs. Come back refreshed.';renderTable();if(state.sessions)renderSchedule(state.sessions);$('messages').replaceChildren();for(const m of state.messages){const p=escapeNode('p','');p.append(escapeNode('strong',m.name),document.createTextNode(m.text));$('messages').append(p);}tick();}
$('start').onclick=()=>send({type:state?.timer.end?'pause':'start'});$('reset').onclick=()=>send({type:'reset'});$('focusMode').onclick=()=>send({type:'mode',mode:'focus'});$('breakMode').onclick=()=>send({type:'mode',mode:'break'});
$('chatToggle').onclick=()=>{const open=$('chatArea').hidden;$('chatArea').hidden=!open;$('chatToggle').textContent=open?'Close −':'Open +';$('chatToggle').setAttribute('aria-expanded',open);};$('chatForm').onsubmit=e=>{e.preventDefault();send({type:'chat',text:$('chatInput').value});$('chatInput').value='';};
$('ownerOpen').onclick=async()=>{$('ownerDialog').showModal();try{await loadOwner();}catch{}};
$('loginForm').onsubmit=async e=>{e.preventDefault();try{const r=await fetch('/api/auth',{method:'POST',headers:{Authorization:`Bearer ${$('ownerKey').value}`,'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('Owner key was not accepted.');$('ownerKey').value='';await loadOwner();}catch(e){$('ownerError').textContent=e.message;}};
async function loadOwner(){const d=await api('/api/owner');owner=true;configureOwnerSeat();if(d.timer){previewTimer=d.timer;renderTimerDurations(d.timer,true);tick();}disable();$('ownerLogin').hidden=true;$('dashboard').hidden=false;$('environment').textContent=d.demo?'LOCAL TEST · App budgets are enforced. Supabase is live; email and complete provider checks may be unconfigured.':'Provider guard enabled · partial, delayed meters plus app budgets. Unknown limits are listed below.';$('ownerHint').textContent='Join the room to start a session.';$('quotaList').replaceChildren();for(const q of d.meters){const n=escapeNode('div','');n.className='meter';const row=escapeNode('div','');row.className='section-title';row.append(escapeNode('strong',q.name),escapeNode('span',`${q.percent.toFixed(1)}% · ${q.used.toLocaleString()} / ${q.limit.toLocaleString()}`));const bar=document.createElement('progress');bar.max=100;bar.value=q.percent;n.append(row,bar,escapeNode('small',q.note||q.source),escapeNode('small',`Resets ${q.resets||'does not reset'} · Checked ${q.checked||d.budget.provider?.checked&&new Date(d.budget.provider.checked).toISOString()||'not yet'}`));$('quotaList').append(n);}$('unknown').replaceChildren(...d.unknown.map(x=>escapeNode('li',x)));$('emailStatus').textContent=d.emailReady?'Warning email credentials configured. Check delivery status below.':'Email is not configured. Production resume is blocked until delivery credentials are set.';$('warn').value=d.budget.warn;$('stop').value=d.budget.stop;$('buffer').value=d.budget.buffer;$('pauseReason').textContent=(d.budget.paused||d.databasePaused)?`Paused: ${d.budget.reason||'The database is paused. Select Review & resume to reopen it.'}`:'Room open · reservations are checked before joins and writes.';$('inviteUrl').value=`${location.origin}/room/entry?invite=${d.invite}`;invite=d.invite;$('inviteCopy').hidden=false;$('outbox').replaceChildren(...d.budget.outbox.map(x=>escapeNode('p',`${x.text} — ${x.status}`)));$('ownerError').textContent='';$('scheduleManage').hidden=false;await loadSchedule();}
async function action(name,body={}){try{await api(`/api/owner/${name}`,body);await loadOwner();if(name==='pause')pause();if(name==='resume'){stopped=false;$('entry').hidden=false;$('sync').textContent='○ Ready to join';notify('Room reopened. Enter your name and take a seat.');}}catch(e){$('ownerError').textContent=e.message;}}
$('thresholdForm').onsubmit=e=>{e.preventDefault();action('settings',{warn:+$('warn').value,stop:+$('stop').value,buffer:+$('buffer').value});};$('pauseRoom').onclick=()=>action('pause');$('resumeRoom').onclick=()=>action('resume');$('refreshUsage').onclick=()=>action('refresh');$('rotateInvite').onclick=()=>action('rotate');$('inviteCopy').onclick=async()=>{try{await navigator.clipboard.writeText($('inviteUrl').value);notify('Invitation copied. Share it with your study companions.');}catch{notify('Copy the invitation from room settings.');}};

function configureOwnerSeat(){
 $('ledColor').querySelector('option[value="#ff5ca8"]').hidden=false;
 $('ledColor').value='#ff5ca8';$('ledColor').disabled=true;
 $('colorHint').textContent='Your owner LED is always pink.';
 renderTable();
}
function renderTable(){
 const members=state?.members||[];
 $('memberCount').textContent=members.length;$('members').replaceChildren();$('seatRoster').replaceChildren();
 for(let seat=0;seat<12;seat++){
  const member=members.find(m=>m.seat===seat);
  const button=document.createElement('button');button.type='button';button.className='table-seat';
  const angle=seat*Math.PI/6;
  button.style.left=`${50+41*Math.sin(angle)}%`;button.style.top=`${50-41*Math.cos(angle)}%`;
  const mine=member?.id===currentUserId;
  const active=mine||(!socket&&selectedSeat===seat);
  button.classList.toggle('occupied',!!member);button.classList.toggle('chosen',active);
  button.disabled=!!member&&!mine;
  button.setAttribute('aria-pressed',String(active));
  button.setAttribute('aria-label',member?`Seat ${seat+1}: ${member.name}${member.owner?', owner, pink LED':''}${mine?', you':''}`:`Sit at seat ${seat+1}`);
  const dot=escapeNode('span',member?'':'+');dot.className='led-dot';
  const color=member?.owner?'#ff5ca8':member?.color||'#a5afa0';button.style.setProperty('--led',color);
  const name=escapeNode('span',member?member.name:`Seat ${seat+1}`);name.className='seat-name';
  button.append(dot,name);if(member?.owner)button.append(escapeNode('small','Owner'));
  button.onclick=()=>{selectedSeat=seat;$('seatChoice').textContent=`Seat ${seat+1} selected`;if(socket?.readyState===1)send({type:'seat',seat});else renderTable();};
  $('members').append(button);
  if(member){const item=escapeNode('li',`${member.name}${member.owner?' · Owner':''}${mine?' · You':''}`);const light=escapeNode('span','');light.className='roster-dot';light.style.backgroundColor=color;item.prepend(light);$('seatRoster').append(item);}
 }
 const me=members.find(m=>m.id===currentUserId);
 if(me){selectedSeat=me.seat;$('seatChoice').textContent=`You’re at seat ${me.seat+1}`;}
}
$('ledColor').onchange=()=>{if(socket?.readyState===1)send({type:'color',color:$('ledColor').value});};
const localZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
$('sessionZone').value=localZone;
const formatTime=d=>new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(d));
function renderSchedule(items){
 sessions=items.filter(s=>Date.parse(s.endsAt)>Date.now()).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt));
 $('scheduleTimezone').textContent=`Times shown in ${localZone.replaceAll('_',' ')}.`;
 for(const target of ['scheduleList','scheduleOwnerList']){
  $(target).replaceChildren();
  if(!sessions.length)$(target).append(escapeNode('p','No study groups planned yet.'));
  for(const session of sessions){
   const card=escapeNode('article','');card.className='scheduled-session';
   card.append(escapeNode('h3',session.title),escapeNode('p',formatTime(session.startsAt)),escapeNode('small',`Until ${formatTime(session.endsAt)}`));
   if(session.notes)card.append(escapeNode('p',session.notes));
   if(target==='scheduleOwnerList'&&owner){const remove=escapeNode('button','Remove session');remove.type='button';remove.onclick=async()=>{try{const result=await api('/api/owner/schedule',{type:'scheduleRemove',id:session.id});if(result.paused)return;await loadSchedule();$('scheduleFeedback').textContent='Session removed.';}catch(e){$('scheduleFeedback').textContent=e.message;}};card.append(remove);}
   $(target).append(card);
  }
 }
}
async function loadSchedule(){
 if(!invite)return;
 try{const d=await api(`/api/schedule?invite=${encodeURIComponent(invite)}`);if(!d.paused)renderSchedule(d.sessions||[]);}catch(e){$('scheduleList').textContent=e.message;}
}
$('scheduleManage').onclick=()=>{$('ownerDialog').showModal();$('sessionTitle').focus();};
$('scheduleForm').onsubmit=async e=>{e.preventDefault();
 try{
  const start=new Date($('sessionStart').value),end=new Date($('sessionEnd').value);
  if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw Error('Choose an end time after the start.');
  const result=await api('/api/owner/schedule',{type:'scheduleAdd',title:$('sessionTitle').value.trim(),startsAt:start.toISOString(),endsAt:end.toISOString(),timezone:localZone,notes:$('sessionNotes').value.trim()});
  if(result.paused){$('scheduleFeedback').textContent='Resume the room before publishing a study group.';return;}
  $('scheduleForm').reset();$('sessionZone').value=localZone;$('scheduleFeedback').textContent='Study group published.';await loadSchedule();
 }catch(e){$('scheduleFeedback').textContent=e.message;}
};
renderTable();
if(invite)loadSchedule();

// Restore the HttpOnly owner session on every page, including invitation tabs.
loadOwner().catch(()=>{}).finally(()=>{
 if(new URL(location.href).searchParams.get('settings')==='1')$('ownerDialog').showModal();
});


function renderTimerDurations(timer,fillInputs=false){
 const focus=(timer.focusMs??1500000)/60000,rest=(timer.breakMs??300000)/60000;
 $('focusDuration').textContent=`${focus} min`;$('breakDuration').textContent=`${rest} min`;
 if(fillInputs){$('focusMinutes').value=focus;$('breakMinutes').value=rest;}
}
$('timerSettingsForm').onsubmit=async e=>{e.preventDefault();
 try{
  const result=await api('/api/owner/timers',{focusMinutes:Number($('focusMinutes').value),breakMinutes:Number($('breakMinutes').value)});
  if(result.paused){$('timerSettingsFeedback').textContent='Resume the room before editing durations.';return;}
  state=result;offset=result.serverTime-Date.now();render();renderTimerDurations(result.timer,true);
  $('timerSettingsFeedback').textContent='Durations saved. The current clock is reset and paused.';
 }catch(e){$('timerSettingsFeedback').textContent=e.message;}
};
function clearVideo(){
 activeVideoId=null;
 $('videoPlayer').replaceChildren(escapeNode('p','Choose Watch on a queued video to load the player.'));
}
function watchVideo(video){
 if(activeVideoId===video.videoId)return;
 activeVideoId=video.videoId;
 const frame=document.createElement('iframe');
 frame.src=`https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=0&playsinline=1`;
 frame.title=video.title;frame.allow='encrypted-media; fullscreen; picture-in-picture';frame.allowFullscreen=true;
 frame.referrerPolicy='strict-origin-when-cross-origin';
 $('videoPlayer').replaceChildren(frame);
}
function renderQueue(){
 const queue=state?.queue||[];
 if(activeVideoId&&!queue.some(v=>v.videoId===activeVideoId))clearVideo();
 $('queueCount').textContent=`${queue.length} / 20`;$('queueNext').hidden=!owner||queue.length===0;
 $('videoQueue').replaceChildren();
 if(!queue.length)$('videoQueue').append(escapeNode('li','The queue is empty. Add the first video.'));
 for(const video of queue){
  const li=document.createElement('li');
  li.append(escapeNode('strong',video.title),escapeNode('small',`Added by ${video.addedBy}`));
  const controls=document.createElement('div');controls.className='queue-actions';
  const watch=escapeNode('button','Watch');watch.type='button';watch.onclick=()=>watchVideo(video);
  const link=escapeNode('a','Open on YouTube ↗');link.href=`https://www.youtube.com/watch?v=${video.videoId}`;link.target='_blank';link.rel='noopener noreferrer';
  controls.append(watch,link);
  if(owner||video.userId===currentUserId){const remove=escapeNode('button','Remove');remove.type='button';remove.disabled=!socket||socket.readyState!==1;remove.onclick=()=>send({type:'queueRemove',id:video.id});controls.append(remove);}
  li.append(controls);$('videoQueue').append(li);
 }
 disable();
}
$('videoForm').onsubmit=async e=>{e.preventDefault();
 $('videoFeedback').textContent='';
 const result=await send({type:'queueAdd',url:$('videoUrl').value.trim(),title:$('videoTitle').value.trim()});
 if(result&&!result.paused){$('videoForm').reset();$('videoFeedback').textContent='Video added to the shared queue.';}
};
$('queueNext').onclick=()=>send({type:'queueNext'});
