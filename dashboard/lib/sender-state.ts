/**
 * Tracks what you've done with each sender (unsubscribed / resubscribed)
 * in browser localStorage. Persists across page reloads on the same device.
 *
 * This is a LOCAL marker of your actions, not the actual subscription status
 * with the sender (Bashir can't know that — only the sender does). After you
 * click Unsubscribe in the dashboard, we record that you did, so you can see
 * at a glance which senders you've already handled.
 *
 * Per-device for V1; can be promoted to a Supabase column later if you want
 * the state to sync across phone + laptop.
 */

export type SenderState = "subscribed" | "unsubscribed" | "resubscribed";

const KEY = "bashir.senderState.v1";

interface Store {
  [fromEmail: string]: {
    state: Exclude<SenderState, "subscribed">;
    at: number;
  };
}

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
    // Tell other tabs/components on this page to re-read.
    window.dispatchEvent(new CustomEvent("bashir:senderState"));
  } catch {
    // localStorage full or disabled — silently ignore.
  }
}

export function getSenderState(fromEmail: string | null | undefined): SenderState {
  if (!fromEmail) return "subscribed";
  const store = read();
  return store[fromEmail.toLowerCase()]?.state ?? "subscribed";
}

export function setSenderState(
  fromEmail: string | null | undefined,
  state: Exclude<SenderState, "subscribed">,
): void {
  if (!fromEmail) return;
  const store = read();
  store[fromEmail.toLowerCase()] = { state, at: Date.now() };
  write(store);
}

export function clearSenderState(fromEmail: string | null | undefined): void {
  if (!fromEmail) return;
  const store = read();
  delete store[fromEmail.toLowerCase()];
  write(store);
}

/** Subscribe to changes (across components / tabs). Returns an unsubscribe fn. */
export function onSenderStateChange(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = () => handler();
  window.addEventListener("bashir:senderState", wrapped);
  window.addEventListener("storage", wrapped);
  return () => {
    window.removeEventListener("bashir:senderState", wrapped);
    window.removeEventListener("storage", wrapped);
  };
}
