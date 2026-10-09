// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentView } from './StudentView';

vi.mock('../components/student/StudentConfig', () => ({ StudentConfig: () => <div>student config</div> }));
vi.mock('../components/student/StudentSelect', () => ({ StudentSelect: () => <div>student select</div> }));
vi.mock('../components/student/StudentDashboard', () => ({ StudentDashboard: () => <div>student dashboard</div> }));

const baseProps = {
  supabase: null,
  studentStage: 'dashboard' as 'config' | 'select' | 'dashboard',
  setStudentStage: vi.fn(),
  studentClassroomId: 'room-1',
  setStudentClassroomId: vi.fn(),
  studentId: 'TEST001',
  setStudentId: vi.fn(),
  studentName: 'Test',
  setStudentName: vi.fn(),
  studentSeatId: '0,1',
  setStudentSeatId: vi.fn(),
  studentComment: '',
  setStudentComment: vi.fn(),
  studentCurrentStatus: null,
  studentRoomTitle: 'Test room',
  studentLiveSeatLocked: false,
  studentGridLayout: {},
  onStudentLogin: vi.fn(),
  onLockSeat: vi.fn(),
  isClaimingSeat: false,
  onChangeSeat: vi.fn(),
  onSendBroadcast: vi.fn(async () => true),
  onSendComment: vi.fn(async () => true),
};

describe('StudentView artwork scope', () => {
  afterEach(cleanup);

  it('applies the artwork only on the lecture feedback dashboard', () => {
    const { container } = render(<StudentView {...baseProps} />);
    expect(screen.getByText('student dashboard')).toBeTruthy();
    expect(container.querySelector('.student-card')?.classList.contains('student-feedback-artwork')).toBe(true);
  });

  it.each(['config', 'select'] as const)('keeps the %s stage without the artwork', stage => {
    const { container } = render(<StudentView {...baseProps} studentStage={stage} />);
    expect(container.querySelector('.student-card')?.classList.contains('student-feedback-artwork')).toBe(false);
  });
});
