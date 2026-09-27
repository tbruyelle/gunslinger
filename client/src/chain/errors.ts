export type ChainErrorKind =
  | "no-wallet"
  | "locked"
  | "rejected"
  | "wrong-network"
  | "checktx"
  | "delivertx"
  | "rpc"
  | "query"
  | "busy"
  | "timeout";

/** An error from the wallet, the node, or the realm, with a kind the UI can act on. */
export class ChainError extends Error {
  constructor(readonly kind: ChainErrorKind, message: string, readonly detail?: string) {
    super(message);
    this.name = "ChainError";
  }
}

/** A one-line message for a toast or banner. */
export function userMessage(e: unknown): string {
  if (e instanceof ChainError) {
    switch (e.kind) {
      case "no-wallet":
        return "Adena wallet not detected. Install it, then reload.";
      case "locked":
        return "Unlock Adena and try again.";
      case "rejected":
        return "Transaction cancelled.";
      case "wrong-network":
        return `Switch Adena to the "${e.detail ?? "expected"}" network.`;
      case "busy":
        return "A transaction is still pending.";
      case "timeout":
        return "Still waiting for the chain…";
      default:
        return e.message;
    }
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
