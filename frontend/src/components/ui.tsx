import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type MouseEvent, type PropsWithChildren } from "react";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

type Color = "default" | "primary" | "secondary" | "success" | "warning";
type Variant = "solid" | "bordered" | "light" | "flat";
type Radius = "full" | "lg";
type Size = "sm" | "md";

function buttonVariantClass(variant: Variant, color: Color) {
  if (variant === "solid") {
    if (color === "success") {
      return "border-transparent bg-emerald-600 text-white hover:-translate-y-0.5 hover:bg-emerald-500 hover:shadow-lg";
    }

    return "border-transparent bg-[var(--ink)] text-white hover:-translate-y-0.5 hover:shadow-lg";
  }

  if (variant === "light") {
    if (color === "warning") {
      return "border-transparent bg-amber-100/80 text-amber-800 hover:bg-amber-100";
    }

    return "border-transparent bg-transparent text-[var(--ink)] hover:bg-white/70";
  }

  return "border border-black/10 bg-white/70 text-[var(--ink)] hover:-translate-y-0.5 hover:border-black/30 hover:bg-white/90";
}

function chipVariantClass(variant: Exclude<Variant, "solid">, color: Color) {
  if (variant === "bordered") {
    if (color === "warning") {
      return "border border-amber-300 bg-amber-50/60 text-amber-800";
    }

    return "border border-black/10 bg-white/55 text-[var(--ink)]";
  }

  if (variant === "flat") {
    if (color === "warning") {
      return "border-transparent bg-amber-100/90 text-amber-800";
    }

    if (color === "secondary") {
      return "border-transparent bg-teal-100/90 text-teal-800";
    }

    return "border-transparent bg-black/5 text-[var(--ink)]";
  }

  return "border-transparent bg-white/40 text-[var(--ink)]";
}

function spinnerColorClass(color: Color) {
  if (color === "warning") {
    return "border-amber-200 border-t-amber-600";
  }

  if (color === "secondary") {
    return "border-teal-200 border-t-teal-700";
  }

  return "border-black/10 border-t-[var(--ink)]";
}

function avatarText(name?: string) {
  const normalizedName = name?.trim() ?? "";
  if (!normalizedName) {
    return "?";
  }

  return Array.from(normalizedName).slice(0, 2).join("").toUpperCase();
}

export function UIProvider({ children }: PropsWithChildren) {
  return <>{children}</>;
}

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Card(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn("rounded-[1.75rem]", className)} {...props} />;
});

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardHeader(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn("flex", className)} {...props} />;
});

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function CardBody(
  { className, ...props },
  ref,
) {
  return <div ref={ref} className={cn("flex flex-col", className)} {...props} />;
});

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> {
  color?: Color;
  isDisabled?: boolean;
  onPress?: (event: MouseEvent<HTMLButtonElement>) => void;
  radius?: Radius;
  size?: Size;
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className,
    color = "default",
    disabled,
    isDisabled,
    onClick,
    onPress,
    radius = "lg",
    size = "md",
    type = "button",
    variant = "solid",
    ...props
  },
  ref,
) {
  const resolvedDisabled = disabled ?? isDisabled ?? false;

  return (
    <button
      ref={ref}
      type={type}
      disabled={resolvedDisabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium outline-none transition duration-200 focus-visible:ring-2 focus-visible:ring-black/10 disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "px-3 py-1.5 text-sm" : "px-5 py-3 text-sm",
        radius === "full" ? "rounded-full" : "rounded-[1rem]",
        buttonVariantClass(variant, color),
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        onPress?.(event);
      }}
      {...props}
    >
      {children}
    </button>
  );
});

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  labelPlacement?: "outside" | "inside";
  onValueChange?: (value: string) => void;
  radius?: Radius;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, labelPlacement = "outside", onChange, onValueChange, radius = "lg", value, ...props },
  ref,
) {
  const input = (
    <input
      ref={ref}
      className={cn(
        "w-full border border-black/10 bg-white/70 px-4 py-3 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)]/80 focus:border-black/30 focus:bg-white",
        radius === "full" ? "rounded-full" : "rounded-[1rem]",
        className,
      )}
      value={value}
      onChange={(event) => {
        onChange?.(event);
        onValueChange?.(event.target.value);
      }}
      {...props}
    />
  );

  if (!label) {
    return input;
  }

  return (
    <label className="flex flex-col gap-2 text-sm text-[var(--ink)]">
      {labelPlacement === "outside" ? <span className="font-medium">{label}</span> : null}
      {input}
    </label>
  );
});

interface SpinnerProps {
  className?: string;
  color?: Color;
  label?: string;
  labelColor?: Color;
}

export function Spinner({ className, color = "default", label, labelColor = color }: SpinnerProps) {
  return (
    <div className={cn("flex flex-col items-center gap-3", className)} role="status" aria-live="polite">
      <span className={cn("h-8 w-8 animate-spin rounded-full border-2", spinnerColorClass(color))} />
      {label ? (
        <span
          className={cn(
            "text-sm",
            labelColor === "warning" ? "text-amber-700" : labelColor === "secondary" ? "text-teal-700" : "text-[var(--muted)]",
          )}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  color?: Color;
  size?: Size;
  variant?: Exclude<Variant, "solid">;
}

export function Chip({ children, className, color = "default", size = "md", variant = "light", ...props }: ChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full font-medium",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
        chipVariantClass(variant, color),
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  color?: Color;
  name?: string;
}

export function Avatar({ className, color = "default", name, ...props }: AvatarProps) {
  return (
    <div
      className={cn(
        "flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        color === "primary" ? "bg-[var(--ink)] text-white" : "bg-white/70 text-[var(--ink)]",
        className,
      )}
      aria-label={name}
      {...props}
    >
      {avatarText(name)}
    </div>
  );
}

export function Divider({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cn("border-0 border-t border-black/10", className)} {...props} />;
}