/** Seat ownership is server-authoritative. A student's name/ID alone never grants a seat. */
const apiUrl = (roomId: string, endpoint: string) => {
  const root = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '');
  return `${root}/api/rooms/${encodeURIComponent(roomId)}/${endpoint}`;
};

export async function claimStudentSeat(
  roomId: string, jwt: string, seatId: string, existingToken?: string, restore = false,
): Promise<{ status: number; token?: string }> {
  const response = await fetch(apiUrl(roomId, 'seat-claim'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatId, ...(existingToken ? { claimToken: existingToken } : {}), ...(restore ? { restore: true } : {}) }),
  });
  if (!response.ok) return { status: response.status };
  const result: { claimToken: string } = await response.json();
  return { status: response.status, token: result.claimToken };
}

export async function releaseStudentSeat(roomId: string, jwt: string, seatId: string, claimToken: string): Promise<boolean> {
  const response = await fetch(apiUrl(roomId, 'seat-release'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ seatId, claimToken }),
  });
  return response.ok;
}

// Compare an opaque digest rather than including a student ID or claim token in broadcasts.
export async function fingerprintClaimToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
