using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Wallet;

public sealed record WalletTransactionResponse(
    int Id,
    decimal Amount,
    WalletEntryDirection Direction,
    string Currency,
    DateTime CreatedAtUtc);
