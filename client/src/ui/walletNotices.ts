import { subscribeWalletLocked, subscribeWalletWaiting, WALLET_TIMEOUT_MS } from "../chain/adena";
import { ChainError, userMessage } from "../chain/errors";
import { hideToast, showToast } from "./toast";

let installed = false;

/**
 * Wallet notices shared by every scene: Adena getting locked or unlocked,
 * and a call left without answer (its popup hidden behind the browser, on
 * another screen, or waiting on Adena's unlock page). Installed once, after
 * Adena is detected.
 */
export function installWalletNotices(): void {
  if (installed) return;
  installed = true;
  subscribeWalletLocked((locked) => {
    if (locked) {
      // Same text as the error of a call refused for the lock, so the two
      // show as one toast.
      const msg = userMessage(new ChainError("locked", "Adena is locked"));
      hideToast("Adena unlocked");
      showToast(null, msg, "error", 8000);
    } else {
      hideToast(userMessage(new ChainError("locked", "Adena is locked")));
      showToast(null, "Adena unlocked", "info", 2500);
    }
  });
  subscribeWalletWaiting((waiting) => {
    if (waiting) {
      showToast(
        null,
        "Waiting for Adena…\nApprove the request in its popup window. If you cannot see it, open the Adena extension.",
        "info",
        WALLET_TIMEOUT_MS,
        { key: "adena-wait" },
      );
    } else {
      hideToast("adena-wait");
    }
  });
}
