import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import app from './index';
import { InMemoryRoomRepository } from './repositories/InMemoryRoomRepository';
import { InMemoryTeacherRepository } from './repositories/InMemoryTeacherRepository';
import { InMemorySeatClaimRepository } from './repositories/InMemorySeatClaimRepository';

describe('Backend API (Dependency Injection & Repository Pattern) Tests', () => {
  let mockRepo: InMemoryRoomRepository;
  let mockTeacherRepo: InMemoryTeacherRepository;
  let mockSeatClaimRepo: InMemorySeatClaimRepository;
  let testApp: Hono<any, any, any>;
  const teacherAuthorization = async (overrides: Record<string, unknown> = {}, secret = 'dev-app-jwt-secret-key-123') => {
    const token = await sign({
      sub: 'teacher-default-uuid',
      role: 'teacher',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    }, secret);
    return { Authorization: `Bearer ${token}` };
  };

  beforeEach(() => {
    // 1. Setup in-memory repositories with default seed data
    mockRepo = new InMemoryRoomRepository([
      {
        id: 'test-room-uuid-1',
        name: '物理実験室',
        grid: [{ x: 1, y: 1, type: 'student' }],
        isActive: true,
      }
    ]);

    mockTeacherRepo = new InMemoryTeacherRepository();
    mockSeatClaimRepo = new InMemorySeatClaimRepository();
    void mockSeatClaimRepo.tryClaim({ roomId:'test-room-uuid-1',seatId:'1,1',studentId:'STU001',studentName:'Claim Name',claimToken:'test-seat-token' });

    // 2. Setup a test Hono application that prepends repositories injection middleware
    testApp = new Hono();
    testApp.use('*', async (c, next) => {
      c.set('roomRepo', mockRepo);
      c.set('teacherRepo', mockTeacherRepo);
      c.set('seatClaimRepo', mockSeatClaimRepo);
      await next();
    });
    
    // Mount the original production app routes
    testApp.route('/', app);
    const requestWithExplicitTestMode = testApp.request.bind(testApp);
    testApp.request = ((input: RequestInfo | URL, requestInit?: RequestInit, env?: Record<string, unknown>) => (
      requestWithExplicitTestMode(input, requestInit, { ENVIRONMENT: 'test', ...env })
    )) as typeof testApp.request;
  });

  afterEach(() => vi.restoreAllMocks());

  it('GET /api/hello - should return greeting message', async () => {
    const res = await testApp.request('/api/hello');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toEqual({ message: 'Hello Hono!' });
  });

  describe('Room administration authentication boundary', () => {
    it('returns 401 for every unauthenticated management operation', async () => {
      const payload = JSON.stringify({
        name: 'Unauthorized room',
        grid: [],
      });
      const requests = [
        testApp.request('/api/rooms'),
        testApp.request('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }),
        testApp.request('/api/rooms/test-room-uuid-1', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload }),
        testApp.request('/api/rooms/test-room-uuid-1/status', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: false }) }),
        testApp.request('/api/rooms/test-room-uuid-1', { method: 'DELETE' }),
      ];
      const responses = await Promise.all(requests);
      expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
      expect(mockRepo.roomsTable).toHaveLength(1);
    });

    it('returns 401 for an invalid and an expired Teacher JWT', async () => {
      const invalid = await testApp.request('/api/rooms', { headers: { Authorization: 'Bearer invalid.jwt.value' } });
      const expired = await testApp.request('/api/rooms', { headers: await teacherAuthorization({ exp: Math.floor(Date.now() / 1000) - 10 }) });
      expect(invalid.status).toBe(401);
      expect(expired.status).toBe(401);
    });

    it('keeps a single-room GET public', async () => {
      const response = await testApp.request('/api/rooms/test-room-uuid-1');
      expect(response.status).toBe(200);
    });
  });

  it('GET /api/rooms - should list all registered classrooms for a teacher', async () => {
    const res = await testApp.request('/api/rooms', { headers: await teacherAuthorization() });
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0].name).toBe('物理実験室');
    expect(body.rooms[0].id).toBe('test-room-uuid-1');
  });

  it('GET /api/rooms/:id - should fetch existing classroom layout details', async () => {
    const res = await testApp.request('/api/rooms/test-room-uuid-1');
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.name).toBe('物理実験室');
    expect(body.grid).toEqual([{ x: 1, y: 1, type: 'student' }]);
    expect(body).not.toHaveProperty('supabaseUrl');
    expect(body).not.toHaveProperty('supabaseAnonKey');
  });

  it('GET /api/rooms/:id - should return 404 for non-existing uuid', async () => {
    const res = await testApp.request('/api/rooms/non-existent-uuid');
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error).toBe('Room not found');
  });

  it('POST /api/rooms - should successfully create a new room layout', async () => {
    const newRoomPayload = {
      name: '化学講義室',
      grid: [{ x: 2, y: 2, type: 'student' }, { x: 0, y: 0, type: 'teacher' }],
      isActive: true,
    };

    const res = await testApp.request(
      '/api/rooms',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await teacherAuthorization() },
        body: JSON.stringify(newRoomPayload),
      }
    );

    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe('化学講義室');
    expect(body.grid).toEqual(newRoomPayload.grid);
    expect(body.isActive).toBe(true);

    // Verify room is inserted into Repository (In-Memory)
    expect(mockRepo.roomsTable).toHaveLength(2);
    expect(mockRepo.roomsTable.some(r => r.name === '化学講義室')).toBe(true);
  });

  it('PUT /api/rooms/:id - should update existing classroom layout details', async () => {
    const updatedPayload = {
      name: '更新された物理実験室',
      grid: [{ x: 3, y: 3, type: 'student' }],
      isActive: false,
    };

    const res = await testApp.request(
      '/api/rooms/test-room-uuid-1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...await teacherAuthorization() },
        body: JSON.stringify(updatedPayload),
      }
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.name).toBe('更新された物理実験室');
    expect(body.isActive).toBe(false);

    // Verify repository update
    const updatedRoom = mockRepo.roomsTable.find(r => r.id === 'test-room-uuid-1');
    expect(updatedRoom?.name).toBe('更新された物理実験室');
    expect(updatedRoom?.isActive).toBe(false);
  });

  it('PATCH /api/rooms/:id/status - should toggle classroom status between active/inactive', async () => {
    const res = await testApp.request(
      '/api/rooms/test-room-uuid-1/status',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...await teacherAuthorization() },
        body: JSON.stringify({ isActive: false }),
      }
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.isActive).toBe(false);

    // Verify status in Repository
    const updatedRoom = mockRepo.roomsTable.find(r => r.id === 'test-room-uuid-1');
    expect(updatedRoom?.isActive).toBe(false);
  });

  it('DELETE /api/rooms/:id - should physically delete existing room layout', async () => {
    const res = await testApp.request(
      '/api/rooms/test-room-uuid-1',
      {
        method: 'DELETE',
        headers: await teacherAuthorization(),
      }
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.id).toBe('test-room-uuid-1');

    // Verify physical deletion from Repository
    expect(mockRepo.roomsTable).toHaveLength(0);
  });

  describe('Teacher Authentication Endpoints', () => {
    it('POST /api/auth/teacher/login - should log in successfully with correct credentials', async () => {
      const payload = {
        username: 'teacher_admin',
        password: 'admin123'
      };

      const res = await testApp.request('/api/auth/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.token).toBeDefined();
      expect(body.supabaseToken).toBeDefined();
      expect(body.teacher.username).toBe('teacher_admin');
    });

    it('POST /api/auth/teacher/login - should fail with incorrect password', async () => {
      const payload = {
        username: 'teacher_admin',
        password: 'wrong_password'
      };

      const res = await testApp.request('/api/auth/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.error).toContain('ユーザー名またはパスワードが正しくありません');
      expect(body.code).toBe('AUTH-T-01');
    });

    it('POST /api/auth/teacher/login - should fail with non-existing username', async () => {
      const payload = {
        username: 'non_existent_teacher',
        password: 'password123'
      };

      const res = await testApp.request('/api/auth/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.error).toContain('ユーザー名またはパスワードが正しくありません');
      expect(body.code).toBe('AUTH-T-01');
    });

    it('rate limits repeated Teacher login failures without affecting Student check-in', async () => {
      const request = () => testApp.request('/api/auth/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.55' },
        body: JSON.stringify({ username: 'brute_force_target', password: 'wrong_password' }),
      });
      for (let attempt = 0; attempt < 5; attempt += 1) expect((await request()).status).toBe(401);
      expect((await request()).status).toBe(429);
    });
  });

  describe('Student Token Issuance Endpoints (Approach B)', () => {
    it('POST /api/rooms/:id/student-token - should issue a student Supabase token for an existing room', async () => {
      const payload = {
        studentId: 'STU001',
        name: '田中太郎'
      };

      const res = await testApp.request('/api/rooms/test-room-uuid-1/student-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.supabaseToken).toBeDefined();
      expect(body.studentId).toBe('STU001');
      expect(body.name).toBe('田中太郎');
      expect(body.roomId).toBe('test-room-uuid-1');
    });

    it('POST /api/rooms/:id/student-token - should fail to issue a token for a non-existing room', async () => {
      const payload = {
        studentId: 'STU001',
        name: '田中太郎'
      };

      const res = await testApp.request('/api/rooms/invalid-room-uuid/student-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.error).toContain('指定された教室が見つかりません');
    });

    it('POST /api/rooms/:id/student-token - returns 403 for a closed room', async () => {
      await mockRepo.updateStatus('test-room-uuid-1', false);
      const res = await testApp.request('/api/rooms/test-room-uuid-1/student-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: 'STU001', name: '田中太郎' }),
      });
      expect(res.status).toBe(403);
    });

    it('allows 50 simultaneous check-ins from the same school NAT address', async () => {
      const responses = await Promise.all(Array.from({ length: 50 }, (_, index) => testApp.request('/api/rooms/test-room-uuid-1/student-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.10' },
        body: JSON.stringify({ studentId: `STU${String(index).padStart(3, '0')}`, name: `Student ${index}` }),
      })));
      expect(responses.every((response) => response.status === 200)).toBe(true);
    });
  });

  describe('Exclusive seat claims', () => {
    const tokenFor = async (id: string, name = id) => sign({
      sub:`student:test-room-uuid-1:${id}`, user_role:'student', role:'authenticated',
      roomId:'test-room-uuid-1', studentId:id, name, exp:Math.floor(Date.now()/1000)+3600,
    }, 'dev-supabase-jwt-secret-key-456');

    it('rejects another student claiming a taken seat and rejects student eviction', async () => {
      const token = await tokenFor('STU002');
      const attempt = () => testApp.request('/api/rooms/test-room-uuid-1/seat-claim', {
        method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({seatId:'1,1'}),
      });
      expect((await attempt()).status).toBe(409);
      const another = await testApp.request('/api/rooms/test-room-uuid-1/seat-claim', {
        method:'POST', headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({seatId:'1,1',restore:true}),
      });
      expect(another.status).toBe(409);
      const unauthorized = await testApp.request('/api/rooms/test-room-uuid-1/seats/1%2C1', {
        method:'DELETE', headers:{Authorization:`Bearer ${token}`},
      });
      expect(unauthorized.status).toBe(401);
      expect((await mockSeatClaimRepo.get('test-room-uuid-1','1,1'))?.studentId).toBe('STU001');
    });

    it('does not leak student names in occupancy and reserves teacher-only eviction', async () => {
      const occupancy = await testApp.request('/api/rooms/test-room-uuid-1/occupied-seats');
      expect(occupancy.status).toBe(200);
      expect(await occupancy.json()).toEqual({ occupiedSeats: ['1,1'] });
      expect((await testApp.request('/api/rooms/test-room-uuid-1/seat-occupants')).status).toBe(401);

      const teacherHeaders = await teacherAuthorization();
      const teacherView = await testApp.request('/api/rooms/test-room-uuid-1/seat-occupants', { headers: teacherHeaders });
      expect(teacherView.status).toBe(200);
      expect(await teacherView.json()).toEqual({
        occupants: [{ seatId: '1,1', studentId: 'STU001', studentName: 'Claim Name' }],
      });
      const removed = await testApp.request('/api/rooms/test-room-uuid-1/seats/1%2C1', {
        method: 'DELETE', headers: teacherHeaders,
      });
      expect(removed.status).toBe(200);
      expect((await mockSeatClaimRepo.list('test-room-uuid-1'))).toHaveLength(0);
      const reclaimed = await testApp.request('/api/rooms/test-room-uuid-1/seat-claim', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await tokenFor('STU002')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatId: '1,1' }),
      });
      expect(reclaimed.status).toBe(201);
    });

    it('rejects claiming another seat using the identity of an already seated student', async () => {
      await mockRepo.update('test-room-uuid-1', {
        name: '物理実験室', grid: [{ x: 1, y: 1, type: 'student' }, { x: 2, y: 2, type: 'student' }], isActive: true,
      });
      const response = await testApp.request('/api/rooms/test-room-uuid-1/seat-claim', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await tokenFor('STU001')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatId: '2,2' }),
      });
      expect(response.status).toBe(409);
      expect((await mockSeatClaimRepo.list('test-room-uuid-1'))).toHaveLength(1);
    });

    it('atomically gives a free seat to just one concurrent student', async () => {
      await mockSeatClaimRepo.releaseByTeacher('test-room-uuid-1','1,1');
      const [a,b]=await Promise.all(['STU003','STU004'].map(async id => {
        const jwt=await tokenFor(id);
        return testApp.request('/api/rooms/test-room-uuid-1/seat-claim',{
          method:'POST',headers:{Authorization:`Bearer ${jwt}`,'Content-Type':'application/json'},
          body:JSON.stringify({seatId:'1,1'}),
        });
      }));
      expect([a.status,b.status].sort()).toEqual([201,409]);
      expect((await mockSeatClaimRepo.list('test-room-uuid-1'))).toHaveLength(1);
    });

    it('requires a valid claim token as well as matching student identity to release/send', async () => {
      const owner=await tokenFor('STU001');
      const borrowed=await tokenFor('STU002');
      const post=(jwt:string, claimToken?:string) => testApp.request('/api/rooms/test-room-uuid-1/student-event',{
        method:'POST',headers:{Authorization:`Bearer ${jwt}`,'Content-Type':'application/json',...(claimToken?{'X-Seat-Claim':claimToken}:{})},
        body:JSON.stringify({seatId:'1,1',status:'ok'}),
      },{SUPABASE_JWT_SECRET:'dev-supabase-jwt-secret-key-456',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'mock-key'});
      expect((await post(owner)).status).toBe(403);
      expect((await post(borrowed,'test-seat-token')).status).toBe(403);
      const invalidRelease=await testApp.request('/api/rooms/test-room-uuid-1/seat-release',{
        method:'POST',headers:{Authorization:`Bearer ${borrowed}`,'Content-Type':'application/json'},
        body:JSON.stringify({seatId:'1,1',claimToken:'00000000-0000-4000-8000-000000000000'}),
      });
      expect(invalidRelease.status).toBe(403);
      const claimed=await testApp.request('/api/rooms/test-room-uuid-1/seat-claim',{
        method:'POST',headers:{Authorization:`Bearer ${owner}`,'Content-Type':'application/json'},
        body:JSON.stringify({seatId:'1,1',claimToken:'00000000-0000-4000-8000-000000000000',restore:true}),
      });
      expect(claimed.status).toBe(409);
    });
  });

  describe('Realtime trust boundary', () => {
    const relayEnv = {
      SUPABASE_JWT_SECRET: 'relay-test-secret-that-is-not-a-production-value',
      SUPABASE_URL: 'https://test-sb-1.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-only-service-key',
    };

    const studentToken = (roomId = 'test-room-uuid-1', studentId = 'STU001', name = 'Claim Name') => sign({
      sub: `student:${roomId}:${studentId}`, role: 'authenticated', user_role: 'student',
      roomId, studentId, name, exp: Math.floor(Date.now() / 1000) + 3600,
    }, relayEnv.SUPABASE_JWT_SECRET);

    it('relays only student_to_teacher and derives identity from JWT claims', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 202 }));
      const token = await studentToken();
      const response = await testApp.request('/api/rooms/test-room-uuid-1/student-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Seat-Claim': 'test-seat-token' },
        body: JSON.stringify({ seatId: '1,1', status: 'ok', comment: 'understood' }),
      }, relayEnv);
      expect(response.status).toBe(200);
      const [requestUrl, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      const relayBody = JSON.parse(request.body as string);
      expect(requestUrl).toContain('/broadcast/room%3Atest-room-uuid-1%3Ateacher/events/student_to_teacher?private=true');
      expect(relayBody).toMatchObject({ studentId: 'STU001', studentName: 'Claim Name' });
    });

    it('relays a standalone anonymous comment with JWT identity and no status', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 202 }));
      const token = await studentToken();
      const response = await testApp.request('/api/rooms/test-room-uuid-1/student-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Seat-Claim': 'test-seat-token' },
        body: JSON.stringify({ kind: 'comment', seatId: '1,1', comment: '質問', anonymous: true }),
      }, relayEnv);
      expect(response.status).toBe(200);
      const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      const relayBody = JSON.parse(request.body as string);
      expect(relayBody).toMatchObject({ kind: 'comment', comment: '質問', anonymous: true, studentId: 'STU001', studentName: 'Claim Name' });
      expect(relayBody).not.toHaveProperty('status');
    });

    it.each([
      { kind: 'comment', seatId: '1,1', comment: ' ' },
      { kind: 'comment', seatId: '1,1', comment: '質問', status: 'ok' },
    ])('rejects invalid comment events without relaying them', async (payload) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch');
      const token = await studentToken();
      const response = await testApp.request('/api/rooms/test-room-uuid-1/student-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Seat-Claim': 'test-seat-token' },
        body: JSON.stringify(payload),
      }, relayEnv);
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('normalizes repeated trailing slashes in the fixed Worker relay URL', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 202 }));
      const token = await studentToken();
      const response = await testApp.request('/api/rooms/test-room-uuid-1/student-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Seat-Claim': 'test-seat-token' },
        body: JSON.stringify({ seatId: '1,1', status: 'ok' }),
      }, { ...relayEnv, SUPABASE_URL: '  https://test-sb-1.supabase.co/  ' });

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://test-sb-1.supabase.co/realtime/v1/api/broadcast/room%3Atest-room-uuid-1%3Ateacher/events/student_to_teacher?private=true',
        expect.any(Object),
      );
    });

    it('logs a bounded safe Supabase error body while returning only RT-RELAY-01 to the Student', async () => {
      const token = await studentToken();
      const oversizedBody = JSON.stringify({
        message: `Bearer ${token} apikey: ${relayEnv.SUPABASE_SERVICE_ROLE_KEY} ${'failure '.repeat(300)}`,
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(oversizedBody, { status: 401 }));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const response = await testApp.request('/api/rooms/test-room-uuid-1/student-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Seat-Claim': 'test-seat-token' },
        body: JSON.stringify({ seatId: '1,1', status: 'ng' }),
      }, relayEnv);

      expect(response.status).toBe(502);
      const responseText = await response.text();
      expect(JSON.parse(responseText)).toEqual({
        error: 'Student event could not be delivered',
        code: 'RT-RELAY-01',
      });
      expect(responseText).not.toContain(token);
      expect(responseText).not.toContain(relayEnv.SUPABASE_SERVICE_ROLE_KEY);

      const relayLog = errorSpy.mock.calls.find(([message]) => String(message).includes('[RT-RELAY-01]'));
      expect(relayLog).toBeDefined();
      const diagnostic = relayLog?.[1] as Record<string, unknown>;
      expect(diagnostic).toMatchObject({
        errorCode: 'RT-RELAY-01',
        operation: 'student-event-relay',
        roomId: 'test-room-uuid-1',
        status: 401,
      });
      expect(String(diagnostic.response).length).toBeLessThanOrEqual(1000);
      expect(String(diagnostic.response)).not.toContain(token);
      expect(String(diagnostic.response)).not.toContain(relayEnv.SUPABASE_SERVICE_ROLE_KEY);
    });

    it('fails closed with CFG-SB-01 when the fixed Worker relay configuration is missing', async () => {
      const token = await studentToken();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const response = await testApp.request('/api/rooms/test-room-uuid-1/student-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Seat-Claim': 'test-seat-token' },
        body: JSON.stringify({ seatId: '1,1', status: 'ok' }),
      }, { SUPABASE_JWT_SECRET: relayEnv.SUPABASE_JWT_SECRET });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: 'Student event could not be delivered',
        code: 'CFG-SB-01',
      });
      const serializedLog = JSON.stringify(errorSpy.mock.calls);
      expect(serializedLog).toContain('CFG-SB-01');
      expect(serializedLog).not.toContain(relayEnv.SUPABASE_URL);
      expect(serializedLog).not.toContain(relayEnv.SUPABASE_SERVICE_ROLE_KEY);
      expect(serializedLog).not.toContain(token);
    });

    it('rejects a Student token from another room', async () => {
      const token = await studentToken('another-room');
      const response = await testApp.request('/api/rooms/test-room-uuid-1/student-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Seat-Claim': 'test-seat-token' },
        body: JSON.stringify({ seatId: '1,1', status: 'ok' }),
      }, relayEnv);
      expect(response.status).toBe(401);
    });

    it('rejects identity fields and teacher-only event injection in Student input', async () => {
      const token = await studentToken();
      const response = await testApp.request('/api/rooms/test-room-uuid-1/student-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Seat-Claim': 'test-seat-token' },
        body: JSON.stringify({ type: 'teacher_reset', seatId: '1,1', status: 'ok', studentId: 'FORGED', studentName: 'Forged' }),
      }, relayEnv);
      expect(response.status).toBe(400);
    });

    it('accepts 50 simultaneous same-NAT answers and relays JWT identities only to the claimed room', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 202 }));
      const students = Array.from({ length: 50 }, (_, index) => ({
        studentId: `STU${String(index).padStart(3, '0')}`,
        name: `Claim Student ${index}`,
        seatId: `${index % 12},${Math.floor(index / 12)}`,
      }));
      const tokens = await Promise.all(students.map((student) => studentToken(
        'test-room-uuid-1',
        student.studentId,
        student.name,
      )));

      await mockSeatClaimRepo.releaseByTeacher('test-room-uuid-1', '1,1');
      for (const [index, student] of students.entries()) {
        await mockSeatClaimRepo.tryClaim({
          roomId:'test-room-uuid-1',seatId:student.seatId,studentId:student.studentId,
          studentName:student.name,claimToken:`claim-${index}`,
        });
      }
      const responses = await Promise.all(students.map((student, index) => testApp.request(
        '/api/rooms/test-room-uuid-1/student-event',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokens[index]}`,
            'X-Seat-Claim': `claim-${index}`,
            'CF-Connecting-IP': '203.0.113.10',
          },
          body: JSON.stringify({ seatId: student.seatId, status: index % 2 === 0 ? 'ok' : 'ng', comment: `answer-${index}` }),
        },
        relayEnv,
      )));

      expect(responses).toHaveLength(50);
      expect(responses.every((response) => response.status === 200)).toBe(true);
      expect(responses.every((response) => response.status !== 429)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(50);

      const relayed = fetchMock.mock.calls.map(([requestUrl, request]) => ({
        requestUrl: String(requestUrl),
        body: JSON.parse((request as RequestInit).body as string),
      }));
      expect(relayed.every(({ requestUrl }) => requestUrl.includes('/broadcast/room%3Atest-room-uuid-1%3Ateacher/events/student_to_teacher?private=true'))).toBe(true);
      for (const student of students) {
        const event = relayed.find(({ body }) => body.studentId === student.studentId);
        expect(event?.body).toMatchObject({
          studentId: student.studentId,
          studentName: student.name,
          seatId: student.seatId,
        });
      }
    });
  });

  describe('Production fail-closed behavior', () => {
    const productionJwtSecret = 'production-test-app-jwt-secret-not-default';
    const productionEnv = () => ({
      ENVIRONMENT: 'production',
      JWT_SECRET: productionJwtSecret,
    });
    const productionTeacherAuthorization = () => teacherAuthorization({}, productionJwtSecret);
    const roomPayload = () => ({
      name: 'Production room',
      grid: [{ x: 2, y: 2, type: 'student' }],
      isActive: true,
    });

    it('creates a Room without accepting Supabase settings from the frontend', async () => {
      const response = await testApp.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await productionTeacherAuthorization() },
        body: JSON.stringify(roomPayload()),
      }, productionEnv());

      expect(response.status).toBe(201);
      expect(mockRepo.roomsTable).toHaveLength(2);
      expect(mockRepo.roomsTable.some((room) => room.name === 'Production room')).toBe(true);
    });

    it('rejects legacy Supabase fields on Room creation without changing the Repository', async () => {
      const before = structuredClone(mockRepo.roomsTable);
      const response = await testApp.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await productionTeacherAuthorization() },
        body: JSON.stringify({ ...roomPayload(), supabaseUrl: 'https://different-project.supabase.co', supabaseAnonKey: 'legacy-key' }),
      }, productionEnv());

      expect(response.status).toBe(400);
      expect(mockRepo.roomsTable).toEqual(before);
    });

    it('rejects legacy Supabase fields on Room updates without changing the Repository', async () => {
      const before = structuredClone(mockRepo.roomsTable);
      const response = await testApp.request('/api/rooms/test-room-uuid-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...await productionTeacherAuthorization() },
        body: JSON.stringify({ ...roomPayload(), name: 'Rejected update', supabaseUrl: 'https://different-project.supabase.co', supabaseAnonKey: 'legacy-key' }),
      }, productionEnv());

      expect(response.status).toBe(400);
      expect(mockRepo.roomsTable).toEqual(before);
    });

    it('does not issue login tokens when production secrets are absent', async () => {
      const response = await testApp.request('/api/auth/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.42' },
        body: JSON.stringify({ username: 'teacher_admin', password: 'admin123' }),
      }, { ENVIRONMENT: 'production' });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Teacher login is unavailable', code: 'AUTH-T-01' });
    });

    it('fails closed when ENVIRONMENT itself is absent', async () => {
      const appWithoutEnvironment = new Hono<any, any, any>();
      appWithoutEnvironment.use('*', async (c, next) => {
        c.set('roomRepo', mockRepo);
        c.set('teacherRepo', mockTeacherRepo);
        await next();
      });
      appWithoutEnvironment.route('/', app);

      const response = await appWithoutEnvironment.request('/api/auth/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.43' },
        body: JSON.stringify({ username: 'teacher_admin', password: 'admin123' }),
      }, {});

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Teacher login is unavailable', code: 'AUTH-T-01' });
    });

    it('uses an exact production CORS allowlist and excludes preview pages.dev origins', async () => {
      const allowed = await testApp.request('/api/hello', { headers: { Origin: 'https://school.example' } }, {
        ENVIRONMENT: 'production', ALLOWED_ORIGINS: 'https://school.example',
      });
      const rejected = await testApp.request('/api/hello', { headers: { Origin: 'https://attacker.pages.dev' } }, {
        ENVIRONMENT: 'production', ALLOWED_ORIGINS: 'https://school.example',
      });
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://school.example');
      expect(rejected.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejects oversized Room payloads before parsing', async () => {
      const response = await testApp.request('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await teacherAuthorization() },
        body: JSON.stringify({ name: 'x'.repeat(70_000), grid: [] }),
      });
      expect(response.status).toBe(413);
    });
  });

  describe('Teacher Account CRUD Endpoints', () => {
    let teacherToken: string;
    let teacherAdminId: string;

    beforeEach(async () => {
      // Login to get a valid teacher JWT token
      const res = await testApp.request('/api/auth/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'teacher_admin', password: 'admin123' })
      });
      const body: any = await res.json();
      teacherToken = body.token;
      
      // Look up teacher_admin UUID inside the repo
      const teacher = await mockTeacherRepo.findByUsername('teacher_admin');
      teacherAdminId = teacher ? teacher.id : '';
    });

    it('GET /api/teachers - should return 401 without Bearer token', async () => {
      const res = await testApp.request('/api/teachers');
      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.error).toBe('Unauthorized');
      expect(body.code).toBe('AUTH-T-01');
    });

    it('GET /api/teachers - should fetch all teachers with a valid token', async () => {
      const res = await testApp.request('/api/teachers', {
        headers: { 'Authorization': `Bearer ${teacherToken}` }
      });
      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.teachers).toBeDefined();
      expect(body.teachers.length).toBe(1);
      expect(body.teachers[0].username).toBe('teacher_admin');
      expect(body.teachers[0].passwordHash).toBeUndefined(); // Should omit password hashes
    });

    it('POST /api/teachers - should successfully register a new teacher', async () => {
      const payload = {
        username: 'new_teacher',
        password: 'secure_password_123'
      };

      const res = await testApp.request('/api/teachers', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${teacherToken}`
        },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(201);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.teacher.id).toBeDefined();
      expect(body.teacher.username).toBe('new_teacher');

      // Verify insertion in repository
      const created = await mockTeacherRepo.findByUsername('new_teacher');
      expect(created).toBeDefined();
      expect(created?.username).toBe('new_teacher');
    });

    it('POST /api/teachers - should fail to register duplicate teacher names', async () => {
      const payload = {
        username: 'teacher_admin',
        password: 'different_password_123'
      };

      const res = await testApp.request('/api/teachers', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${teacherToken}`
        },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('このユーザー名はすでに登録されています');
    });

    it('DELETE /api/teachers/:id - should fail to delete self-account', async () => {
      const res = await testApp.request(`/api/teachers/${teacherAdminId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${teacherToken}` }
      });

      expect(res.status).toBe(400);
      const body: any = await res.json();
      expect(body.error).toContain('自分自身のアカウントを削除することはできません');
    });

    it('DELETE /api/teachers/:id - should delete a different teacher successfully', async () => {
      // 1. Create a dummy teacher using helper method
      mockTeacherRepo.addTeacher({
        id: 'dummy-teacher-uuid',
        username: 'dummy_teacher',
        passwordHash: 'dummy_hash',
        createdAt: new Date().toISOString()
      });

      // 2. Perform deletion
      const res = await testApp.request('/api/teachers/dummy-teacher-uuid', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${teacherToken}` }
      });

      expect(res.status).toBe(200);
      const body: any = await res.json();
      expect(body.success).toBe(true);
      expect(body.id).toBe('dummy-teacher-uuid');

      // Verify deletion from repository
      const deleted = await mockTeacherRepo.findByUsername('dummy_teacher');
      expect(deleted).toBeNull();
    });
  });
});
