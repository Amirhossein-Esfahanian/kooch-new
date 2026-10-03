using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Wallet;

public sealed record CreateWalletWithdrawalRequest(string Currency, decimal Amount);

public sealed record WalletWithdrawalResponse(
    int Id,
    string Currency,
    decimal Amount,
    WalletWithdrawalStatus Status,
    DateTime RequestedAtUtc);

public sealed record AdminWalletWithdrawalResponse(
    int Id,
    string GuestName,
    string Currency,
    decimal Amount,
    WalletWithdrawalStatus Status,
    DateTime RequestedAtUtc,
    DateTime? ProcessedAtUtc);
