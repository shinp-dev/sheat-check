import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LayoutGrid, Lock } from 'lucide-react';
import { GridItem, LiveSeatStatus } from '@my-app/shared';
import { useSupabaseClient } from '../hooks/useSupabaseClient';
import { useStudentRealtime } from '../hooks/useStudentRealtime';
import { StudentView } from '../containers/StudentView';
import client from '../lib/hc';
import { useToast } from '../contexts/ToastContext';
import { studentSession } from '../lib/storage';
import { claimStudentSeat, releaseStudentSeat } from '../lib/studentSeatApi';

export const StudentPage: React.FC = () => {
  const { addToast } = useToast();
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [isRoomActive, setIsRoomActive] = useState(true);
  const [studentToken, setStudentToken] = useState(() => roomId ? studentSession.getToken(roomId) : '');

  // Student specific states
  const [studentStage, setStudentStage] = useState<'config' | 'select' | 'dashboard'>('config');
  const [studentClassroomId, setStudentClassroomId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentSeatId, setStudentSeatId] = useState('');
  const [isClaimingSeat, setIsClaimingSeat] = useState(false);
  const [studentComment, setStudentComment] = useState('');
  const [studentCurrentStatus, setStudentCurrentStatus] = useState<'ok' | 'ng' | null>(null);
  const [studentRoomTitle, setStudentRoomTitle] = useState('');
  const [studentLiveSeatLocked, setStudentLiveSeatLocked] = useState(false);
  const [studentGridLayout, setStudentGridLayout] = useState<Record<string, GridItem['type']>>({});
  
  // Empty live statuses for Student Page (since they only send, not receive grid updates visually)
  const [liveStatuses, setLiveStatuses] = useState<Record<string, LiveSeatStatus>>({});

  const fetchRoomAndSetup = useCallback(async (
    cleanUuid: string,
    storedId?: string | null,
    storedName?: string | null,
    storedSeatId?: string | null,
    forceStageUpdate = false
  ) => {
    try {
      const res = await client.api.rooms[':id'].$get({
        param: { id: cleanUuid },
      });
      
      if (res.ok) {
        const data = await res.json();
        setStudentRoomTitle(data.name);
        
        const active = data.isActive !== false;
        setIsRoomActive(active);

        // Refresh the student JWT and validate any locally stored seat capability.
        let freshToken = studentSession.getToken(cleanUuid);
        if (storedId && storedName) {
          try {
            const tokenRes = await client.api.rooms[':id']['student-token'].$post({
              param: { id: cleanUuid },
              json: { studentId: storedId, name: storedName }
            });
            if (tokenRes.ok) {
              const tokenData = await tokenRes.json();
              studentSession.saveToken(cleanUuid, tokenData.supabaseToken);
              setStudentToken(tokenData.supabaseToken);
              freshToken = tokenData.supabaseToken;
            }
          } catch (jwtErr) {
            console.error('Failed to pre-fetch student realtime token:', jwtErr);
          }
        }

        const gridObj: Record<string, GridItem['type']> = {};
        if (data.grid) {
          data.grid.forEach((item: GridItem) => {
            gridObj[`${item.x},${item.y}`] = item.type;
          });
        }
        setStudentGridLayout(gridObj);

        if (active) {
          if (forceStageUpdate) {
            if (storedName) {
              const savedClaim = studentSession.getSeatClaimToken(cleanUuid);
              if (storedSeatId && savedClaim && freshToken) {
                try {
                  const verified = await claimStudentSeat(cleanUuid, freshToken, storedSeatId, savedClaim, true);
                  if (verified.token) {
                    setStudentStage('dashboard');
                    addToast('success', `教室「${data.name}」の固定席 (${storedSeatId}) を復元しました！`);
                  } else {
                    studentSession.removeSeatId(cleanUuid);
                    studentSession.removeSeatClaimToken(cleanUuid);
                    setStudentSeatId('');
                    setStudentStage('select');
                    addToast('warning', '以前の座席登録を確認できません。空席を選び直してください。');
                  }
                } catch {
                  setStudentStage('select');
                  addToast('error', '座席登録を確認できませんでした。通信状態を確認してください。');
                }
              } else {
                if (storedSeatId) {
                  studentSession.removeSeatId(cleanUuid);
                  studentSession.removeSeatClaimToken(cleanUuid);
                  setStudentSeatId('');
                }
                setStudentStage('select');
                addToast('info', `教室「${data.name}」の座席選択画面へ進みます`);
              }
            } else {
              addToast('info', `教室「${data.name}」への招待リンクをロードしました。お名前を入力して入室してください！`);
            }
          }
        }
      } else {
        addToast('error', '指定された招待リンクの教室が見つかりませんでした。');
      }
    } catch (err: any) {
      console.error('教室データの取得エラー:', err);
    }
  }, [addToast]);

  const { supabase } = useSupabaseClient(studentToken);

  const {
    isFallbackActive,
    sendStudentToTeacherBroadcast,
    sendStudentCommentBroadcast,
  } = useStudentRealtime({
    supabase,
    studentClassroomId,
    studentToken,
    addToast,
    onTeacherReset: () => {
      setStudentComment('');
      setStudentCurrentStatus(null);
      // Keep the seat ID but refresh the portal for the new question session
      addToast('info', '教員が新しい質問を開始しました。現在の理解度回答がリセットされました。');
    },
    onTeacherEvict: (evictedSeatId) => {
      if (studentSeatId === evictedSeatId) {
        studentSession.removeSeatId(studentClassroomId);
        studentSession.removeSeatClaimToken(studentClassroomId);
        setStudentSeatId('');
        setStudentCurrentStatus(null);
        setStudentComment('');
        setStudentStage('select');
        addToast('warning', '教員によって座席登録が解除されました。新しく座席を選択してください。');
      }
    },
    onTeacherLockState: (locked) => setStudentLiveSeatLocked(locked),
    onRoomLayoutUpdated: () => {
      if (studentClassroomId) {
        // Silent hot reload of the classroom layout
        fetchRoomAndSetup(studentClassroomId, null, null, null, false);
        addToast('info', '教員が教室の座席レイアウトを更新しました。配置が自動同期されました！');
      }
    },
  });

  // Handle URL parameter login flow on mount
  useEffect(() => {
    if (roomId && roomId.trim()) {
      const cleanUuid = roomId.trim();
      setStudentClassroomId(cleanUuid);

      const storedId = studentSession.getId(cleanUuid);
      const storedName = studentSession.getName(cleanUuid);
      const storedSeatId = studentSession.getSeatId(cleanUuid);
      const prevSeatId = studentSession.getPrevSeatId(cleanUuid);

      if (storedId) {
        setStudentId(storedId);
      }
      if (storedName) {
        setStudentName(storedName);
        if (storedSeatId) {
          setStudentSeatId(storedSeatId);
        } else if (prevSeatId) {
          setStudentSeatId(prevSeatId);
        }
      }

      fetchRoomAndSetup(cleanUuid, storedId, storedName, storedSeatId, true);
    }
  }, [roomId, fetchRoomAndSetup]);

  // Seat ownership persists across reloads: only an explicit student release or
  // an authenticated teacher eviction can free the claimed seat.

  const handleStudentLogin = async () => {
    if (!studentClassroomId.trim()) {
      addToast('error', '教室の UUID を入力してください');
      return;
    }
    if (!studentId.trim()) {
      addToast('error', '学籍番号を入力してください');
      return;
    }

    // Strict student ID check (5-15 alphanumeric chars)
    const studentIdPattern = /^[A-Z0-9]{5,15}$/;
    if (!studentIdPattern.test(studentId.trim())) {
      addToast('error', '学籍番号は5〜15文字の半角英数字で入力してください。');
      return;
    }

    if (!studentName.trim()) {
      addToast('error', 'お名前を入力してください');
      return;
    }

    try {
      const res = await client.api.rooms[':id'].$get({
        param: { id: studentClassroomId.trim() },
      });

      if (res.ok) {
        const data = await res.json();
        setStudentRoomTitle(data.name);

        const active = data.isActive !== false;
        setIsRoomActive(active);

        // Retrieve student Supabase Access Token (JWT) from backend to lock down Realtime channels
        try {
          const tokenRes = await client.api.rooms[':id']['student-token'].$post({
            param: { id: studentClassroomId.trim() },
            json: {
              studentId: studentId.trim(),
              name: studentName.trim()
            }
          });

          if (tokenRes.ok) {
            const tokenData = await tokenRes.json();
            studentSession.saveToken(studentClassroomId.trim(), tokenData.supabaseToken);
            setStudentToken(tokenData.supabaseToken);
          } else {
            throw new Error('Supabase 認証トークンの取得に失敗しました');
          }
        } catch (tokenErr: any) {
          console.error('リアルタイム通信の認証に失敗しました:', tokenErr);
          return;
        }

        const gridObj: Record<string, GridItem['type']> = {};
        if (data.grid) {
          data.grid.forEach((item: GridItem) => {
            gridObj[`${item.x},${item.y}`] = item.type;
          });
        }
        setStudentGridLayout(gridObj);

        studentSession.saveId(studentClassroomId, studentId.trim());
        studentSession.saveName(studentClassroomId, studentName.trim());
        studentSession.saveLastRoomId(studentClassroomId);

        const prevSeatId = studentSession.getPrevSeatId(studentClassroomId.trim());
        if (prevSeatId) {
          setStudentSeatId(prevSeatId);
        }

        // If not using a URL parameter, explicitly navigate to the clean URL so they can bookmark it
        if (!roomId) {
          navigate(`/student/${studentClassroomId}`);
        } else {
          if (active) {
            setStudentStage('select');
            addToast('success', `教室「${data.name}」に参加しました！着席する座席を選んでください。`);
          }
        }
      } else {
        addToast('error', '指定された UUID の教室が見つかりませんでした。');
      }
    } catch (err: any) {
      console.error('教室データの取得エラー:', err);
    }
  };

  const handleLockSeat = async () => {
    if (!studentSeatId.trim() || isClaimingSeat) return;
    if (studentLiveSeatLocked) {
      addToast('warning', '現在、座席変更は教員によってロックされています。');
      return;
    }
    if (!studentToken || !studentClassroomId) {
      addToast('error', '認証情報がありません。画面を再読み込みしてください。');
      return;
    }
    setIsClaimingSeat(true);
    try {
      const response = await claimStudentSeat(studentClassroomId, studentToken, studentSeatId);
      if (!response.token) {
        addToast('error', response.status === 409
          ? 'その席はすでに使用中か、別の座席に登録済みです。空席を選んでください。'
          : '座席を確定できませんでした。もう一度お試しください。');
        return;
      }
      studentSession.saveSeatClaimToken(studentClassroomId, response.token);
      studentSession.saveSeatId(studentClassroomId, studentSeatId);
      studentSession.savePrevSeatId(studentClassroomId, studentSeatId);
      setStudentStage('dashboard');
      addToast('success', `座席 [ ${studentSeatId} ] を確定しました！`);
    } catch {
      addToast('error', '通信エラーで座席を確定できませんでした。');
    } finally {
      setIsClaimingSeat(false);
    }
  };

  const handleChangeSeat = async () => {
    if (studentLiveSeatLocked) {
      addToast('warning', '現在、座席変更は教員によってロックされています。');
      return;
    }
    const claimToken = studentSession.getSeatClaimToken(studentClassroomId);
    if (!claimToken || !studentSeatId) {
      addToast('error', '座席登録を確認できません。再読み込みしてください。');
      return;
    }
    try {
      if (!await releaseStudentSeat(studentClassroomId, studentToken, studentSeatId, claimToken)) {
        addToast('error', '席の変更に失敗しました。教員に確認してください。');
        return;
      }
      studentSession.removeSeatId(studentClassroomId);
      studentSession.removeSeatClaimToken(studentClassroomId);
      setStudentStage('select');
      setStudentCurrentStatus(null);
      setStudentComment('');
    } catch {
      addToast('error', '通信エラーで席を変更できませんでした。');
    }
  };

  return (
    <div style={{ height: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'linear-gradient(135deg, rgba(107, 140, 174, 0.08) 0%, rgba(248, 250, 252, 0) 50%)' }}>
      <header className="app-header">
        <div className="header-brand">
          <div className="logo-icon">
            <LayoutGrid size={24} style={{ color: 'var(--color-student)' }} />
          </div>
          <h1 className="header-title">Seats & Check</h1>
        </div>
      </header>

      {!isRoomActive ? (
        <main style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
          <div className="card" style={{ maxWidth: '440px', width: '100%', padding: '3rem 2rem', textAlign: 'center', background: 'rgba(20, 27, 45, 0.4)', backdropFilter: 'blur(12px)', border: '1px solid var(--border-color)', borderRadius: '16px' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '64px', height: '64px', borderRadius: '50%', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', marginBottom: '1.5rem' }}>
              <Lock size={32} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.75rem', color: '#ef4444' }}>現在クローズされています</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: '1.6' }}>
              この教室（<strong>{studentRoomTitle || '講義室'}</strong>）は、現在チェックインを受け付けていません。
              教員が受付を開始するまでしばらくお待ちください。
            </p>
            <button 
              className="btn btn-secondary" 
              onClick={async () => {
                try {
                  const cleanUuid = studentClassroomId || roomId || '';
                  if (cleanUuid) {
                    const res = await client.api.rooms[':id'].$get({ param: { id: cleanUuid } });
                    if (res.ok) {
                      const data = await res.json();
                      const active = data.isActive !== false;
                      setIsRoomActive(active);
                      if (active) {
                        addToast('success', '受付が開始されました！画面を進めます。');
                        if (studentName) {
                          setStudentStage(studentSeatId ? 'dashboard' : 'select');
                        }
                      } else {
                        addToast('info', '現在も受付クローズ状態です。');
                      }
                    }
                  }
                } catch (e) {
                  addToast('error', '再試行に失敗しました。');
                }
              }}
              style={{ width: '100%' }}
            >
              状態を再読込
            </button>
          </div>
        </main>
      ) : (
        <StudentView
          supabase={supabase}
          isFallbackActive={isFallbackActive}
          studentStage={studentStage}
          setStudentStage={setStudentStage}
          studentClassroomId={studentClassroomId}
          setStudentClassroomId={setStudentClassroomId}
          studentId={studentId}
          setStudentId={setStudentId}
          studentName={studentName}
          setStudentName={setStudentName}
          studentSeatId={studentSeatId}
          setStudentSeatId={setStudentSeatId}
          studentComment={studentComment}
          setStudentComment={setStudentComment}
          studentCurrentStatus={studentCurrentStatus}
          studentRoomTitle={studentRoomTitle}
          studentLiveSeatLocked={studentLiveSeatLocked}
          studentGridLayout={studentGridLayout}
          onStudentLogin={handleStudentLogin}
          onLockSeat={handleLockSeat}
          isClaimingSeat={isClaimingSeat}
          onChangeSeat={handleChangeSeat}
          onSendBroadcast={async (status) => {
            setStudentCurrentStatus(null);
            const result = await sendStudentToTeacherBroadcast(studentSeatId, status, studentName, studentId);
            if (result === 'ok') {
              setStudentCurrentStatus(status);
              return true;
            }
            return false;
          }}
          onSendComment={async (comment, anonymous) => (
            await sendStudentCommentBroadcast(studentSeatId, comment, anonymous)
          ) === 'ok'}
        />
      )}
    </div>
  );
};
