/** Native Worker routing, binary TTS, multipart cloning and late response cancellation. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, resolveAPIURL } from '../apiFetch';
const mocks = vi.hoisted(() => ({ native: false, request: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.native ? 'android' : 'web' },
  CapacitorHttp: { request: mocks.request }, registerPlugin: () => ({}),
}));
beforeEach(() => { mocks.native = true; mocks.request.mockReset(); vi.stubEnv('VITE_WORKER_API_URL', ''); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Android API transport', () => {
  it('keeps browser fetch behavior', async () => {
    mocks.native = false;
    const response = new Response('{}');
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetch);
    expect(await apiFetch('/api/auth/session', { credentials: 'include' })).toBe(response);
    expect(fetch).toHaveBeenCalledWith('/api/auth/session', { credentials: 'include' });
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('routes API paths to HTTPS and rejects foreign or insecure URLs', () => {
    expect(resolveAPIURL('/api/auth/session')).toBe('https://www.project-resonance.net/api/auth/session');
    expect(() => resolveAPIURL('https://elsewhere.example/api/auth/session')).toThrow();
    vi.stubEnv('VITE_WORKER_API_URL', 'http://bad.example');
    expect(() => resolveAPIURL('/api/auth/session')).toThrow('HTTPS');
  });
  it('reconstructs JSON errors without exposing Set-Cookie to JavaScript', async () => {
    mocks.request.mockResolvedValue({ status: 401, headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'token=private' }, data: { error: '请登录' } });
    const response = await apiFetch('/api/auth/session');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: '请登录' });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('preserves binary audio response bytes', async () => {
    mocks.request.mockResolvedValue({ status: 200, headers: { 'Content-Type': 'audio/mpeg' }, data: btoa('\x00\xff\x42') });
    const response = await apiFetch('/api/tts/speak');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 66]);
  });
  it('converts cloning files and text into native multipart entries', async () => {
    const form = new FormData();
    form.append('text', '你好');
    form.append('audio', new Blob(['wav'], { type: 'audio/wav' }), 'voice.wav');
    Object.defineProperty(form.get('audio'), 'arrayBuffer', {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    mocks.request.mockResolvedValue({ status: 200, headers: { 'Content-Type': 'application/json' }, data: { ok: true } });
    await apiFetch('/api/tts/voices/clone', { method: 'POST', body: form });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ dataType: 'formData', data: [
      { key: 'text', value: '你好', type: 'string' },
      { key: 'audio', type: 'base64File', fileName: 'voice.wav', contentType: 'audio/wav', value: 'AQID' },
    ] }));
  });
  it('rejects cancellation and ignores a late native response', async () => {
    let finish: (value: unknown) => void;
    mocks.request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const response = apiFetch('/api/asr/recognize', { signal: controller.signal });
    controller.abort();
    await expect(response).rejects.toMatchObject({ name: 'AbortError' });
    finish({ status: 200, headers: {}, data: '' });
  });
});
