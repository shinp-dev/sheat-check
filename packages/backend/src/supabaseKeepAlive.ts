export type SupabaseKeepAliveEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

export const KEEPALIVE_ERROR_CODE = 'KEEPALIVE-DB-01';

const normalizeSupabaseUrl = (url: string) => url.trim().replace(/\/+$/, '');

export async function runSupabaseKeepAlive(
  env: SupabaseKeepAliveEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const supabaseUrl = env.SUPABASE_URL ? normalizeSupabaseUrl(env.SUPABASE_URL) : '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase keep-alive configuration is unavailable');
  }

  const response = await fetchImpl(
    `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1`,
    {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Supabase keep-alive query failed with HTTP ${response.status}`);
  }
}
