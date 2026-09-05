import { useEffect, useState, type ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
export function Choice({
  value,
  onChange,
  options,
  label,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="choice" aria-label={label}>
        <SelectValue>
          {options.find((o) => o.value === value)?.label || value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  min = -100000,
  max = 100000,
  step = 1,
  suffix,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(Number(value.toFixed(3))));
  useEffect(() => setText(String(Number(value.toFixed(3)))), [value]);
  const commit = () => {
    if (text.trim() === '' || !Number.isFinite(Number(text))) {
      setText(String(value));
      return;
    }
    const v = Math.min(max, Math.max(min, Number(text)));
    if (v !== value) onChange(v);
    setText(String(v));
  };
  return (
    <label className="number-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          aria-label={label}
          value={text}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        {suffix && <small>{suffix}</small>}
      </div>
    </label>
  );
}
export function Range({
  value,
  min = 0,
  max = 100,
  step = 1,
  label,
  onChange,
  onCommit,
  onStart,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  onChange: (v: number) => void;
  onCommit?: () => void;
  onStart?: () => void;
}) {
  return (
    <Slider
      className="range"
      value={[value]}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      onValueChange={(v) => {
        onStart?.();
        onChange(Array.isArray(v) ? v[0] : v);
      }}
      onValueCommitted={() => onCommit?.()}
    />
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className={`editor-modal ${wide ? 'wide' : ''}`}>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription
          className={description ? 'modal-description' : 'sr-only'}
        >
          {description || title}
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export const bytes = (n: number) =>
  n < 1024 ** 2
    ? `${(n / 1024).toFixed(0)} KB`
    : n < 1024 ** 3
      ? `${(n / 1024 ** 2).toFixed(1)} MB`
      : `${(n / 1024 ** 3).toFixed(1)} GB`;
