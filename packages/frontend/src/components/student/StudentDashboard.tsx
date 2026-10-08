import React from 'react';
import { Heart, User, Lock, Unlock, CheckCircle2, XCircle } from 'lucide-react';

interface StudentDashboardProps {
  studentName: string;
  studentSeatId: string;
  studentComment: string;
  setStudentComment: (val: string) => void;
  studentLiveSeatLocked: boolean;
  onSendBroadcast: (status: 'ok' | 'ng') => Promise<boolean>;
  onSendComment: (comment: string, anonymous: boolean) => Promise<boolean>;
  onChangeSeat: () => void;
  currentStatus: 'ok' | 'ng' | null;
}

export const StudentDashboard: React.FC<StudentDashboardProps> = React.memo(({
  studentName,
  studentSeatId,
  studentComment,
  setStudentComment,
  studentLiveSeatLocked,
  onSendBroadcast,
  onSendComment,
  onChangeSeat,
  currentStatus,
}) => {
  const [isSending, setIsSending] = React.useState(false);
  const [sendError, setSendError] = React.useState('');
  const [anonymous, setAnonymous] = React.useState(false);
  const [isSendingComment, setIsSendingComment] = React.useState(false);
  const [commentSendError, setCommentSendError] = React.useState('');
  const [commentSent, setCommentSent] = React.useState(false);

  const handleSend = async (status: 'ok' | 'ng') => {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(40);
      } catch (e) {}
    }

    setIsSending(true);
    setSendError('');
    try {
      const success = await onSendBroadcast(status);
      if (!success) {
        setSendError('回答を送信できませんでした。通信状態を確認して再送してください。');
      }
    } catch {
      setSendError('回答を送信できませんでした。通信状態を確認して再送してください。');
    } finally {
      setIsSending(false);
    }
  };

  const handleSendComment = async () => {
    const text = studentComment.trim();
    if (!text || isSendingComment) return;
    setIsSendingComment(true);
    setCommentSendError('');
    setCommentSent(false);
    try {
      if (await onSendComment(text, anonymous)) {
        setStudentComment('');
        setCommentSent(true);
      } else {
        setCommentSendError('コメントを送信できませんでした。通信状態を確認して再送してください。');
      }
    } catch {
      setCommentSendError('コメントを送信できませんでした。通信状態を確認して再送してください。');
    } finally {
      setIsSendingComment(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="student-title-group" style={{ marginBottom: 0 }}>
        <h2 className="student-title">
          <Heart size={24} style={{ color: 'var(--text-primary)' }} /> 講義フィードバック
        </h2>
      </div>

      {/* Fixed seat details & subtle status summary */}
      <div style={{ background: 'rgba(255, 255, 255, 0.5)', padding: '1rem 1.25rem', borderRadius: '16px', border: '1px solid rgba(0, 0, 0, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'rgba(0, 0, 0, 0.05)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <User size={16} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{studentName} さん</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>登録席: <strong style={{ color: 'var(--text-primary)' }}>{studentSeatId}</strong></div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem', fontWeight: 700 }}>
          {isSending ? (
            <span style={{ color: 'var(--text-muted)' }}>送信中...</span>
          ) : currentStatus === null ? (
            <span style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444', animation: 'bannerPulse 1.5s infinite alternate' }} />
              回答待ち
            </span>
          ) : (
            <span style={{ color: '#6A9478', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              ✓ 送信済み
            </span>
          )}
        </div>
      </div>

      {sendError && (
        <div role="alert" style={{ color: '#B5606A', fontSize: '0.85rem', fontWeight: 600, textAlign: 'center' }}>
          {sendError}
        </div>
      )}

      {studentLiveSeatLocked && (
        <div className="lock-banner" style={{ marginTop: '0' }}>
          <Lock size={14} />
          <span>教員によって座席の変更がロックされています</span>
        </div>
      )}

      {/* Comments are sent separately from the seat status. */}
      <div>
        <label htmlFor="student-feedback-comment" style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 700 }}>
          コメント（任意）
        </label>
        <textarea
          id="student-feedback-comment"
          value={studentComment}
          onChange={(e) => { setStudentComment(e.target.value); setCommentSent(false); }}
          maxLength={1000}
          rows={3}
          placeholder="気になったことや質問を入力できます"
          disabled={isSendingComment}
          style={{ width: '100%', boxSizing: 'border-box', borderRadius: '12px', padding: '0.85rem', resize: 'vertical', border: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.85)', color: 'var(--text-primary)', font: 'inherit' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginTop: '0.65rem', cursor: 'pointer', fontSize: '0.9rem' }}>
          <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} disabled={isSendingComment} />
          コメントを匿名表示する
        </label>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
          匿名にすると「みんなの様子」のコメント一覧では名前を表示しません。教員の座席管理では本人を確認できます。
        </p>
        <button className="btn btn-primary" onClick={handleSendComment} disabled={isSendingComment || !studentComment.trim()}
          style={{ width: '100%', justifyContent: 'center', marginTop: '0.85rem' }}>
          {isSendingComment ? 'コメント送信中...' : 'コメントを送信'}
        </button>
        {commentSendError && <p role="alert" style={{ color: '#B5606A', fontSize: '0.85rem' }}>{commentSendError}</p>}
        {commentSent && <p role="status" style={{ color: '#397B50', fontSize: '0.85rem' }}>✓ コメント送信済み</p>}
      </div>
      <fieldset disabled={isSending} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <button className="quick-feedback-btn" onClick={() => handleSend('ng')}
          style={{ minHeight: '170px', borderRadius: '20px', border: '2px solid #B5606A', background: '#F8E9EB', color: '#A63E4C', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', fontSize: '1.3rem', fontWeight: 800, cursor: 'pointer' }}>
          <XCircle size={44} /> NG
        </button>
        <button className="quick-feedback-btn" onClick={() => handleSend('ok')}
          style={{ minHeight: '170px', borderRadius: '20px', border: '2px solid #6A9478', background: '#E8F3EC', color: '#397B50', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', fontSize: '1.3rem', fontWeight: 800, cursor: 'pointer' }}>
          <CheckCircle2 size={44} /> OK
        </button>
      </fieldset>

      {/* Change seat fallback (Only active when Teacher's seatLock is false!) */}
      <button
        className="btn btn-secondary"
        style={{ width: '100%', marginTop: '0.5rem', justifyContent: 'center' }}
        onClick={onChangeSeat}
        disabled={studentLiveSeatLocked}
        title={studentLiveSeatLocked ? '教員により変更がロックされています' : undefined}
      >
        <Unlock size={14} /> 席の変更 (Change Seat)
      </button>
    </div>
  );
});

StudentDashboard.displayName = 'StudentDashboard';
