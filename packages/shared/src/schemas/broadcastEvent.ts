import { z } from 'zod';
import { SeatStatusTypeSchema } from './seatStatus';

/**
 * 1. 学生から教員への送信フォーマット
 * Format for data sent from a student to the teacher.
 */
export const StudentStatusEventSchema = z.object({
  seatId: z.string().regex(/^(?:[0-9]|1[01]),(?:[0-9]|1[01])$/, 'Seat ID must be an in-range grid coordinate'),
  status: SeatStatusTypeSchema,
  studentName: z.string().trim().min(1).max(100),
  studentId: z.string().trim().regex(/^[A-Z0-9]{5,15}$/i, 'Student ID must be 5-15 alphanumeric characters'),
  comment: z.string().max(1000).nullable().optional(),
  anonymous: z.boolean().optional(),
}).strict();

/** A comment is independent of the student's current seat status. */
export const StudentCommentEventSchema = StudentStatusEventSchema.omit({
  status: true,
  comment: true,
}).extend({
  kind: z.literal('comment'),
  comment: z.string().max(1000).trim().min(1),
}).strict();

export const StudentToTeacherEventSchema = z.union([
  StudentStatusEventSchema,
  StudentCommentEventSchema,
]);

/** Student input accepted by the authenticated HTTP relay. Identity comes from JWT claims. */
export const StudentEventInputSchema = z.union([
  StudentStatusEventSchema.omit({ studentName: true, studentId: true }).strict(),
  StudentCommentEventSchema.omit({ studentName: true, studentId: true }).strict(),
]);

/**
 * 2. 教員から全学生へのリセット信号フォーマット
 * Format for the reset signal sent from a teacher to all students.
 */
export const TeacherResetEventSchema = z.object({
  reset: z.literal(true),
});

/**
 * 3. 共通ブロードキャストイベント（送信・受信メッセージの判別用）
 * Combined broadcast event schema utilizing discriminated union for type-safe message parsing.
 */
export const BroadcastEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('student_to_teacher'),
    payload: StudentToTeacherEventSchema,
  }),
  z.object({
    type: z.literal('teacher_reset'),
    payload: TeacherResetEventSchema,
  }),
]);
