import { useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./select";
import { cn } from "@/lib/utils";

export const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const parseDate = (value: string) => { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day, 12); };
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
const firstOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1, 12);
const moveMonth = (date: Date, amount: number) => {
  const last = new Date(date.getFullYear(), date.getMonth() + amount + 1, 0).getDate();
  return new Date(date.getFullYear(), date.getMonth() + amount, Math.min(date.getDate(), last), 12);
};

/** Calendar composed from the shared Button and Select primitives; keyboard navigation stays local to the grid. */
export function Calendar({ value, onSelect }: { value: string; onSelect: (value: string) => void }) {
  const initial = value ? parseDate(value) : new Date();
  const [month, setMonth] = useState(firstOfMonth(initial));
  const [focused, setFocused] = useState(localDate(initial));
  const grid = useRef<HTMLDivElement>(null);
  const start = addDays(month, -((month.getDay() + 6) % 7));
  const dates = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = localDate(new Date());
  const currentYear = new Date().getFullYear();
  const minYear = Math.min(currentYear - 20, month.getFullYear());
  const maxYear = Math.max(currentYear + 10, month.getFullYear());
  function changeMonth(date: Date) { setMonth(firstOfMonth(date)); setFocused(localDate(date)); }
  function focusDate(date: Date) {
    const key = localDate(date); setFocused(key); setMonth(firstOfMonth(date));
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${key}"]`)?.focus());
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -((date.getDay() + 6) % 7), End: 6 - ((date.getDay() + 6) % 7) };
    if (event.key in delta) { event.preventDefault(); focusDate(addDays(date, delta[event.key])); }
    else if (event.key === "PageUp" || event.key === "PageDown") { event.preventDefault(); focusDate(moveMonth(date, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1))); }
  }
  return <div data-slot="calendar" className="flex flex-col gap-3">
    <div className="flex items-center gap-1">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="上个月" onClick={() => changeMonth(moveMonth(month,-1))}><ChevronLeft /></Button>
      <Select value={String(month.getFullYear())} onValueChange={year=>changeMonth(new Date(Number(year),month.getMonth(),1,12))}><SelectTrigger size="sm" aria-label="选择年份"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{Array.from({length:maxYear-minYear+1},(_,i)=><SelectItem key={minYear+i} value={String(minYear+i)}>{minYear+i} 年</SelectItem>)}</SelectGroup></SelectContent></Select>
      <Select value={String(month.getMonth())} onValueChange={m=>changeMonth(new Date(month.getFullYear(),Number(m),1,12))}><SelectTrigger size="sm" aria-label="选择月份"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{Array.from({length:12},(_,i)=><SelectItem key={i} value={String(i)}>{i+1} 月</SelectItem>)}</SelectGroup></SelectContent></Select>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="下个月" onClick={() => changeMonth(moveMonth(month,1))}><ChevronRight /></Button>
    </div>
    <div ref={grid} role="grid" aria-label={`${month.getFullYear()} 年 ${month.getMonth()+1} 月`} className="flex flex-col gap-1">
      <div role="row" className="grid grid-cols-7">{["一","二","三","四","五","六","日"].map(day=><span key={day} role="columnheader" className="py-1 text-center text-xs text-muted-foreground">{day}</span>)}</div>
      {Array.from({length:6},(_,week)=><div role="row" key={week} className="grid grid-cols-7 gap-1">{dates.slice(week*7,week*7+7).map(date=>{
        const key=localDate(date);return <div role="gridcell" key={key} aria-selected={value===key}><Button type="button" variant={key===value?"default":"ghost"} size="icon-sm" data-date={key} aria-label={key} aria-current={key===today?"date":undefined} tabIndex={key===focused?0:-1} className={cn("w-full font-normal",date.getMonth()!==month.getMonth()&&"text-muted-foreground/50",key===today&&key!==value&&"bg-accent text-accent-foreground")} onKeyDown={e=>keyDown(e,date)} onFocus={()=>setFocused(key)} onClick={()=>onSelect(key)}>{date.getDate()}</Button></div>;
      })}</div>)}
    </div>
  </div>;
}
