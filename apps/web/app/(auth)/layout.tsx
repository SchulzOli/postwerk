export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth">
      <p className="brand">Postwerk</p>
      {children}
    </main>
  );
}
