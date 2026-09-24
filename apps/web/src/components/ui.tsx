import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, forwardRef } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'line';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-slate-300',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'text-red-600 hover:bg-red-50',
  line: 'bg-[#06C755] text-white hover:bg-[#05b34c]',
};

export function Button({
  variant = 'primary',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-base font-medium transition-colors disabled:cursor-not-allowed',
        variants[variant],
        className,
      )}
    >
      {loading && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      {...rest}
      className={cx(
        'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base outline-none placeholder:text-slate-400 focus:border-brand-600 focus:ring-2 focus:ring-brand-100',
        className,
      )}
    />
  );
});

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-sm text-slate-500">{hint}</span>}
    </label>
  );
}

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </p>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-2xl border border-slate-200 bg-white p-5', className)}>{children}</div>;
}

/** Centered single-column layout for sign-in style pages; phone-first. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-10">
      <div className="mb-8">
        <div className="mb-6 flex items-center gap-2 text-brand-700">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-700 text-lg font-bold text-white">S</span>
          <span className="text-lg font-semibold">ServiceFlow</span>
        </div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
      </div>
      {children}
    </main>
  );
}

export function Spinner() {
  return (
    <div className="grid min-h-screen place-items-center">
      <span className="size-8 animate-spin rounded-full border-4 border-brand-600 border-t-transparent" />
    </div>
  );
}

export const roleLabel: Record<string, string> = {
  OWNER: 'เจ้าของร้าน',
  ADMIN: 'แอดมิน',
  DISPATCHER: 'ผู้รับงาน',
  TECHNICIAN: 'ช่าง',
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}
