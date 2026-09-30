namespace Kooch.Api.Dtos.Wallet;

public sealed record WalletBalanceResponse(
    string Currency,
    decimal Balance,
    decimal WithdrawableBalance,
    decimal NonWithdrawableBalance);
