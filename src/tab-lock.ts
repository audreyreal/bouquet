import { TAB_LOCK } from "./constants";
import { sleep } from "./utils";

/* One Bouquet tab at a time: an exclusive Web Lock. A second try a second later covers in-tab
 * Manage↔Settings navigation, where the previous document may still be releasing it. Returns the
 * lock's release (held until called or the document goes away), or null when another tab holds it. */
export async function acquireTabLock(): Promise<(() => void) | null> {
  const tryOnce = (): Promise<(() => void) | null> => {
    const { promise, resolve } = Promise.withResolvers<(() => void) | null>();
    void navigator.locks.request(TAB_LOCK, { ifAvailable: true }, (lock) => {
      if (lock === null) {
        resolve(null);
        return undefined;
      }
      /* The lock stays held while `held` is pending. */
      const held = Promise.withResolvers<void>();
      resolve(() => held.resolve());
      return held.promise;
    });
    return promise;
  };
  const first = await tryOnce();
  if (first) return first;
  await sleep(1000);
  return tryOnce();
}
