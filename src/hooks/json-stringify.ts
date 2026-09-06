/**
 * Forces `isInlinePlaybackNoAd` on outgoing InnerTube player requests.
 *
 * JSON.stringify is a global hook, so YouTube calls it constantly -- every localStorage
 * write, every request body, every internal log. The previous implementation
 * structuredClone()d every non-primitive argument before looking at it, paying a full deep
 * copy on payloads that carry no playbackContext at all.
 *
 * Three things replace it:
 *   1. An O(1) direct hit for the shape YouTube actually sends, where playbackContext sits
 *      at the root of the request body.
 *   2. A cheap rejection for everything else: only InnerTube request bodies carry
 *      contentPlaybackContext, and those always carry a `context` object too. Anything
 *      without one is skipped before any walking.
 *   3. In-place mutation restored in a `finally`, so the caller's object is handed back
 *      untouched without cloning it.
 *
 * A bounded breadth-first walk covers the case where both gates hold but the shape has
 * moved, so an InnerTube schema change degrades to "slower" rather than "silently stops
 * working".
 */
const originalStringify = JSON.stringify;
const hasOwn = Object.prototype.hasOwnProperty;

const MAX_DEPTH = 6;
// Bounds the fallback walk. A request body is a few hundred nodes; anything far past that
// is not the object we are looking for.
const MAX_NODES = 2000;
const DEBUG = false;

type FunctionReplacer = (this: any, key: string, value: any) => any;
type WhitelistReplacer = (string | number)[] | null;

type PlaybackCtx = Record<string, unknown>;
type AnyRecord = Record<string, unknown>;

function isRecord(value: unknown): value is AnyRecord {
  return typeof value === 'object' && value !== null;
}

function contentPlaybackContextOf(node: AnyRecord): PlaybackCtx | null {
  const pc = node.playbackContext;
  if (!isRecord(pc)) return null;
  const ctx = pc.contentPlaybackContext;
  return isRecord(ctx) ? ctx : null;
}

function findCtx(root: AnyRecord): PlaybackCtx | null {
  // Flat queue of alternating (node, depth) pairs -- one array, no per-node allocation.
  const queue: unknown[] = [root, 0];
  let i = 0;
  let visited = 0;

  while (i < queue.length) {
    if (++visited > MAX_NODES) return null;

    const node = queue[i++];
    const depth = queue[i++] as number;
    if (!isRecord(node) || depth > MAX_DEPTH) continue;

    const ctx = contentPlaybackContextOf(node);
    if (ctx) return ctx;

    const nextDepth = depth + 1;
    for (const k in node) {
      const v = node[k];
      if (isRecord(v)) queue.push(v, nextDepth);
    }
  }

  return null;
}

function stringify(
  value: unknown,
  replacer?: FunctionReplacer | WhitelistReplacer,
  space?: string | number
): string {
  let ctx: PlaybackCtx | null = null;
  let had = false;
  let prev: unknown;

  try {
    if (isRecord(value)) {
      // (1) The shape YouTube actually sends -- no traversal at all.
      ctx = contentPlaybackContextOf(value);

      // (2) Looks like an InnerTube request, but not the expected shape.
      if (!ctx && isRecord(value.context)) ctx = findCtx(value);

      if (ctx && ctx.isInlinePlaybackNoAd !== true) {
        had = hasOwn.call(ctx, 'isInlinePlaybackNoAd');
        prev = ctx.isInlinePlaybackNoAd;
        ctx.isInlinePlaybackNoAd = true;
        if (DEBUG) console.info('[JSON.stringify] Set isInlinePlaybackNoAd');
      } else {
        ctx = null;
      }
    }
  } catch {
    ctx = null; // this hook must never break YouTube's serialization
  }

  try {
    return originalStringify(value, replacer as any, space);
  } finally {
    if (ctx) {
      if (had) ctx.isInlinePlaybackNoAd = prev;
      else delete ctx.isInlinePlaybackNoAd;
    }
  }
}

JSON.stringify = stringify;
