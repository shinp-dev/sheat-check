import { z } from 'zod';
import {
  StudentToTeacherEventSchema,
  StudentEventInputSchema,
  TeacherResetEventSchema,
  BroadcastEventSchema,
} from '../schemas/broadcastEvent';

export type StudentToTeacherEvent = z.infer<typeof StudentToTeacherEventSchema>;
export type StudentEventInput = z.infer<typeof StudentEventInputSchema>;
export type TeacherResetEvent = z.infer<typeof TeacherResetEventSchema>;
export type BroadcastEvent = z.infer<typeof BroadcastEventSchema>;
