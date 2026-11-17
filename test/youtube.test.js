import {test} from 'node:test';
import assert from 'node:assert/strict';
import {youtubeId} from '../src/youtube.js';
test('extracts a single video from supported YouTube link formats',()=>{
 for(const link of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30','https://youtu.be/dQw4w9WgXcQ?si=example','https://m.youtube.com/shorts/dQw4w9WgXcQ','https://www.youtube.com/live/dQw4w9WgXcQ','https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'])assert.equal(youtubeId(link),'dQw4w9WgXcQ');
});
test('rejects unrelated, misleading, credential-bearing and playlist-only URLs',()=>{
 for(const link of ['javascript:alert(1)','https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ','https://evil.example/dQw4w9WgXcQ','https://youtube.com/playlist?list=123','https://youtube.com/watch?v=bad','https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com:8443/watch?v=dQw4w9WgXcQ'])assert.throws(()=>youtubeId(link));
});
