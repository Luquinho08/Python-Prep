import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export const inputClasses =
  "block w-full rounded-xl border-2 border-line bg-white px-3.5 py-2.5 text-base text-ink placeholder:text-ink-soft/70 focus:border-blue-strong focus:outline-none aria-[invalid=true]:border-danger";

type FieldProps = {
  id: string;
  label: ReactNode;
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  children: (a11y: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }) => ReactNode;
  className?: string;
};

/** Etiqueta + control + ayuda + error asociados con aria-describedby. */
export function Field({ id, label, error, hint, required, children, className }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="text-danger"> *</span> : <span className="font-normal text-ink-soft"> (opcional)</span>}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, required })}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-soft">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cn(inputClasses, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(inputClasses, "min-h-24", props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={cn(inputClasses, "pr-8", props.className)} />;
}
