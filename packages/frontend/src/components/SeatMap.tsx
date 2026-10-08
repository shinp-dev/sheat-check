import React from 'react';
import { SeatCell } from './SeatCell';
import { GridItem, LiveSeatStatus } from '@my-app/shared';

interface SeatMapProps {
  grid: Record<string, GridItem['type']>;
  liveStatuses: Record<string, LiveSeatStatus>;
  onCycle: (x: number, y: number) => void;
  onRemoveLiveStatus?: (key: string) => void;
  massive?: boolean;
}

const isRowEmpty = (y: number, grid: Record<string, GridItem['type']>) => {
  if (!grid) return true;
  for (let x = 0; x < 12; x++) {
    if (grid[`${x},${y}`]) return false;
  }
  return true;
};

const shouldShrinkColumn = (
  x: number,
  grid: Record<string, GridItem['type']>,
  liveStatuses: Record<string, LiveSeatStatus>
) => {
  if (!grid) return true;
  for (let y = 0; y < 12; y++) {
    const cellType = grid[`${x},${y}`];
    if (!cellType) continue;
    if (cellType === 'teacher' || cellType === 'door' || cellType === 'student') {
      return false;
    }
  }
  return true;
};

export const SeatMap = React.memo(({ grid, liveStatuses, onCycle, onRemoveLiveStatus, massive = false }: SeatMapProps) => {
  if (massive) {
    // Keep the original seat coordinates and interior aisles, but stop drawing
    // unused columns beyond the rightmost physical classroom element.
    const visibleColumnCount = React.useMemo(() => {
      for (let x = 11; x >= 0; x--) {
        for (let y = 0; y < 12; y++) {
          if (grid?.[`${x},${y}`]) return x + 1;
        }
      }
      return 1;
    }, [grid]);

    const shrinkCols = React.useMemo(() => {
      return Array.from({ length: 12 }).map((_, x) => shouldShrinkColumn(x, grid, liveStatuses));
    }, [grid, liveStatuses]);

    const emptyRows = React.useMemo(() => {
      return Array.from({ length: 12 }).map((_, y) => isRowEmpty(y, grid));
    }, [grid]);

    const gridTemplateColumns = React.useMemo(() => {
      return shrinkCols
        .slice(0, visibleColumnCount)
        .map((isShrink) => isShrink ? '22px' : '60px')
        .join(' ');
    }, [shrinkCols, visibleColumnCount]);

    const gridTemplateRows = React.useMemo(() => {
      return emptyRows
        .map((isEmpty) => isEmpty ? '8px' : '44px')
        .join(' ');
    }, [emptyRows]);

    return (
      <div className="grid-container-card grid-massive-container" style={{ overflowX: 'auto', width: 'fit-content', maxWidth: '100%', boxSizing: 'border-box', alignSelf: 'flex-start' }}>
        <div
          className="monitor-seat-grid"
          style={{
            display: 'grid',
            gridTemplateColumns,
            gridTemplateRows,
            gap: '6px',
            width: 'max-content',
            margin: 0,
          }}
        >
          {Array.from({ length: 12 }).map((_, y) => {
            const isEmptyR = emptyRows[y];
            return Array.from({ length: visibleColumnCount }).map((_, x) => {
              const coordKey = `${x},${y}`;
              const cellType = grid ? grid[coordKey] : undefined;
              const liveStatus = liveStatuses ? liveStatuses[coordKey] : undefined;
              const isShrinkC = shrinkCols[x];

              return (
                <div
                  key={coordKey}
                  style={{
                    gridColumnStart: x + 1,
                    gridRowStart: y + 1,
                    height: isEmptyR ? '8px' : '44px',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                >
                  <SeatCell
                    x={x}
                    y={y}
                    cellType={cellType}
                    liveStatus={liveStatus}
                    onCycle={onCycle}
                    onRemoveLiveStatus={onRemoveLiveStatus}
                    massive={true}
                    isEmptyRow={isEmptyR}
                    isShrinkCol={isShrinkC}
                  />
                </div>
              );
            });
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="grid-container-card" style={{ overflowX: 'auto', width: '100%' }}>
      <table 
        className="seat-map-table" 
        style={{ 
          borderCollapse: 'separate', 
          borderSpacing: '6px', 
          width: 'auto', 
          margin: '0 auto' 
        }}
      >
        <tbody>
          {Array.from({ length: 12 }).map((_, y) => (
            <tr key={`row-${y}`}>
              {Array.from({ length: 12 }).map((_, x) => {
                const coordKey = `${x},${y}`;
                const cellType = grid ? grid[coordKey] : undefined;
                const liveStatus = liveStatuses ? liveStatuses[coordKey] : undefined;
                return (
                  <td key={coordKey} style={{ padding: 0, border: 'none' }}>
                    <SeatCell
                      x={x}
                      y={y}
                      cellType={cellType}
                      liveStatus={liveStatus}
                      onCycle={onCycle}
                      onRemoveLiveStatus={onRemoveLiveStatus}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

SeatMap.displayName = 'SeatMap';
