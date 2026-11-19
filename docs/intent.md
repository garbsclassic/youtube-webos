# Intent

Deliberate choices that look like mistakes. One line each: what it looks like, why it stays.

- **Legacy webOS branches in a modern-only build.** `isLegacyWebOS()`, `getWebOSVersion() <= 4` checks and the Chrome 38 helpers in the test harness look dead, and they are on webOS 22+. They stay as upstream wrote them so upstream changes to those hot paths cherry-pick without conflicts.
- **`emoji-wrap.js` is a no-op that the adblock filters still call.** The legacy emoji fix is gone; keeping the module and its call sites keeps upstream's filter code unchanged.
