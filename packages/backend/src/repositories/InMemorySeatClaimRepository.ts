import type { SeatClaim, SeatClaimRepository } from './SeatClaimRepository';

/** Test adapter with the same exclusive-room/seat and one-seat-per-student rules as D1. */
export class InMemorySeatClaimRepository implements SeatClaimRepository {
  private readonly claims = new Map<string, SeatClaim>();
  private key(roomId: string, seatId: string) { return `${roomId}:${seatId}`; }

  async list(roomId: string) { return [...this.claims.values()].filter(claim => claim.roomId === roomId); }
  async get(roomId: string, seatId: string) { return this.claims.get(this.key(roomId, seatId)) || null; }

  async tryClaim(claim: SeatClaim) {
    if (this.claims.has(this.key(claim.roomId, claim.seatId)) ||
        [...this.claims.values()].some(row => row.roomId === claim.roomId && row.studentId === claim.studentId)) {
      return false;
    }
    this.claims.set(this.key(claim.roomId, claim.seatId), { ...claim });
    return true;
  }

  async release(roomId: string, seatId: string, studentId: string, claimToken: string) {
    if (!(await this.verify(roomId, seatId, studentId, claimToken))) return false;
    return this.claims.delete(this.key(roomId, seatId));
  }

  async releaseByTeacher(roomId: string, seatId: string) { return this.claims.delete(this.key(roomId, seatId)); }

  async verify(roomId: string, seatId: string, studentId: string, claimToken: string) {
    const claim = await this.get(roomId, seatId);
    return Boolean(claim && claim.studentId === studentId && claim.claimToken === claimToken);
  }
}
