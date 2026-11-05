import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { LayerScope, useLayerCloseAutoFocus, useLayerScope } from "./layer-scope";
function Popover({open,defaultOpen,onOpenChange,...props}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const layer=useLayerScope({open,defaultOpen,onOpenChange});
  return <LayerScope.Provider value={layer.scope}><PopoverPrimitive.Root data-slot="popover" {...props} open={layer.open} onOpenChange={layer.onOpenChange}/></LayerScope.Provider>;
}
function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) { return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />; }
function PopoverContent({className,align="center",sideOffset=6,onCloseAutoFocus,...props}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const closeAutoFocus=useLayerCloseAutoFocus(onCloseAutoFocus);
  return <PopoverPrimitive.Portal><PopoverPrimitive.Content data-slot="popover-content" align={align} sideOffset={sideOffset} collisionPadding={12} className={cn("z-50 w-80 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none",className)} {...props} onCloseAutoFocus={closeAutoFocus}/></PopoverPrimitive.Portal>;
}
export { Popover, PopoverTrigger, PopoverContent };
