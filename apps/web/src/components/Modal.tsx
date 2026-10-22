import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
/** Native top-layer dialogs keep pointer, keyboard and focus inside the modal. */
export function Modal({
  label,
  className = "",
  onDismiss,
  initialFocus,
  returnFocus,
  children,
}: {
  label: string;
  className?: string;
  onDismiss: () => void;
  initialFocus?: string;
  returnFocus?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useLayoutEffect(() => {
    const dialog = ref.current!,
      previous =
        returnFocus?.current ?? (document.activeElement as HTMLElement | null);
    dialog.showModal();
    if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`accessible-modal ${className}`}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const elements = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
          ),
        ].filter(
          (e) =>
            e.getClientRects().length > 0 && !e.closest("fieldset[disabled]"),
        );
        const first = elements[0],
          last = elements.at(-1);
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        dismiss.current();
      }}
    >
      {children}
    </dialog>,
    document.body,
  );
}
