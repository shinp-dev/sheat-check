// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentSelect } from './StudentSelect';

const mocks = vi.hoisted(() => ({ load: vi.fn(), toast: vi.fn() }));
vi.mock('../../lib/hc', () => ({
  default: { api: { rooms: { ':id': { 'occupied-seats': { $get: mocks.load } } } } },
}));
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ addToast: mocks.toast }),
}));

describe('StudentSelect occupied seats', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('disables occupied seats and leaves available seats selectable', async () => {
    mocks.load.mockResolvedValue({
      ok: true, json: async () => ({ occupiedSeats: ['0,0'] }),
    });
    const selectSeat = vi.fn();
    const confirm = vi.fn();
    const { container } = render(
      <StudentSelect
        studentRoomTitle="テスト教室"
        studentClassroomId="room-1"
        studentLiveSeatLocked={false}
        studentGridLayout={{ '0,0': 'student', '1,0': 'student' }}
        studentSeatId="0,0"
        setStudentSeatId={selectSeat}
        setStudentStage={vi.fn()}
        onLockSeat={confirm}
        isClaimingSeat={false}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText('座席 0,0 は使用中')).toBeTruthy());
    expect((screen.getByRole('button', { name: /この席で確定/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('座席 0,0 は使用中'));
    expect(selectSeat).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith('warning', expect.stringContaining('使用中'));
    const firstRow = container.querySelector('tbody tr');
    const openSeat = firstRow?.querySelectorAll('td')[1]?.firstElementChild;
    expect(openSeat).toBeTruthy();
    fireEvent.click(openSeat!);
    expect(selectSeat).toHaveBeenCalledWith('1,0');
    expect(confirm).not.toHaveBeenCalled();
  });
});
