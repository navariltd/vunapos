import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-container focus-visible:outline-outline",
  secondary:
    "bg-secondary text-on-secondary hover:bg-secondary-container hover:text-on-secondary-container focus-visible:outline-outline",
  danger:
    "bg-error text-on-error hover:bg-error-container hover:text-on-error-container focus-visible:outline-error",
  ghost:
    "bg-surface-container text-on-surface hover:bg-surface-container-high focus-visible:outline-outline",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-touch px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
