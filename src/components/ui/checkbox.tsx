import { Checkbox as CheckboxPrimitive } from "radix-ui";
import { CheckIcon, MinusIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return <CheckboxPrimitive.Root {...props} data-slot="checkbox" className={cn("peer flex size-4 shrink-0 items-center justify-center rounded-sm border border-input bg-background shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground", className)}>
    <CheckboxPrimitive.Indicator className="flex items-center justify-center [&_svg]:size-3">{props.checked === "indeterminate" ? <MinusIcon /> : <CheckIcon />}</CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}
