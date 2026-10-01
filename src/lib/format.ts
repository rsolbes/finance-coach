const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const mxnWhole = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

export function money(n: number, opts: { whole?: boolean } = {}): string {
  return (opts.whole ? mxnWhole : mxn).format(n);
}

export function label(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
