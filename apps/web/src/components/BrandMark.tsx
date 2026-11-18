/** The Blindspot mark: a smoked-glass square with an off-centre "blind spot" (same as the printed nav mark). */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="bs-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d9d6ff" />
          <stop offset="0.55" stopColor="#9fe9c3" />
          <stop offset="1" stopColor="#5d5a7a" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.7" fill="url(#bs-mark)" />
      <circle cx="19.8" cy="12.8" r="6.4" fill="#050507" />
    </svg>
  );
}
