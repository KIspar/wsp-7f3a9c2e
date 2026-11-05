import type { ComponentProps, ComponentType, ReactNode } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Option = { value: string; label: string; disabled?: boolean };
type FormSelectProps = Omit<ComponentProps<typeof SelectTrigger>, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  options: (string | Option)[];
  placeholder?: string;
  icon?: ComponentType;
  displayValue?: ReactNode;
};
/** Business forms share the same shadcn Select composition and parameter mapping. */
export function FormSelect({ value, onValueChange, options, placeholder = "请选择", icon: Icon, disabled, displayValue, ...props }: FormSelectProps) {
  return <Select value={value} onValueChange={onValueChange} disabled={disabled}>
    <SelectTrigger {...props}>{Icon && <Icon />}<SelectValue placeholder={placeholder}>{displayValue}</SelectValue></SelectTrigger>
    <SelectContent><SelectGroup>{options.map(option => {
      const item = typeof option === "string" ? { value: option, label: option } : option;
      return <SelectItem key={item.value} value={item.value} disabled={item.disabled}>{item.label}</SelectItem>;
    })}{!options.length && <div className="p-3 text-sm text-muted-foreground">暂无可用选项</div>}</SelectGroup></SelectContent>
  </Select>;
}
