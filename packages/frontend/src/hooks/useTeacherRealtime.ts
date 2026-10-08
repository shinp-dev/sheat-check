import { useState, useEffect, useRef, useCallback } from 'react';
import { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { RealtimeLog, LiveSeatStatus } from '@my-app/shared';
import { playAlertSound } from '../lib/audio';
import { createAuthorizedPrivateChannel } from '../lib/realtimeChannel';
import { logRealtimeFailure, toSafeRealtimeError, type RealtimeErrorCode } from '../lib/realtimeDiagnostics';

interface UseTeacherRealtimeProps {
  supabase: SupabaseClient | null;
  realtimeToken: string;
  roomId: string | null;
  isSeatLocked: boolean;
  setLiveStatuses: React.Dispatch<React.SetStateAction<Record<string, LiveSeatStatus>>>;
  addToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

export function useTeacherRealtime({
  supabase,
  realtimeToken,
  roomId,
  isSeatLocked,
  setLiveStatuses,
  addToast
}: UseTeacherRealtimeProps) {
  const [realtimeLogs, setRealtimeLogs] = useState<RealtimeLog[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const teacherChannelRef = useRef<RealtimeChannel | null>(null);
  const teacherInboxRef = useRef<RealtimeChannel | null>(null);
  const reconnectTimeoutRef = useRef<any>(null);
  const inboxReconnectTimeoutRef = useRef<any>(null);

  const isSeatLockedRef = useRef(isSeatLocked);
  const addToastRef = useRef(addToast);
  const networkOnlineRef = useRef(typeof navigator === 'undefined' ? true : navigator.onLine);
  const mainSubscribedRef = useRef(false);
  const inboxSubscribedRef = useRef(false);

  useEffect(() => { isSeatLockedRef.current = isSeatLocked; }, [isSeatLocked]);
  useEffect(() => { addToastRef.current = addToast; }, [addToast]);

  const updateRealtimeOnlineState = useCallback(() => {
    setIsOnline(networkOnlineRef.current && mainSubscribedRef.current && inboxSubscribedRef.current);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      networkOnlineRef.current = true;
      updateRealtimeOnlineState();
      addToastRef.current('success', 'ネットワークに再接続しました');
    };
    const handleOffline = () => {
      networkOnlineRef.current = false;
      setIsOnline(false);
      addToastRef.current('error', 'ネットワーク接続が切れました。オフライン動作中...');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [updateRealtimeOnlineState]);

  // Comments are an in-memory, append-only feed for the active room (until explicit reset).
  useEffect(() => {
    setRealtimeLogs([]);
  }, [roomId]);

  useEffect(() => {
    if (teacherChannelRef.current) {
      teacherChannelRef.current.unsubscribe();
      teacherChannelRef.current = null;
    }
    if (teacherInboxRef.current) {
      teacherInboxRef.current.unsubscribe();
      teacherInboxRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (inboxReconnectTimeoutRef.current) {
      clearTimeout(inboxReconnectTimeoutRef.current);
      inboxReconnectTimeoutRef.current = null;
    }

    mainSubscribedRef.current = false;
    inboxSubscribedRef.current = false;
    setIsOnline(false);

    if (!supabase || !roomId || !realtimeToken) return;
    const realtimeClient = supabase;
    let cancelled = false;

    const removeChannel = async (channel: RealtimeChannel) => {
      try {
        await realtimeClient.removeChannel(channel);
      } catch (err) {
        console.warn('[Teacher] Failed to remove Realtime channel:', toSafeRealtimeError(err));
      }
    };

    const clearMainReconnectTimer = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    const clearInboxReconnectTimer = () => {
      if (inboxReconnectTimeoutRef.current) {
        clearTimeout(inboxReconnectTimeoutRef.current);
        inboxReconnectTimeoutRef.current = null;
      }
    };

    const handleStudentResponse = (response: { payload: any }) => {
        const payload = response.payload;
        if (payload && payload.seatId && (payload.kind === 'comment' || payload.status)) {
          const isComment = payload.kind === 'comment';
          const receivedAt = new Date().toLocaleTimeString('ja-JP');
          if (!isComment) setLiveStatuses((prev) => {
            const nextStatuses = { ...prev };
            if (payload.status === 'none') {
              delete nextStatuses[payload.seatId];
            } else {
              nextStatuses[payload.seatId] = {
                status: payload.status,
                name: payload.studentName || '匿名',
                studentId: payload.studentId || '不明',
                comment: payload.comment || undefined,
                answeredAt: receivedAt,
              };
            }
            return nextStatuses;
          });

          // A seat change or disconnect must not erase previously received comments.
          // Anonymous and named posts are separate messages, even from the same seat.
          if (typeof payload.comment === 'string' && payload.comment.trim()) {
            const logItem: RealtimeLog = {
              id: crypto.randomUUID(),
              studentName: payload.anonymous ? '匿名' : (payload.studentName || '匿名'),
              studentId: payload.anonymous ? undefined : (payload.studentId || '不明'),
              seatId: payload.seatId,
              comment: payload.comment,
              timestamp: receivedAt,
            };
            setRealtimeLogs((prev) => [logItem, ...prev]);
          }

          if (!isComment && payload.status === 'ng') {
            playAlertSound();
          }
        }
    };

    const handleMainStatus = (channel: RealtimeChannel, status: string, err?: Error) => {
      if (cancelled || teacherChannelRef.current !== channel) return;
      if (status === 'SUBSCRIBED') {
        clearMainReconnectTimer();
        mainSubscribedRef.current = true;
        updateRealtimeOnlineState();
        console.log(`[Teacher] Successfully subscribed to channel: ${roomId}`);
        void channel.send({
          type: 'broadcast',
          event: 'teacher_lock_state',
          payload: { locked: isSeatLockedRef.current },
        });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        mainSubscribedRef.current = false;
        updateRealtimeOnlineState();
        logRealtimeFailure('RT-T-MAIN-01', roomId, 'teacher-main', status, err);
        clearMainReconnectTimer();
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          void retryMainChannel(channel);
        }, 10000);
      }
    };

    const handleInboxStatus = (inbox: RealtimeChannel, status: string, err?: Error) => {
      if (cancelled || teacherInboxRef.current !== inbox) return;
      if (status === 'SUBSCRIBED') {
        clearInboxReconnectTimer();
        inboxSubscribedRef.current = true;
        updateRealtimeOnlineState();
        console.log(`[Teacher] Successfully subscribed to answer inbox: ${roomId}`);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        inboxSubscribedRef.current = false;
        updateRealtimeOnlineState();
        logRealtimeFailure('RT-T-INBOX-01', roomId, 'teacher-inbox', status, err);
        addToastRef.current('error', '学生回答の受信Channelに接続できません。Realtime設定と認可を確認してください。（エラーコード: RT-T-INBOX-01）');
        clearInboxReconnectTimer();
        inboxReconnectTimeoutRef.current = setTimeout(() => {
          inboxReconnectTimeoutRef.current = null;
          void retryInboxChannel(inbox);
        }, 10000);
      }
    };

    const subscribeMainChannel = (channel: RealtimeChannel) => {
      teacherChannelRef.current = channel;
      channel.subscribe((status, err) => handleMainStatus(channel, status, err));
    };

    const subscribeInboxChannel = (inbox: RealtimeChannel) => {
      inbox.on('broadcast', { event: 'student_to_teacher' }, handleStudentResponse);
      teacherInboxRef.current = inbox;
      inbox.subscribe((status, err) => handleInboxStatus(inbox, status, err));
    };

    const reportAuthorizationFailure = (
      code: RealtimeErrorCode,
      channel: 'teacher-main' | 'teacher-inbox',
      err: unknown,
    ) => {
      mainSubscribedRef.current = false;
      inboxSubscribedRef.current = false;
      setIsOnline(false);
      logRealtimeFailure(code, roomId, channel, 'AUTHORIZATION_ERROR', err);
      addToastRef.current('error', `リアルタイム認証に失敗しました。再ログインしてください。（エラーコード: ${code}）`);
    };

    async function retryMainChannel(failedChannel: RealtimeChannel) {
      if (cancelled || teacherChannelRef.current !== failedChannel) return;
      teacherChannelRef.current = null;
      await removeChannel(failedChannel);
      if (cancelled) return;
      try {
        const replacement = await createAuthorizedPrivateChannel(realtimeClient, realtimeToken, `room:${roomId}`);
        if (cancelled) {
          await removeChannel(replacement);
          return;
        }
        subscribeMainChannel(replacement);
      } catch (err) {
        if (!cancelled) reportAuthorizationFailure('RT-T-MAIN-01', 'teacher-main', err);
      }
    }

    async function retryInboxChannel(failedInbox: RealtimeChannel) {
      if (cancelled || teacherInboxRef.current !== failedInbox) return;
      teacherInboxRef.current = null;
      await removeChannel(failedInbox);
      if (cancelled) return;
      try {
        const replacement = await createAuthorizedPrivateChannel(realtimeClient, realtimeToken, `room:${roomId}:teacher`);
        if (cancelled) {
          await removeChannel(replacement);
          return;
        }
        subscribeInboxChannel(replacement);
      } catch (err) {
        if (!cancelled) reportAuthorizationFailure('RT-T-INBOX-01', 'teacher-inbox', err);
      }
    }

    void (async () => {
      let channel: RealtimeChannel | null = null;
      let inbox: RealtimeChannel | null = null;
      let initializationCode: RealtimeErrorCode = 'RT-T-MAIN-01';
      let initializationChannel: 'teacher-main' | 'teacher-inbox' = 'teacher-main';
      try {
        channel = await createAuthorizedPrivateChannel(realtimeClient, realtimeToken, `room:${roomId}`);
        if (cancelled) {
          await removeChannel(channel);
          return;
        }
        initializationCode = 'RT-T-INBOX-01';
        initializationChannel = 'teacher-inbox';
        inbox = await createAuthorizedPrivateChannel(realtimeClient, realtimeToken, `room:${roomId}:teacher`);
        if (cancelled) {
          await Promise.all([removeChannel(channel), removeChannel(inbox)]);
          return;
        }

        subscribeInboxChannel(inbox);
        subscribeMainChannel(channel);
      } catch (err) {
        await Promise.all([channel, inbox].filter((item): item is RealtimeChannel => item !== null).map(removeChannel));
        if (!cancelled) reportAuthorizationFailure(initializationCode, initializationChannel, err);
      }
    })();

    return () => {
      cancelled = true;
      clearMainReconnectTimer();
      clearInboxReconnectTimer();
      const channel = teacherChannelRef.current;
      const inbox = teacherInboxRef.current;
      teacherChannelRef.current = null;
      teacherInboxRef.current = null;
      if (channel) void removeChannel(channel);
      if (inbox) void removeChannel(inbox);
    };
  }, [supabase, roomId, realtimeToken, setLiveStatuses, updateRealtimeOnlineState]);

  const sendTeacherResetBroadcast = useCallback(async (): Promise<'ok' | 'error'> => {
    const channel = teacherChannelRef.current;
    if (!channel) return 'error';

    try {
      const res = await channel.send({
        type: 'broadcast',
        event: 'teacher_reset',
        payload: { timestamp: new Date().toISOString() },
      });
      if (res === 'ok') {
        setRealtimeLogs([]);
      }
      return res === 'ok' ? 'ok' : 'error';
    } catch (err) {
      console.error('Failed to send teacher reset:', err);
      return 'error';
    }
  }, []);

  const sendStudentEvictedBroadcast = useCallback(async (seatId: string): Promise<'ok' | 'error'> => {
    const channel = teacherChannelRef.current;
    if (!channel) return 'error';

    try {
      const res = await channel.send({
        type: 'broadcast',
        event: 'student_evicted',
        payload: { seatId, timestamp: new Date().toISOString() },
      });
      return res === 'ok' ? 'ok' : 'error';
    } catch (err) {
      console.error('Failed to send student evicted broadcast:', err);
      return 'error';
    }
  }, []);

  const sendTeacherLockStateBroadcast = useCallback(async (locked: boolean): Promise<'ok' | 'error'> => {
    const channel = teacherChannelRef.current;
    if (!channel) return 'error';

    try {
      const res = await channel.send({
        type: 'broadcast',
        event: 'teacher_lock_state',
        payload: { locked },
      });
      return res === 'ok' ? 'ok' : 'error';
    } catch (err) {
      console.error('Failed to send teacher lock state:', err);
      return 'error';
    }
  }, []);

  const sendRoomLayoutUpdatedBroadcast = useCallback(async (): Promise<'ok' | 'error'> => {
    const channel = teacherChannelRef.current;
    if (!channel) return 'error';

    try {
      const res = await channel.send({
        type: 'broadcast',
        event: 'room_layout_updated',
        payload: { timestamp: new Date().toISOString() },
      });
      return res === 'ok' ? 'ok' : 'error';
    } catch (err) {
      console.error('Failed to send room layout updated broadcast:', err);
      return 'error';
    }
  }, []);

  return {
    realtimeLogs,
    setRealtimeLogs,
    isOnline,
    sendTeacherResetBroadcast,
    sendStudentEvictedBroadcast,
    sendTeacherLockStateBroadcast,
    sendRoomLayoutUpdatedBroadcast
  };
}
