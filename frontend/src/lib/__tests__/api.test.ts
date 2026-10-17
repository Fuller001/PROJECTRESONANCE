/** TTS API response validation prevents non-audio bodies from reaching playback. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../apiFetch', () => ({ apiFetch: mocks.apiFetch }));

describe('TTS API response validation', () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
  });

  it('maps an HTTP service failure to a user-facing TTS error', async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError('Request failed with status 405', 405));

    await expect(api.tts.speak({ text: '你好' }))
      .rejects.toThrow('语音服务请求失败（HTTP 405），请检查云端服务配置');
  });

  it('preserves a backend-provided TTS error', async () => {
    const backendError = new ApiError('Request failed with status 503', 503, { error: '语音合成服务未配置' });
    mocks.apiFetch.mockRejectedValue(backendError);

    await expect(api.tts.speak({ text: '你好' })).rejects.toThrow('语音合成服务未配置');
  });

  it('preserves AbortError for cancelled TTS requests', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    mocks.apiFetch.mockRejectedValue(abortError);

    await expect(api.tts.speak({ text: '你好' })).rejects.toBe(abortError);
  });

  it('rejects a non-audio clone response', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('<html>error</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    }));

    await expect(api.tts.speakWithCloneVoice(new FormData()))
      .rejects.toThrow('语音服务未返回音频，请检查云端服务配置');
  });

  it('maps an HTTP failure from the clone endpoint', async () => {
    mocks.apiFetch.mockRejectedValue(new ApiError('Request failed with status 405', 405));

    await expect(api.tts.speakWithCloneVoice(new FormData()))
      .rejects.toThrow('语音服务请求失败（HTTP 405），请检查云端服务配置');
  });
});
