using System.Collections.Concurrent;
using System.Data;
using Kooch.Api.Data;
using Kooch.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace Kooch.Api.Services;

public sealed class PaymentCallbackService(
    KoochDbContext dbContext,
    IEnumerable<IPaymentProvider> providers,
    IPaymentDomainApplicationHandler domainApplicationHandler) : IPaymentCallbackService
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> LocalCallbackLocks = new();

    public async Task<PaymentCallbackResult> ReceiveAsync(
        string providerName,
        PaymentProviderCallbackContext context,
        CancellationToken cancellationToken = default)
    {
        var provider = ResolveProvider(providerName);
        var validated = await provider.ValidateCallbackAsync(context, cancellationToken);
        var resource = $"payment:{validated.PaymentId}";
        var callbackLock = LocalCallbackLocks.GetOrAdd(resource, static _ => new SemaphoreSlim(1, 1));
        await callbackLock.WaitAsync(cancellationToken);

        try
        {
            var receiptResult = await PersistReceiptAsync(
                provider.Name,
                validated,
                cancellationToken);
            if (receiptResult.IsDuplicate || !validated.IsSuccessful)
            {
                return receiptResult;
            }

            return await ApplyDomainAsync(
                validated.PaymentId,
                receiptResult.ReceiptId,
                isDuplicate: false,
                cancellationToken);
        }
        finally
        {
            callbackLock.Release();
        }
    }

    public async Task<PaymentCallbackResult> RetryApplicationAsync(
        int paymentId,
        CancellationToken cancellationToken = default)
    {
        if (paymentId <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(paymentId));
        }

        var receiptId = await dbContext.PaymentCallbackReceipts.AsNoTracking()
            .Where(receipt => receipt.PaymentId == paymentId && receipt.IsSuccessful)
            .OrderByDescending(receipt => receipt.Id)
            .Select(receipt => (int?)receipt.Id)
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new InvalidOperationException("No successful provider receipt is available for retry.");
        var callbackLock = LocalCallbackLocks.GetOrAdd(
            $"payment:{paymentId}",
            static _ => new SemaphoreSlim(1, 1));
        await callbackLock.WaitAsync(cancellationToken);

        try
        {
            return await ApplyDomainAsync(
                paymentId,
                receiptId,
                isDuplicate: true,
                cancellationToken);
        }
        finally
        {
            callbackLock.Release();
        }
    }

    private async Task<PaymentCallbackResult> PersistReceiptAsync(
        string providerName,
        ValidatedPaymentProviderCallback callback,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var payment = await LockPaymentAsync(callback.PaymentId, cancellationToken);
        ValidatePaymentMatch(payment, providerName, callback);

        var existingReceipt = await dbContext.PaymentCallbackReceipts
            .SingleOrDefaultAsync(receipt =>
                receipt.Provider == providerName &&
                receipt.ProviderEventId == callback.ProviderEventId,
                cancellationToken);
        if (existingReceipt is not null)
        {
            ValidateReceiptMatch(existingReceipt, callback);
            await transaction.CommitAsync(cancellationToken);
            return ToResult(
                payment,
                existingReceipt.Id,
                isDuplicate: true,
                providerRejected: !existingReceipt.IsSuccessful);
        }

        var now = DateTime.UtcNow;
        var receipt = new PaymentCallbackReceipt
        {
            PaymentId = payment.Id,
            Provider = providerName,
            ProviderEventId = callback.ProviderEventId,
            TransactionReference = callback.TransactionReference,
            Amount = callback.Amount,
            Currency = callback.Currency,
            IsSuccessful = callback.IsSuccessful,
            ReceivedAtUtc = now
        };
        payment.TransactionReference ??= callback.TransactionReference;
        if (callback.IsSuccessful)
        {
            payment.ProviderConfirmedAtUtc ??= callback.ProviderOccurredAtUtc;
        }
        else
        {
            payment.Status = PaymentStatus.Failed;
            payment.FailedAtUtc = callback.ProviderOccurredAtUtc;
            payment.ProcessingError = "The provider reported an unsuccessful payment.";
        }

        dbContext.PaymentCallbackReceipts.Add(receipt);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToResult(
            payment,
            receipt.Id,
            isDuplicate: false,
            providerRejected: !receipt.IsSuccessful);
    }

    private async Task<PaymentCallbackResult> ApplyDomainAsync(
        int paymentId,
        int receiptId,
        bool isDuplicate,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var transaction = await dbContext.Database.BeginTransactionAsync(
                IsolationLevel.Serializable,
                cancellationToken);
            var payment = await LockPaymentAsync(paymentId, cancellationToken);
            if (payment.AppliedAtUtc.HasValue)
            {
                await transaction.CommitAsync(cancellationToken);
                return ToResult(payment, receiptId, isDuplicate);
            }

            var outcome = await domainApplicationHandler.ApplyAsync(
                payment,
                cancellationToken);
            if (outcome == PaymentDomainApplicationOutcome.Deferred)
            {
                await transaction.CommitAsync(cancellationToken);
                return ToResult(payment, receiptId, isDuplicate);
            }

            var now = DateTime.UtcNow;
            payment.Status = PaymentStatus.Successful;
            payment.PaidAtUtc ??= now;
            payment.AppliedAtUtc = now;
            payment.FailedAtUtc = null;
            payment.ProcessingError = null;
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return ToResult(payment, receiptId, isDuplicate);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            dbContext.ChangeTracker.Clear();
            return await RecordProcessingFailureAsync(
                paymentId,
                receiptId,
                isDuplicate,
                exception,
                cancellationToken);
        }
    }

    private async Task<PaymentCallbackResult> RecordProcessingFailureAsync(
        int paymentId,
        int receiptId,
        bool isDuplicate,
        Exception exception,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(
            IsolationLevel.Serializable,
            cancellationToken);
        var payment = await LockPaymentAsync(paymentId, cancellationToken);
        payment.FailedAtUtc = DateTime.UtcNow;
        payment.ProcessingError = $"Domain application failed ({exception.GetType().Name}).";
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return ToResult(payment, receiptId, isDuplicate);
    }

    private IPaymentProvider ResolveProvider(string providerName)
    {
        var normalized = providerName?.Trim();
        if (string.IsNullOrEmpty(normalized))
        {
            throw new ArgumentException("Payment provider is required.", nameof(providerName));
        }

        return providers.SingleOrDefault(provider =>
                   string.Equals(provider.Name, normalized, StringComparison.OrdinalIgnoreCase))
               ?? throw new KeyNotFoundException("Payment provider is not registered.");
    }

    private static void ValidatePaymentMatch(
        Payment payment,
        string providerName,
        ValidatedPaymentProviderCallback callback)
    {
        if (!string.Equals(payment.Provider, providerName, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("The callback provider does not match the payment.");
        }

        if (payment.Amount != callback.Amount)
        {
            throw new InvalidOperationException("The callback amount does not match the payment.");
        }

        if (!string.Equals(payment.Currency, callback.Currency, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("The callback currency does not match the payment.");
        }

        if (payment.TransactionReference is not null &&
            payment.TransactionReference != callback.TransactionReference)
        {
            throw new InvalidOperationException(
                "The callback transaction reference does not match the payment.");
        }
    }

    private static void ValidateReceiptMatch(
        PaymentCallbackReceipt receipt,
        ValidatedPaymentProviderCallback callback)
    {
        if (receipt.PaymentId != callback.PaymentId ||
            receipt.TransactionReference != callback.TransactionReference ||
            receipt.Amount != callback.Amount ||
            !string.Equals(receipt.Currency, callback.Currency, StringComparison.OrdinalIgnoreCase) ||
            receipt.IsSuccessful != callback.IsSuccessful)
        {
            throw new InvalidOperationException(
                "The provider event was already received with a different payload.");
        }
    }

    private static PaymentCallbackResult ToResult(
        Payment payment,
        int receiptId,
        bool isDuplicate,
        bool providerRejected = false) =>
        new()
        {
            PaymentId = payment.Id,
            ReceiptId = receiptId,
            IsDuplicate = isDuplicate,
            ApplicationState = GetApplicationState(payment, providerRejected),
            ProviderConfirmedAtUtc = payment.ProviderConfirmedAtUtc,
            AppliedAtUtc = payment.AppliedAtUtc,
            FailedAtUtc = payment.FailedAtUtc
        };

    private static PaymentCallbackApplicationState GetApplicationState(
        Payment payment,
        bool providerRejected)
    {
        if (payment.AppliedAtUtc.HasValue)
        {
            return PaymentCallbackApplicationState.Applied;
        }

        if (providerRejected)
        {
            return PaymentCallbackApplicationState.ProviderRejected;
        }

        if (payment.FailedAtUtc.HasValue)
        {
            return PaymentCallbackApplicationState.Failed;
        }

        return payment.ProviderConfirmedAtUtc.HasValue
            ? PaymentCallbackApplicationState.Deferred
            : PaymentCallbackApplicationState.Received;
    }

    private async Task<Payment> LockPaymentAsync(int paymentId, CancellationToken token) =>
        await GetPaymentLockQuery(paymentId).SingleOrDefaultAsync(token)
        ?? throw new KeyNotFoundException("Payment not found.");

    private IQueryable<Payment> GetPaymentLockQuery(int paymentId) =>
        dbContext.Database.IsSqlServer()
            ? dbContext.Payments.FromSqlInterpolated(
                $"SELECT * FROM Payments WITH (UPDLOCK, HOLDLOCK) WHERE Id = {paymentId}")
            : dbContext.Payments.Where(payment => payment.Id == paymentId);

}
