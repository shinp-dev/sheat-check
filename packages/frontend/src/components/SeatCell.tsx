import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { User, GraduationCap, XCircle, DoorOpen, X } from 'lucide-react';
import { GridItem, LiveSeatStatus } from '@my-app/shared';

interface SeatCellProps {
  x: number;
  y: number;
  cellType?: GridItem['type'];
  liveStatus?: LiveSeatStatus;
  onCycle: (x: number, y: number) => void;
  onRemoveLiveStatus?: (key: string) => void;
  massive?: boolean;
  isEmptyRow?: boolean;
  isShrinkCol?: boolean;
}

export const SeatCell = React.memo(({ 
  x, 
  y, 
  cellType, 
  liveStatus,
  onCycle,
  onRemoveLiveStatus,
  massive = false,
  isEmptyRow = false,
  isShrinkCol = false
}: SeatCellProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const { isOver, setNodeRef } = useDroppable({
    id: `cell-${x}-${y}`,
    data: { x, y },
  });

  const coordKey = `${x},${y}`;

  const getIcon = () => {
    switch (cellType) {
      case 'student': return <User size={20} />;
      case 'teacher': return <GraduationCap size={20} />;
      case 'obstacle': return <XCircle size={18} />;
      case 'door': return <DoorOpen size={20} />;
      default: return null;
    }
  };

  // 1. 教室設定画面（通常モード / massive=false）のレンダリング
  if (!massive) {
    const getCellClassName = () => {
      let classes = `grid-cell`;
      if (!cellType) classes += ' cell-empty';
      if (isOver) classes += ' cell-over';
      return classes;
    };

    const getAriaLabel = () => {
      const typeLabels: Record<string, string> = {
        student: '学生席',
        teacher: '先生席',
        obstacle: '障害物',
        door: '出入り口'
      };
      const current = cellType ? typeLabels[cellType] || cellType : '空きスペース';
      return `席種切り替え: 座標 (${x}, ${y})、現在: ${current}`;
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onCycle(x, y);
      }
    };

    return (
      <div
        ref={setNodeRef}
        onClick={() => onCycle(x, y)}
        onKeyDown={handleKeyDown}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={getCellClassName()}
        title={cellType ? undefined : `座標: (${x}, ${y})`}
        style={{ position: 'relative' }}
        role="button"
        tabIndex={0}
        aria-label={getAriaLabel()}
      >
        {cellType && (
          <div className={`cell-item ${cellType}`}>
            {getIcon()}
          </div>
        )}
      </div>
    );
  }

  // 2. みんなの様子画面（モニターモード / massive=true）のレンダリング
  const getCellClassNameMassive = () => {
    let classes = `grid-cell cell-massive`;
    if (isEmptyRow) classes += ' cell-empty-row';
    if (isShrinkCol) classes += ' cell-shrink-col';
    if (!cellType) classes += ' cell-empty-space';
    return classes;
  };

  return (
    <div
      ref={setNodeRef}
      onClick={liveStatus && cellType === 'student' ? () => setIsDetailsOpen(true) : undefined}
      onKeyDown={liveStatus && cellType === 'student' ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setIsDetailsOpen(true);
        }
      } : undefined}
      role={liveStatus && cellType === 'student' ? 'button' : undefined}
      tabIndex={liveStatus && cellType === 'student' ? 0 : undefined}
      aria-label={liveStatus && cellType === 'student' ? `座席 ${coordKey} の詳細を表示` : undefined}
      title={liveStatus && cellType === 'student' ? `${liveStatus.name}（${liveStatus.studentId || '学籍番号不明'}）` : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={getCellClassNameMassive()}
      style={{ 
        position: 'relative',
        width: '100%',
        height: '100%',
        display: isEmptyRow ? 'none' : 'flex',
        border: isEmptyRow || !cellType ? 'none' : undefined,
      }}
    >
      {cellType && (
        <div className={`cell-item ${cellType} ${cellType === 'student' && liveStatus ? `student-live-${liveStatus.status}` : ''}`}>
          {cellType === 'student' && liveStatus ? (
            <>
              {/* Compact monitoring label; detailed identity is available on selection. */}
              <span className="monitor-seat-number" style={{
                fontSize: '1rem',
                fontWeight: 800,
                fontFamily: 'monospace',
                textAlign: 'center',
                lineHeight: 1,
                whiteSpace: 'nowrap',
              }}>
                {liveStatus.studentId ? liveStatus.studentId.slice(-2) : '--'}
              </span>

              {/* Individual Student Eviction (Kick) Button */}
              {onRemoveLiveStatus && isHovered && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`${liveStatus.name} さんをこの席から退室させますか？`)) {
                      onRemoveLiveStatus(coordKey);
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: '-6px',
                    right: '-6px',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    backgroundColor: '#ef4444',
                    color: '#ffffff',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    padding: 0,
                    zIndex: 10,
                    transition: 'background-color 0.2s',
                  }}
                  title="この席を空席にする"
                  aria-label={`${liveStatus.name} さんをこの席から退室させる`}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#dc2626';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#ef4444';
                  }}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
              )}
            </>
          ) : (
            getIcon()
          )}
        </div>
      )}
      {isDetailsOpen && liveStatus && cellType === 'student' && createPortal(
        <div
          onClick={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) setIsDetailsOpen(false);
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15, 23, 42, 0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="座席の詳細"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') setIsDetailsOpen(false);
            }}
            style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', borderRadius: '12px', padding: '1.5rem', width: 'min(100%, 320px)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <h3 style={{ margin: 0 }}>座席の詳細</h3>
            <div>氏名：{liveStatus.name}</div>
            <div>学籍番号：{liveStatus.studentId || '不明'}</div>
            <div>座席：{coordKey}</div>
            <button type="button" autoFocus className="btn btn-secondary" onClick={() => setIsDetailsOpen(false)}>閉じる</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});

SeatCell.displayName = 'SeatCell';
