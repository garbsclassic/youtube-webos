import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleLaunch } from '../src/utils.js';

function launch(params) {
  globalThis.window = { location: {} };
  handleLaunch(params);
  return new URL(globalThis.window.location.href);
}

test('handleLaunch with no params falls back to the default TV URL', () => {
  const url = launch({});
  assert.equal(url.origin + url.pathname, 'https://www.youtube.com/tv');
  assert.equal(url.hash, '#/');
  assert.equal(url.searchParams.get('env_forceFullAnimation'), '1');
  assert.equal(url.searchParams.get('env_enableWebSpeech'), '1');
  assert.equal(url.searchParams.get('env_enableVoice'), '1');
});

test('handleLaunch replaces the URL outright when contentTarget is already a youtube.com URL', () => {
  const url = launch({ contentTarget: 'https://www.youtube.com/tv#/watch?v=abc123' });
  assert.equal(url.hash, '#/watch?v=abc123');
});

test('handleLaunch appends a non-URL string contentTarget as query params', () => {
  const url = launch({ contentTarget: 'v=abc123&list=xyz' });
  assert.equal(url.searchParams.get('v'), 'abc123');
  assert.equal(url.searchParams.get('list'), 'xyz');
});

test('handleLaunch strips a doubled "v=v=" prefix', () => {
  const url = launch({ contentTarget: 'v=v=abc123' });
  assert.equal(url.searchParams.get('v'), 'abc123');
});

test('handleLaunch falls back to target when contentTarget is absent', () => {
  const url = launch({ target: 'v=fromTarget' });
  assert.equal(url.searchParams.get('v'), 'fromTarget');
});

test('handleLaunch builds voice-search params from an object contentTarget', () => {
  const url = launch({
    contentTarget: { intent: 'SearchContent', intentParam: 'cats' }
  });
  assert.equal(url.searchParams.get('inApp'), 'true');
  assert.equal(url.searchParams.get('vs'), '9');
  assert.equal(url.searchParams.get('va'), 'search');
  assert.deepEqual(url.searchParams.getAll('launch'), ['voice', 'search']);
  assert.equal(url.searchParams.get('vq'), 'cats');
});

test('handleLaunch only appends launch=voice (no launch=search) for non-search intents', () => {
  const url = launch({
    contentTarget: { intent: 'PlayContent', intentParam: 'some song' }
  });
  assert.equal(url.searchParams.get('va'), 'play');
  assert.deepEqual(url.searchParams.getAll('launch'), ['voice']);
});

test('handleLaunch removes the animation/speech/voice env params under the "k" theme', () => {
  const url = launch({ contentTarget: 'v=abc123&theme=k' });
  assert.equal(url.searchParams.get('theme'), 'k');
  assert.equal(url.searchParams.has('env_forceFullAnimation'), false);
  assert.equal(url.searchParams.has('env_enableWebSpeech'), false);
  assert.equal(url.searchParams.has('env_enableVoice'), false);
});

test('handleLaunch still builds a voice search when an object contentTarget has no intent', () => {
  // An intent-less launch is malformed but not useless -- the intentParam is the spoken
  // query, so it still searches, just without the `va` intent hint.
  const url = launch({ contentTarget: { intentParam: 'cats' } });
  assert.equal(url.searchParams.get('vq'), 'cats');
  assert.equal(url.searchParams.has('va'), false);
  assert.deepEqual(url.searchParams.getAll('launch'), ['voice']);
});

test('handleLaunch rejects a contentTarget whose origin only looks like youtube.com', () => {
  // A prefix match on the origin let https://www.youtube.com.attacker.example/x through and
  // assigned it straight to location.href.
  const url = launch({ contentTarget: 'https://www.youtube.com.attacker.example/x' });
  assert.equal(url.origin, 'https://www.youtube.com');
  assert.notEqual(url.hostname, 'www.youtube.com.attacker.example');
});

test('handleLaunch rejects a cross-origin contentTarget URL outright', () => {
  const url = launch({ contentTarget: 'https://attacker.example/tv#/watch?v=abc123' });
  assert.equal(url.origin, 'https://www.youtube.com');
});

test('handleLaunch degrades to the plain YouTube URL when contentTarget is null', () => {
  const url = launch({ contentTarget: null });
  assert.equal(url.origin + url.pathname, 'https://www.youtube.com/tv');
});

test('handleLaunch degrades to the plain YouTube URL instead of throwing when something unexpected blows up', () => {
  // Any exception while building the URL -- not just the undefined-intent
  // case -- should degrade gracefully rather than leaving the app on a
  // blank page. A throwing getter is a deterministic way to force that path.
  const poison = {
    get intent() {
      throw new Error('boom');
    }
  };
  const url = launch({ contentTarget: poison });
  assert.equal(url.origin + url.pathname, 'https://www.youtube.com/tv');
});
