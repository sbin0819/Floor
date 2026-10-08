export function TypingIndicator({ label }: { label: string }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="min-h-6 shrink-0 px-4 pb-1 text-xs text-muted-foreground md:px-6"
      data-chat-typing
    >
      {label}
    </p>
  );
}
