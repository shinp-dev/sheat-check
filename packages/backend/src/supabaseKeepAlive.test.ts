import { describe, expect, it, vi } from 'vitest';
import { runSupabaseKeepAlive } from './supabaseKeepAlive';

describe('runSupabaseKeepAlive', () => {
  it('performs a small authenticated database-backed Supabase request', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ users: [] }), { status: 200 }));

    await runSupabaseKeepAlive(
      {
        SUPABASE_URL: 'https://example.supabase.co/',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      },
      fetchMock as typeof fetch,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/admin/users?page=1&per_page=1',
      {
        method: 'GET',
        headers: {
          apikey: 'service-role-key',
          Authorization: 'Bearer service-role-key',
        },
      },
    );
  });

  it('fails closed when configuration is missing', async () => {
    await expect(runSupabaseKeepAlive({}, vi.fn() as unknown as typeof fetch)).rejects.toThrow(
      'Supabase keep-alive configuration is unavailable',
    );
  });

  it('reports only the HTTP status on Supabase failure', async () => {
    const fetchMock = vi.fn(async () => new Response('secret-looking-response', { status: 401 }));

    await expect(
      runSupabaseKeepAlive(
        {
          SUPABASE_URL: 'https://example.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        },
        fetchMock as typeof fetch,
      ),
    ).rejects.toThrow('Supabase keep-alive query failed with HTTP 401');
  });
});
