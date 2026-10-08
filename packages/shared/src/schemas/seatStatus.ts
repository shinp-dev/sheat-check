import { z } from 'zod';

export const SeatStatusTypeSchema = z.enum(['ok', 'ng', 'none'], {
  description: 'Seat status: ok (good/present), ng (need attention), or none (empty/unselected)',
});

export const SeatStatusSchema = z.object({
  seatId: z.string().min(1, 'Seat ID is required'),
  status: SeatStatusTypeSchema,
  comment: z.string().nullable().optional(),
  studentName: z.string().nullable().optional(),
  updatedAt: z.string().min(1, 'Updated timestamp/date is required'),
});

export const LiveSeatStatusSchema = z.object({
  status: SeatStatusTypeSchema,
  name: z.string(),
  studentId: z.string().optional(),
  answeredAt: z.string().optional(),
  comment: z.string().nullable().optional(),
});

export const RealtimeLogSchema = z.object({
  id: z.string(),
  studentName: z.string(),
  studentId: z.string().optional(),
  seatId: z.string(),
  status: SeatStatusTypeSchema.optional(),
  comment: z.string().nullable().optional(),
  timestamp: z.string(),
});
