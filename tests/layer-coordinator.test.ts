import { describe, expect, it, vi } from "vitest";
import { LayerCoordinator, type LayerEntry } from "../src/lib/layer-coordinator";

function layer(id: string, ancestors: string[] = [], kind: LayerEntry["kind"] = "transient"): LayerEntry {
  return { id, ancestors, kind, dismiss: vi.fn() };
}

describe("interactive layer coordination", () => {
  it("dismisses sibling menus and mixed popovers, even when old cleanup arrives late", () => {
    const state = new LayerCoordinator();
    const ratio = layer("ratio"), language = layer("language"), upload = layer("upload");
    state.open(ratio); state.open(language); state.close(ratio.id); state.open(upload);
    expect(ratio.dismiss).toHaveBeenCalledOnce();
    expect(language.dismiss).toHaveBeenCalledOnce();
    expect(upload.dismiss).not.toHaveBeenCalled();
  });

  it("keeps the calendar while switching its nested year and month dropdowns", () => {
    const state = new LayerCoordinator();
    const date = layer("date"), year = layer("year", ["date"]), month = layer("month", ["date"]);
    state.open(date); state.open(year); state.open(month);
    expect(date.dismiss).not.toHaveBeenCalled();
    expect(year.dismiss).toHaveBeenCalledOnce();
    expect(month.dismiss).not.toHaveBeenCalled();
    state.close("date");
    expect(month.dismiss).toHaveBeenCalledOnce();
  });

  it("closes open menus when opening a modal and preserves nested dialogs", () => {
    const state = new LayerCoordinator();
    const upload = layer("upload"), dialog = layer("dialog", [], "modal");
    const model = layer("model", ["dialog"]), preview = layer("preview", ["dialog"], "modal");
    state.open(upload); state.open(dialog); state.open(model); state.open(preview);
    expect(upload.dismiss).toHaveBeenCalledOnce();
    expect(model.dismiss).toHaveBeenCalledOnce();
    expect(dialog.dismiss).not.toHaveBeenCalled();
    expect(preview.dismiss).not.toHaveBeenCalled();
  });

  it("does not revive an unmounted branch or dismiss a newer unrelated menu", () => {
    const state = new LayerCoordinator();
    const parent = layer("parent", [], "modal"), child = layer("child", ["parent"]), next = layer("next");
    state.open(parent); state.open(child); state.close("parent"); state.open(next); state.close("child");
    expect(child.dismiss).toHaveBeenCalledOnce();
    expect(next.dismiss).not.toHaveBeenCalled();
    state.open(next);
    expect(next.dismiss).not.toHaveBeenCalled();
  });
});
