import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { LayerScope, useLayerCloseAutoFocus, useLayerScope } from "./layer-scope";

function Select({ open, defaultOpen, onOpenChange, ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const layer = useLayerScope({ open, defaultOpen, onOpenChange });
  return <LayerScope.Provider value={layer.scope}><SelectPrimitive.Root data-slot="select" {...props} open={layer.open} onOpenChange={layer.onOpenChange} /></LayerScope.Provider>;
}
function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) { return <SelectPrimitive.Group data-slot="select-group" {...props} />; }
function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) { return <SelectPrimitive.Value data-slot="select-value" {...props} />; }
function SelectTrigger({ className, size = "default", children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: "sm" | "default" }) {
  return <SelectPrimitive.Trigger data-slot="select-trigger" data-size={size} className={cn("flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-secondary/70 px-3 text-sm font-semibold shadow-xs outline-none transition-[color,box-shadow] hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive data-[placeholder]:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-9 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_[data-slot=select-value]]:truncate", className)} {...props}>
    {children}<SelectPrimitive.Icon asChild><ChevronDownIcon className="opacity-50" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>;
}
function SelectContent({ className, children, position = "popper", onCloseAutoFocus, ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  const closeAutoFocus = useLayerCloseAutoFocus(onCloseAutoFocus);
  return <SelectPrimitive.Portal><SelectPrimitive.Content data-slot="select-content" position={position} sideOffset={5} collisionPadding={10} className={cn("relative z-50 max-h-[min(22rem,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl shadow-foreground/10 outline-none", className)} {...props} onCloseAutoFocus={closeAutoFocus}>
    <SelectScrollUpButton /><SelectPrimitive.Viewport className="p-1.5">{children}</SelectPrimitive.Viewport><SelectScrollDownButton />
  </SelectPrimitive.Content></SelectPrimitive.Portal>;
}
function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item data-slot="select-item" className={cn("relative flex w-full cursor-default items-center gap-2 rounded-lg py-2 pr-8 pl-2 text-sm outline-none select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)} {...props}>
    <span className="absolute right-2 flex size-4 items-center justify-center"><SelectPrimitive.ItemIndicator><CheckIcon className="size-4" /></SelectPrimitive.ItemIndicator></span><SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>;
}
function SelectScrollUpButton(props: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) { return <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1" {...props}><ChevronUpIcon className="size-4" /></SelectPrimitive.ScrollUpButton>; }
function SelectScrollDownButton(props: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) { return <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1" {...props}><ChevronDownIcon className="size-4" /></SelectPrimitive.ScrollDownButton>; }
export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectScrollUpButton, SelectScrollDownButton };
