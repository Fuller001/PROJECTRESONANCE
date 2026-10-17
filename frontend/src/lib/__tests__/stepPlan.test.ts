/** Step Plan protocol, credential isolation, response limits and cancellation regressions. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStepPlanKey, getStepPlanStatus, saveStepPlanKey, speakStepPlan } from '../stepPlan';
import { STEP_PLAN_BASE_URL } from '../speechService';

const mocks = vi.hoisted(() => ({
  android: false,
  native: { getStatus: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn(), speak: vi.fn(), cancel: vi.fn() },
}));
vi.mock('../r2t2', () => ({ isAndroid: () => mocks.android }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => mocks.native }));

/** jsdom's Blob uses FileReader rather than the browser arrayBuffer helper. */
function bytesOf(blob: Blob): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve([...new Uint8Array(reader.result as ArrayBuffer)]);
    reader.readAsArrayBuffer(blob);
  });
}
const fixtureKey = 'test-only-step-plan-key-123456';
beforeEach(async () => {
  mocks.android = false;
  await clearStepPlanKey();
  Object.values(mocks.native).forEach((mock) => mock.mockReset());
  mocks.native.cancel.mockResolvedValue(undefined);
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('Step Plan credentials', () => {
  it('keeps web keys in memory without putting them in localStorage', async () => {
    expect(await getStepPlanStatus()).toEqual({ configured: false });
    expect(await saveStepPlanKey(fixtureKey)).toEqual({ configured: true });
    expect(localStorage.length).toBe(0);
    expect(await clearStepPlanKey()).toEqual({ configured: false });
  });
  it('rejects masked and injected keys before calling the native store', async () => {
    mocks.android = true;
    for (const key of ['example...masked', 'test-key\r\nInjected:yes', 'test key with spaces', '***masked***']) {
      await expect(saveStepPlanKey(key)).rejects.toThrow();
    }
    expect(mocks.native.saveKey).not.toHaveBeenCalled();
  });
  it('uses status-only native credential methods', async () => {
    mocks.android = true;
    mocks.native.saveKey.mockResolvedValue({ configured: true });
    mocks.native.getStatus.mockResolvedValue({ configured: true });
    mocks.native.clearKey.mockResolvedValue({ configured: false });
    await expect(saveStepPlanKey(fixtureKey)).resolves.toEqual({ configured: true });
    expect(mocks.native.saveKey).toHaveBeenCalledWith({ apiKey: fixtureKey });
    await expect(getStepPlanStatus()).resolves.toEqual({ configured: true });
    await expect(clearStepPlanKey()).resolves.toEqual({ configured: false });
  });
});

describe('Step Plan speech', () => {
  it('requires a configured key before making a web request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(speakStepPlan({ text: '你好' })).rejects.toThrow('填写并保存完整');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the Step Plan audio endpoint and documented model/input/voice contract', async () => {
    await saveStepPlanKey(fixtureKey);
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([0, 255, 42]), {
      headers: { 'Content-Type': 'audio/mpeg' },
    }));
    vi.stubGlobal('fetch', fetch);
    const blob = await speakStepPlan({ text: '你好', voice: 'wenrounvsheng', speed: 0.8 });
    expect(await bytesOf(blob)).toEqual([0, 255, 42]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${STEP_PLAN_BASE_URL}/audio/speech`);
    expect(init.credentials).toBe('omit');
    expect(init.redirect).toBe('error');
    expect(init.headers.Authorization).toBe(`Bearer ${fixtureKey}`);
    expect(JSON.parse(init.body)).toEqual({
      model: 'stepaudio-2.5-tts', input: '你好', voice: 'wenrounvsheng', speed: 0.8, volume: 1, response_format: 'mp3',
    });
  });
  it.each([[401, 'API Key 无效'], [403, '模型权限'], [429, '额度不足'], [405, 'HTTP 405']])(
    'reports HTTP %i without echoing the server body or retrying', async (status, message) => {
      await saveStepPlanKey(fixtureKey);
      const fetch = vi.fn().mockResolvedValue(new Response('sensitive-server-body', { status }));
      vi.stubGlobal('fetch', fetch);
      await expect(speakStepPlan({ text: '你好' })).rejects.toThrow(message);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each(['application/json', 'text/html'])('rejects a successful non-audio %s response', async (type) => {
    await saveStepPlanKey(fixtureKey);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Type': type } })));
    await expect(speakStepPlan({ text: '你好' })).rejects.toThrow('未返回音频');
  });
  it('rejects empty audio responses', async () => {
    await saveStepPlanKey(fixtureKey);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { headers: { 'Content-Type': 'audio/mpeg' } })));
    await expect(speakStepPlan({ text: '你好' })).rejects.toThrow('未返回音频');
  });
  it('validates text and speed before native requests', async () => {
    mocks.android = true;
    await expect(speakStepPlan({ text: 'a'.repeat(1001) })).rejects.toThrow('1000');
    await expect(speakStepPlan({ text: '你好', speed: NaN })).rejects.toThrow('语速');
    await expect(speakStepPlan({ text: '你好', voice: 'invalid voice' })).rejects.toThrow('音色');
    expect(mocks.native.speak).not.toHaveBeenCalled();
  });
  it('decodes native audio without passing credentials through the speech call', async () => {
    mocks.android = true;
    mocks.native.speak.mockResolvedValue({ audioBase64: btoa('\x00\xff\x2a'), contentType: 'audio/mpeg' });
    const blob = await speakStepPlan({ text: '你好' });
    expect(await bytesOf(blob)).toEqual([0, 255, 42]);
    expect(mocks.native.speak).toHaveBeenCalledWith({
      text: '你好', voice: 'qinqienvsheng', speed: 1, requestId: expect.any(String),
    });
  });
  it('cancels the identified native request and ignores late audio', async () => {
    mocks.android = true;
    let finish!: (audio: { audioBase64: string; contentType: string }) => void;
    mocks.native.speak.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const request = speakStepPlan({ text: '你好' }, controller.signal);
    const { requestId } = mocks.native.speak.mock.calls[0][0];
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.native.cancel).toHaveBeenCalledWith({ requestId });
    finish({ audioBase64: 'not-valid-base64!', contentType: 'text/html' });
    await Promise.resolve();
  });
});
