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
  onSendComment: vi.fn().mockResolvedValue(true),
  currentStatus: null as 'ok' | 'ng' | null,
};

describe('StudentDashboard send state', () => {
  afterEach(cleanup);

  it('places OK/NG quick responses above the optional comment field', () => {
    render(<StudentDashboard {...baseProps} onSendBroadcast={vi.fn()} />);
    const ok = screen.getByRole('button', { name: /OK/ });
    const ng = screen.getByRole('button', { name: /NG/ });
    const comment = screen.getByLabelText('コメント（任意）');
    expect(ok.compareDocumentPosition(comment) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(ng.compareDocumentPosition(comment) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

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
    await waitFor(() => expect(onSendBroadcast).toHaveBeenCalledWith('ok'));

    rerender(<StudentDashboard {...baseProps} currentStatus="ok" onSendBroadcast={onSendBroadcast} />);
    expect(screen.getByText('✓ 送信済み')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('updates the seat status without sending the typed anonymous comment', async () => {
    const onSendBroadcast = vi.fn().mockResolvedValue(true);
    const onSendComment = vi.fn().mockResolvedValue(true);
    render(<StudentDashboard {...baseProps} studentComment="説明が速いです" onSendBroadcast={onSendBroadcast} onSendComment={onSendComment} />);
    fireEvent.click(screen.getByLabelText('コメントを匿名表示する'));
    fireEvent.click(screen.getByRole('button', { name: /NG/ }));
    await waitFor(() => expect(onSendBroadcast).toHaveBeenCalledWith('ng'));
    expect(onSendComment).not.toHaveBeenCalled();
    expect((screen.getByLabelText('コメント（任意）') as HTMLTextAreaElement).value).toBe('説明が速いです');
  });

  it('sends an anonymous comment before a status is selected and clears it only after success', async () => {
    const onSendBroadcast = vi.fn();
    const onSendComment = vi.fn().mockResolvedValue(true);
    const setStudentComment = vi.fn();
    render(<StudentDashboard {...baseProps} studentComment="説明が速いです" setStudentComment={setStudentComment} onSendBroadcast={onSendBroadcast} onSendComment={onSendComment} />);
    fireEvent.click(screen.getByLabelText('コメントを匿名表示する'));
    fireEvent.click(screen.getByRole('button', { name: 'コメントを送信' }));
    await waitFor(() => expect(onSendComment).toHaveBeenCalledWith('説明が速いです', true));
    await waitFor(() => expect(screen.getByText('✓ コメント送信済み')).toBeTruthy());
    expect(onSendBroadcast).not.toHaveBeenCalled();
    expect(screen.getByText('回答待ち')).toBeTruthy();
    expect(setStudentComment).toHaveBeenCalledWith('');
  });

  it('retains the comment for retry after a failure and leaves status controls available while pending', async () => {
    let resolveSend: (result: boolean) => void = () => {};
    const onSendComment = vi.fn(() => new Promise<boolean>((resolve) => { resolveSend = resolve; }));
    const setStudentComment = vi.fn();
    render(<StudentDashboard {...baseProps} studentComment="質問です" currentStatus="ok" setStudentComment={setStudentComment} onSendBroadcast={vi.fn()} onSendComment={onSendComment} />);
    fireEvent.click(screen.getByRole('button', { name: 'コメントを送信' }));
    expect((screen.getByRole('button', { name: 'コメント送信中...' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /NG/ }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => resolveSend(false));
    expect(screen.getByRole('alert').textContent).toContain('コメントを送信できませんでした');
    expect(setStudentComment).not.toHaveBeenCalled();
    expect(screen.getByText('✓ 送信済み')).toBeTruthy();
  });

  it('disables comment sending for an empty or whitespace-only draft', () => {
    render(<StudentDashboard {...baseProps} studentComment="   " onSendBroadcast={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'コメントを送信' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
