import { useState, useEffect, useRef, useCallback } from 'react';
import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import type { StudentEventInput } from '@my-app/shared';
import { createAuthorizedPrivateChannel } from '../lib/realtimeChannel';
import { logRealtimeFailure, toSafeRealtimeError } from '../lib/realtimeDiagnostics';
import { extractErrorCode, readResponseBody } from '../lib/apiResponse';
import { studentSession } from '../lib/storage';
import { fingerprintClaimToken } from '../lib/studentSeatApi';

interface UseStudentRealtimeProps {
  supabase: SupabaseClient | null;
  studentClassroomId: string;
  studentToken: string;
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
  onTeacherReset: () => void;
  onTeacherEvict: (seatId: string) => void;
  onTeacherLockState: (locked: boolean) => void;
  onRoomLayoutUpdated: () => void;
}

interface StudentEventSendOptions {
  keepalive?: boolean;
}

const buildApiUrl = (path: string) => {
  const baseUrl = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  return `${baseUrl}/${path.replace(/^\/+/, '')}`;
};

export function useStudentRealtime({
  supabase,
  studentClassroomId,
  studentToken,
  addToast,
  onTeacherReset,
  onTeacherEvict,
  onTeacherLockState,
  onRoomLayoutUpdated
}: UseStudentRealtimeProps) {
  const [isFallbackActive, setIsFallbackActive] = useState(false);
  const studentChannelRef = useRef<RealtimeChannel | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addToastRef = useRef(addToast);
  const onTeacherResetRef = useRef(onTeacherReset);
  const onTeacherEvictRef = useRef(onTeacherEvict);
  const onTeacherLockStateRef = useRef(onTeacherLockState);
  const onRoomLayoutUpdatedRef = useRef(onRoomLayoutUpdated);

  useEffect(() => { addToastRef.current = addToast; }, [addToast]);
  useEffect(() => { onTeacherResetRef.current = onTeacherReset; }, [onTeacherReset]);
  useEffect(() => { onTeacherEvictRef.current = onTeacherEvict; }, [onTeacherEvict]);
  useEffect(() => { onTeacherLockStateRef.current = onTeacherLockState; }, [onTeacherLockState]);
  useEffect(() => { onRoomLayoutUpdatedRef.current = onRoomLayoutUpdated; }, [onRoomLayoutUpdated]);

  // HTTP Fallback Auto-Polling
  useEffect(() => {
    if (!isFallbackActive || !studentClassroomId) return;

    let timer: any;
    const pollClassroom = async () => {
      try {
        const res = await fetch(buildApiUrl(`/api/rooms/${encodeURIComponent(studentClassroomId)}`));
        if (res.ok) {
          const data = await res.json();
          if (data && onRoomLayoutUpdatedRef.current) {
            onRoomLayoutUpdatedRef.current();
          }
        }
      } catch (err) {
        console.warn('HTTP Fallback polling failed:', err);
      }
    };

    timer = setInterval(pollClassroom, 7000);
    return () => clearInterval(timer);
  }, [isFallbackActive, studentClassroomId]);

  // Student Realtime Subscription
  useEffect(() => {
    if (studentChannelRef.current) {
      studentChannelRef.current.unsubscribe();
      studentChannelRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (!supabase || !studentClassroomId.trim() || !studentToken) return;
    let cancelled = false;

    const removeChannel = async (channel: RealtimeChannel) => {
      try {
        await supabase.removeChannel(channel);
      } catch (err) {
        console.warn('[Student] Failed to remove Realtime channel:', toSafeRealtimeError(err));
      }
    };

    const clearReconnectTimer = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const handleStatus = (channel: RealtimeChannel, status: string, err?: Error) => {
      if (cancelled || studentChannelRef.current !== channel) return;
      if (status === 'SUBSCRIBED') {
        clearReconnectTimer();
        setIsFallbackActive(false);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        logRealtimeFailure('RT-S-CHANNEL-01', studentClassroomId, 'student', status, err);
        setIsFallbackActive(true);
        addToastRef.current('warning', 'リアルタイム接続に失敗しました。教室の接続設定に問題がある可能性があります。教員に確認してください。バックアップの自動同期へ移行しました。（エラーコード: RT-S-CHANNEL-01）');
        clearReconnectTimer();
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          void retrySubscription(channel);
        }, 10000);
      }
    };

    const subscribeChannel = (channel: RealtimeChannel) => {
      channel
        .on('broadcast', { event: 'teacher_reset' }, () => {
          onTeacherResetRef.current();
        })
        .on('broadcast', { event: 'student_evicted' }, (response) => {
          const seatId = response.payload?.seatId;
          const expectedTag = response.payload?.evictedClaimTag;
          const savedToken = studentSession.getSeatClaimToken(studentClassroomId);
          if (typeof seatId !== 'string' || typeof expectedTag !== 'string' || !savedToken) return;
          void fingerprintClaimToken(savedToken).then((actualTag) => {
            if (!cancelled && actualTag === expectedTag) onTeacherEvictRef.current(seatId);
          }).catch(() => {
            console.warn('[Student] Could not verify an eviction event');
          });
        })
        .on('broadcast', { event: 'teacher_lock_state' }, (response) => {
          if (response.payload && typeof response.payload.locked === 'boolean') {
            onTeacherLockStateRef.current(response.payload.locked);
          }
        })
        .on('broadcast', { event: 'room_layout_updated' }, () => {
          onRoomLayoutUpdatedRef.current();
        });

      studentChannelRef.current = channel;
      channel.subscribe((status, err) => handleStatus(channel, status, err));
    };

    const startSubscription = async () => {
      try {
        const channel = await createAuthorizedPrivateChannel(supabase, studentToken, `room:${studentClassroomId}`);
        if (cancelled) {
          await removeChannel(channel);
          return;
        }
        subscribeChannel(channel);
      } catch (err) {
        if (cancelled) return;
        logRealtimeFailure('RT-S-CHANNEL-01', studentClassroomId, 'student', 'AUTHORIZATION_ERROR', err);
        setIsFallbackActive(true);
        addToastRef.current('warning', 'リアルタイム認証に失敗しました。画面を再読み込みして再度入室してください。（エラーコード: RT-S-CHANNEL-01）');
      }
    };

    async function retrySubscription(failedChannel: RealtimeChannel) {
      if (cancelled || studentChannelRef.current !== failedChannel) return;
      studentChannelRef.current = null;
      await removeChannel(failedChannel);
      if (!cancelled) await startSubscription();
    }

    void startSubscription();

    return () => {
      cancelled = true;
      clearReconnectTimer();
      const channel = studentChannelRef.current;
      studentChannelRef.current = null;
      if (channel) void removeChannel(channel);
    };
  }, [supabase, studentClassroomId, studentToken]);

  const sendStudentEvent = useCallback(async (
    payload: StudentEventInput,
    options?: StudentEventSendOptions,
  ): Promise<'ok' | 'error'> => {
    if (!studentToken || !studentClassroomId) return 'error';
    const claimToken = studentSession.getSeatClaimToken(studentClassroomId);
    if (!claimToken) {
      addToastRef.current('error', '座席を選択し直してください。');
      return 'error';
    }

    try {
      const res = await fetch(buildApiUrl(`/api/rooms/${encodeURIComponent(studentClassroomId)}/student-event`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${studentToken}`, 'X-Seat-Claim': claimToken },
        body: JSON.stringify(payload),
        ...(options?.keepalive ? { keepalive: true } : {}),
      });
      if (res.ok) return 'ok';
      const code = extractErrorCode(await readResponseBody(res));
      if (res.status === 403) {
        addToastRef.current('error', '座席の登録が解除されています。再読み込みして座席を選び直してください。');
      } else if (code) {
        addToastRef.current('error', `回答を送信できませんでした。再送してください。（エラーコード: ${code}）`);
      }
      return 'error';
    } catch (err) {
      console.error('Failed to send student broadcast:', err);
      return 'error';
    }
  }, [studentClassroomId, studentToken]);

  const sendStudentToTeacherBroadcast = useCallback((
    seatId: string,
    status: 'ok' | 'ng' | 'none',
    _studentName: string,
    _studentId: string,
    comment?: string | null,
    options?: StudentEventSendOptions,
    anonymous = false,
  ) => sendStudentEvent({ seatId, status, comment: comment || null, anonymous }, options), [sendStudentEvent]);

  const sendStudentCommentBroadcast = useCallback((seatId: string, comment: string, anonymous = false) => {
    const text = comment.trim();
    if (!text || text.length > 1000) return Promise.resolve('error' as const);
    return sendStudentEvent({ kind: 'comment', seatId, comment: text, anonymous });
  }, [sendStudentEvent]);

  return {
    isFallbackActive,
    sendStudentToTeacherBroadcast,
    sendStudentCommentBroadcast,
  };
}
