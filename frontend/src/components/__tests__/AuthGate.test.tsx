/** Step Plan/settings remain reachable without the legacy cloud login. */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthGate } from '../AuthGate';

const state = vi.hoisted(() => ({ service: 'step-plan', auth: vi.fn() }));
vi.mock('@/hooks/useSpeechService', () => ({ useSpeechService: () => ({ service: state.service }) }));
vi.mock('@/hooks/useASREnginePreference', () => ({ useASREnginePreference: () => ({ preference: 'cloud', setPreference: vi.fn() }) }));
vi.mock('@/lib/r2t2', () => ({ isAndroid: () => true }));
vi.mock('@/hooks/useDeviceId', () => ({ useDeviceId: () => ({ deviceId: 'fixture', isLoading: false }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: state.auth }));
vi.mock('@/pages/LoginPage', () => ({ default: () => <div>原云端登录</div> }));
afterEach(cleanup);

/** Mounts the gate at a real router path while exposing guest authentication calls. */
function mount(path: string, service: string) {
  state.service = service;
  state.auth.mockReset().mockReturnValue({ status: 'guest' });
  render(<MemoryRouter initialEntries={[path]}><AuthGate><div>应用内容</div></AuthGate></MemoryRouter>);
}

describe('speech service entry', () => {
  it('opens Step Plan without touching legacy cloud authentication', () => {
    mount('/', 'step-plan');
    expect(screen.getByText('应用内容')).toBeInTheDocument();
    expect(state.auth).not.toHaveBeenCalled();
  });
  it('keeps settings reachable when the legacy service is selected', () => {
    mount('/settings', 'worker');
    expect(screen.getByText('应用内容')).toBeInTheDocument();
    expect(state.auth).not.toHaveBeenCalled();
  });
  it('retains the legacy login requirement for the legacy service', async () => {
    mount('/', 'worker');
    expect(await screen.findByText('原云端登录')).toBeInTheDocument();
    expect(screen.queryByText('应用内容')).not.toBeInTheDocument();
  });
});
