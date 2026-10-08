import { useState, useCallback, useEffect } from 'react';
import { DragEndEvent } from '@dnd-kit/core';
import { useRoomLayout } from './useRoomLayout';
import { useSeatManager } from './useSeatManager';
import { useSupabaseClient } from './useSupabaseClient';
import { useTeacherRealtime } from './useTeacherRealtime';
import { GridItem, LiveSeatStatus } from '@my-app/shared';
import { useToast } from '../contexts/ToastContext';
import { teacherAuth, activeRoom } from '../lib/storage';
import client from '../lib/hc';

/**
 * Facade hook that combines useRoomLayout + useSeatManager + useRealtimeSession
 * into a single interface for Teacher pages.
 *
 * This eliminates the ~60 lines of duplicated wiring code that was
 * previously copy-pasted between TeacherLayoutPage and TeacherMonitorPage.
 */
export function useTeacherSession() {
  const { addToast } = useToast();

  const [teacherToken] = useState(() => teacherAuth.getSupabaseToken());

  const { supabase } = useSupabaseClient(teacherToken);

  // ── Room layout management ──
  const roomLayout = useRoomLayout({
    addToast,
    onClearLiveStatuses: () => seatManager.setLiveStatuses({} as Record<string, LiveSeatStatus>),
  });

  // ── Seat status management ──
  const seatManager = useSeatManager({
    roomId: roomLayout.roomId,
    addToast,
  });

  // ── Realtime session (Supabase channels) ──
  const realtimeSession = useTeacherRealtime({
    supabase,
    realtimeToken: teacherToken,
    roomId: roomLayout.roomId,
    isSeatLocked: seatManager.isSeatLocked,
    setLiveStatuses: seatManager.setLiveStatuses,
    addToast,
  });

  // ── Auto-restore active room ID across navigation ──
  useEffect(() => {
    if (!roomLayout.roomId && roomLayout.savedRooms.length > 0) {
      const savedActiveRoomId = activeRoom.getId();
      if (savedActiveRoomId && roomLayout.savedRooms.some(r => r.id === savedActiveRoomId)) {
        roomLayout.loadClassroom(savedActiveRoomId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomLayout.roomId, roomLayout.savedRooms]);

  // ── Composed action handlers ──
  const handleRemoveLiveStatus = useCallback(async (key: string): Promise<boolean> => {
    if (!roomLayout.roomId) return false;
    const displacedStudentId = seatManager.liveStatuses[key]?.studentId;
    try {
      const response = await client.api.rooms[':id'].seats[':seatId'].$delete({
        param: { id: roomLayout.roomId, seatId: key },
      });
      if (!response.ok) {
        addToast('error', '席を空けられませんでした。再試行してください。');
        return false;
      }
      seatManager.removeLiveStatus(key);
      if (displacedStudentId) await realtimeSession.sendStudentEvictedBroadcast(key, displacedStudentId);
      addToast('success', '席を空けました。');
      return true;
    } catch {
      addToast('error', '通信エラーで席を空けられませんでした。');
      return false;
    }
  }, [roomLayout.roomId, seatManager.liveStatuses, seatManager.removeLiveStatus, realtimeSession.sendStudentEvictedBroadcast, addToast]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !active) return;

    const dragType = active.data.current?.type as GridItem['type'];
    const { x, y } = over.data.current as { x: number; y: number };

    if (dragType && typeof x === 'number' && typeof y === 'number') {
      roomLayout.updateGridCell(x, y, dragType, handleRemoveLiveStatus);
    }
  }, [roomLayout.updateGridCell, handleRemoveLiveStatus]);

  const handleCellCycle = useCallback((x: number, y: number) => {
    const currentGrid = roomLayout.cases[roomLayout.activeCaseIdx]?.grid || {};
    const key = `${x},${y}`;
    const current = currentGrid[key];

    let next: GridItem['type'] | undefined;
    if (!current) next = 'student';
    else if (current === 'student') next = 'teacher';
    else if (current === 'teacher') next = 'obstacle';
    else if (current === 'obstacle') next = 'door';
    else next = undefined;

    roomLayout.updateGridCell(x, y, next, handleRemoveLiveStatus);
  }, [roomLayout.cases, roomLayout.activeCaseIdx, roomLayout.updateGridCell, handleRemoveLiveStatus]);

  const handleBulkReset = useCallback(() => {
    const ok = seatManager.bulkResetLiveStatuses();
    if (ok) {
      realtimeSession.sendTeacherResetBroadcast();
    }
    return ok;
  }, [seatManager.bulkResetLiveStatuses, realtimeSession.sendTeacherResetBroadcast]);

  const handleToggleSeatLock = useCallback(() => {
    const nextLocked = seatManager.toggleSeatLock();
    realtimeSession.sendTeacherLockStateBroadcast(nextLocked);
    return nextLocked;
  }, [seatManager.toggleSeatLock, realtimeSession.sendTeacherLockStateBroadcast]);

  const handleSaveClassroom = useCallback(async () => {
    const saved = await roomLayout.saveClassroom();
    if (saved) {
      await realtimeSession.sendRoomLayoutUpdatedBroadcast();
    }
    return saved;
  }, [roomLayout.saveClassroom, realtimeSession.sendRoomLayoutUpdatedBroadcast]);

  return {
    supabase,

    // Room layout
    roomName: roomLayout.roomName,
    setRoomName: roomLayout.setRoomName,
    roomId: roomLayout.roomId,
    cases: roomLayout.cases,
    activeCaseIdx: roomLayout.activeCaseIdx,
    setActiveCaseIdx: roomLayout.setActiveCaseIdx,
    updateActiveCaseName: roomLayout.updateActiveCaseName,
    addNewCase: roomLayout.addNewCase,
    deleteCurrentCase: roomLayout.deleteCurrentCase,
    isLoadingRooms: roomLayout.isLoadingRooms,
    savedRooms: roomLayout.savedRooms,
    isSaving: roomLayout.isSaving,
    isActive: roomLayout.isActive,
    setIsActive: roomLayout.setIsActive,
    loadClassroom: roomLayout.loadClassroom,
    saveClassroom: handleSaveClassroom,
    createNewClassroomSession: roomLayout.createNewClassroomSession,
    fetchRooms: roomLayout.fetchRooms,
    clearCurrentGrid: roomLayout.clearCurrentGrid,
    deleteClassroom: roomLayout.deleteClassroom,

    // Seat manager
    liveStatuses: seatManager.liveStatuses,
    setLiveStatuses: seatManager.setLiveStatuses,
    isSeatLocked: seatManager.isSeatLocked,
    removeLiveStatus: handleRemoveLiveStatus,

    // Realtime
    realtimeLogs: realtimeSession.realtimeLogs,
    isOnline: realtimeSession.isOnline,

    // Composed actions
    handleDragEnd,
    handleCellCycle,
    handleBulkReset,
    handleToggleSeatLock,
  };
}
