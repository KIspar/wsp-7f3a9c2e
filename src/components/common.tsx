import { useId, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { FormSelect } from "@/components/form-select";
import { NumberInput } from "@/components/ui/number-input";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { statusLabels, type SkillField, type TaskStatus } from "../../packages/contracts";
import { cn } from "@/lib/utils";
import {parameterLabel,parameterOptions} from '@/lib/parameter-labels';
export { MediaModal } from './media-preview';

export function IconButton({ icon: Icon, label, onClick, disabled, variant = "ghost", className }: {
  icon: ComponentType; label: string; onClick?: () => void; disabled?: boolean;
  variant?: "ghost" | "outline" | "secondary"; className?: string;
}) {
  return <Tooltip><TooltipTrigger asChild><Button type="button" size="icon-sm" variant={variant} aria-label={label} onClick={onClick} disabled={disabled} className={className}><Icon /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
export function Status({ status }: { status: TaskStatus }) {
  return <Badge variant="secondary" className={cn("status", `status-${status}`)}><i />{statusLabels[status]}</Badge>;
}
export function Modal({ title, description, open, onClose, children, wide = false }: {
  title: string; description?: string; open: boolean; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  return <Dialog open={open} onOpenChange={(v) => !v && onClose()}><DialogContent className={cn("studio-modal", wide && "studio-modal-wide")}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description || "AI 创作工作台"}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}
export function PropertyField({ name, field, value, onChange }: {
  name: string; field: SkillField; value: string | number | boolean; onChange: (value: string | number | boolean) => void;
}) {
  const id = useId();
  return <Field orientation={field.type === "boolean" ? "horizontal" : "vertical"}>
    <FieldLabel htmlFor={id}>{parameterLabel(name,field.label)}</FieldLabel>
    {field.type === "boolean" ? <Switch id={id} checked={!!value} onCheckedChange={onChange} />
      : field.type === "select" ? <FormSelect id={id} value={String(value)} options={parameterOptions(name,field.options || [])} onValueChange={onChange} />
      : field.type === "number" ? <NumberInput id={id} min={field.min} max={field.max} value={Number(value)} onValueChange={(next) => onChange(Number(next))} />
      : <Input id={id} value={String(value)} maxLength={16000} onChange={(e) => onChange(e.target.value)} />}
  </Field>;
}
export function Properties({ definitions, values, onChange, exclude = [] }: {
  definitions: Record<string, SkillField>; values: Record<string, string | number | boolean>;
  onChange: (values: Record<string, string | number | boolean>) => void; exclude?: string[];
}) {
  return <FieldGroup className="property-grid">{Object.entries(definitions).filter(([name]) => !exclude.includes(name)).map(([name, field]) => <PropertyField key={name} name={name} field={field} value={values[name] ?? field.default ?? ""} onChange={(value) => onChange({ ...values, [name]: value })} />)}</FieldGroup>;
}
export const copy = async (text: string) => {
  try { await navigator.clipboard.writeText(text); toast.success("已复制"); } catch { toast.error("复制失败，请在文本框中手动选择"); }
};
export function PromptText({ value, onChange }: { value: string; onChange?: (value: string) => void }) {
  return <Textarea className="prompt-text" aria-label="完整提示词" value={value} readOnly={!onChange} onChange={(e) => onChange?.(e.target.value)} />;
}
