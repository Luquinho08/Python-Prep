export function Star({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M12 2.5l2.6 6 6.4.6-4.9 4.3 1.5 6.3L12 16.4 6.4 19.7l1.5-6.3L3 9.1l6.4-.6z" />
    </svg>
  );
}

export function Rainbow({ className }: { className?: string }) {
  const colors = ["#FC938E", "#FED669", "#B1E9E6", "#6EA8DF", "#A790E2"];
  return (
    <svg viewBox="0 0 64 34" aria-hidden="true" className={className} fill="none">
      {colors.map((c, i) => (
        <path key={c} d={`M ${6 + i * 5} 32 A ${26 - i * 5} ${26 - i * 5} 0 0 1 ${58 - i * 5} 32`} stroke={c} strokeWidth="4" strokeLinecap="round" />
      ))}
    </svg>
  );
}
