/** Key settings regressions: password input, clearing after save, status-only storage and removal. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StepPlanSettings from '../StepPlanSettings';
const mocks = vi.hoisted(() => ({ getStatus: vi.fn(), saveKey: vi.fn(), clearKey: vi.fn() }));
vi.mock('@/lib/stepPlan', () => ({ getStepPlanStatus: mocks.getStatus, saveStepPlanKey: mocks.saveKey, clearStepPlanKey: mocks.clearKey }));
vi.mock('@/lib/r2t2', () => ({ isAndroid: () => true }));
beforeEach(() => {
  mocks.getStatus.mockReset().mockResolvedValue({ configured: false });
  mocks.saveKey.mockReset().mockResolvedValue({ configured: true });
  mocks.clearKey.mockReset().mockResolvedValue({ configured: false });
});
afterEach(cleanup);

describe('Step Plan key settings', () => {
  it('saves a user key, clears the input, and removes it without reading it back', async () => {
    const stop = vi.fn();
    render(<StepPlanSettings service="step-plan" onServiceChange={vi.fn()} onStop={stop} />);
    await screen.findByText('尚未配置 API Key');
    const input = screen.getByLabelText('Step Plan API Key');
    expect(input).toHaveAttribute('type', 'password');
    const fixture = 'test-only-key-never-a-real-secret';
    fireEvent.change(input, { target: { value: fixture } });
    fireEvent.click(screen.getByRole('button', { name: '保存 API Key' }));
    await screen.findByText('API Key 已配置');
    expect(mocks.saveKey).toHaveBeenCalledWith(fixture);
    expect(input).toHaveValue('');
    expect(screen.queryByText(fixture)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除 API Key' }));
    await screen.findByText('API Key 已移除');
    expect(mocks.clearKey).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(2);
  });
  it('shows storage failure instead of claiming that a key was saved', async () => {
    mocks.saveKey.mockRejectedValue(new Error('API Key 加密保存失败，请重试'));
    render(<StepPlanSettings service="step-plan" onServiceChange={vi.fn()} onStop={vi.fn()} />);
    await screen.findByText('尚未配置 API Key');
    fireEvent.change(screen.getByLabelText('Step Plan API Key'), { target: { value: 'test-only-key-value' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 API Key' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('加密保存失败'));
    expect(screen.queryByText('API Key 已配置')).not.toBeInTheDocument();
  });
});
