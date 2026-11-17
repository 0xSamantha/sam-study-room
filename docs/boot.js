// Small pause preflight: no Supabase SDK, auth refresh, video or Realtime connection.
const config=globalThis.STUDY_CONFIG||{};
const invite=new URL(location.href).searchParams.get('invite');
const ownerSession=localStorage.getItem(`study-owner:${config.supabaseUrl||'unconfigured'}`);
if(invite&&!ownerSession&&config.supabaseUrl){
 try{
  const url=`${config.supabaseUrl}/functions/v1/study-api/api/status?invite=${encodeURIComponent(invite)}`;
  const r=await fetch(url,{headers:{apikey:config.publishableKey},signal:AbortSignal.timeout(10000)});
  if(r.status===423){location.replace(new URL('./paused.html',location.href));}
  else await import('./app.js');
 }catch{await import('./app.js');}
}else await import('./app.js');
