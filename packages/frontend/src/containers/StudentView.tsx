import React from 'react';
import { SupabaseClient } from '@supabase/supabase-js';
import { Settings } from 'lucide-react';
import { GridItem } from '@my-app/shared';
import { StudentConfig } from '../components/student/StudentConfig';
import { StudentSelect } from '../components/student/StudentSelect';
import { StudentDashboard } from '../components/student/StudentDashboard';

interface StudentViewProps {
  supabase: SupabaseClient | null;
  isFallbackActive?: boolean;
  studentStage: 'config' | 'select' | 'dashboard';
  setStudentStage: (stage: 'config' | 'select' | 'dashboard') => void;
  studentClassroomId: string;
  setStudentClassroomId: (id: string) => void;
  studentId: string;
  setStudentId: (id: string) => void;
  studentName: string;
  setStudentName: (name: string) => void;
  studentSeatId: string;
  setStudentSeatId: (seatId: string) => void;
  studentComment: string;
  setStudentComment: (comment: string) => void;
  studentCurrentStatus: 'ok' | 'ng' | null;
  studentRoomTitle: string;
  studentLiveSeatLocked: boolean;
  studentGridLayout: Record<string, GridItem['type']>;
  onStudentLogin: () => void;
  onLockSeat: () => void;
  onChangeSeat: () => void;
  onSendBroadcast: (status: 'ok' | 'ng') => Promise<boolean>;
  onSendComment: (comment: string, anonymous: boolean) => Promise<boolean>;
}

export const StudentView: React.FC<StudentViewProps> = React.memo(({
  supabase,
  isFallbackActive = false,
  studentStage,
  setStudentStage,
  studentClassroomId,
  setStudentClassroomId,
  studentId,
  setStudentId,
  studentName,
  setStudentName,
  studentSeatId,
  setStudentSeatId,
  studentComment,
  setStudentComment,
  studentCurrentStatus,
  studentRoomTitle,
  studentLiveSeatLocked,
  studentGridLayout,
  onStudentLogin,
  onLockSeat,
  onChangeSeat,
  onSendBroadcast,
  onSendComment,
}) => {
  return (
    <main className="student-view-container">
      {isFallbackActive && (
        <div style={{
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.25)',
          borderRadius: 'var(--border-radius)',
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          color: '#f59e0b',
          fontSize: '0.8rem',
          fontWeight: 500,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
          <Settings size={16} style={{ animation: 'spin 4s infinite linear' }} />
          <span>リアルタイム接続に失敗しました。教室の接続設定（Supabase）に問題がある可能性があります。教員に確認してください。</span>
        </div>
      )}
      
      <div className="student-card">
        {studentStage === 'config' && (
          <StudentConfig
            supabase={supabase}
            studentClassroomId={studentClassroomId}
            setStudentClassroomId={setStudentClassroomId}
            studentId={studentId}
            setStudentId={setStudentId}
            studentName={studentName}
            setStudentName={setStudentName}
            onLogin={onStudentLogin}
          />
        )}

        {studentStage === 'select' && (
          <StudentSelect
            studentRoomTitle={studentRoomTitle}
            studentLiveSeatLocked={studentLiveSeatLocked}
            studentGridLayout={studentGridLayout}
            studentSeatId={studentSeatId}
            setStudentSeatId={setStudentSeatId}
            setStudentStage={setStudentStage}
            onLockSeat={onLockSeat}
          />
        )}

        {studentStage === 'dashboard' && (
          <StudentDashboard
            studentName={studentName}
            studentSeatId={studentSeatId}
            studentComment={studentComment}
            setStudentComment={setStudentComment}
            studentLiveSeatLocked={studentLiveSeatLocked}
            onSendBroadcast={onSendBroadcast}
            onSendComment={onSendComment}
            onChangeSeat={onChangeSeat}
            currentStatus={studentCurrentStatus}
          />
        )}
      </div>
    </main>
  );
});

StudentView.displayName = 'StudentView';
