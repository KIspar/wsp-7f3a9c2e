import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Calendar, localDate } from "./calendar";
import { Button } from "./button";
import { Separator } from "./separator";
export { localDate } from "./calendar";

export function DatePicker({ value, onValueChange, label = "按日期筛选" }: { value: string; onValueChange: (value: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  function choose(date: string) { onValueChange(date); setOpen(false); }
  return <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" aria-label={label} className="min-w-32 justify-start"><CalendarDays /><span>{value ? value.replaceAll("-", " / ") : "选择日期"}</span></Button></PopoverTrigger>
    <PopoverContent align="end" aria-label="选择筛选日期" className="flex w-80 flex-col gap-3" onOpenAutoFocus={event => {
      event.preventDefault();requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-slot=calendar] [data-date="${value || localDate(new Date())}"]`)?.focus());
    }}>
      <div className="flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" /><strong className="text-sm font-medium">选择日期</strong><span className="ml-auto text-xs text-muted-foreground">按本地日期筛选</span></div>
      <Calendar value={value} onSelect={choose} /><Separator />
      <div className="flex justify-between gap-2"><Button type="button" variant="ghost" size="sm" onClick={()=>choose("")} disabled={!value}>清除日期</Button><Button type="button" variant="secondary" size="sm" onClick={()=>choose(localDate(new Date()))}>今天</Button></div>
    </PopoverContent>
  </Popover>;
}
