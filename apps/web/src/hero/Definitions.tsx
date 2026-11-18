"use client";

/**
 * The view revealed behind the shattered page: Blindspot in five terms.
 * Type scales with viewport width, measured from the reference layout.
 */
export const TERMS: { term: string; body: string }[] = [
  {
    term: "Sealed bet",
    body: "Your stake is public, your side is not. It is encrypted to the market’s ML-KEM-1024 key and bound by a commitment, so nobody can read it before close — and nobody, you included, can change it after.",
  },
  {
    term: "Keyper",
    body: "Holds each market’s secret key and publishes it on-chain only once betting has closed. From that moment anyone can decrypt every bet and check every reveal.",
  },
  {
    term: "Reveal",
    body: "Sealed sides are opened against their commitments. A side that doesn’t match is rejected; a bet that stays hidden is forfeited to the winners, so hiding a losing side never pays.",
  },
  {
    term: "Optimistic oracle",
    body: "Anyone can propose the outcome by posting a bond. Undisputed for two hours, it becomes final; disputed, it escalates to the council and the loser’s bond goes to whoever was right.",
  },
  {
    term: "Post-quantum council",
    body: "Settles disputes with an ML-DSA-87 signature, verified on-chain by QoreChain’s precompile — unforgeable even by a quantum computer. Winners then split the pool.",
  },
];

export function Definitions({ visible, onBack }: { visible: boolean; onBack: () => void }) {
  return (
    <div
      className="hero-definitions"
      data-visible={visible}
      aria-hidden={!visible}
      style={{ pointerEvents: visible ? "auto" : "none" }}
    >
      <button type="button" className="hero-back" onClick={onBack} tabIndex={visible ? 0 : -1}>
        ← Back
      </button>
      <article className="hero-terms">
        <h2>Blindspot, in five terms.</h2>
        {TERMS.map((t) => (
          <p key={t.term}>
            <b>{t.term}</b> — {t.body}
          </p>
        ))}
      </article>
    </div>
  );
}
