using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Wallet;

public sealed record CreateWalletWithdrawalRequest(string Currency, decimal Amount);

public sealed record WalletWithdrawalResponse(
    int Id,
    string Currency,
    decimal Amount,
    WalletWithdrawalStatus Status,
    DateTime RequestedAtUtc);

public sealed class MarkWalletWithdrawalPaidRequest
{
    [Required] public SettlementPaymentMethod? PayoutMethod { get; set; }
    [Required, StringLength(200, MinimumLength = 1)] public string? ReferenceNumber { get; set; }
    [Required] public DateTimeOffset? PaidAtUtc { get; set; }
    [StringLength(2000)] public string? Note { get; set; }
}

public sealed record AdminWalletWithdrawalResponse(
    int Id,
    string GuestName,
    string Currency,
    decimal Amount,
    WalletWithdrawalStatus Status,
    DateTime RequestedAtUtc,
    DateTime? ProcessedAtUtc,
    DateTime? PaidAtUtc,
    SettlementPaymentMethod? PayoutMethod,
    string? PayoutReferenceNumber,
    string? PayoutNote);
