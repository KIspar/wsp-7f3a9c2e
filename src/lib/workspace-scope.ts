export const WORKSPACE_STORAGE_KEY = "creative-studio-workspaces-v1";
export const ACTIVE_WORKSPACE_KEY = "creative-studio-active-workspace-v1";
export const DEFAULT_WORKSPACE_ID = "douyin-cn-fashion";

export function currentWorkspaceId(): string {
  try {
    const activeId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    if (activeId && /^[a-zA-Z0-9_-]{1,120}$/.test(activeId)) return activeId;
  } catch { /* Use the first-run workspace outside a browser context. */ }
  return DEFAULT_WORKSPACE_ID;
}
