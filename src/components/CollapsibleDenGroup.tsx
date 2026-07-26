/** Wraps a den's content in a collapsible <details>, open by default. */
export default function CollapsibleDenGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <details className="den-group" open>
      <summary className="den-toggle">{label}</summary>
      {children}
    </details>
  );
}
