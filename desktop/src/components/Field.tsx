interface FieldProps {
  label: string;
  error?: string;
  children: React.ReactNode;
}

export function Field({ label, error, children }: FieldProps) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
