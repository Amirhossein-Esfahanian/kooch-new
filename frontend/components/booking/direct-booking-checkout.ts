import {
  createAccountBookingSession,
  issuePropertyDirectBookingContext,
  type AccountBookingSessionCreateRequest,
  type AccountBookingSessionCreateResponse,
} from "@/lib/booking-sessions";
import { ApiRequestError } from "@/lib/owner-api";

const missingCreationToken = "A matching Property Direct booking context token is required for creation.";
const invalidContext = "Property Direct booking context is invalid or expired.";

export class DirectBookingCheckoutError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "DirectBookingCheckoutError";
  }
}

function safeFailure(error: unknown): DirectBookingCheckoutError {
  if (error instanceof DirectBookingCheckoutError) return error;
  const status = error instanceof ApiRequestError ? error.status : undefined;
  const messages: Record<number, string> = {
    400: "اعتبار درخواست رزرو مستقیم تأیید نشد. انتخاب‌های شما حفظ شده‌اند؛ دوباره تلاش کنید.",
    401: "نشست شما معتبر نیست. سبد رزرو حفظ شده؛ دوباره وارد حساب شوید.",
    403: "اجازه ثبت این رزرو مستقیم وجود ندارد. به صفحه اقامتگاه برگردید و وضعیت آن را بررسی کنید.",
    404: "اقامتگاه یا درخواست رزرو در دسترس نیست. به صفحه اقامتگاه برگردید و دوباره بررسی کنید.",
    409: "این تلاش رزرو با اطلاعات قبلی مطابقت ندارد. پیش از تلاش تازه، سفارش‌های خود را بررسی کنید.",
    429: "تعداد درخواست‌ها زیاد است. کمی صبر کنید و سپس دوباره تلاش کنید.",
    503: "سرویس رزرو مستقیم موقتاً در دسترس نیست. سبد شما حفظ شده است؛ بعداً دوباره تلاش کنید.",
  };
  // Never render a raw issuance/creation error: it may contain protected request data.
  return new DirectBookingCheckoutError(status && messages[status] ||
    "ارتباط با سامانه رزرو برقرار نشد. سبد شما حفظ شده است؛ با همان انتخاب‌ها دوباره تلاش کنید.", status);
}

export async function replayPropertyDirectBookingSession(
  request: AccountBookingSessionCreateRequest,
  propertyId: number,
  create = createAccountBookingSession,
): Promise<AccountBookingSessionCreateResponse | null> {
  try {
    return await create({ ...request, propertyDirectContext: { propertyId, token: null } });
  } catch (error) {
    // Phase 3 rejects tokenless NEW creation with this precise 400. No other failure proves absence.
    if (error instanceof ApiRequestError && error.status === 400 && error.message === missingCreationToken) return null;
    throw safeFailure(error);
  }
}

export async function createPropertyDirectBookingSession(
  request: AccountBookingSessionCreateRequest,
  property: { propertyId: number; propertySlug: string },
  onCreating: () => void,
  isCurrent: () => boolean,
  issue = issuePropertyDirectBookingContext,
  create = createAccountBookingSession,
): Promise<AccountBookingSessionCreateResponse> {
  const assertCurrent = () => {
    if (!isCurrent()) throw new DirectBookingCheckoutError("اطلاعات حساب یا رزرو تغییر کرده است. انتخاب فعلی را دوباره بررسی کنید.");
  };
  try {
    // One bounded renewal only. The request and idempotency key never change between attempts.
    for (let attempt = 0; attempt < 2; attempt++) {
      assertCurrent();
      const context = await issue(property.propertySlug, request.idempotencyKey);
      assertCurrent();
      if (context.propertyId !== property.propertyId || typeof context.token !== "string" ||
          !context.token.trim() || !Number.isFinite(Date.parse(context.expiresAtUtc))) {
        throw new DirectBookingCheckoutError("پاسخ اعتبارسنجی رزرو با اقامتگاه انتخاب‌شده مطابقت ندارد. به صفحه اقامتگاه برگردید.");
      }
      if (Date.parse(context.expiresAtUtc) <= Date.now()) {
        if (attempt === 0) continue;
        throw new DirectBookingCheckoutError("اعتبار درخواست رزرو منقضی شده است. ساعت دستگاه را بررسی کنید و دوباره تلاش کنید.");
      }
      onCreating();
      assertCurrent();
      try {
        return await create({ ...request,
          propertyDirectContext: { propertyId: context.propertyId, token: context.token } });
      } catch (error) {
        if (attempt === 0 && error instanceof ApiRequestError && error.status === 400 && error.message === invalidContext) continue;
        throw error;
      }
    }
    throw new DirectBookingCheckoutError("اعتبار درخواست رزرو تأیید نشد. دوباره تلاش کنید.");
  } catch (error) {
    throw safeFailure(error);
  }
}
