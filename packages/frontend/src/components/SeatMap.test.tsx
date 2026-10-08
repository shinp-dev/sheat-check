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

  it('removes only unused columns to the right of the last physical seat', () => {
    // Seats use x=0 and x=7. Internal aisles x=1..6 must keep their spacing;
    // columns x=8..11 must not create an empty tail after the last seat.
    const layout = { '0,0': 'teacher' as const, '2,1': 'student' as const, '7,6': 'student' as const };
    const { container, getByTestId, queryByTestId } = render(
      <SeatMap grid={layout} liveStatuses={{}} onCycle={vi.fn()} massive />,
    );
    const seatGrid = container.querySelector<HTMLElement>('.monitor-seat-grid');
    expect(seatGrid).not.toBeNull();
    expect(seatGrid!.style.gridTemplateColumns.split(' ')).toHaveLength(8);
    expect(seatGrid!.style.gridTemplateColumns.split(' ')).toEqual([
      '60px', '22px', '60px', '22px', '22px', '22px', '22px', '60px',
    ]);
    expect(getByTestId('seat-7-6')).toBeTruthy();
    expect(queryByTestId('seat-8-6')).toBeNull();
    expect(seatGrid!.style.width).toBe('max-content');
  });

  it('keeps the last column when there is a physical object at x=11', () => {
    const layout = { '7,4': 'student' as const, '11,2': 'obstacle' as const };
    const { container, getByTestId } = render(
      <SeatMap grid={layout} liveStatuses={{}} onCycle={vi.fn()} massive />,
    );
    const seatGrid = container.querySelector<HTMLElement>('.monitor-seat-grid');
    expect(seatGrid!.style.gridTemplateColumns.split(' ')).toHaveLength(12);
    expect(getByTestId('seat-11-2')).toBeTruthy();
  });

  it('leaves the editor seat map unchanged', () => {
    const { container } = render(<SeatMap grid={grid} liveStatuses={{}} onCycle={vi.fn()} />);
    expect(container.querySelector('.seat-map-table')).not.toBeNull();
    expect(container.querySelector('.monitor-seat-grid')).toBeNull();
  });
});
