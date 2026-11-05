import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { LayerScope, useLayerScope, useModalFocus } from "./layer-scope";
function AlertDialog({open,defaultOpen,onOpenChange,...props}:React.ComponentProps<typeof AlertDialogPrimitive.Root>){
  const layer=useLayerScope({open,defaultOpen,onOpenChange,kind:"modal"});
  return <LayerScope.Provider value={layer.scope}><AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} open={layer.open} onOpenChange={layer.onOpenChange}/></LayerScope.Provider>;
}
function AlertDialogContent({className,...props}:React.ComponentProps<typeof AlertDialogPrimitive.Content>){const focus=useModalFocus();return <AlertDialogPrimitive.Portal><AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/60 backdrop-blur-sm"/><AlertDialogPrimitive.Content data-slot="alert-dialog-content" onCloseAutoFocus={focus.onCloseAutoFocus} className={cn("fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-2xl border border-border bg-popover p-6 text-popover-foreground shadow-lg outline-none",className)} {...props}/></AlertDialogPrimitive.Portal>;}
function AlertDialogHeader({className,...props}:React.ComponentProps<"div">){return <div className={cn("flex flex-col gap-2",className)} {...props}/>;}
function AlertDialogFooter({className,...props}:React.ComponentProps<"div">){return <div className={cn("flex justify-end gap-2",className)} {...props}/>;}
function AlertDialogTitle({className,...props}:React.ComponentProps<typeof AlertDialogPrimitive.Title>){return <AlertDialogPrimitive.Title className={cn("text-lg font-semibold",className)} {...props}/>;}
function AlertDialogDescription({className,...props}:React.ComponentProps<typeof AlertDialogPrimitive.Description>){return <AlertDialogPrimitive.Description className={cn("text-sm leading-relaxed text-muted-foreground",className)} {...props}/>;}
function AlertDialogAction({className,...props}:React.ComponentProps<typeof AlertDialogPrimitive.Action>){return <AlertDialogPrimitive.Action className={cn(buttonVariants(),className)} {...props}/>;}
function AlertDialogCancel({className,...props}:React.ComponentProps<typeof AlertDialogPrimitive.Cancel>){return <AlertDialogPrimitive.Cancel className={cn(buttonVariants({variant:"outline"}),className)} {...props}/>;}
export {AlertDialog,AlertDialogContent,AlertDialogHeader,AlertDialogFooter,AlertDialogTitle,AlertDialogDescription,AlertDialogAction,AlertDialogCancel};
