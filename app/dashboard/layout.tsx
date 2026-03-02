import { PropsWithChildren } from 'react';

export default function DashboardLayout({ children }: PropsWithChildren) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      {children}
    </div>
  );
}
