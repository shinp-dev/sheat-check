import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { cors } from 'hono/cors';
import { zValidator } from '@hono/zod-validator';
import { SaveRoomLayoutInputSchema, StudentEventInputSchema, TeacherLoginInputSchema } from '@my-app/shared';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { sign, verify } from 'hono/jwt';
import { IRoomRepository } from './repositories/RoomRepository';
import { DrizzleRoomRepository } from './repositories/DrizzleRoomRepository';
import { TeacherRepository } from './repositories/TeacherRepository';
import { DrizzleTeacherRepository } from './repositories/DrizzleTeacherRepository';
import { drizzle } from 'drizzle-orm/d1';
import { D1SeatClaimRepository, type SeatClaimRepository } from './repositories/SeatClaimRepository';
import { KEEPALIVE_ERROR_CODE, runSupabaseKeepAlive } from './supabaseKeepAlive';

type Bindings = {
  DB: D1Database;
  JWT_SECRET?: string;
  SUPABASE_JWT_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  INITIAL_TEACHER_USERNAME?: string;
  INITIAL_TEACHER_PASSWORD?: string;
  ENVIRONMENT?: string;
  ALLOWED_ORIGINS?: string;
};

type Variables = {
  roomRepo: IRoomRepository;
  teacherRepo: TeacherRepository;
  seatClaimRepo: SeatClaimRepository;
  teacherAuthUser?: any;
};

type AppEnv = { Bindings: Bindings; Variables: Variables };
const app = new Hono<AppEnv>();

const DEV_APP_SECRET = 'dev-app-jwt-secret-key-123';
const DEV_SUPABASE_SECRET = 'dev-supabase-jwt-secret-key-456';
const MAX_ROOM_PAYLOAD_BYTES = 64 * 1024;
const MAX_RELAY_ERROR_BODY_LENGTH = 1000;
const DEFAULT_PRODUCTION_ORIGIN = 'https://seat-check.pages.dev';
const ERROR_CODES = {
  teacherAuth: 'AUTH-T-01',
  supabaseConfig: 'CFG-SB-01',
  realtimeRelay: 'RT-RELAY-01',
} as const;
// Only explicit local/test modes may use development fallbacks. Missing or unknown
// deployment modes fail closed so a dropped ENVIRONMENT binding cannot enable them.
const isProduction = (env?: Bindings) => env?.ENVIRONMENT !== 'development' && env?.ENVIRONMENT !== 'test';

const normalizeSupabaseUrl = (url: string) => url.trim().replace(/\/+$/, '');

const redactDiagnosticText = (value: string) => value
  .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
  .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
  .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/gi, '[REDACTED_KEY]')
  .replace(/((?:authorization|api[ _-]?key|anon[ _-]?key|publishable[ _-]?key|password|jwt[ _-]?secret|service[ _-]?role[ _-]?key)["'\s:=]+)[^\s,;"'}]+/gi, '$1[REDACTED]')
  .slice(0, MAX_RELAY_ERROR_BODY_LENGTH);

const getSecret = (env: Bindings | undefined, key: 'JWT_SECRET' | 'SUPABASE_JWT_SECRET'): string => {
  const fallback = key === 'JWT_SECRET' ? DEV_APP_SECRET : DEV_SUPABASE_SECRET;
  const configured = env?.[key]?.trim();
  if (isProduction(env)) {
    if (!configured || configured === fallback) throw new Error(`${key} is not securely configured`);
    return configured;
  }
  return configured || fallback;
};

const getAllowedOrigins = (env?: Bindings): string[] => {
  if (!isProduction(env)) return [DEFAULT_PRODUCTION_ORIGIN];
  const configured = env?.ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean);
  return configured?.length ? configured : [DEFAULT_PRODUCTION_ORIGIN];
};

app.use('*', cors({
  origin: (origin, c) => {
    if (!origin) return '';
    if (getAllowedOrigins(c.env).includes(origin)) return origin;
    if (!isProduction(c.env)) {
      try {
        const parsed = new URL(origin);
        if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) return origin;
      } catch {
        return '';
      }
    }
    return '';
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-Seat-Claim'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  maxAge: 600,
  credentials: true,
}));

const internalError = (c: Context<AppEnv>, publicMessage: string, err: unknown, code?: string) => {
  console.error(code ? `[${code}] ${publicMessage}` : publicMessage, err);
  const response: { error: string; code?: string; message?: string } = { error: publicMessage };
  if (code) response.code = code;
  if (!isProduction(c.env) && err instanceof Error) response.message = err.message;
  return c.json(response, 500);
};

const verifyTeacher = async (c: Context<AppEnv>) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Unauthorized');
  try {
    const payload = await verify(authHeader.slice(7), getSecret(c.env, 'JWT_SECRET'), 'HS256');
    if (payload.role !== 'teacher') throw new Error('Unauthorized');
    return payload;
  } catch {
    throw new Error('Unauthorized');
  }
};

const requireTeacher = async (c: Context<AppEnv>, next: Next) => {
  try {
    c.set('teacherAuthUser', await verifyTeacher(c));
    await next();
  } catch {
    console.warn(`[${ERROR_CODES.teacherAuth}] Teacher authorization rejected`, {
      errorCode: ERROR_CODES.teacherAuth,
      operation: 'teacher-api-authorization',
      path: c.req.path,
      status: 401,
    });
    return c.json({ error: 'Unauthorized', code: ERROR_CODES.teacherAuth }, 401);
  }
};

const enforceRoomPayloadLimit = async (c: Context<AppEnv>, next: Next) => {
  const declaredLength = Number(c.req.header('content-length') || '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ROOM_PAYLOAD_BYTES) return c.json({ error: 'Payload Too Large' }, 413);
  if ((await c.req.raw.clone().arrayBuffer()).byteLength > MAX_ROOM_PAYLOAD_BYTES) return c.json({ error: 'Payload Too Large' }, 413);
  await next();
};

// Per-isolate failed-login limiter. Student check-ins are deliberately not IP-throttled.
const failedLogins = new Map<string, number[]>();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_FAILURE_LIMIT = 5;
const loginKey = (c: Context<AppEnv>, username: string) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || c.req.header('x-forwarded-for') || 'unknown';
  return `${ip}:${username.trim().toLowerCase()}`;
};
const recentFailures = (key: string, now = Date.now()) => (failedLogins.get(key) || []).filter((timestamp) => now - timestamp < LOGIN_WINDOW_MS);
const isLoginBlocked = (key: string) => {
  const failures = recentFailures(key);
  failedLogins.set(key, failures);
  return failures.length >= LOGIN_FAILURE_LIMIT;
};
const recordLoginFailure = (key: string) => failedLogins.set(key, [...recentFailures(key), Date.now()]);

app.use('*', async (c, next) => {
  if (!c.get('roomRepo') || !c.get('teacherRepo')) {
    const db = drizzle(c.env.DB);
    if (!c.get('roomRepo')) c.set('roomRepo', new DrizzleRoomRepository(db));
    if (!c.get('teacherRepo')) c.set('teacherRepo', new DrizzleTeacherRepository(db));
  }
  if (!c.get('seatClaimRepo')) c.set('seatClaimRepo', new D1SeatClaimRepository(c.env.DB));

  try {
    const teacherRepo = c.get('teacherRepo');
    if ((await teacherRepo.listAll()).length === 0) {
      const username = isProduction(c.env) ? c.env?.INITIAL_TEACHER_USERNAME?.trim() : c.env?.INITIAL_TEACHER_USERNAME?.trim() || 'teacher_admin';
      const password = isProduction(c.env) ? c.env?.INITIAL_TEACHER_PASSWORD : c.env?.INITIAL_TEACHER_PASSWORD || 'admin123';
      if (username && password && (!isProduction(c.env) || password !== 'admin123')) {
        await teacherRepo.create({ id: crypto.randomUUID(), username, passwordHash: await bcrypt.hash(password, 10) });
      } else if (isProduction(c.env)) {
        console.error('Initial teacher was not created: secure production credentials are required');
      }
    }
  } catch (err) {
    console.error('Failed to initialize teacher account:', err);
  }
  await next();
});

const StudentTokenInputSchema = z.object({
  studentId: z.string().trim().regex(/^[A-Z0-9]{5,15}$/i),
  name: z.string().trim().min(1).max(100),
}).strict();

const SeatCoordinateSchema = z.string().regex(/^(?:[0-9]|1[01]),(?:[0-9]|1[01])$/);
const SeatClaimInputSchema = z.object({ seatId: SeatCoordinateSchema, claimToken: z.string().uuid().optional(), restore: z.boolean().optional() }).strict();
const SeatReleaseInputSchema = z.object({ seatId: SeatCoordinateSchema, claimToken: z.string().uuid() }).strict();

// Self-entered student IDs are not ownership proof. Subsequent actions need the
// unpredictable capability issued by the first successful atomic claim.
const verifyStudent = async (c: Context<AppEnv>, roomId: string) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const claims = await verify(header.slice(7), getSecret(c.env, 'SUPABASE_JWT_SECRET'), 'HS256');
    if (claims.user_role !== 'student' || claims.role !== 'authenticated' ||
        claims.roomId !== roomId || typeof claims.studentId !== 'string' || typeof claims.name !== 'string') return null;
    return { studentId: claims.studentId, studentName: claims.name };
  } catch {
    return null;
  }
};

const routes = app
  .get('/api/hello', (c) => c.json({ message: 'Hello Hono!' }))

  .get('/api/rooms/:id', async (c) => {
    try {
      const room = await c.get('roomRepo').findById(c.req.param('id'));
      if (!room) return c.json({ error: 'Room not found' }, 404);
      return c.json({ id: room.id, name: room.name, grid: room.grid, isActive: room.isActive });
    } catch (err) {
      return internalError(c, 'Internal Server Error', err);
    }
  })

  .get('/api/rooms/:id/occupied-seats', async (c) => {
    try {
      const id = c.req.param('id');
      if (!(await c.get('roomRepo').exists(id))) return c.json({ error: 'Room not found' }, 404);
      const claims = await c.get('seatClaimRepo').list(id);
      return c.json({ occupiedSeats: claims.map(claim => claim.seatId) });
    } catch (err) { return internalError(c, 'Could not load occupied seats', err); }
  })

  .get('/api/rooms/:id/seat-occupants', requireTeacher, async (c) => {
    try {
      const id = c.req.param('id') || '';
      if (!(await c.get('roomRepo').exists(id))) return c.json({ error: 'Room not found' }, 404);
      const claims = await c.get('seatClaimRepo').list(id);
      return c.json({ occupants: claims.map(({ seatId, studentId, studentName }) => ({ seatId, studentId, studentName })) });
    } catch (err) { return internalError(c, 'Could not load seat occupants', err); }
  })

  .delete('/api/rooms/:id/seats/:seatId', requireTeacher, async (c) => {
    const seatId = c.req.param('seatId') || '';
    if (!SeatCoordinateSchema.safeParse(seatId).success) return c.json({ error: 'Invalid seat' }, 400);
    try {
      const removedToken = await c.get('seatClaimRepo').releaseByTeacher(c.req.param('id') || '', seatId);
      // A one-way hash of the high-entropy token is safe to broadcast; never
      // expose the token itself or a student's identity to classmates.
      const evictedClaimTag = removedToken
        ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(removedToken))))
            .map(byte => byte.toString(16).padStart(2, '0')).join('')
        : null;
      return c.json({ success: true, removed: Boolean(removedToken), evictedClaimTag });
    } catch (err) { return internalError(c, 'Could not clear seat', err); }
  })

  .post('/api/rooms/:id/seat-claim', zValidator('json', SeatClaimInputSchema), async (c) => {
    const roomId = c.req.param('id');
    const student = await verifyStudent(c, roomId);
    if (!student) return c.json({ error: 'Unauthorized' }, 401);
    const { seatId, claimToken, restore } = c.req.valid('json');
    try {
      const room = await c.get('roomRepo').findById(roomId);
      if (!room || !room.isActive) return c.json({ error: 'Room unavailable' }, 403);
      const [x, y] = seatId.split(',').map(Number);
      if (!room.grid.some(seat => seat.x === x && seat.y === y && seat.type === 'student')) {
        return c.json({ error: 'Not a student seat' }, 400);
      }
      const existing = await c.get('seatClaimRepo').get(roomId, seatId);
      if (existing && claimToken && existing.studentId === student.studentId && existing.claimToken === claimToken) {
        return c.json({ claimToken, seatId });
      }
      if (restore || existing) return c.json({ error: 'Seat already occupied or session expired' }, 409);
      const issuedClaimToken = crypto.randomUUID();
      const claimed = await c.get('seatClaimRepo').tryClaim({
        roomId, seatId, studentId: student.studentId, studentName: student.studentName, claimToken: issuedClaimToken,
      });
      if (!claimed) return c.json({ error: 'Seat or student already assigned' }, 409);
      return c.json({ claimToken: issuedClaimToken, seatId }, 201);
    } catch (err) { return internalError(c, 'Could not claim seat', err); }
  })

  .post('/api/rooms/:id/seat-release', zValidator('json', SeatReleaseInputSchema), async (c) => {
    const roomId = c.req.param('id');
    const student = await verifyStudent(c, roomId);
    if (!student) return c.json({ error: 'Unauthorized' }, 401);
    try {
      const { seatId, claimToken } = c.req.valid('json');
      const released = await c.get('seatClaimRepo').release(roomId, seatId, student.studentId, claimToken);
      if (!released) return c.json({ error: 'Only the current holder can release this seat' }, 403);
      return c.json({ success: true });
    } catch (err) { return internalError(c, 'Could not release seat', err); }
  })

  .post('/api/rooms/:id/student-token', zValidator('json', StudentTokenInputSchema), async (c) => {
    const roomId = c.req.param('id');
    const { studentId, name } = c.req.valid('json');
    try {
      const room = await c.get('roomRepo').findById(roomId);
      if (!room) return c.json({ error: '指定された教室が見つかりません' }, 404);
      if (!room.isActive) return c.json({ error: 'Forbidden' }, 403);
      const now = Math.floor(Date.now() / 1000);
      const supabaseToken = await sign({
        role: 'authenticated', aud: 'authenticated', iss: 'supabase', iat: now, exp: now + 21_600,
        sub: `student:${roomId}:${studentId}`, user_role: 'student', studentId, name, roomId,
      }, getSecret(c.env, 'SUPABASE_JWT_SECRET'));
      return c.json({ supabaseToken, studentId, name, roomId });
    } catch (err) {
      return internalError(c, 'Student token could not be issued', err);
    }
  })

  .post('/api/rooms/:id/student-event', zValidator('json', StudentEventInputSchema), async (c) => {
    const roomId = c.req.param('id');
    const student = await verifyStudent(c, roomId);
    if (!student) return c.json({ error: 'Unauthorized' }, 401);
    const input = c.req.valid('json');
    const claimToken = c.req.header('X-Seat-Claim') || '';
    // A status reset/eviction is never a student broadcast; it needs a release operation.
    if ('status' in input && input.status === 'none') return c.json({ error: 'Use seat-release instead' }, 403);
    if (!(await c.get('seatClaimRepo').verify(roomId, input.seatId, student.studentId, claimToken))) {
      return c.json({ error: 'Seat session is not owned by this student' }, 403);
    }

    try {
      const room = await c.get('roomRepo').findById(roomId);
      if (!room || !room.isActive) return c.json({ error: 'Forbidden' }, 403);
      const configuredUrl = c.env?.SUPABASE_URL ? normalizeSupabaseUrl(c.env.SUPABASE_URL) : '';
      const serviceKey = c.env?.SUPABASE_SERVICE_ROLE_KEY?.trim();
      if (!configuredUrl || !serviceKey) {
        console.error(`[${ERROR_CODES.supabaseConfig}] Supabase relay configuration is unavailable`, {
          errorCode: ERROR_CODES.supabaseConfig,
          operation: 'student-event-relay-configuration',
          roomId,
          status: 503,
        });
        return c.json({ error: 'Student event could not be delivered', code: ERROR_CODES.supabaseConfig }, 503);
      }
      const relayTopic = `room:${roomId}:teacher`;
      let relayResponse: Response;
      try {
        relayResponse = await fetch(`${configuredUrl}/realtime/v1/api/broadcast/${encodeURIComponent(relayTopic)}/events/student_to_teacher?private=true`, {
          method: 'POST',
          headers: { apikey: serviceKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...c.req.valid('json'),
            studentId: student.studentId,
            studentName: student.studentName,
            updatedAt: new Date().toISOString(),
          }),
        });
      } catch (err) {
        console.error(`[${ERROR_CODES.realtimeRelay}] Supabase relay request failed`, {
          errorCode: ERROR_CODES.realtimeRelay,
          operation: 'student-event-relay',
          roomId,
          status: 502,
          error: err instanceof Error ? { name: err.name, message: redactDiagnosticText(err.message) } : { name: 'UnknownRelayError' },
        });
        return c.json({ error: 'Student event could not be delivered', code: ERROR_CODES.realtimeRelay }, 502);
      }
      if (!relayResponse.ok) {
        let responseBody = '';
        try {
          responseBody = redactDiagnosticText(await relayResponse.text());
        } catch {
          responseBody = '[unavailable]';
        }
        console.error(`[${ERROR_CODES.realtimeRelay}] Supabase relay failed`, {
          errorCode: ERROR_CODES.realtimeRelay,
          operation: 'student-event-relay',
          roomId,
          status: relayResponse.status,
          response: responseBody,
        });
        return c.json({ error: 'Student event could not be delivered', code: ERROR_CODES.realtimeRelay }, 502);
      }
      return c.json({ success: true });
    } catch (err) {
      return internalError(c, 'Student event could not be delivered', err);
    }
  })

  .get('/api/rooms', requireTeacher, async (c) => {
    try {
      return c.json({ rooms: await c.get('roomRepo').listAll() });
    } catch (err) {
      return internalError(c, 'Failed to fetch rooms', err);
    }
  })

  .post('/api/rooms', requireTeacher, enforceRoomPayloadLimit, zValidator('json', SaveRoomLayoutInputSchema), async (c) => {
    const body = c.req.valid('json');
    const id = crypto.randomUUID();
    try {
      await c.get('roomRepo').create({ id, name: body.name, grid: body.grid, isActive: body.isActive !== false });
      return c.json({ id, ...body, isActive: body.isActive !== false }, 201);
    } catch (err) {
      return internalError(c, 'Failed to create room', err);
    }
  })

  .put('/api/rooms/:id', requireTeacher, enforceRoomPayloadLimit, zValidator('json', SaveRoomLayoutInputSchema), async (c) => {
    const id = c.req.param('id')!;
    const body = c.req.valid('json');
    try {
      if (!(await c.get('roomRepo').exists(id))) return c.json({ error: 'Room not found' }, 404);
      await c.get('roomRepo').update(id, { name: body.name, grid: body.grid, isActive: body.isActive !== false });
      return c.json({ id, ...body, isActive: body.isActive !== false });
    } catch (err) {
      return internalError(c, 'Failed to update room', err);
    }
  })

  .patch('/api/rooms/:id/status', requireTeacher, zValidator('json', z.object({ isActive: z.boolean() }).strict()), async (c) => {
    const id = c.req.param('id')!;
    const { isActive: active } = c.req.valid('json');
    try {
      if (!(await c.get('roomRepo').exists(id))) return c.json({ error: 'Room not found' }, 404);
      await c.get('roomRepo').updateStatus(id, active);
      return c.json({ id, isActive: active });
    } catch (err) {
      return internalError(c, 'Failed to update status', err);
    }
  })

  .delete('/api/rooms/:id', requireTeacher, async (c) => {
    const id = c.req.param('id')!;
    try {
      if (!(await c.get('roomRepo').exists(id))) return c.json({ error: 'Room not found' }, 404);
      await c.get('roomRepo').delete(id);
      return c.json({ success: true, id });
    } catch (err) {
      return internalError(c, 'Failed to delete room', err);
    }
  })

  .post('/api/auth/teacher/login', zValidator('json', TeacherLoginInputSchema), async (c) => {
    const { username, password } = c.req.valid('json');
    const key = loginKey(c, username);
    if (isLoginBlocked(key)) {
      console.warn(`[${ERROR_CODES.teacherAuth}] Teacher login rate limited`, {
        errorCode: ERROR_CODES.teacherAuth,
        operation: 'teacher-login',
        status: 429,
      });
      return c.json({ error: 'Too Many Requests', code: ERROR_CODES.teacherAuth, retryAfter: 60 }, 429);
    }
    try {
      const jwtSecret = getSecret(c.env, 'JWT_SECRET');
      const supabaseJwtSecret = getSecret(c.env, 'SUPABASE_JWT_SECRET');
      const teacher = await c.get('teacherRepo').findByUsername(username);
      if (!teacher || !(await bcrypt.compare(password, teacher.passwordHash))) {
        recordLoginFailure(key);
        console.warn(`[${ERROR_CODES.teacherAuth}] Teacher login rejected`, {
          errorCode: ERROR_CODES.teacherAuth,
          operation: 'teacher-login',
          status: 401,
        });
        return c.json({ error: 'ユーザー名またはパスワードが正しくありません', code: ERROR_CODES.teacherAuth }, 401);
      }
      const now = Math.floor(Date.now() / 1000);
      const token = await sign({ sub: teacher.id, username: teacher.username, role: 'teacher', iat: now, exp: now + 86_400 }, jwtSecret);
      const supabaseToken = await sign({
        sub: teacher.id, role: 'authenticated', aud: 'authenticated', iss: 'supabase', iat: now, exp: now + 43_200,
        user_role: 'teacher', teacherId: teacher.id, userId: teacher.id,
      }, supabaseJwtSecret);
      failedLogins.delete(key);
      await c.get('teacherRepo').updateLastLogin(teacher.id, new Date().toISOString());
      return c.json({ token, supabaseToken, teacher: { id: teacher.id, username: teacher.username } });
    } catch (err) {
      return internalError(c, 'Teacher login is unavailable', err, ERROR_CODES.teacherAuth);
    }
  })

  .get('/api/teachers', requireTeacher, async (c) => {
    try {
      return c.json({ teachers: await c.get('teacherRepo').listAll() });
    } catch (err) {
      return internalError(c, '教員一覧の取得に失敗しました', err);
    }
  })

  .post('/api/teachers', requireTeacher, zValidator('json', TeacherLoginInputSchema), async (c) => {
    const { username, password } = c.req.valid('json');
    try {
      if (await c.get('teacherRepo').findByUsername(username)) return c.json({ error: 'このユーザー名はすでに登録されています' }, 400);
      const id = crypto.randomUUID();
      await c.get('teacherRepo').create({ id, username, passwordHash: await bcrypt.hash(password, 10) });
      return c.json({ success: true, teacher: { id, username } }, 201);
    } catch (err) {
      return internalError(c, '教員の登録に失敗しました', err);
    }
  })

  .delete('/api/teachers/:id', requireTeacher, async (c) => {
    const id = c.req.param('id')!;
    try {
      if (c.get('teacherAuthUser')?.sub === id) return c.json({ error: '現在ログイン中の自分自身のアカウントを削除することはできません' }, 400);
      await c.get('teacherRepo').delete(id);
      return c.json({ success: true, id });
    } catch (err) {
      return internalError(c, '教員の削除に失敗しました', err);
    }
  });

type DecoupledEnv = { Bindings: Omit<Bindings, 'DB'> & { DB: any }; Variables: Variables };
export type AppType = typeof routes extends Hono<any, infer S, infer O> ? Hono<DecoupledEnv, S, O> : never;

type ScheduledApp = typeof app & {
  scheduled: (controller: ScheduledController, env: Bindings, ctx: ExecutionContext) => void;
};

(app as ScheduledApp).scheduled = (_controller, env, ctx) => {
  ctx.waitUntil((async () => {
    try {
      await runSupabaseKeepAlive(env);
      console.info('[KEEPALIVE-DB-OK] Supabase keep-alive query succeeded');
    } catch (err) {
      console.error(`[${KEEPALIVE_ERROR_CODE}] Supabase keep-alive query failed`, {
        errorCode: KEEPALIVE_ERROR_CODE,
        operation: 'supabase-keep-alive',
        error: err instanceof Error ? { name: err.name, message: err.message } : { name: 'UnknownKeepAliveError' },
      });
      throw err;
    }
  })());
};

export default app;
