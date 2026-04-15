// Canonical message the user signs to prove ownership of the wallet
// they're binding. Shape is fixed so the server can recreate it
// deterministically from session + nonce and verify the signature.
//
// Human-readable on purpose — this string appears in the wallet popup
// and should make the user confident about what they're signing.
//
// The nonce is a per-session random value issued by /api/wallet/nonce.
// Keeping it short-lived (5 min) prevents replay across sessions.

export function bindMessage(params: {
  xHandle: string;
  xId:     string;
  nonce:   string;
  issuedAt: string; // ISO8601
}): string {
  return [
    "DOGE FORGE Community",
    "",
    "Sign to bind this wallet to your X account.",
    `X handle: @${params.xHandle}`,
    `X id:     ${params.xId}`,
    `Nonce:    ${params.nonce}`,
    `Issued:   ${params.issuedAt}`,
    "",
    "This does not authorise any token transfer.",
  ].join("\n");
}
