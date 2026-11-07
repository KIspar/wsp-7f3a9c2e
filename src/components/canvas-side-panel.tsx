import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import {useMediaQuery} from '@/lib/use-media-query';
import {Sheet,SheetContent,SheetTitle} from './ui/sheet';
import { canvasPanelLimits, defaultCanvasPanelWidth } from '@/lib/canvas-interaction';

/** Resize only this layout; keep the graph outside the per-pointer React update path. */
type CanvasSidePanelProps = {
  stageRef: RefObject<HTMLDivElement | null>;
  width: number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
  children: ReactNode;
  onClose: () => void;
};

export function CanvasSidePanel(props:CanvasSidePanelProps){
  const narrow=useMediaQuery('(max-width: 760px)');
  if(narrow)return <Sheet open onOpenChange={open=>{if(!open)props.onClose();}}><SheetContent side="left" className="canvas-panel-drawer" showCloseButton={false} aria-describedby={undefined}><SheetTitle className="sr-only">画布侧栏</SheetTitle>{props.children}</SheetContent></Sheet>;
  return <ResizableCanvasSidePanel {...props}/>;
}

function ResizableCanvasSidePanel({stageRef,width,onResize,onCommit,children}:CanvasSidePanelProps) {
  const panelRef = usePanelRef();
  const callbacks = useRef({ onResize, onCommit });
  callbacks.current = { onResize, onCommit };
  const [stageWidth, setStageWidth] = useState(() => stageRef.current?.clientWidth || 1024);
  const limits = canvasPanelLimits(stageWidth);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width));
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stageRef]);
  const resize = useCallback(({ inPixels }: { inPixels: number }) => {
    callbacks.current.onResize(inPixels);
  }, []);
  const reset = () => {
    const next = Math.max(limits.min, Math.min(limits.max, defaultCanvasPanelWidth));
    panelRef.current?.resize(next);
    callbacks.current.onCommit(defaultCanvasPanelWidth);
  };
  return <div className="canvas-panel-layout">
    <Group className="canvas-panel-group" orientation="horizontal" resizeTargetMinimumSize={{ fine: 12, coarse: 24 }}
      onLayoutChanged={(_, meta) => {
        if (meta.isUserInteraction) {
          const next = panelRef.current?.getSize().inPixels;
          if (next !== undefined) callbacks.current.onCommit(next);
        }
      }}>
      <Panel id="canvas-sidebar" className="canvas-panel-slot" panelRef={panelRef} defaultSize={width} minSize={limits.min} maxSize={limits.max} groupResizeBehavior="preserve-pixel-size" onResize={resize}>
        {children}
      </Panel>
      <Separator className="canvas-panel-resizer" aria-label="调整画布侧栏宽度" title="拖动调整宽度；双击恢复默认宽度" disableDoubleClick
        onDoubleClick={reset} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); reset(); }
        }}><span aria-hidden="true"/></Separator>
      <Panel id="canvas-space" minSize={Math.min(360, stageWidth * .55)} className="canvas-panel-space"/>
    </Group>
  </div>;
}
