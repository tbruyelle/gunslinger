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
  | "timeout"
  | "not-connected"
  | "wrong-account";

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
        return "Adena is locked. Open the Adena extension, unlock it, then try again.";
      case "rejected":
        return "Transaction cancelled.";
      case "wrong-network":
        return `Switch Adena to the "${e.detail ?? "expected"}" network.`;
      case "not-connected":
        return "This site is not connected to the current Adena account. Reconnect from the lobby.";
      case "wrong-account":
        return `Adena is now on another account (${e.detail ?? "?"}). Reconnect from the lobby.`;
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
