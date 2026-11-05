import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Button } from "./button";
import { Textarea } from './textarea';
export function InputGroup({className,...props}:ComponentProps<"div">) {return <div role="group" data-slot="input-group" className={cn("group/input-group relative flex h-9 w-full min-w-0 items-center rounded-md border border-input bg-background shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 has-[[aria-invalid=true]]:border-destructive data-[disabled=true]:opacity-50",className)} {...props} />;}
export function InputGroupInput({className,...props}:ComponentProps<typeof Input>) {return <Input data-slot="input-group-control" className={cn("min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0",className)} {...props} />;}
export function InputGroupTextarea({className,...props}:ComponentProps<typeof Textarea>) {return <Textarea data-slot="input-group-control" className={cn('min-w-0 flex-1 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0',className)} {...props}/>;}
export function InputGroupAddon({className,...props}:ComponentProps<"div">) {return <div data-slot="input-group-addon" className={cn("flex h-auto shrink-0 items-center gap-1 pr-1 text-muted-foreground [&_svg]:size-3",className)} {...props} />;}
export function InputGroupButton({className,...props}:ComponentProps<typeof Button>) {return <Button type="button" variant="ghost" size="icon-xs" className={cn("shadow-none",className)} {...props} />;}
