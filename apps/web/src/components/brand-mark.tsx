import Link from "next/link";

interface BrandMarkProps {
  compact?: boolean;
}

export function BrandMark({ compact = false }: BrandMarkProps) {
  return (
    <Link
      className="inline-flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
      href="/"
      aria-label="AutoPay Guard home"
    >
      <span
        aria-hidden="true"
        className="grid size-10 place-items-center rounded-[0.9rem] bg-emerald-950 text-lg font-black text-lime-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
      >
        ₹
      </span>
      {!compact && (
        <span className="text-[1.02rem] font-extrabold tracking-[-0.03em] text-slate-950">
          AutoPay Guard
        </span>
      )}
    </Link>
  );
}
