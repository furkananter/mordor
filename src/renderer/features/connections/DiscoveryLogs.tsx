export function DiscoveryLogs({ logs }: { logs: string[] }) {
  if (logs.length === 0) return null;
  return (
    <section className="mx-2 mb-2 shrink-0 border-t border-line-soft pt-2" aria-label="Discovery logs">
      <h2 className="px-1.5 text-[10.5px] font-medium text-subtle">Discovery</h2>
      {logs.slice(-4).map((entry) => (
        <p key={entry} className="mt-0.5 px-1.5 text-[11px] leading-[1.4] text-muted">{entry}</p>
      ))}
    </section>
  );
}
