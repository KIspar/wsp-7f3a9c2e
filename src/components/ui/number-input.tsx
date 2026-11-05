import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Minus, Plus } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group";
import { Input } from "./input";
import { cn } from "@/lib/utils";

type NumberInputProps = Omit<ComponentProps<typeof Input>, "type" | "value" | "defaultValue" | "onChange" | "min" | "max" | "step"> & {
  value?: number | "";
  defaultValue?: number | "";
  onValueChange?: (value: number | "") => void;
  min?: number;
  max?: number;
  step?: number;
  allowEmpty?: boolean;
};

export function NumberInput({ value, defaultValue = "", onValueChange, min, max, step = 1, allowEmpty = false, className, disabled, onBlur, onKeyDown, ...props }: NumberInputProps) {
  const [text, setText] = useState(String(value ?? defaultValue));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (value !== undefined) setText(String(value)); }, [value]);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  function commit(next: number | "") {
    setText(String(next));
    onValueChange?.(next);
  }
  function normalize() {
    if (allowEmpty && text === "") { commit(""); return; }
    const candidate = text.trim() ? Number(text) : NaN;
    const n = Number.isFinite(candidate) ? candidate : typeof value === "number" ? value : typeof defaultValue === "number" ? defaultValue : min ?? 0;
    commit(clamp(Number(((min ?? 0) + Math.round((n - (min ?? 0)) / step) * step).toFixed(8))));
  }
  function increment(direction: number) {
    const n = text.trim() && Number.isFinite(Number(text)) ? Number(text) : min ?? 0;
    commit(clamp(Number((n + direction * step).toFixed(8))));
    input.current?.focus();
  }
  const label = props["aria-label"] || props.id || "数值";
  const number = text.trim() ? Number(text) : NaN;
  const invalid = text !== "" && (!Number.isFinite(number) || number !== clamp(number));
  return <InputGroup className={cn("number-input", className)} data-disabled={disabled || undefined}>
    <InputGroupInput {...props} ref={input} type="text" role="spinbutton" inputMode={Number.isInteger(step) ? "numeric" : "decimal"} autoComplete="off" disabled={disabled}
      aria-valuemin={min} aria-valuemax={max} aria-valuenow={Number.isFinite(number) ? number : undefined} aria-invalid={invalid || undefined} value={text}
      onChange={e => {
        const next = e.target.value;
        if (!/^-?\d*(\.\d*)?$/.test(next)) return;
        setText(next);
        if (next === "") { if (allowEmpty) onValueChange?.(""); }
        else if (Number.isFinite(Number(next)) && Number(next) === clamp(Number(next))) onValueChange?.(Number(next));
      }}
      onBlur={e => { normalize(); onBlur?.(e); }}
      onKeyDown={e => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); increment(e.key === "ArrowUp" ? 1 : -1); }
        else if (e.key === "Enter") normalize();
        onKeyDown?.(e);
      }} />
    <InputGroupAddon>
      <InputGroupButton aria-label={`减少${label}`} disabled={disabled || Number.isFinite(number) && min !== undefined && number <= min} onMouseDown={e => e.preventDefault()} onClick={() => increment(-1)}><Minus /></InputGroupButton>
      <InputGroupButton aria-label={`增加${label}`} disabled={disabled || Number.isFinite(number) && max !== undefined && number >= max} onMouseDown={e => e.preventDefault()} onClick={() => increment(1)}><Plus /></InputGroupButton>
    </InputGroupAddon>
  </InputGroup>;
}
