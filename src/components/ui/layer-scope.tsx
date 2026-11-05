import * as React from "react";
import { LayerCoordinator, type LayerEntry } from "@/lib/layer-coordinator";

const coordinator = new LayerCoordinator();
type Scope = { id: string; ancestors: readonly string[]; restoreFocus: () => boolean; returnFocus: React.RefObject<HTMLElement | null> };
export const LayerScope = React.createContext<Scope | null>(null);

function captureReturnFocus(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let target = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  // A modal may replace a popover whose action button will be unmounted. Return
  // to its surviving trigger rather than leaving keyboard users on document.body.
  let content = target?.closest('[data-slot="popover-content"], [data-slot="select-content"]');
  while (content?.id) {
    const trigger = [...document.querySelectorAll<HTMLElement>("[aria-controls]")].find(element => element.getAttribute("aria-controls") === content!.id);
    if (!trigger || trigger === target) break;
    target = trigger;
    content = target.closest('[data-slot="popover-content"], [data-slot="select-content"]');
  }
  return target;
}

/** Coordinates controlled and uncontrolled Radix roots, including portalled children. */
export function useLayerScope({ open, defaultOpen = false, onOpenChange, kind = "transient" }: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  kind?: LayerEntry["kind"];
}) {
  const parent = React.useContext(LayerScope);
  const id = React.useId();
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isOpen = open ?? internalOpen;
  const wasOpen = React.useRef(false);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  if (isOpen && !wasOpen.current) returnFocus.current = captureReturnFocus();
  wasOpen.current = isOpen;
  const superseded = React.useRef(false);
  const callback = React.useRef(onOpenChange);
  callback.current = onOpenChange;
  const scope = React.useMemo<Scope>(() => ({
    id,
    ancestors: parent ? [...parent.ancestors, parent.id] : [],
    restoreFocus: () => !superseded.current,
    returnFocus,
  }), [id, parent]);
  const entry = React.useMemo<LayerEntry>(() => ({
    id, ancestors: scope.ancestors, kind,
    dismiss: () => {
      superseded.current = true;
      setInternalOpen(false);
      callback.current?.(false);
    },
  }), [id, scope, kind]);

  React.useLayoutEffect(() => {
    if (isOpen) {
      superseded.current = false;
      coordinator.open(entry);
    } else coordinator.close(id);
  }, [isOpen, entry, id]);
  React.useLayoutEffect(() => () => coordinator.close(id), [id]);

  const changeOpen = React.useCallback((next: boolean) => {
    if (next) {
      superseded.current = false;
      coordinator.open(entry);
    } else coordinator.close(id);
    setInternalOpen(next);
    callback.current?.(next);
  }, [entry, id]);
  return { scope, open: isOpen, onOpenChange: changeOpen };
}

export function useLayerCloseAutoFocus(handler?: (event: Event) => void) {
  const scope = React.useContext(LayerScope);
  return (event: Event) => {
    handler?.(event);
    if (scope && !scope.restoreFocus()) event.preventDefault();
  };
}

export function useModalFocus() {
  const scope = React.useContext(LayerScope);
  return {
    onCloseAutoFocus: (event: Event) => {
      const target = scope?.returnFocus.current;
      if (target?.isConnected && !target.closest('[inert], [data-slot="popover-content"][data-state="closed"], [data-slot="select-content"][data-state="closed"], [data-slot="dialog-content"][data-state="closed"], [data-slot="sheet-content"][data-state="closed"]')) {
        event.preventDefault();
        target.focus({ preventScroll: true });
      }
    },
  };
}
