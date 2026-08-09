import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "quiet";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-emerald-950 text-white shadow-[0_12px_30px_rgba(6,78,59,0.18)] hover:bg-emerald-900",
  secondary:
    "border border-slate-300 bg-white text-slate-950 hover:border-slate-400 hover:bg-slate-50",
  quiet: "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
};

export function Button({
  className = "",
  variant = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:opacity-55 ${variantClasses[variant]} ${className}`}
      type={type}
      {...props}
    />
  );
}
