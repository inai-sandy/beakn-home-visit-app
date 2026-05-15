import { z } from 'zod';

// Task creation form (task_type, description, estimated_time, link to entity, date).
// Filled by HVA-58 (Add Task UI) — that issue will also pin the estimatedTime
// enum values that are currently varchar(32) in the schema per HVA-14 DEFERRED note.

export const taskSchema = z.object({});

export type TaskInput = z.infer<typeof taskSchema>;
