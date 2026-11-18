"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { IconAlert, IconCheck, IconInfo, IconX } from "./icons";
import { Button, ErrorText, IconButton } from "./ui";

function useNativeDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return ref;
}

function DialogHeader({
  title,
  description,
  onClose,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
}) {
  return (
    <header className="mb-4 flex items-start gap-3 border-b border-line px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold text-ink text-balance">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted text-pretty">{description}</p>}
      </div>
      <IconButton label="Tutup" icon={IconX} onClick={onClose} className="-mr-2 -mt-2" />
    </header>
  );
}

const backdropClass =
  "backdrop:bg-nav/45 backdrop:animate-[fade-in_200ms_ease-out]";

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useNativeDialog(open);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full max-w-none bg-surface p-0 text-ink shadow-pop open:flex open:flex-col open:animate-[sheet-in_280ms_cubic-bezier(0.16,1,0.3,1)] sm:w-[min(520px,100vw)] sm:rounded-l-2xl ${backdropClass}`}
    >
      {open && (
        <>
          <div className="pt-safe sm:rounded-tl-2xl">
            <DialogHeader title={title} description={description} onClose={onClose} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6">{children}</div>
          {footer && (
            <footer className="pb-safe flex flex-wrap items-center justify-end gap-2 bg-surface px-5 py-4 border-t border-line sm:rounded-bl-2xl">
              {footer}
            </footer>
          )}
        </>
      )}
    </dialog>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useNativeDialog(open);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className={`m-auto max-h-[calc(100dvh-32px)] w-[calc(100vw-32px)] max-w-md overflow-y-auto rounded-2xl bg-surface p-0 text-ink shadow-pop open:animate-[pop-in_220ms_cubic-bezier(0.16,1,0.3,1)] ${backdropClass}`}
    >
      {open && (
        <>
          <DialogHeader title={title} description={description} onClose={onClose} />
          <div className="px-5 pb-5">{children}</div>
          {footer && (
            <footer className="flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-subtle px-5 py-4">
              {footer}
            </footer>
          )}
        </>
      )}
    </dialog>
  );
}

const CONFIRM_TONE = {
  danger: { icon: IconAlert, badge: "text-danger-600", button: "danger" },
  warn: { icon: IconAlert, badge: "text-warn-700", button: "dark" },
  brand: { icon: IconInfo, badge: "text-brand-600", button: "primary" },
} as const;

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel,
  tone = "danger",
  busy = false,
  error = null,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: keyof typeof CONFIRM_TONE;
  busy?: boolean;
  error?: string | null;
}) {
  const t = CONFIRM_TONE[tone];
  const Icon = t.icon;
  const ref = useNativeDialog(open);
  return (
    <dialog
      ref={ref}
      role="alertdialog"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className={`m-auto w-[calc(100vw-32px)] max-w-sm rounded-2xl bg-surface p-0 text-ink shadow-pop open:animate-[pop-in_220ms_cubic-bezier(0.16,1,0.3,1)] ${backdropClass}`}
    >
      {open && (
        <div className="p-5">
          <span className={`mb-3 flex ${t.badge}`}>
            <Icon size={28} />
          </span>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <div className="mt-1.5 text-sm text-muted text-pretty">{children}</div>
          {error && (
            <div className="mt-4">
              <ErrorText message={error} />
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy} autoFocus>
              Batal
            </Button>
            <Button variant={t.button} onClick={onConfirm} loading={busy}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  );
}

type ToastTone = "success" | "error";
type ShowToast = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<ShowToast>(() => {});
const TOAST_MS = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; tone: ToastTone } | null>(null);

  const show = useCallback<ShowToast>((message, tone = "success") => {
    setToast({ id: Date.now(), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(80px+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 lg:bottom-6"
      >
        {toast && (
          <p
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className="flex max-w-md items-center gap-2 rounded-md bg-ink px-4 py-3 text-sm font-medium text-white shadow-pop animate-[enter-up_200ms_cubic-bezier(0.16,1,0.3,1)]"
          >
            {toast.tone === "error" ? (
              <IconAlert size={16} className="shrink-0 text-danger-50" />
            ) : (
              <IconCheck size={16} className="shrink-0 text-ok-50" />
            )}
            {toast.message}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
