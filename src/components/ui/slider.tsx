import { Slider as SliderPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
export function Slider({ className, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  return <SliderPrimitive.Root {...props} className={cn("relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=horizontal]:h-5 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col", className)} data-slot="slider">
    <SliderPrimitive.Track className="relative grow overflow-hidden rounded-full bg-secondary data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1"><SliderPrimitive.Range className="absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full" /></SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block size-3 shrink-0 rounded-full border border-primary bg-background shadow-sm outline-none transition-shadow focus-visible:ring-4 focus-visible:ring-ring/50 disabled:pointer-events-none" aria-label={props["aria-label"]} />
  </SliderPrimitive.Root>;
}
