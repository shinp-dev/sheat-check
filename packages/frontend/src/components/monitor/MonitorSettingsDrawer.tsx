import React from 'react';
import { Copy, QrCode } from 'lucide-react';

interface MonitorSettingsDrawerProps {
  roomId: string | null;
}

/** Compact QR panel beside the classroom. The full link is copied, not rendered. */
export const MonitorSettingsDrawer: React.FC<MonitorSettingsDrawerProps> = ({ roomId }) => {
  const [copyMessage, setCopyMessage] = React.useState('');
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
    <aside className="card" style={{
      width: '270px', maxWidth: '100%', flex: '0 0 270px', padding: '1rem',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem',
      border: '1px solid var(--border-color)', boxSizing: 'border-box',
    }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '1rem', margin: 0, alignSelf: 'flex-start' }}>
        <QrCode size={18} /> 学生用チェックイン QR
      </h2>
      <div style={{ background: '#fff', padding: '0.7rem', borderRadius: '12px' }}>
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(checkinUrl)}`}
          alt="学生用チェックインQRコード"
          width={180}
          height={180}
          style={{ display: 'block' }}
        />
      </div>
      <button type="button" className="btn btn-secondary" onClick={copyLink}
        style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: '0.5rem' }}>
        <Copy size={16} /> チェックインURLをコピー
      </button>
      {copyMessage && <p role="status" style={{ margin: 0, fontSize: '0.8rem' }}>{copyMessage}</p>}
    </aside>
  );
};
