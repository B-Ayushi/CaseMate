import { useEffect, useId, useRef, type ReactNode } from 'react';

// A modal dialog built on <dialog>: focus stays inside, Escape closes it, and the page
// behind is inert. Render it while it should be open and stop rendering it to close it:
// Escape reports through onClose, and buttons inside call onClose themselves.
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      className="w-[calc(100%-2rem)] max-w-lg rounded-xl border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="space-y-4 p-6">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
