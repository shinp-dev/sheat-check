import React from 'react';
import { 
  DndContext, 
  useDraggable, 
  DragEndEvent 
} from '@dnd-kit/core';
import { 
  User, 
  GraduationCap, 
  XCircle, 
  DoorOpen, 
  Plus, 
  Trash2, 
  FolderOpen, 
  RefreshCw, 
  Lightbulb
} from 'lucide-react';
import { GridItem, LiveSeatStatus, RealtimeLog } from '@my-app/shared';
import { SeatMap } from '../components/SeatMap';
import { ControlPanel } from '../components/ControlPanel';

interface SavedRoom {
  id: string;
  name: string;
}

interface EditorCase {
  caseName: string;
  grid: Record<string, GridItem['type']>;
}

interface TeacherViewProps {
  roomName: string;
  setRoomName: (name: string) => void;
  onCreateNewSession: () => void;
  cases: EditorCase[];
  activeCaseIdx: number;
  setActiveCaseIdx: (idx: number) => void;
  onUpdateActiveCaseName: (name: string) => void;
  onAddNewCase: () => void;
  onDeleteCurrentCase: () => void;
  isLoadingRooms: boolean;
  savedRooms: SavedRoom[];
  roomId: string | null;
  onLoadClassroom: (id: string) => void;
  onFetchRooms: () => void;
  realtimeLogs: RealtimeLog[];
  isSeatLocked: boolean;
  onToggleSeatLock: () => void;
  onClearGrid: () => void;
  onBulkReset: () => void;
  onSaveClassroom: () => void;
  onDeleteClassroom: (id: string) => void;
  isSaving: boolean;
  onDragEnd: (event: DragEndEvent) => void;
  onCellCycle: (x: number, y: number) => void;
  liveStatuses: Record<string, LiveSeatStatus>;
  mode?: 'layout' | 'monitor';
}

const PALETTE_ITEMS = [
  { type: 'student' as const, name: 'みんなの席', icon: User, colorClass: 'student' },
  { type: 'teacher' as const, name: '教卓', icon: GraduationCap, colorClass: 'teacher' },
  { type: 'obstacle' as const, name: '空き', icon: XCircle, colorClass: 'obstacle' },
  { type: 'door' as const, name: '出入り口', icon: DoorOpen, colorClass: 'door' },
];

/* ==========================================================================
   Draggable Palette Component
   ========================================================================== */
function DraggablePaletteItem({ 
  type, 
  name, 
  icon: Icon, 
  colorClass 
}: { 
  type: GridItem['type']; 
  name: string; 
  icon: any; 
  colorClass: string;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `palette-${type}`,
    data: { type },
  });

  const style: React.CSSProperties = {
    opacity: isDragging ? 0.5 : 1,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 100 : 'auto',
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="palette-item"
      {...listeners}
      {...attributes}
    >
      <div className={`palette-color-indicator ${colorClass}`} />
      <Icon size={18} />
      <span className="palette-name">{name}</span>
    </div>
  );
}

export const TeacherView: React.FC<TeacherViewProps> = React.memo(({
  roomName,
  setRoomName,
  onCreateNewSession,
  cases,
  activeCaseIdx,
  setActiveCaseIdx,
  onUpdateActiveCaseName,
  onAddNewCase,
  onDeleteCurrentCase,
  isLoadingRooms,
  savedRooms,
  roomId,
  onLoadClassroom,
  onFetchRooms,
  realtimeLogs,
  isSeatLocked,
  onToggleSeatLock,
  onClearGrid,
  onBulkReset,
  onSaveClassroom,
  onDeleteClassroom,
  isSaving,
  onDragEnd,
  onCellCycle,
  liveStatuses,
  mode = 'layout',
}) => {
  return (
    <main className={`main-content${mode === 'layout' ? ' layout-main-content' : ''}`}>
      
      {/* Left Control Sidebar - Only in layout mode */}
      {mode === 'layout' && (
      <div className="sidebar">
        
        {/* Unified "Room Selection & Management" Card */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h2 className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FolderOpen size={18} /> 講義室の選択・管理
            </span>
            <button 
              onClick={onFetchRooms}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '0.25rem',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
              }}
              title="講義室リストを更新"
              onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
            >
              <RefreshCw size={14} className={isLoadingRooms ? 'animate-spin' : ''} />
            </button>
          </h2>

          {/* 1. Current Classroom Name & Storage Status */}
          <div className="input-group" style={{ marginBottom: '0.15rem' }}>
            <label className="input-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>教室名 (Room Name)</span>
              {roomId ? (
                <span style={{ fontSize: '0.7rem', color: '#10b981', background: 'rgba(16, 185, 129, 0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 'bold' }}>
                  保存済み
                </span>
              ) : (
                <span style={{ fontSize: '0.7rem', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 'bold' }}>
                  新規(未保存)
                </span>
              )}
            </label>
            <input
              type="text"
              className="text-input"
              placeholder="例: 一般講義室 301"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
            />
          </div>

          {/* 2. New Classroom Design Action */}
          <button 
            className="btn btn-secondary" 
            style={{ 
              width: '100%', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              gap: '0.5rem',
              padding: '0.5rem',
              fontSize: '0.85rem'
            }}
            onClick={onCreateNewSession}
          >
            <Plus size={15} /> 新規デザイン開始
          </button>

          {/* Subtle horizontal separator */}
          <div style={{ height: '1px', background: 'var(--border-color)', margin: '0.15rem 0' }} />

          {/* 3. Saved Classrooms Quick Switch List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <FolderOpen size={14} /> 保存済み講義室リスト
            </span>

            {isLoadingRooms ? (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
                読み込み中...
              </p>
            ) : savedRooms.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
                保存された教室はありません
              </p>
            ) : (
              <div className="room-list-container" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                {savedRooms.map((room) => (
                  <div
                    key={room.id}
                    className={`room-item-wrapper ${roomId === room.id ? 'selected' : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      background: roomId === room.id ? 'rgba(99, 102, 241, 0.12)' : 'rgba(255, 255, 255, 0.02)',
                      border: roomId === room.id ? '1px solid var(--color-student)' : '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '0.15rem 0.4rem',
                      marginBottom: '0.4rem',
                      gap: '0.4rem',
                    }}
                  >
                    <button
                      onClick={() => onLoadClassroom(room.id)}
                      style={{
                        flex: 1,
                        background: 'none',
                        border: 'none',
                        textAlign: 'left',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        padding: '0.4rem 0.2rem',
                        fontSize: '0.85rem',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {room.name}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteClassroom(room.id);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-obstacle)',
                        cursor: 'pointer',
                        padding: '0.4rem',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background-color 0.2s',
                      }}
                      title="講義室を物理削除"
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
      )}

      {/* Right Editor Canvas */}
      <DndContext onDragEnd={onDragEnd}>
        <div className="workspace">
          
          {/* Editor Action Bar */}
          <ControlPanel
            roomName={roomName}
            caseName={cases[activeCaseIdx]?.caseName}
            roomId={roomId}
            isSeatLocked={isSeatLocked}
            onToggleSeatLock={onToggleSeatLock}
            onClearGrid={onClearGrid}
            onBulkReset={onBulkReset}
            onSaveClassroom={onSaveClassroom}
            isSaving={isSaving}
            mode={mode}
          />

          {/* Editor Panel Split */}
          <div className="editor-grid-layout">
            
            {/* Left Item Palette */}
            {mode === 'layout' && (
            <div className="palette">
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Lightbulb size={14} /> <span>アイテムをマス目へドラッグ＆ドロップ、または直接クリックして配置してください。</span>
              </p>
              {PALETTE_ITEMS.map((item) => (
                <DraggablePaletteItem
                  key={item.type}
                  type={item.type}
                  name={item.name}
                  icon={item.icon}
                  colorClass={item.colorClass}
                />
              ))}
            </div>
            )}

            {/* Right Interactive 12x12 CSS Grid (Now Overlaying realtime status) */}
            <SeatMap
              grid={cases[activeCaseIdx]?.grid}
              liveStatuses={liveStatuses}
              onCycle={mode === 'monitor' ? () => {} : onCellCycle}
              massive={mode === 'monitor'}
            />

          </div>

        </div>
      </DndContext>

    </main>
  );
});

TeacherView.displayName = 'TeacherView';
