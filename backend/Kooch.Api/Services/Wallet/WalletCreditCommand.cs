using Kooch.Api.Entities;

namespace Kooch.Api.Services.Wallet;

// Internal funding input only; no HTTP write endpoint accepts this command.
public sealed record WalletCreditCommand(
    int UserId,
    string Currency,
    decimal Amount,
    WalletSourceType SourceType,
    DateTime? ExpiresAtUtc = null,
    int? CreatedByUserId = null,
    string? SourceReference = null,
    string? Reason = null);
