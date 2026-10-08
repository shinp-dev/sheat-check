// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudentRealtime } from './useStudentRealtime';

vi.mock('../lib/studentSeatApi', () => ({
  fingerprintClaimToken: vi.fn().mockResolvedValue('test-opaque-tag'),
}));

const props = {
  supabase: null,
  studentClassroomId: 'room-1',
  studentToken: 'student-jwt',
  addToast: vi.fn(),
  onTeacherReset: vi.fn(),
  onTeacherEvict: vi.fn(),
  onTeacherLockState: vi.fn(),
  onRoomLayoutUpdated: vi.fn(),
};

describe('useStudentRealtime Student answer relay', () => {
  beforeEach(() => localStorage.setItem('student_seat_claim_room-1', 'test-claim-token'));
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports success only for a successful Worker response and sends no client identity', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { result } = renderHook(() => useStudentRealtime(props));

    let sendResult: 'ok' | 'error' = 'error';
    await act(async () => {
      sendResult = await result.current.sendStudentToTeacherBroadcast('1,1', 'ok', 'Forged Name', 'FORGED1', 'understood');
    });

    expect(sendResult).toBe('ok');
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rooms/room-1/student-event');
    expect(JSON.parse(request.body as string)).toEqual({ seatId: '1,1', status: 'ok', comment: 'understood', anonymous: false });
    expect(request.headers).toMatchObject({ Authorization: 'Bearer student-jwt', 'X-Seat-Claim': 'test-claim-token' });
    expect(request).not.toHaveProperty('keepalive');
  });

  it('sends a standalone anonymous comment without a status or client identity', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { result } = renderHook(() => useStudentRealtime(props));
    await act(async () => {
      expect(await result.current.sendStudentCommentBroadcast('1,1', ' 質問です ', true)).toBe('ok');
    });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(request.body as string)).toEqual({ kind: 'comment', seatId: '1,1', comment: '質問です', anonymous: true });
    expect(request.headers).toMatchObject({ Authorization: 'Bearer student-jwt', 'X-Seat-Claim': 'test-claim-token' });
  });

  it.each(['   ', 'x'.repeat(1001)])('rejects an invalid comment before sending it', async (comment) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const { result } = renderHook(() => useStudentRealtime(props));
    await act(async () => {
      expect(await result.current.sendStudentCommentBroadcast('1,1', comment)).toBe('error');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sets keepalive only when requested for an unload event', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const { result } = renderHook(() => useStudentRealtime(props));

    await act(async () => {
      await result.current.sendStudentToTeacherBroadcast(
        '1,1',
        'none',
        'Name',
        'STU001',
        undefined,
        { keepalive: true },
      );
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.keepalive).toBe(true);
  });

  it.each([401, 403, 429, 500])('reports error for Worker HTTP %s', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status }));
    const { result } = renderHook(() => useStudentRealtime(props));

    let sendResult: 'ok' | 'error' = 'ok';
    await act(async () => {
      sendResult = await result.current.sendStudentToTeacherBroadcast('1,1', 'ng', 'Name', 'STU001');
    });
    expect(sendResult).toBe('error');
  });

  it('reports error for a network failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network failed'));
    const { result } = renderHook(() => useStudentRealtime(props));

    let sendResult: 'ok' | 'error' = 'ok';
    await act(async () => {
      sendResult = await result.current.sendStudentToTeacherBroadcast('1,1', 'ng', 'Name', 'STU001');
    });
    expect(sendResult).toBe('error');
  });

  it('shows the stable Worker error code without exposing the relay response body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      error: 'Student event could not be delivered',
      code: 'RT-RELAY-01',
    }), { status: 502, headers: { 'Content-Type': 'application/json' } }));
    const addToast = vi.fn();
    const { result } = renderHook(() => useStudentRealtime({ ...props, addToast }));

    await act(async () => {
      expect(await result.current.sendStudentToTeacherBroadcast('1,1', 'ng', 'Name', 'STU001')).toBe('error');
    });
    expect(addToast).toHaveBeenCalledWith('error', expect.stringContaining('RT-RELAY-01'));
  });

  it('keeps the four Teacher-to-Student control event listeners active', async () => {
    const handlers = new Map<string, (response: { payload?: Record<string, unknown> }) => void>();
    const channel: any = {
      on: vi.fn((_type: string, filter: { event: string }, callback: (response: { payload?: Record<string, unknown> }) => void) => {
        handlers.set(filter.event, callback);
        return channel;
      }),
      subscribe: vi.fn((callback?: (status: string) => void) => {
        callback?.('SUBSCRIBED');
        return channel;
      }),
      unsubscribe: vi.fn(),
    };
    const callbacks = {
      onTeacherReset: vi.fn(),
      onTeacherEvict: vi.fn(),
      onTeacherLockState: vi.fn(),
      onRoomLayoutUpdated: vi.fn(),
    };
    const supabase: any = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };

    renderHook(() => useStudentRealtime({ ...props, ...callbacks, supabase }));
    await waitFor(() => expect(handlers.size).toBe(4));

    act(() => {
      handlers.get('teacher_reset')?.({});
      handlers.get('student_evicted')?.({ payload: { seatId: '1,1', evictedClaimTag: 'test-opaque-tag' } });
      handlers.get('teacher_lock_state')?.({ payload: { locked: true } });
      handlers.get('room_layout_updated')?.({});
    });
    expect(callbacks.onTeacherReset).toHaveBeenCalledOnce();
    await waitFor(() => expect(callbacks.onTeacherEvict).toHaveBeenCalledWith('1,1'));
    expect(callbacks.onTeacherLockState).toHaveBeenCalledWith(true);
    expect(callbacks.onRoomLayoutUpdated).toHaveBeenCalledOnce();
  });

  it('activates fallback on CLOSED and retries with status monitoring until SUBSCRIBED', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const makeChannel = () => {
      const channel: any = {
        on: vi.fn(() => channel),
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      };
      return channel;
    };
    const firstChannel = makeChannel();
    const retryChannel = makeChannel();
    const supabase: any = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn()
        .mockReturnValueOnce(firstChannel)
        .mockReturnValueOnce(retryChannel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };

    const { result } = renderHook(() => useStudentRealtime({ ...props, supabase }));
    await act(async () => undefined);
    const firstStatusHandler = firstChannel.subscribe.mock.calls[0]?.[0];
    expect(firstStatusHandler).toBeTypeOf('function');

    act(() => firstStatusHandler('CLOSED', new Error('join closed')));
    expect(result.current.isFallbackActive).toBe(true);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[RT-S-CHANNEL-01]'),
      expect.objectContaining({
        errorCode: 'RT-S-CHANNEL-01',
        status: 'CLOSED',
        roomId: 'room-1',
        channel: 'student',
        error: expect.objectContaining({ message: 'join closed' }),
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(10000);
      await Promise.resolve();
    });
    const retryStatusHandler = retryChannel.subscribe.mock.calls[0]?.[0];
    expect(supabase.removeChannel).toHaveBeenCalledWith(firstChannel);
    expect(retryStatusHandler).toBeTypeOf('function');

    act(() => retryStatusHandler('SUBSCRIBED'));
    expect(result.current.isFallbackActive).toBe(false);
  });

  it('polls the configured cross-origin API and stops after Realtime recovers', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_API_URL', 'https://api.example.test///');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const channel: any = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    };
    const supabase: any = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };

    const { result } = renderHook(() => useStudentRealtime({ ...props, supabase }));
    await act(async () => undefined);
    const statusHandler = channel.subscribe.mock.calls[0]?.[0];

    act(() => statusHandler('CHANNEL_ERROR'));
    await act(async () => {
      vi.advanceTimersByTime(7000);
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/rooms/room-1');

    act(() => statusHandler('SUBSCRIBED'));
    expect(result.current.isFallbackActive).toBe(false);
    fetchMock.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(14000);
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops fallback polling after unmount', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_API_URL', 'https://api.example.test');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const channel: any = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    };
    const supabase: any = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };

    const rendered = renderHook(() => useStudentRealtime({ ...props, supabase }));
    await act(async () => undefined);
    const statusHandler = channel.subscribe.mock.calls[0]?.[0];
    act(() => statusHandler('TIMED_OUT'));
    rendered.unmount();

    await act(async () => {
      vi.advanceTimersByTime(14000);
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not retry after unmount', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const channel: any = {
      on: vi.fn(() => channel),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    };
    const supabase: any = {
      realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn().mockResolvedValue('ok'),
    };

    const rendered = renderHook(() => useStudentRealtime({ ...props, supabase }));
    await act(async () => undefined);
    const statusHandler = channel.subscribe.mock.calls[0]?.[0];
    act(() => statusHandler('TIMED_OUT'));
    rendered.unmount();
    act(() => vi.advanceTimersByTime(10000));

    expect(supabase.channel).toHaveBeenCalledTimes(1);
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });
});
