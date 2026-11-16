import type { ReactNode } from "react";

type AppShellProps = {
  title: string;
  status?: string;
  statusTone?: "neutral" | "ok" | "error";
  onClose?: () => void;
  children: ReactNode;
};

export function AppShell({ title, status, statusTone = "neutral", onClose, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a href="/" className="brand" target="_blank" rel="noreferrer">
          OmniScope
        </a>
        <span className="topbar-sep" />
        <span className="topbar-title">{title}</span>
        <div className="spacer" />
        {status && <span className={`pill ${statusTone}`}>{status}</span>}
        {onClose && (
          <button type="button" className="ghost danger" onClick={onClose}>
            关闭
          </button>
        )}
      </header>
      <main className="main">{children}</main>
    </div>
  );
}
