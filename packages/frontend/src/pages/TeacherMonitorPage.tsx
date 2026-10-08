import React, { useEffect } from 'react';
import { MonitorPlay } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useTeacherSession } from '../hooks/useTeacherSession';
import { SeatMap } from '../components/SeatMap';
import client from '../lib/hc';
import { initAudioOnInteraction } from '../lib/audio';
import { useRequireAuth, useLogout } from '../hooks/useRequireAuth';
import { TeacherHeader } from '../components/layout/TeacherHeader';
import { MonitorControlBar } from '../components/monitor/MonitorControlBar';
import { MonitorRealtimeLogs } from '../components/monitor/MonitorRealtimeLogs';
import { MonitorSettingsDrawer } from '../components/monitor/MonitorSettingsDrawer';

export const TeacherMonitorPage: React.FC = () => {
  useRequireAuth();
  const handleLogout = useLogout();
  const { addToast } = useToast();

  const minWidth = import.meta.env.VITE_MONITOR_CELL_MIN_WIDTH || '80';
  const minHeight = import.meta.env.VITE_MONITOR_CELL_MIN_HEIGHT || '40';

  const session = useTeacherSession();

  // ページマウント時にユーザー操作で AudioContext を有効化（ブラウザ自動再生ポリシー対策）
  useEffect(() => {
    return initAudioOnInteraction();
  }, []);

  const handleLoadClassroom = (id: string) => session.loadClassroom(id);

  const onHandleBulkReset = () => {
    const ok = session.handleBulkReset();
    if (ok) {
      addToast('success', 'みんなの回答をクリアし、新しい質問を開始しました！');
    }
  };

  const handleToggleActive = async () => {
    const nextActive = !session.isActive;

    try {
      const res = await client.api.rooms[':id'].status.$patch({
        param: { id: session.roomId! },
        json: { isActive: nextActive },
      });
      if (!res.ok) {
        addToast('error', '受付ステータスの更新に失敗しました。再度お試しください。');
        return;
      }
      session.setIsActive(nextActive);
      addToast('success', nextActive ? 'チェックインの受付を開始しました（オープン）' : 'チェックインの受付を停止しました（クローズ）');
    } catch (err) {
      console.error('ステータス更新に失敗しました:', err);
      addToast('error', '受付ステータスの更新中に通信エラーが発生しました。再度お試しください。');
    }
  };

  return (
    <div style={{ height: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', minWidth: '1280px', background: 'linear-gradient(135deg, rgba(107, 140, 174, 0.08) 0%, rgba(248, 250, 252, 0) 50%)' }}>
      <TeacherHeader activePage="monitor" subtitle="みんなの様子" onLogout={handleLogout} />

      <main 
        className="main-content" 
        style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          padding: '1rem 2rem', 
          gap: '1rem', 
          width: '100%', 
          maxWidth: '100%',
          ['--min-cell-width' as any]: `${minWidth}px`,
          ['--min-cell-height' as any]: `${minHeight}px`
        }}
      >
        {/* Top Control Bar */}
        <MonitorControlBar 
          savedRooms={session.savedRooms}
          roomId={session.roomId}
          isActive={session.isActive}
          onLoadClassroom={handleLoadClassroom}
          onBulkReset={onHandleBulkReset}
          onToggleActive={handleToggleActive}
        />

        {/* Main Massive Grid / Placeholder */}
        {session.roomId ? (
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%', marginTop: '1rem', flex: 1, gap: '2rem' }}>
            
            {/* Keep the classroom geometry; put QR into the freed space to its right. */}
            <div className="monitor-classroom-and-qr" style={{
              display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap',
              gap: '1.5rem', width: '100%',
            }}>
              <div style={{ flex: '0 1 auto', minWidth: 0, maxWidth: '100%', overflowX: 'auto' }}>
                <SeatMap
                  grid={session.cases[session.activeCaseIdx]?.grid}
                  liveStatuses={session.liveStatuses}
                  onCycle={() => {}}
                  onRemoveLiveStatus={session.removeLiveStatus}
                  massive={true}
                />
              </div>
              <MonitorSettingsDrawer roomId={session.roomId} />
            </div>

            <MonitorRealtimeLogs realtimeLogs={session.realtimeLogs} />
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem' }}>
            <div className="card" style={{ maxWidth: '480px', width: '100%', padding: '3rem 2rem', textAlign: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(59, 130, 246, 0.1)', color: 'var(--color-student)', marginBottom: '1.5rem' }}>
                <MonitorPlay size={32} />
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem' }}>ライブ監視を開始</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: '1.5' }}>
                上部のメニューから教室を選択して、リアルタイムの授業理解度（OK/NG状況やコメント）の監視を開始してください。
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
