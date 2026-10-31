namespace Kooch.Api.Services;

public sealed class OtpVerificationUnavailableException(Exception innerException)
    : Exception("OTP verification is temporarily unavailable. Please try again.", innerException);
