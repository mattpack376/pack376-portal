/** Wraps content in a collapsible <details>, open by default. Used for den groups, guest-of groups, etc. */
export default function CollapsibleGroup({
  label,
  children,
  defaultOpen = true,
  labelClassName,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Extra class on the summary line — e.g. a payment status color, so a closed row still reads at a glance. */
  labelClassName?: string;
}) {
  return (
    <details className="den-group" open={defaultOpen}>
      <summary className={labelClassName ? `den-toggle ${labelClassName}` : "den-toggle"}>{label}</summary>
      {children}
    </details>
  );
}
