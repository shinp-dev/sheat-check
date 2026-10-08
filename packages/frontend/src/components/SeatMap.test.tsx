// @vitest-environment jsdom
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SeatMap } from './SeatMap';

vi.mock('./SeatCell', () => ({
  SeatCell: ({ x, y }: { x: number; y: number }) => <span data-testid={`seat-${x}-${y}`} />,
}));

describe('SeatMap monitoring layout', () => {
  const grid = { '0,0': 'student' as const, '11,0': 'door' as const };

  it('keeps all 12 columns and positions while compacting column and gap widths', () => {
    const { container, getByTestId } = render(
      <SeatMap grid={grid} liveStatuses={{}} onCycle={vi.fn()} massive />,
    );
    const seatGrid = container.querySelector<HTMLElement>('.monitor-seat-grid');
    expect(seatGrid).not.toBeNull();
    const cols = seatGrid!.style.gridTemplateColumns.split(' ');
    expect(cols).toHaveLength(12);
    expect(cols[0]).toBe('60px');
    expect(cols[1]).toBe('22px');
    expect(cols[11]).toBe('60px');
    expect(seatGrid!.style.gap).toBe('6px');
    expect(seatGrid!.style.width).toBe('max-content');
    expect(getByTestId('seat-0-0')).toBeTruthy();
    expect(getByTestId('seat-11-11')).toBeTruthy();
  });

  it('leaves the editor seat map unchanged', () => {
    const { container } = render(<SeatMap grid={grid} liveStatuses={{}} onCycle={vi.fn()} />);
    expect(container.querySelector('.seat-map-table')).not.toBeNull();
    expect(container.querySelector('.monitor-seat-grid')).toBeNull();
  });
});
