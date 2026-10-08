export interface SeatClaim {
  roomId: string;
  seatId: string;
  studentId: string;
  studentName: string;
  claimToken: string;
}

export interface SeatClaimRepository {
  list(roomId: string): Promise<SeatClaim[]>;
  get(roomId: string, seatId: string): Promise<SeatClaim | null>;
  tryClaim(claim: SeatClaim): Promise<boolean>;
  release(roomId: string, seatId: string, studentId: string, claimToken: string): Promise<boolean>;
  releaseByTeacher(roomId: string, seatId: string): Promise<string | null>;
  verify(roomId: string, seatId: string, studentId: string, claimToken: string): Promise<boolean>;
}

export class D1SeatClaimRepository implements SeatClaimRepository {
  constructor(private readonly db: D1Database) {}

  async list(roomId: string): Promise<SeatClaim[]> {
    const result = await this.db.prepare(
      'SELECT room_id, seat_id, student_id, student_name, claim_token FROM seat_claims WHERE room_id = ?',
    ).bind(roomId).all<{
      room_id: string; seat_id: string; student_id: string; student_name: string; claim_token: string;
    }>();
    return (result.results || []).map(row => ({
      roomId: row.room_id, seatId: row.seat_id, studentId: row.student_id,
      studentName: row.student_name, claimToken: row.claim_token,
    }));
  }

  async get(roomId: string, seatId: string): Promise<SeatClaim | null> {
    const row = await this.db.prepare(
      'SELECT room_id, seat_id, student_id, student_name, claim_token FROM seat_claims WHERE room_id = ? AND seat_id = ?',
    ).bind(roomId, seatId).first<{
      room_id: string; seat_id: string; student_id: string; student_name: string; claim_token: string;
    }>();
    return row ? {
      roomId: row.room_id, seatId: row.seat_id, studentId: row.student_id,
      studentName: row.student_name, claimToken: row.claim_token,
    } : null;
  }

  async tryClaim(claim: SeatClaim): Promise<boolean> {
    // D1's unique constraints serialize competing claims across Workers/devices.
    const result = await this.db.prepare(
      'INSERT INTO seat_claims (room_id, seat_id, student_id, student_name, claim_token) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    ).bind(claim.roomId, claim.seatId, claim.studentId, claim.studentName, claim.claimToken).run();
    return result.meta.changes === 1;
  }

  async release(roomId: string, seatId: string, studentId: string, claimToken: string): Promise<boolean> {
    const result = await this.db.prepare(
      'DELETE FROM seat_claims WHERE room_id = ? AND seat_id = ? AND student_id = ? AND claim_token = ?',
    ).bind(roomId, seatId, studentId, claimToken).run();
    return result.meta.changes === 1;
  }

  async releaseByTeacher(roomId: string, seatId: string): Promise<string | null> {
    const claim = await this.get(roomId, seatId);
    if (!claim) return null;
    // Conditional DELETE is safe if the old occupant released the seat and a
    // new student claimed it between the read and delete.
    const removed = await this.db.prepare(
      'DELETE FROM seat_claims WHERE room_id = ? AND seat_id = ? AND claim_token = ?',
    ).bind(roomId, seatId, claim.claimToken).run();
    return removed.meta.changes === 1 ? claim.claimToken : null;
  }

  async verify(roomId: string, seatId: string, studentId: string, claimToken: string): Promise<boolean> {
    const result = await this.db.prepare(
      'SELECT 1 AS claimed FROM seat_claims WHERE room_id = ? AND seat_id = ? AND student_id = ? AND claim_token = ?',
    ).bind(roomId, seatId, studentId, claimToken).first<{ claimed: number }>();
    return result?.claimed === 1;
  }
}
