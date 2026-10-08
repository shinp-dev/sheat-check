import React from 'react';
import { ChevronDown, ChevronUp, Copy, QrCode } from 'lucide-react';

interface MonitorSettingsDrawerProps {
  roomId: string | null;
}

/** Room-specific check-in QR; collapsed state leaves room for the live comments. */
export const MonitorSettingsDrawer: React.FC<MonitorSettingsDrawerProps> = ({ roomId }) => {
  const [isExpanded, setIsExpanded] = React.useState(true);
  const [copyMessage, setCopyMessage] = React.useState('');

  // Switching classrooms should immediately make the new check-in QR visible.
  React.useEffect(() => {
    setIsExpanded(true);
    setCopyMessage('');
  }, [roomId]);

  if (!roomId) return null;

  const checkinUrl = `${window.location.origin}/student/${roomId}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(checkinUrl);
      setCopyMessage('コピーしました');
    } catch {
      setCopyMessage('コピーに失敗しました');
    }
  };

  return (
    <aside className="card monitor-qr-card">
      <button
        type="button"
        className="monitor-qr-toggle"
        aria-expanded={isExpanded}
        aria-controls="monitor-checkin-details"
        title={isExpanded ? 'QRコードを折りたたむ' : 'QRコードを展開する'}
        onClick={() => setIsExpanded((expanded) => !expanded)}
      >
        <span className="monitor-qr-title">
          <QrCode size={18} aria-hidden="true" /> 学生用チェックイン QR
        </span>
        {isExpanded
          ? <ChevronUp size={18} aria-hidden="true" />
          : <ChevronDown size={18} aria-hidden="true" />}
      </button>
      {isExpanded && (
        <div id="monitor-checkin-details" className="monitor-qr-details">
          <div style={{ background: '#fff', padding: '0.7rem', borderRadius: '3px' }}>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(checkinUrl)}`}
              alt="学生用チェックインQRコード"
              width={180}
              height={180}
              style={{ display: 'block' }}
            />
          </div>
          <button
            type="button"
            className="btn btn-secondary monitor-checkin-copy-btn"
            aria-label="チェックインURLをコピー"
            onClick={copyLink}
            style={{ width: '100%', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
          >
            <Copy size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span className="monitor-checkin-copy-label">
              <span>チェックインURL</span>
              <span>をコピー</span>
            </span>
          </button>
          {copyMessage && <p role="status" style={{ margin: 0, fontSize: '0.8rem' }}>{copyMessage}</p>}
        </div>
      )}
    </aside>
  );
};
