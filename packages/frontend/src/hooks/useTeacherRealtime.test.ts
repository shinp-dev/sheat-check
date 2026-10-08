// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dispatch, SetStateAction } from 'react';
import type { LiveSeatStatus } from '@my-app/shared';
import { useTeacherRealtime } from './useTeacherRealtime';

describe('useTeacherRealtime authorization and Teacher events', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('joins private authorized channels and sends the four Teacher control events', async () => {
    const mainSend = vi.fn().mockResolvedValue('ok');
    const makeChannel = (send = vi.fn().mockResolvedValue('ok')) => {
      const channel: any = {
        on: vi.fn(() => channel),
        subscribe: vi.fn((callback?: (status: string) => void) => {
          callback?.('SUBSCRIBED');
          return channel;
        }),
        send,
        unsubscribe: vi.fn(),
      };
      return channel;
    };
    const mainChannel = makeChannel(mainSend);
    const inboxChannel = makeChannel();
    const supabase: any = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn((topic: string) => topic.endsWith(':teacher') ? inboxChannel : mainChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };
    const setLiveStatuses = vi.fn();
    const addToast = vi.fn();

    const { result } = renderHook(() => useTeacherRealtime({
      supabase,
      realtimeToken: 'teacher-realtime-jwt',
      roomId: 'room-1',
      isSeatLocked: false,
      setLiveStatuses,
      addToast,
    }));

    await waitFor(() => expect(supabase.channel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isOnline).toBe(true));
    expect(supabase.realtime.setAuth).toHaveBeenCalledWith('teacher-realtime-jwt');
    expect(supabase.channel).toHaveBeenCalledWith('room:room-1', expect.objectContaining({ config: expect.objectContaining({ private: true }) }));

    await act(async () => {
      await result.current.sendTeacherResetBroadcast();
      await result.current.sendStudentEvictedBroadcast('1,1', 'STU001');
      await result.current.sendTeacherLockStateBroadcast(true);
      await result.current.sendRoomLayoutUpdatedBroadcast();
    });

    const events = mainSend.mock.calls.map(([message]) => message.event);
    expect(events).toEqual(expect.arrayContaining([
      'teacher_reset',
      'student_evicted',
      'teacher_lock_state',
      'room_layout_updated',
    ]));
  });

  it.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])(
    'keeps Realtime offline and reports an answer inbox %s',
    async (inboxStatus) => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const makeChannel = (status: string) => {
        const channel: any = {
          on: vi.fn(() => channel),
          subscribe: vi.fn((callback?: (value: string, error?: Error) => void) => {
            callback?.(status, new Error('safe join failure'));
            return channel;
          }),
          send: vi.fn().mockResolvedValue('ok'),
          unsubscribe: vi.fn(),
        };
        return channel;
      };
      const mainChannel = makeChannel('SUBSCRIBED');
      const inboxChannel = makeChannel(inboxStatus);
      const addToast = vi.fn();
      const supabase: any = {
        realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
        channel: vi.fn((topic: string) => topic.endsWith(':teacher') ? inboxChannel : mainChannel),
        removeChannel: vi.fn().mockResolvedValue('ok'),
      };

      const { result } = renderHook(() => useTeacherRealtime({
        supabase,
        realtimeToken: 'teacher-realtime-jwt',
        roomId: 'room-1',
        isSeatLocked: false,
        setLiveStatuses: vi.fn(),
        addToast,
      }));

      await waitFor(() => expect(mainChannel.subscribe).toHaveBeenCalled());
      expect(result.current.isOnline).toBe(false);
      expect(addToast).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('RT-T-INBOX-01'),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[RT-T-INBOX-01]'),
        expect.objectContaining({
          errorCode: 'RT-T-INBOX-01',
          status: inboxStatus,
          roomId: 'room-1',
          channel: 'teacher-inbox',
          error: expect.objectContaining({ message: 'safe join failure' }),
        }),
      );
    },
  );

  it('cleans up the main Channel when answer inbox authorization fails before subscription', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mainChannel: any = {
      on: vi.fn(() => mainChannel),
      subscribe: vi.fn(),
      send: vi.fn(),
      unsubscribe: vi.fn(),
    };
    const addToast = vi.fn();
    const setLiveStatuses = vi.fn();
    const supabase: any = {
      realtime: {
        setAuth: vi.fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('inbox authorization denied')),
      },
      channel: vi.fn(() => mainChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };

    const { result } = renderHook(() => useTeacherRealtime({
      supabase,
      realtimeToken: 'teacher-realtime-jwt',
      roomId: 'room-1',
      isSeatLocked: false,
      setLiveStatuses,
      addToast,
    }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      'error',
      'リアルタイム認証に失敗しました。再ログインしてください。（エラーコード: RT-T-INBOX-01）',
    ));
    expect(supabase.realtime.setAuth).toHaveBeenCalledTimes(2);
    expect(supabase.removeChannel).toHaveBeenCalledWith(mainChannel);
    expect(mainChannel.subscribe).not.toHaveBeenCalled();
    expect(result.current.isOnline).toBe(false);
  });

  it('recreates the Teacher main Channel with status monitoring on retry', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const makeChannel = () => {
      const channel: any = {
        on: vi.fn(() => channel),
        subscribe: vi.fn(),
        send: vi.fn().mockResolvedValue('ok'),
        unsubscribe: vi.fn(),
      };
      return channel;
    };
    const firstMainChannel = makeChannel();
    const retryMainChannel = makeChannel();
    const inboxChannel = makeChannel();
    let mainChannelCount = 0;
    const supabase: any = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn((topic: string) => {
        if (topic.endsWith(':teacher')) return inboxChannel;
        mainChannelCount += 1;
        return mainChannelCount === 1 ? firstMainChannel : retryMainChannel;
      }),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };
    const setLiveStatuses = vi.fn();
    const addToast = vi.fn();

    const rendered = renderHook(() => useTeacherRealtime({
      supabase,
      realtimeToken: 'teacher-realtime-jwt',
      roomId: 'room-1',
      isSeatLocked: false,
      setLiveStatuses,
      addToast,
    }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const inboxStatusHandler = inboxChannel.subscribe.mock.calls[0]?.[0];
    const firstMainStatusHandler = firstMainChannel.subscribe.mock.calls[0]?.[0];
    expect(inboxStatusHandler).toBeTypeOf('function');
    expect(firstMainStatusHandler).toBeTypeOf('function');

    act(() => {
      inboxStatusHandler('SUBSCRIBED');
      firstMainStatusHandler('CHANNEL_ERROR');
    });
    expect(rendered.result.current.isOnline).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const retryStatusHandler = retryMainChannel.subscribe.mock.calls[0]?.[0];
    expect(supabase.removeChannel).toHaveBeenCalledWith(firstMainChannel);
    expect(retryStatusHandler).toBeTypeOf('function');

    act(() => retryStatusHandler('SUBSCRIBED'));
    expect(rendered.result.current.isOnline).toBe(true);
    rendered.unmount();
  });

  it('removes online and offline listeners on every unmount', () => {
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const props = {
      supabase: null,
      realtimeToken: '',
      roomId: null,
      isSeatLocked: false,
      setLiveStatuses: vi.fn(),
      addToast: vi.fn(),
    };

    const first = renderHook(() => useTeacherRealtime(props));
    first.unmount();
    const second = renderHook(() => useTeacherRealtime(props));
    second.unmount();

    for (const eventName of ['online', 'offline']) {
      const added = addListener.mock.calls.filter(([name]) => name === eventName);
      const removed = removeListener.mock.calls.filter(([name]) => name === eventName);
      expect(added).toHaveLength(2);
      expect(removed).toHaveLength(2);
      expect(removed.map(([, handler]) => handler)).toEqual(added.map(([, handler]) => handler));
    }
  });

  it('keeps a chronological in-memory comment feed across status changes, anonymity and seat release', async () => {
    let receiveStudentEvent: ((response: { payload: Record<string, unknown> }) => void) | undefined;
    const makeChannel = (isInbox = false) => {
      const channel: any = {
        on: vi.fn((_type: string, _filter: unknown, callback: typeof receiveStudentEvent) => {
          if (isInbox) receiveStudentEvent = callback;
          return channel;
        }),
        subscribe: vi.fn((callback?: (status: string) => void) => {
          callback?.('SUBSCRIBED');
          return channel;
        }),
        send: vi.fn().mockResolvedValue('ok'),
        unsubscribe: vi.fn(),
      };
      return channel;
    };
    const mainChannel = makeChannel();
    const inboxChannel = makeChannel(true);
    const supabase: any = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn((topic: string) => topic.endsWith(':teacher') ? inboxChannel : mainChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };
    let statuses: Record<string, LiveSeatStatus> = {};
    const setLiveStatuses: Dispatch<SetStateAction<Record<string, LiveSeatStatus>>> = (value) => {
      statuses = typeof value === 'function' ? value(statuses) : value;
    };

    const { result } = renderHook(() => useTeacherRealtime({
      supabase,
      realtimeToken: 'teacher-realtime-jwt',
      roomId: 'room-1',
      isSeatLocked: false,
      setLiveStatuses,
      addToast: vi.fn(),
    }));
    await waitFor(() => expect(receiveStudentEvent).toBeTypeOf('function'));

    act(() => receiveStudentEvent?.({ payload: {
      seatId: '1,1', status: 'ok', studentId: 'STU001', studentName: 'Claim Name', comment: 'first',
    } }));
    const firstTimestamp = result.current.realtimeLogs[0]?.timestamp;
    expect(firstTimestamp).toBeTruthy();
    expect(statuses['1,1']).toMatchObject({ status: 'ok', answeredAt: firstTimestamp });

    act(() => receiveStudentEvent?.({ payload: {
      seatId: '1,1', status: 'ng', studentId: 'STU001', studentName: 'Claim Name', comment: 'latest',
    } }));
    expect(result.current.realtimeLogs).toHaveLength(2);
    expect(result.current.realtimeLogs.map((entry) => entry.comment)).toEqual(['latest', 'first']);
    expect(result.current.realtimeLogs[0]).toMatchObject({
      seatId: '1,1', comment: 'latest', studentId: 'STU001', studentName: 'Claim Name',
    });
    expect(statuses['1,1']).toMatchObject({ status: 'ng', comment: 'latest' });

    act(() => receiveStudentEvent?.({ payload: {
      kind: 'comment', seatId: '1,1', studentId: 'STU001', studentName: 'Claim Name', comment: 'anonymous question', anonymous: true,
    } }));
    expect(statuses['1,1']).toMatchObject({ status: 'ng', comment: 'latest' });
    expect(result.current.realtimeLogs).toHaveLength(3);
    expect(result.current.realtimeLogs[0]).toMatchObject({ comment: 'anonymous question', studentName: '匿名' });
    expect(result.current.realtimeLogs[1]).toMatchObject({ comment: 'latest', studentId: 'STU001', studentName: 'Claim Name' });
    expect(result.current.realtimeLogs[0].studentId).toBeUndefined();
    expect(result.current.realtimeLogs[0].status).toBeUndefined();

    act(() => receiveStudentEvent?.({ payload: {
      kind: 'comment', seatId: '1,1', studentId: 'STU001', studentName: 'Claim Name', comment: 'named again', anonymous: false,
    } }));
    expect(result.current.realtimeLogs).toHaveLength(4);
    expect(result.current.realtimeLogs.map((entry) => entry.comment))
      .toEqual(['named again', 'anonymous question', 'latest', 'first']);
    expect(result.current.realtimeLogs[0]).toMatchObject({ studentName: 'Claim Name', studentId: 'STU001' });
    expect(result.current.realtimeLogs[1]).toMatchObject({ studentName: '匿名', studentId: undefined });

    act(() => receiveStudentEvent?.({ payload: {
      seatId: '1,1', status: 'ok', studentId: 'STU001', studentName: 'Claim Name',
    } }));
    expect(statuses['1,1'].status).toBe('ok');
    expect(result.current.realtimeLogs.map((entry) => entry.comment))
      .toEqual(['named again', 'anonymous question', 'latest', 'first']);

    act(() => receiveStudentEvent?.({ payload: {
      kind: 'comment', seatId: '2,2', studentId: 'STU002', studentName: 'Another Student', comment: 'before choosing a status',
    } }));
    expect(statuses['2,2']).toBeUndefined();
    expect(result.current.realtimeLogs).toHaveLength(5);

    // Leaving/changing seats is not a request to delete the comment history.
    act(() => receiveStudentEvent?.({ payload: {
      seatId: '1,1', status: 'none', studentId: 'STU001', studentName: 'Claim Name', comment: 'stale comment',
    } }));
    expect(statuses['1,1']).toBeUndefined();
    expect(result.current.realtimeLogs).toHaveLength(5);

    await act(async () => {
      expect(await result.current.sendTeacherResetBroadcast()).toBe('ok');
    });
    expect(result.current.realtimeLogs).toEqual([]);
  });
});
