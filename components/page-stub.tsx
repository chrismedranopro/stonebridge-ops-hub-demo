export function PageStub({ title, note }: { title: string; note?: string }) {
  return (
    <div className="card page-stub">
      <h2>{title}</h2>
      <p className="muted">
        {note ?? "Coming in the next work session — this page isn't built out yet."}
      </p>
    </div>
  );
}
