// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeacherMonitorPage } from './TeacherMonitorPage';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  setIsActive: vi.fn(),
  addToast: vi.fn(),
  session: {
    roomId: 'room-1',
    isActive: true,
    setIsActive: vi.fn(),
    savedRooms: [],
    loadClassroom: vi.fn(),
    handleBulkReset: vi.fn(),
    cases: [{ grid: {} }],
    activeCaseIdx: 0,
    liveStatuses: {},
    removeLiveStatus: vi.fn(),
    realtimeLogs: [],
  },
}));

mocks.session.setIsActive = mocks.setIsActive;

vi.mock('../lib/hc', () => ({
  default: {
    api: { rooms: { ':id': { status: { $patch: mocks.patch } } } },
  },
}));
vi.mock('../hooks/useTeacherSession', () => ({ useTeacherSession: () => mocks.session }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ addToast: mocks.addToast }) }));
vi.mock('../hooks/useRequireAuth', () => ({ useRequireAuth: vi.fn(), useLogout: () => vi.fn() }));
vi.mock('../lib/audio', () => ({ initAudioOnInteraction: () => vi.fn() }));
vi.mock('../components/layout/TeacherHeader', () => ({ TeacherHeader: () => null }));
vi.mock('../components/SeatMap', () => ({ SeatMap: () => null }));
vi.mock('../components/monitor/MonitorRealtimeLogs', () => ({
  MonitorRealtimeLogs: ({ onBulkReset }: { onBulkReset: () => void }) => (
    <div data-testid="comments-region-mock"><button onClick={onBulkReset}>clear-from-comments</button></div>
  ),
}));
vi.mock('../components/monitor/MonitorSettingsDrawer', () => ({ MonitorSettingsDrawer: () => null }));
vi.mock('../components/monitor/MonitorControlBar', () => ({
  MonitorControlBar: ({ onToggleActive }: { onToggleActive: () => void }) => (
    <button onClick={onToggleActive}>toggle-active</button>
  ),
}));

describe('TeacherMonitorPage room reception toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.isActive = true;
  });

  afterEach(() => cleanup());

  it('uses one compact workspace for the classroom, QR and comments and clears from comments', () => {
    mocks.session.handleBulkReset.mockReturnValue(true);
    const { container } = render(<TeacherMonitorPage />);
    const workspace = container.querySelector('.monitor-dashboard-grid');
    expect(container.querySelector('.monitor-page-shell')).not.toBeNull();
    expect(workspace?.querySelector('.monitor-seat-region')).not.toBeNull();
    expect(workspace?.querySelector('.monitor-qr-region')).not.toBeNull();
    expect(workspace?.querySelector('.monitor-comments-region')).not.toBeNull();
    const button = screen.getByRole('button', { name: 'clear-from-comments' });
    expect(workspace?.querySelector('.monitor-comments-region')?.contains(button)).toBe(true);
    fireEvent.click(button);
    expect(mocks.session.handleBulkReset).toHaveBeenCalledOnce();
    expect(mocks.addToast).toHaveBeenCalledWith('success', expect.stringContaining('みんなの回答をクリア'));
  });

  it('updates local state only after the API succeeds', async () => {
    mocks.patch.mockResolvedValue({ ok: true, status: 200 });
    render(<TeacherMonitorPage />);

    fireEvent.click(screen.getByRole('button', { name: 'toggle-active' }));

    await waitFor(() => expect(mocks.setIsActive).toHaveBeenCalledWith(false));
    expect(mocks.addToast).toHaveBeenCalledWith('success', expect.stringContaining('受付を停止'));
  });

  it.each([401, 403, 500])('does not update local state when the API returns %s', async (status) => {
    mocks.patch.mockResolvedValue({ ok: false, status });
    render(<TeacherMonitorPage />);

    fireEvent.click(screen.getByRole('button', { name: 'toggle-active' }));

    await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
    expect(mocks.setIsActive).not.toHaveBeenCalled();
    expect(mocks.addToast).toHaveBeenCalledWith('error', expect.stringContaining('更新に失敗'));
    expect(mocks.addToast).not.toHaveBeenCalledWith('success', expect.any(String));
  });

  it('does not update local state after a network error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.patch.mockRejectedValue(new Error('network down'));
    render(<TeacherMonitorPage />);

    fireEvent.click(screen.getByRole('button', { name: 'toggle-active' }));

    await waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('通信エラー'),
    ));
    expect(mocks.setIsActive).not.toHaveBeenCalled();
    expect(mocks.addToast).not.toHaveBeenCalledWith('success', expect.any(String));
  });
});
