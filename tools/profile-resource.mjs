// TV_HOST=tv-address:9998 node tools/profile-resource.mjs status|window|settings output.json
// Settings latency is keydown-to-next-rAF, including synchronous handlers, not display scanout.
import { writeFileSync } from 'node:fs';

const [mode = 'status', output] = process.argv.slice(2);
if (!process.env.TV_HOST || !['status', 'window', 'settings'].includes(mode)) {
  throw new Error('Set TV_HOST=host:port; choose status, window, or settings [output.json]');
}
const targets = await fetch(`http://${process.env.TV_HOST}/json/list`, {
  signal: AbortSignal.timeout(10000)
}).then((response) => response.json());
if (!Array.isArray(targets)) throw new Error('Invalid target list');
const target = targets.find(
  (page) => typeof page?.url === 'string' && page.url.includes('youtube.com/tv')
);
if (typeof target?.webSocketDebuggerUrl !== 'string') {
  throw new Error('YouTube TV target unavailable');
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 0;
const runTimeout = setTimeout(() => {
  for (const request of pending.values()) request.reject(new Error('Profiling timed out'));
  ws.close();
}, 180000);
/**
 * @param {string} method
 * @param {Record<string, unknown>} [params]
 * @returns {Promise<Record<string, any>>}
 */
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) return reject(new Error('Inspector disconnected'));
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
/** @param {{data: unknown}} event */
ws.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
};
/** @param {string} expression */
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
};
/** @param {number} ms */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const status = () =>
  evaluate(`({url:location.href,visible:!document.hidden,
  ua:navigator.userAgent,config:localStorage.getItem('ytaf-configuration'),
  stream:(()=>{try{const p=document.getElementById('ytlr-player__player-container-player');
    const s=p?.getStatsForNerds?.();return {videoId:p?.getVideoData?.()?.video_id,
    codecs:s?.codecs,resolution:s?.resolution};}catch{return null}})(),
  video:[...document.querySelectorAll('video')].map(v=>({time:v.currentTime,paused:v.paused,
  width:v.videoWidth,height:v.videoHeight,decoded:v.webkitDecodedFrameCount,
  dropped:v.webkitDroppedFrameCount}))})`);

try {
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const before = await status();
  if (!before.visible) throw new Error('YouTube is hidden; foreground it before profiling');
  /** @type {Record<string, any>} */
  let result = { before };
  if (mode === 'window') {
    await send('Performance.enable');
    const start = await send('Performance.getMetrics');
    await send('Profiler.enable');
    await send('Profiler.start');
    try {
      await delay(20000);
    } finally {
      result.profile = (await send('Profiler.stop')).profile;
    }
    result = { ...result, start, end: await send('Performance.getMetrics'), after: await status() };
  }
  if (mode === 'settings') {
    result.open = await evaluate(`(() => {
      const before=document.querySelectorAll('.ytaf-settings-page').length,start=performance.now();
      window.ytaf_showOptionsPanel(true);
      window.__spatialNavigation__?.setStartingPoint(null,null);
      return {before,after:document.querySelectorAll('.ytaf-settings-page').length,ms:performance.now()-start};
    })()`);
    await delay(600);
    await evaluate(`(() => {
      if (window.__resourceProfile) throw new Error('Sampler already installed');
      const state=window.__resourceProfile={rect:0,style:0,samples:[],
        rectFn:Element.prototype.getBoundingClientRect,styleFn:window.getComputedStyle};
      Element.prototype.getBoundingClientRect=function(){state.rect++;return state.rectFn.call(this)};
      window.getComputedStyle=function(...args){state.style++;return state.styleFn.apply(this,args)};
      state.stop=()=>{
        if(window.__resourceProfile!==state)return;
        Element.prototype.getBoundingClientRect=state.rectFn;
        window.getComputedStyle=state.styleFn;
        window.removeEventListener('keydown',state.listener,true);
        clearTimeout(state.expiry);
        delete window.__resourceProfile;
      };
      state.listener=e=>{if(typeof e.key!=='string'||!e.key.startsWith('Arrow')||state.samples.length>=120)return;
        const start=performance.now(),rect=state.rect,style=state.style,origin=document.activeElement;
        requestAnimationFrame(()=>{
          if(state.samples.length<120)state.samples.push({key:e.key,ms:performance.now()-start,
            rect:state.rect-rect,style:state.style-style,moved:document.activeElement!==origin,
            tab:document.querySelector('.ytaf-tab-btn.active')?.textContent});
        });};
      state.expiry=setTimeout(state.stop,140000);
      window.addEventListener('keydown',state.listener,true);
    })()`);
    try {
      // Sequential events are the workload: the next key must observe the prior focus.
      /* eslint-disable no-await-in-loop */
      for (let tab = 0; tab < 4; tab++) {
        await evaluate(`document.querySelectorAll('.ytaf-tab-btn')[${tab}].focus()`);
        for (let i = 0; i < 30; i++) {
          const key = i < 20 ? 'ArrowDown' : 'ArrowUp';
          const code = key === 'ArrowDown' ? 40 : 38;
          for (const type of ['keyDown', 'keyUp']) {
            await send('Input.dispatchKeyEvent', {
              type,
              key,
              code: key,
              windowsVirtualKeyCode: code,
              nativeVirtualKeyCode: code
            });
          }
          await delay(150);
        }
      }
      /* eslint-enable no-await-in-loop */
      result.samples = await evaluate('window.__resourceProfile.samples');
      if (result.samples.length !== 120) throw new Error('Incomplete input sample count');
      /** @type {Array<{moved: boolean}>} */
      const samples = result.samples;
      if (samples.filter((sample) => sample.moved).length < 60) {
        throw new Error('Too few focus changes; reject an inert navigation measurement');
      }
    } finally {
      await evaluate(`(() => {
        window.__resourceProfile?.stop();
        window.ytaf_showOptionsPanel(false);
      })()`);
    }
  }
  const json = JSON.stringify(result, null, 2);
  if (output) writeFileSync(output, json + '\n');
  else process.stdout.write(json + '\n');
} finally {
  clearTimeout(runTimeout);
  ws.close();
}
