// @vitest-environment jsdom
import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SeatCell } from './SeatCell';

describe('SeatCell monitoring labels', () => {
  afterEach(() => cleanup());

  it('shows only the last two student ID characters and reveals full identity on click', () => {
    render(
      <DndContext>
        <SeatCell x={0} y={0} cellType="student" liveStatus={{ name: '山田 太郎', studentId: '24JZ0199', status: 'ok' }} onCycle={vi.fn()} massive />
      </DndContext>,
    );
    expect(screen.getByText('99')).toBeTruthy();
    expect(screen.queryByText('24JZ0199')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '座席 0,0 の詳細を表示' }));
    expect(screen.getByRole('dialog', { name: '座席の詳細' })).toBeTruthy();
    expect(screen.getByText('学籍番号：24JZ0199')).toBeTruthy();
    expect(screen.getByText('氏名：山田 太郎')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not expose monitoring identity controls for an empty seat', () => {
    render(<DndContext><SeatCell x={1} y={0} cellType="student" onCycle={vi.fn()} massive /></DndContext>);
    expect(screen.queryByRole('button', { name: /座席 .* の詳細を表示/ })).toBeNull();
  });
});
