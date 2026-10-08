import React from 'react';
import { FolderOpen } from 'lucide-react';

interface MonitorControlBarProps {
  savedRooms: { id: string; name: string }[];
  roomId: string | null;
  isActive: boolean;
  onLoadClassroom: (id: string) => void;
  onToggleActive: () => void;
}

export const MonitorControlBar: React.FC<MonitorControlBarProps> = ({
  savedRooms,
  roomId,
  isActive,
  onLoadClassroom,
  onToggleActive
}) => {
  return (
    <div className="monitor-control-bar" style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
      
      {/* Left: Room & Case Selection and Monitor Controls */}
      <div style={{ display: 'flex', gap: '1rem', flex: 1, alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}>
        <div className="card" style={{ padding: '0.75rem 1rem', flex: '1 1 260px', minWidth: 0, display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <FolderOpen size={20} />
          <select 
            className="text-input" 
            value={roomId || ''} 
            onChange={(e) => onLoadClassroom(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          >
            <option value="">教室を選択してください</option>
            {savedRooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        
        {/* Reception Status Control (Open/Closed) */}
        {roomId && (
          <div className="card" style={{ padding: '0.75rem 1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>受付ステータス:</span>
            <button 
              className="btn" 
              style={{ 
                padding: '0.5rem 1rem', 
                backgroundColor: isActive ? 'rgba(106, 148, 120, 0.12)' : 'rgba(181, 96, 106, 0.12)', 
                border: 'none',
                color: isActive ? '#6A9478' : '#B5606A',
                fontWeight: 'bold',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }} 
              onClick={onToggleActive}
            >
              {isActive ? '● 受付中 (Open)' : '○ クローズ (Closed)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
