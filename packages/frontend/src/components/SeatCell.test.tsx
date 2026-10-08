// @vitest-environment jsdom
import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeatCell } from './SeatCell';

describe('SeatCell monitoring labels', () => {
  afterEach(() => cleanup());

  it('shows the name until hovered, then shows just the last two ID digits, with full details on click', () => {
    render(
      <DndContext>
        <SeatCell x={0} y={0} cellType="student" liveStatus={{ name: '山田 太郎', studentId: '24JZ0199', status: 'ok' }} onCycle={vi.fn()} massive />
      </DndContext>,
    );
    const seat = screen.getByRole('button', { name: '座席 0,0 の詳細を表示' });
    expect(screen.getByText('山田 太郎')).toBeTruthy();
    expect(screen.queryByText('99')).toBeNull();
    expect(screen.queryByText('24JZ0199')).toBeNull();

    fireEvent.mouseEnter(seat);
    expect(screen.queryByText('山田 太郎')).toBeNull();
    expect(screen.getByText('99')).toBeTruthy();

    fireEvent.mouseLeave(seat);
    expect(screen.getByText('山田 太郎')).toBeTruthy();
    expect(screen.queryByText('99')).toBeNull();

    fireEvent.click(seat);
    expect(screen.getByRole('dialog', { name: '座席の詳細' })).toBeTruthy();
    expect(screen.getByText('学籍番号：24JZ0199')).toBeTruthy();
    expect(screen.getByText('氏名：山田 太郎')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('truncates long names at the seat boundary using an ellipsis', () => {
    render(
      <DndContext>
        <SeatCell x={0} y={0} cellType="student" liveStatus={{ name: '非常に長い名前の学生', studentId: '24JZ0199', status: 'ng' }} onCycle={vi.fn()} massive />
      </DndContext>,
    );
    const name = screen.getByText('非常に長い名前の学生') as HTMLElement;
    expect(name.className).toBe('monitor-seat-name');
    expect(name.style.whiteSpace).toBe('nowrap');
    expect(name.style.overflow).toBe('hidden');
    expect(name.style.textOverflow).toBe('ellipsis');
    expect(name.style.width).toBe('100%');
    expect(name.style.minWidth).toBe('0px');
    fireEvent.mouseEnter(screen.getByRole('button', { name: '座席 0,0 の詳細を表示' }));
    expect(screen.getByText('99')).toBeTruthy();
  });

  it('does not expose monitoring identity controls for an empty seat', () => {
    render(<DndContext><SeatCell x={1} y={0} cellType="student" onCycle={vi.fn()} massive /></DndContext>);
    expect(screen.queryByRole('button', { name: /座席 .* の詳細を表示/ })).toBeNull();
  });
});
