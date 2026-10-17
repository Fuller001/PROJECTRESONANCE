/** Audio bounds, channel mixing, protocol cleanup and guaranteed decoder resource cleanup. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { bytesToBase64, cleanR2T2Transcript, recordingToPCM } from '../r2t2';

function audioMocks(duration = 0.5) {
  const samples = Math.round(duration * 48000);
  const left = new Float32Array(samples).fill(0.75);
  const right = new Float32Array(samples).fill(-0.25);
  const close = vi.fn().mockResolvedValue(undefined);
  const decode = vi.fn().mockResolvedValue({ length: samples, sampleRate: 48000, numberOfChannels: 2,
    getChannelData: (channel: number) => channel === 0 ? left : right });
  let mixed: Float32Array;
  vi.stubGlobal('AudioContext', vi.fn(() => ({ close, decodeAudioData: decode })));
  const offline = vi.fn((_channels: number, length: number, rate: number) => ({
    createBuffer: (_channels: number, size: number) => {
      mixed = new Float32Array(size);
      return { getChannelData: () => mixed };
    },
    createBufferSource: () => ({ connect: vi.fn(), start: vi.fn() }), destination: {},
    startRendering: () => Promise.resolve({ getChannelData: () => new Float32Array(length).fill(mixed[0]) }),
  }));
  vi.stubGlobal('OfflineAudioContext', offline);
  return { close, decode, offline };
}

function audioBlob() { return { arrayBuffer: async () => new ArrayBuffer(8) } as Blob; }

afterEach(() => vi.unstubAllGlobals());

describe('R2T2 audio and output contract', () => {
  it('preserves Chinese and emoji while removing ASR protocol metadata', () => {
    expect(cleanR2T2Transcript('language Chinese<asr_text>你好🙂<|im_end|>')).toBe('你好🙂');
    expect(cleanR2T2Transcript('已经是文字。')).toBe('已经是文字。');
  });
  it('serializes a maximum-length clip without stack overflow', () => {
    const data = new Uint8Array(1920000);
    data[0] = 128; data[data.length - 1] = 255;
    const raw = atob(bytesToBase64(data));
    expect(raw.length).toBe(data.length);
    expect(raw.charCodeAt(0)).toBe(128);
    expect(raw.charCodeAt(raw.length - 1)).toBe(255);
  });
  it('mixes stereo and sends 16 kHz little-endian float PCM', async () => {
    const mocks = audioMocks();
    const raw = atob(await recordingToPCM(audioBlob()));
    expect(mocks.offline).toHaveBeenCalledWith(1, 8000, 16000);
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    expect(bytes.length).toBe(8000 * 4);
    expect(new DataView(bytes.buffer).getFloat32(0, true)).toBeCloseTo(0.25);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it.each([0.2, 30.1])('rejects %s second clips and releases the decoder', async (duration) => {
    const mocks = audioMocks(duration);
    await expect(recordingToPCM(audioBlob())).rejects.toThrow('0.3 到 30 秒');
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.offline).not.toHaveBeenCalled();
  });
  it('releases the decoder after malformed audio fails', async () => {
    const mocks = audioMocks();
    mocks.decode.mockRejectedValue(new Error('bad audio'));
    await expect(recordingToPCM(audioBlob())).rejects.toThrow('bad audio');
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
