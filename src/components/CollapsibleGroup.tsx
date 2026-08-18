/** Wraps content in a collapsible <details>, open by default. Used for den groups, guest-of groups, etc. */
export default function CollapsibleGroup({
  label,
  children,
  defaultOpen = true,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="den-group" open={defaultOpen}>
      <summary className="den-toggle">{label}</summary>
      {children}
    </details>
  );
}
