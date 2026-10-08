// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentDashboard } from './StudentDashboard';

const baseProps = {
  studentName: 'テスト学生',
  studentSeatId: '1,1',
  studentComment: '',
  setStudentComment: vi.fn(),
  studentLiveSeatLocked: false,
  onChangeSeat: vi.fn(),
  currentStatus: null as 'ok' | 'ng' | null,
};

describe('StudentDashboard send state', () => {
  afterEach(cleanup);

  it('does not show sent while the relay is pending or after it fails', async () => {
    let resolveSend: (result: boolean) => void = () => {};
    const onSendBroadcast = vi.fn(() => new Promise<boolean>((resolve) => { resolveSend = resolve; }));
    render(<StudentDashboard {...baseProps} onSendBroadcast={onSendBroadcast} />);

    fireEvent.click(screen.getByRole('button', { name: /OK/ }));
    expect(screen.getByText('送信中...')).toBeTruthy();
    expect(screen.queryByText('✓ 送信済み')).toBeNull();

    await act(async () => resolveSend(false));
    await waitFor(() => expect(screen.getByText('回答待ち')).toBeTruthy());
    expect(screen.queryByText('✓ 送信済み')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('再送してください');
  });

  it('shows sent only after a successful relay updates the controlled status', async () => {
    const onSendBroadcast = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<StudentDashboard {...baseProps} onSendBroadcast={onSendBroadcast} />);

    fireEvent.click(screen.getByRole('button', { name: /OK/ }));
    expect(screen.queryByText('✓ 送信済み')).toBeNull();
    await waitFor(() => expect(onSendBroadcast).toHaveBeenCalledWith('ok', '', false));

    rerender(<StudentDashboard {...baseProps} currentStatus="ok" onSendBroadcast={onSendBroadcast} />);
    expect(screen.getByText('✓ 送信済み')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sends an anonymous comment together with the NG answer', async () => {
    const onSendBroadcast = vi.fn().mockResolvedValue(true);
    render(<StudentDashboard {...baseProps} studentComment="説明が速いです" onSendBroadcast={onSendBroadcast} />);
    fireEvent.click(screen.getByLabelText('コメントを匿名表示する'));
    fireEvent.click(screen.getByRole('button', { name: /NG/ }));
    await waitFor(() => expect(onSendBroadcast).toHaveBeenCalledWith('ng', '説明が速いです', true));
  });
});
