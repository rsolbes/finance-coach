export function Card(props: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">{props.title}</h2>
          {props.subtitle && <p className="text-xs text-muted">{props.subtitle}</p>}
        </div>
        {props.action}
      </div>
      <div className="mt-3">{props.children}</div>
    </section>
  );
}
