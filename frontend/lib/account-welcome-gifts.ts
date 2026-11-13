import { apiRequest } from "@/lib/owner-api";
import type { PagedResult } from "@/lib/account-reservations";

export interface WelcomeGift {
  title: string;
  grantedAmount: number;
  currency: string;
  grantedAtUtc: string;
  expiresAtUtc: string;
}

export async function getWelcomeGifts(page: number, signal?: AbortSignal) {
  const result = await apiRequest<PagedResult<WelcomeGift>>(
    `/account/welcome-gifts?page=${page}&pageSize=20`, { signal, cache: "no-store" },
  );
  if (!result || !Array.isArray(result.items) || result.page !== page || result.pageSize !== 20
    || !Number.isSafeInteger(result.totalCount) || result.totalCount < 0
    || result.totalPages !== Math.ceil(result.totalCount / 20) || result.items.length > 20
    || (result.totalCount === 0 && result.items.length > 0)
    || result.items.some(gift => !gift || typeof gift.title !== "string" || !gift.title.trim()
      || !Number.isFinite(gift.grantedAmount) || typeof gift.currency !== "string" || !gift.currency.trim()
      || typeof gift.grantedAtUtc !== "string" || !Number.isFinite(Date.parse(gift.grantedAtUtc))
      || typeof gift.expiresAtUtc !== "string" || !Number.isFinite(Date.parse(gift.expiresAtUtc)))) {
    throw new Error("Invalid welcome gift history response");
  }
  return result;
}
