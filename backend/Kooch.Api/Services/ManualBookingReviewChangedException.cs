namespace Kooch.Api.Services;

public sealed class ManualBookingReviewChangedException()
    : InvalidOperationException("قیمت یا ارز سفارش تغییر کرده است؛ پیش‌نمایش را دوباره دریافت و بررسی کنید.");
