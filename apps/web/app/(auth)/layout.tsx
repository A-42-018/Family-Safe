export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-secondary/40 p-4">
      <p className="text-xl font-semibold tracking-tight">FamilySafe</p>
      <div className="w-full max-w-md">{children}</div>
      <p className="max-w-md text-center text-xs text-muted-foreground">
        FamilySafe is transparent by design: monitored devices are enrolled by a parent and visible to the child.
      </p>
    </main>
  );
}
