import {registerBackgroundSave} from './background-save-registry';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Bootstrap, Draft, SavedDraft, Snapshot } from "../../packages/contracts";
import {cacheDraft,readCachedDraft} from "./background-persistence";
import {whenCanvasIdle} from "./canvas-autosave";
import { api, bootstrap, snapshot } from "./api";
import { currentWorkspaceId, DEFAULT_WORKSPACE_ID } from "./workspace-scope";

type LocalDraft = SavedDraft & { edit: number; savedEdit: number; savedAt?: number; saveError?: boolean };
type StudioValue = {
  boot: Bootstrap; snapshot: Snapshot; disconnected: boolean;
  draft: (id: string) => Draft;
  draftStatus: (id: string) => { pending: boolean; savedAt?: number; error: boolean };
  updateDraft: (id: string, value: Draft) => void;
  flushDraft: (id: string) => Promise<SavedDraft>;
  acceptDraft: (draft: SavedDraft) => void;
  refresh: () => Promise<void>;
};
const StudioContext = createContext<StudioValue | null>(null);
const emptySnapshot: Snapshot = { batches: [], assets: [], ledger: [], eventId: 0 };
export function StudioProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const boot = useQuery({ queryKey: ["bootstrap"], queryFn: bootstrap, staleTime: Infinity, retry: 1 });
  const state = useQuery({ queryKey: ["snapshot"], queryFn: snapshot, enabled: !!boot.data, refetchInterval: 1200, retry: 1,
    structuralSharing: (old, next) => {
      const before = old as Snapshot | undefined;
      const after = next as Snapshot;
      return before && before.eventId > after.eventId ? before : after;
    },
  });
  const drafts = useRef(new Map<string, LocalDraft>());
  const workspaceId = currentWorkspaceId();
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const idleSaves=useRef(new Map<string,()=>void>());
  const queues = useRef(new Map<string, Promise<SavedDraft>>());
  const [, rerender] = useState(0);
  if (boot.data) {
    for (const saved of boot.data.drafts) {
      const existing=drafts.current.get(saved.skillId);
      // Untouched, unsaved drafts may inherit newly connected default models.
      if (existing && !(existing.revision===0 && existing.edit===0 && saved.revision===0)) continue;
      let value = saved.value;
      try {
        const local = JSON.parse(localStorage.getItem(`studio-draft-${workspaceId}-${saved.skillId}`) || (workspaceId === DEFAULT_WORKSPACE_ID ? localStorage.getItem(`studio-draft-${saved.skillId}`) : "null") || "null");
        if (local?.revision === saved.revision) value = local.value;
      } catch { /* Ignore an invalid local cache; the persisted server draft remains authoritative. */ }
      drafts.current.set(saved.skillId, { ...saved, value, edit: JSON.stringify(value) !== JSON.stringify(saved.value) ? 1 : 0, savedEdit: 0 });
    }
  }
  const cache = (saved: LocalDraft) => {
    cacheDraft(`studio-draft-${workspaceId}-${saved.skillId}`, { revision: saved.revision, value: saved.value });
  };
  const flushDraft = (id: string): Promise<SavedDraft> => {
    clearTimeout(timers.current.get(id));idleSaves.current.get(id)?.();idleSaves.current.delete(id);
    const previous = queues.current.get(id) || Promise.resolve(drafts.current.get(id)!);
    const pending = previous.catch(() => drafts.current.get(id)!).then(async () => {
      let doc = drafts.current.get(id)!;
      while (doc.savedEdit !== doc.edit) {
        const edit = doc.edit;
        let saved: SavedDraft;
        try {
          saved = await api<SavedDraft>(`/drafts/${id}`, { draft: doc.value, revision: doc.revision }, "PUT");
        } catch (error) {
          drafts.current.set(id, { ...drafts.current.get(id)!, saveError: true });
          rerender((v) => v + 1);
          throw error;
        }
        const hadError=doc.saveError;
        doc = { ...drafts.current.get(id)!, revision: saved.revision, savedEdit: edit, savedAt: Date.now(), saveError: false };
        drafts.current.set(id, doc);
        cache(doc);
        if(hadError)rerender((v) => v + 1);
      }
      return { skillId: id, revision: doc.revision, value: doc.value };
    });
    queues.current.set(id, pending);
    return pending;
  };
  const updateDraft = (id: string, value: Draft) => {
    const current = drafts.current.get(id)!;
    const next = { ...current, value, edit: current.edit + 1, saveError: false };
    drafts.current.set(id, next);
    cache(next);
    rerender((v) => v + 1);
    clearTimeout(timers.current.get(id));idleSaves.current.get(id)?.();idleSaves.current.delete(id);
    timers.current.set(id, setTimeout(() => { idleSaves.current.set(id,whenCanvasIdle(()=>{idleSaves.current.delete(id);void flushDraft(id).catch((e: Error) => toast.error(e.message, { id: `draft-${id}` }));})); }, 1500));
  };
  const acceptDraft = (saved: SavedDraft) => {
    clearTimeout(timers.current.get(saved.skillId));idleSaves.current.get(saved.skillId)?.();idleSaves.current.delete(saved.skillId);
    const next = { ...saved, edit: 0, savedEdit: 0, savedAt: Date.now() };
    drafts.current.set(saved.skillId, next);
    cache(next);
    rerender((v) => v + 1);
  };
  useEffect(() => {
    for (const [id, doc] of drafts.current) {
      if (doc.edit !== doc.savedEdit && !timers.current.has(id) && !queues.current.has(id)) {
        timers.current.set(id, setTimeout(() => { idleSaves.current.set(id,whenCanvasIdle(()=>{idleSaves.current.delete(id);void flushDraft(id).catch((e: Error) => toast.error(e.message, { id: `draft-${id}` }));})); }, 1500));
      }
    }
  }, [boot.data]);
  useEffect(()=>{
    let active=true;
    if(boot.data)for(const saved of boot.data.drafts)void readCachedDraft<{revision:number;value:Draft}>(`studio-draft-${workspaceId}-${saved.skillId}`).then(cached=>{
      const doc=drafts.current.get(saved.skillId);
      if(active&&cached&&doc&&doc.edit===0&&cached.revision===doc.revision&&JSON.stringify(cached.value)!==JSON.stringify(doc.value))updateDraft(saved.skillId,cached.value);
    }).catch(e=>toast.error(e.message));
    return()=>{active=false;};
  },[boot.data]);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer);for(const cancel of idleSaves.current.values())cancel();for(const [id,doc] of drafts.current)if(doc.edit!==doc.savedEdit)void flushDraft(id).catch(()=>{}); }, []);
  const latestFlush=useRef(flushDraft);latestFlush.current=flushDraft;
  useEffect(()=>registerBackgroundSave(async()=>{for(const [id,doc] of drafts.current)if(doc.edit!==doc.savedEdit)await latestFlush.current(id);}),[]);
  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["bootstrap"] }), queryClient.invalidateQueries({ queryKey: ["snapshot"] })]);
  };
  if (!boot.data) return <div className="startup"><img src="/favicon.svg" alt="" /><h1>AI 创作工作台</h1><p>{boot.error ? "本地服务未连接" : "正在打开工作台…"}</p>{boot.error && <button onClick={() => void boot.refetch()}>重新连接</button>}</div>;
  return <StudioContext.Provider value={{
    boot: boot.data, snapshot: state.data || emptySnapshot, disconnected: state.isError,
    draft: (id) => drafts.current.get(id)!.value,
    draftStatus: (id) => {
      const doc = drafts.current.get(id)!;
      return { pending: doc.edit !== doc.savedEdit, savedAt: doc.savedAt, error: !!doc.saveError };
    },
    updateDraft, flushDraft, acceptDraft, refresh,
  }}>{children}</StudioContext.Provider>;
}
export function useStudio() {
  const value = useContext(StudioContext);
  if (!value) throw new Error("StudioProvider missing");
  return value;
}
