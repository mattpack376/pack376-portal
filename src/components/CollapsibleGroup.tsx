/** Wraps content in a collapsible <details>, open by default. Used for den groups, guest-of groups, etc. */
export default function CollapsibleGroup({
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
