import React from 'react';
import { Activity, Radio, RotateCcw } from 'lucide-react';

interface RealtimeLog {
  id: string;
  studentId?: string;
  studentName: string;
  seatId: string;
  timestamp: string;
  comment?: string | null;
  status?: string;
}

interface MonitorRealtimeLogsProps {
  realtimeLogs: RealtimeLog[];
  onBulkReset?: () => void;
}

export const MonitorRealtimeLogs: React.FC<MonitorRealtimeLogsProps> = ({ realtimeLogs, onBulkReset }) => {
  return (
    <div className="card monitor-comments-card" style={{ width: '100%', minWidth: 0, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: '320px', maxHeight: '480px' }}>
      <div className="monitor-comments-header">
        <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <Activity size={18} style={{ color: 'var(--color-student)' }} /> 直近のコメント
        </h2>
        {onBulkReset && (
          <button type="button" className="btn btn-secondary" onClick={onBulkReset}
            title="全員の回答状況をクリアして新しい質問を開始します。"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.45rem 0.75rem' }}>
            <RotateCcw size={16} /> みんなの回答をクリア
          </button>
        )}
      </div>
      
      {!realtimeLogs.some((log) => log.comment?.trim()) ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '260px', flexDirection: 'column', gap: '0.75rem', color: 'var(--text-muted)' }}>
          <Radio size={32} />
          <p style={{ fontSize: '0.85rem', textAlign: 'center', margin: 0, lineHeight: 1.4 }}>
            学生からのコメントを<br />リアルタイムに待機しています...
          </p>
        </div>
      ) : (
        <div className="activity-feed-container" style={{ flex: 1, overflowY: 'auto', minWidth: 0, maxHeight: '380px', paddingRight: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {realtimeLogs.filter((log) => log.comment?.trim()).map((log) => (
            <div key={log.id} className="feed-item" style={{ margin: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{log.studentId || '-'}</span>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{log.studentName}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--bg-deep)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>席 {log.seatId}</span>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{log.timestamp}</span>
              </div>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5, paddingLeft: '0.1rem' }}>
                {log.comment}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
