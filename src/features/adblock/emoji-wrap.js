// The legacy emoji fix only runs on webOS 3 and 4, which this fork does not build for, so these
// are no-ops. The callers in the adblock filters stay as upstream wrote them to keep its
// commits cherry-picking cleanly; remove them together if upstream drops the fix.

/** Nothing to wrap. */
export function wrapEmojiInTree() {}

/** No emoji work on this build. */
export function mayNeedEmojiWork() {
  return false;
}
