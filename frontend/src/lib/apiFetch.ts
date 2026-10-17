/** Preserves browser fetch while Android uses native HTTP and the native cookie jar for Worker APIs. */
import { CapacitorHttp, type HttpOptions } from '@capacitor/core';
import { isAndroid, bytesToBase64 } from './r2t2';

/** Resolves bundled Android API paths to the public HTTPS Worker origin. */
export function resolveAPIURL(path: string): string {
  if (!isAndroid()) return path;
  const base = new URL(import.meta.env.VITE_WORKER_API_URL || 'https://www.project-resonance.net');
  if (base.protocol !== 'https:' || base.username || base.password) {
    throw new Error('Android 云端服务地址必须使用 HTTPS');
  }
  const url = new URL(path, base);
  if (url.protocol !== 'https:' || url.origin !== base.origin || url.username !== '' || url.password !== '' || !url.pathname.startsWith('/api/')) {
    throw new Error('无效的云端 API 地址');
  }
  return url.href;
}

function aborted(): DOMException { return new DOMException('Request aborted', 'AbortError'); }

/** Abort invalidates late responses; native sockets remain subject to the connect/read timeouts. */
function withAbort<T>(work: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted());
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    work.then(
      (result) => signal.aborted ? reject(aborted()) : resolve(result),
      (error) => reject(error),
    ).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Handles JSON, text and multipart cloning uploads, and reconstructs binary TTS responses. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!isAndroid()) return fetch(path, init);
  if (init.signal?.aborted) throw aborted();
  const headers = new Headers(init.headers);
  let data: HttpOptions['data'];
  let dataType: HttpOptions['dataType'];
  if (init.body instanceof FormData) {
    const entries: Record<string, string>[] = [];
    for (const [key, value] of init.body.entries()) {
      if (typeof value === 'string') entries.push({ key, value, type: 'string' });
      else entries.push({ key, type: 'base64File', fileName: value.name,
        contentType: value.type || 'application/octet-stream',
        value: bytesToBase64(new Uint8Array(await value.arrayBuffer())) });
    }
    data = entries;
    dataType = 'formData';
    headers.set('Content-Type', 'multipart/form-data');
  } else if (init.body != null) {
    if (typeof init.body !== 'string') throw new Error('不支持的云端请求格式');
    data = init.body;
  }
  if (init.signal?.aborted) throw aborted();
  const result = await withAbort(CapacitorHttp.request({
    url: resolveAPIURL(path), method: init.method || 'GET',
    headers: Object.fromEntries(headers.entries()), data, dataType,
    responseType: 'arraybuffer', connectTimeout: 20000, readTimeout: 30000,
  }), init.signal);
  const responseHeaders = new Headers();
  Object.entries(result.headers).forEach(([name, value]) => {
    if (name.toLowerCase() !== 'set-cookie' && name.toLowerCase() !== 'set-cookie2') {
      responseHeaders.set(name, value);
    }
  });
  let body: BodyInit | null = null;
  if (result.status !== 204 && result.status !== 205 && init.method !== 'HEAD') {
    if (responseHeaders.get('content-type')?.includes('json')) body = JSON.stringify(result.data);
    else if (result.status >= 400) body = String(result.data ?? '');
    else {
      const raw = atob(String(result.data ?? ''));
      body = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    }
  }
  return new Response(body, { status: result.status, headers: responseHeaders });
}
