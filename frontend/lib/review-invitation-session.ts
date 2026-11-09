const dismissedInMemory = new Set<number>();
const key = (userId: number) => `kooch:review-invitation:dismissed:${userId}`;

export function isReviewInvitationDismissed(userId: number) {
  try { return dismissedInMemory.has(userId) || sessionStorage.getItem(key(userId)) === "1"; }
  catch { return dismissedInMemory.has(userId); }
}
export function dismissReviewInvitationForSession(userId: number) {
  dismissedInMemory.add(userId);
  try { sessionStorage.setItem(key(userId), "1"); } catch { /* Memory fallback for blocked storage. */ }
}
