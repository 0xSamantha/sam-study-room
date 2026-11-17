export function youtubeId(input){
 let u;try{u=new URL(String(input).trim());}catch{throw Error('Enter a full YouTube video link.');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)throw Error('Enter a YouTube video link.');
 const host=u.hostname.toLowerCase();let id;
 if(['youtu.be','www.youtu.be'].includes(host))id=u.pathname.split('/')[1];
 else if(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','www.youtube-nocookie.com','youtube-nocookie.com'].includes(host)){
  const parts=u.pathname.split('/');id=u.pathname==='/watch'?u.searchParams.get('v'):['shorts','embed','live'].includes(parts[1])?parts[2]:null;
 }
 if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))throw Error('Use a link to one YouTube video, not a channel or playlist.');
 return id;
}
