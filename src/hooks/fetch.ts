import { CustomEventTarget, TypedCustomEvent, type EventListenerArg } from '../custom-event-target';

export type FetchTarget = string | URL | Request;

let registry: FetchRegistry | null = null;

type HookedType = 'request' | 'response';

const isHookedType = (t: unknown): t is HookedType => t === 'request' || t === 'response';

export interface RequestInfo {
  url: URL;
  resource: FetchTarget;
  init?: RequestInit | undefined;
}

interface EventMap {
  request: CustomEvent<RequestInfo>;
  response: CustomEvent<Response>;
}

export class FetchRegistry extends CustomEventTarget<EventMap> {
  #originalFetch: typeof fetch;
  #fetchCount = 0;
  // Per-type listener sets so #customFetch can skip URL construction and CustomEvent
  // dispatch when nobody is listening (e.g. tracking block off). Native EventTarget exposes
  // no listener count, so we maintain our own -- as Sets rather than counters, because
  // EventTarget itself deduplicates: adding the same callback twice, or removing one that
  // was never added, would drift a counter and strand the fast path permanently.
  #listeners: Record<HookedType, Set<unknown>> = {
    request: new Set(),
    response: new Set()
  };

  override addEventListener<K extends keyof EventMap & string>(
    type: K,
    callback: EventListenerArg<FetchRegistry, EventMap, K>,
    options?: boolean | AddEventListenerOptions
  ): void {
    super.addEventListener(type, callback, options);
    if (callback && isHookedType(type)) this.#listeners[type].add(callback);
  }

  override removeEventListener<K extends keyof EventMap & string>(
    type: K,
    callback: EventListenerArg<FetchRegistry, EventMap, K>,
    options?: boolean | EventListenerOptions
  ): void {
    super.removeEventListener(type, callback, options);
    if (callback && isHookedType(type)) this.#listeners[type].delete(callback);
  }

  private constructor() {
    super();

    this.#originalFetch = window.fetch.bind(window);
    window.fetch = this.#customFetch;
  }

  static async #dumpBody(resource: Request | Response) {
    if (
      !resource?.constructor?.name ||
      !['Request', 'Response'].includes(resource.constructor.name)
    )
      return null;

    const blob = await resource.clone().blob();
    if (!blob.size) return null;

    const fr = new FileReader();

    const res = new Promise<string | ArrayBuffer | null>(resolve => {
      fr.addEventListener('load', () => {
        resolve(fr.result);
      });
    });

    fr.readAsDataURL(blob);

    return res;
  }

  #customFetch = async (resource: FetchTarget, init?: RequestInit): Promise<Response> => {
    // Fast path: no listeners and not debugging — pass straight through with
    // zero allocations (no URL object, no CustomEvent dispatch). Tracking
    // block off is the common case for most sessions.
    if (
      !window.__ytaf_debug__ &&
      this.#listeners.request.size === 0 &&
      this.#listeners.response.size === 0
    ) {
      return this.#originalFetch(resource, init);
    }

    if (window.__ytaf_debug__) {
      console.debug(`Request ${this.#fetchCount}:`, resource);
      init && console.debug(`Options  ${this.#fetchCount}:`, init);

      if (resource instanceof Request) {
        const reqBody = await FetchRegistry.#dumpBody(resource);
        reqBody && console.debug(`Request Body ${this.#fetchCount}:`, reqBody);
      }
    }

    let reqAllowed = true;
    if (this.#listeners.request.size > 0) {
      const url =
        resource instanceof Request
          ? new URL(resource.url)
          : new URL(resource.toString(), document.location.href);

      reqAllowed = this.dispatchEvent(
        new TypedCustomEvent('request', {
          detail: { url, resource, init },
          cancelable: true
        })
      );
    }

    if (!reqAllowed) {
      console.info(`Fetch request ${this.#fetchCount} was cancelled by listener.`, resource, init);
      throw new TypeError('Failed to fetch');
    }

    const res = await this.#originalFetch(resource, init);

    if (window.__ytaf_debug__) {
      console.debug(`Response ${this.#fetchCount}:`, res);

      const resBody = await FetchRegistry.#dumpBody(res);
      resBody && console.debug(`Response Body ${this.#fetchCount}:`, resBody);
    }

    let resAllowed = true;
    if (this.#listeners.response.size > 0) {
      resAllowed = this.dispatchEvent(
        new TypedCustomEvent('response', { detail: res, cancelable: true })
      );
    }

    if (!resAllowed) {
      console.info(`Fetch response ${this.#fetchCount} was cancelled by listener.`, res);
      throw new TypeError('Failed to fetch');
    }

    this.#fetchCount++;

    return res;
  };

  static getInstance() {
    if (!registry) {
      registry = new FetchRegistry();
    }
    return registry;
  }

  [Symbol.dispose]() {
    window.fetch = this.#originalFetch;
    registry = null;
  }
}
