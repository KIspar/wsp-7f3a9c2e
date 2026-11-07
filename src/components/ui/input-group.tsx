import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Button } from "./button";
import { Textarea } from './textarea';
export function InputGroup({className,...props}:ComponentProps<"div">) {return <div role="group" data-slot="input-group" className={cn("group/input-group relative flex h-10 w-full min-w-0 items-center rounded-md border border-input bg-card shadow-xs transition-[color,box-shadow] has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/20 has-[[aria-invalid=true]]:border-destructive data-[disabled=true]:opacity-50",className)} {...props} />;}
export function InputGroupInput({className,...props}:ComponentProps<typeof Input>) {return <Input data-slot="input-group-control" className={cn("h-full min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none group-has-[[data-align=inline-start]]/input-group:pl-0 focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0",className)} {...props} />;}
export function InputGroupTextarea({className,...props}:ComponentProps<typeof Textarea>) {return <Textarea data-slot="input-group-control" className={cn('min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-0',className)} {...props}/>;}
export function InputGroupAddon({className,align="inline-end",onClick,...props}:ComponentProps<"div">&{align?:"inline-start"|"inline-end"}) {
  return <div data-slot="input-group-addon" data-align={align} className={cn("flex h-auto shrink-0 items-center gap-1 text-muted-foreground [&>svg]:pointer-events-none [&>svg]:size-4 [&>svg]:shrink-0",align==="inline-start"?"pl-3 pr-2":"pr-1",className)} {...props} onClick={event=>{
    onClick?.(event);
    if(align==="inline-start"&&!event.defaultPrevented&&!(event.target as HTMLElement).closest("button,a"))
      event.currentTarget.parentElement?.querySelector<HTMLInputElement>('[data-slot="input-group-control"]')?.focus();
  }}/>;
}
export function InputGroupButton({className,...props}:ComponentProps<typeof Button>) {return <Button type="button" variant="ghost" size="icon-xs" className={cn("shadow-none",className)} {...props} />;}
