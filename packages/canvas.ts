import { z } from 'zod';

export const canvasNodeSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['image', 'video', 'text', 'tool']),
  title: z.string().trim().min(1).max(120),
  text: z.string().max(10000).default(''),
  assetId: z.string().max(120).optional(),
  toolId: z.string().max(80).optional(),
  modelId: z.string().max(100).optional(),
  aspectRatio: z.string().max(30).optional(),
  duration: z.number().int().min(1).max(60).optional(),
  width: z.number().finite().min(180).max(1200).optional(),
  x: z.number().finite().min(-10_000_000).max(10_000_000),
  y: z.number().finite().min(-10_000_000).max(10_000_000),
});
export const canvasEdgeSchema = z.object({
  id: z.string().uuid(),
  source: z.string().uuid(),
  target: z.string().uuid(),
});
export const canvasViewportSchema = z.object({
  x: z.number().finite().min(-10_000_000).max(10_000_000),
  y: z.number().finite().min(-10_000_000).max(10_000_000),
  zoom: z.number().finite().min(0.1).max(4),
});
export const canvasGroupSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string().uuid()).min(1).max(500),
});
export const canvasSaveSchema = z.object({
  revision: z.number().int().nonnegative(),
  nodes: z.array(canvasNodeSchema).max(500),
  edges: z.array(canvasEdgeSchema).max(1000),
  groups: z.array(canvasGroupSchema).max(100).default([]),
  viewport: canvasViewportSchema,
}).superRefine((value, context) => {
  const ids = new Set(value.nodes.map(node => node.id));
  if (ids.size !== value.nodes.length) context.addIssue({code:'custom', message:'画布节点编号重复'});
  if (new Set(value.edges.map(edge => edge.id)).size !== value.edges.length) context.addIssue({code:'custom', message:'画布连线编号重复'});
  if (value.edges.some(edge => !ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target)) context.addIssue({code:'custom', message:'画布连线引用了无效节点'});
  if (new Set(value.groups.map(group => group.id)).size !== value.groups.length) context.addIssue({code:'custom', message:'画布分组编号重复'});
  const grouped = new Set<string>();
  for (const group of value.groups) {
    if (new Set(group.memberIds).size !== group.memberIds.length || group.memberIds.some(id => !ids.has(id))) context.addIssue({code:'custom', message:'画布分组引用了无效节点'});
    for (const id of group.memberIds) {
      if (grouped.has(id)) context.addIssue({code:'custom', message:'一个节点只能属于一个分组'});
      grouped.add(id);
    }
  }
});
export type CanvasNodeRecord = z.infer<typeof canvasNodeSchema>;
export type CanvasGroupRecord = z.infer<typeof canvasGroupSchema>;
export type CanvasDocument = z.infer<typeof canvasSaveSchema> & {updatedAt: string | null};
export type CanvasBoard = {id:string;name:string;createdAt:string;updatedAt:string};
export const emptyCanvas: CanvasDocument = {revision:0,nodes:[],edges:[],groups:[],viewport:{x:0,y:0,zoom:1},updatedAt:null};
