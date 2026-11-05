import { z } from 'zod';
export const promptReferenceSchema = z.object({
  id: z.string().min(1).max(120), versionId: z.string().min(1).max(120),
  name: z.string().max(100), appliedAt: z.iso.datetime(),
});
