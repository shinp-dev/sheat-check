// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MonitorRealtimeLogs } from './MonitorRealtimeLogs';

describe('MonitorRealtimeLogs', () => {
  it('shows only comments without OK or NG labels', () => {
    render(<MonitorRealtimeLogs realtimeLogs={[
      { id: '1', studentId: 'STU001', studentName: '山田 太郎', seatId: '1,1', status: 'ok', timestamp: '10:00:01' },
      { id: '2', studentId: 'STU002', studentName: '鈴木 花子', seatId: '1,2', status: 'ng', comment: '難しい', timestamp: '10:00:02' },
    ]} />);

    for (const text of ['STU002', '鈴木 花子', '席 1,2', '10:00:02', '難しい']) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    for (const text of ['STU001', '山田 太郎', 'OK', 'NG', '要確認', 'コメントなし']) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });
});
