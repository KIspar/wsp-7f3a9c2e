export type LayerEntry = {
  id: string;
  ancestors: readonly string[];
  kind: "transient" | "modal";
  dismiss: () => void;
};

/** Keep one transient branch open; modal ancestors and nested dialogs may coexist. */
export class LayerCoordinator {
  private active = new Map<string, LayerEntry>();

  open(entry: LayerEntry) {
    if (this.active.has(entry.id)) return;
    const displaced = [...this.active.values()].filter(layer =>
      layer.kind === "transient" && !entry.ancestors.includes(layer.id)
    );
    // Register the destination before dismissing peers, so delayed cleanup cannot
    // remove it and closing layers know that focus belongs to the new layer.
    this.active.set(entry.id, entry);
    for (const layer of displaced) this.active.delete(layer.id);
    for (const layer of displaced) layer.dismiss();
  }

  close(id: string) {
    this.active.delete(id);
    const descendants = [...this.active.values()].filter(layer => layer.ancestors.includes(id));
    for (const layer of descendants) this.active.delete(layer.id);
    for (const layer of descendants) layer.dismiss();
  }
}
