export const day = now => new Date(now).toISOString().slice(0,10);
export const nextDay = now => new Date(Date.parse(day(now)) + 86400000).toISOString();
export function initial(now=Date.now()) {
 return {cycle:day(now),paused:false,reason:'',warn:90,stop:97,buffer:2,counts:{requests:0,storageWrites:0,emails:0,realtime:0,egress:0},warned:{},outbox:[],provider:null,checked:null};
}
export function rollover(b,now=Date.now()) {
 if(b.cycle!==day(now)){b.cycle=day(now);b.counts={requests:0,storageWrites:0,emails:0,realtime:0,egress:0};b.provider=null;}
}
export const specs={requests:{name:'Room requests',limit:10000,note:'App budget • below 100,000/day provider allowance'},storageWrites:{name:'Database write reservations',limit:10000,note:'App reservation • includes guard persistence; not provider billing'},realtime:{name:'Real-time message reservations',limit:20000,note:'Daily app budget • reserves twelve deliveries per action; provider: 2 million/month'},egress:{name:'Egress reservations',limit:100000000,note:'Daily app budget • conservative fanout bytes; provider: 5 GB/month'},emails:{name:'Warning emails',limit:20,note:'App budget • Resend Free: 100/day and 3,000/month'}};
export function meters(b,now=Date.now()) {
 return Object.entries(specs).map(([key,q])=>({key,...q,used:b.counts[key],percent:b.counts[key]/q.limit*100,resets:nextDay(now),checked:b.checked,source:'App counter'})).concat((b.provider?.meters||[]).map(q=>({...q,percent:q.used/q.limit*100,source:'Provider snapshot (delayed)'})));
}
export function assess(b,cost={},now=Date.now(),production=false){
 rollover(b,now);
 if(production&&(!b.provider||now-b.provider.checked>300000)){b.paused=true;b.reason='Provider usage is missing or older than five minutes. Owner review required.';}
 for(const q of meters(b,now)){
  const projected=(q.used+(cost[q.key]||0))/q.limit*100;
  if(projected>=b.warn&&!b.warned[`${q.key}:${q.resets}`]){
   b.warned[`${q.key}:${q.resets}`]=true;b.outbox.push({id:`${q.key}-${q.resets}`,key:q.key,text:`${q.name}: ${q.used} of ${q.limit} used. ${Math.max(0,q.limit-q.used)} remains; resets ${q.resets||'not applicable'}.`,status:'pending'});
  }
  if(projected+b.buffer>=b.stop){b.paused=true;b.reason=`${q.name} reached its buffered pause threshold (${b.stop-b.buffer}%).`;}
 }
 if(b.paused)return false;
 for(const [k,n]of Object.entries(cost))b.counts[k]+=n;
 b.checked=new Date(now).toISOString();return true;
}
export function configure(b,warn,stop,buffer){
 if(![warn,stop,buffer].every(Number.isFinite)||warn<1||warn>=stop-buffer||stop>97||buffer<1||buffer>20)throw Error('Use 1 ≤ warning < pause − buffer, pause ≤ 97, and buffer between 1 and 20.');
 b.warn=warn;b.stop=stop;b.buffer=buffer;
}
export function resume(b,now=Date.now(),production=false){
 const copy=structuredClone(b);copy.paused=false;copy.reason='';
 if(!assess(copy,{},now,production))throw Error(copy.reason);
 b.paused=false;b.reason='';
}
