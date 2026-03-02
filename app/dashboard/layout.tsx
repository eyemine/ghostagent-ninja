import { PropsWithChildren } from 'react';

export default function DashboardLayout({ children }: PropsWithChildren) {
  return (
    <div className="min-h-screen bg-[var(--background)] pt-14">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        {children}
      </div>
    </div>
  );
}
