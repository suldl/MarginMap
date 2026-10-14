import type { ReactNode } from 'react';

/** Top bar that doubles as the window's drag region (Windows controls are drawn by Electron on the right). */
export function TitleBar({ children }: { children: ReactNode }) {
  return <header className="titlebar">{children}</header>;
}
