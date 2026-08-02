using Kooch.Api.Authentication;
using Kooch.Api.Dtos.Payments;
using Kooch.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Kooch.Api.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/payments/callbacks")]
public sealed class PaymentCallbacksController(
    IPaymentCallbackService paymentCallbackService,
    ILogger<PaymentCallbacksController> logger) : ControllerBase
{
    private const int MaximumCallbackBodyBytes = 64 * 1024;

    [HttpPost("{providerName}")]
    [EnableRateLimiting(PaymentCallbackRateLimitPolicy.Name)]
    [ProducesResponseType<PaymentCallbackResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<PaymentCallbackResponse>(StatusCodes.Status202Accepted)]
    [ProducesResponseType<PaymentCallbackErrorResponse>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<PaymentCallbackErrorResponse>(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType<PaymentCallbackErrorResponse>(StatusCodes.Status404NotFound)]
    [ProducesResponseType<PaymentCallbackErrorResponse>(StatusCodes.Status409Conflict)]
    [ProducesResponseType<PaymentCallbackErrorResponse>(StatusCodes.Status413PayloadTooLarge)]
    public async Task<ActionResult<PaymentCallbackResponse>> Receive(
        string providerName,
        CancellationToken cancellationToken)
    {
        try
        {
            var rawBody = await ReadRawBodyAsync(Request, cancellationToken);
            var headers = Request.Headers.ToDictionary(
                header => header.Key,
                header => header.Value.ToString(),
                StringComparer.OrdinalIgnoreCase);
            var result = await paymentCallbackService.ReceiveAsync(
                providerName,
                new PaymentProviderCallbackContext(
                    rawBody,
                    headers,
                    HttpContext.Connection.RemoteIpAddress?.ToString()),
                cancellationToken);
            var response = new PaymentCallbackResponse
            {
                Accepted = true,
                IsDuplicate = result.IsDuplicate,
                State = ToPublicState(result.ApplicationState)
            };

            return result.ApplicationState == PaymentCallbackApplicationState.Failed
                ? Accepted(response)
                : Ok(response);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (CallbackBodyTooLargeException)
        {
            return StatusCode(
                StatusCodes.Status413PayloadTooLarge,
                Error("callback_too_large", "Payment callback payload is too large."));
        }
        catch (PaymentProviderValidationException)
        {
            return Unauthorized(Error(
                "callback_validation_failed",
                "Payment callback validation failed."));
        }
        catch (KeyNotFoundException)
        {
            return NotFound(Error(
                "callback_target_not_found",
                "Payment callback target was not found."));
        }
        catch (InvalidOperationException)
        {
            return Conflict(Error(
                "callback_mismatch",
                "Payment callback does not match the pending payment."));
        }
        catch (ArgumentException)
        {
            return BadRequest(Error(
                "callback_invalid",
                "Payment callback request is invalid."));
        }
        catch (Exception exception)
        {
            logger.LogError(
                "Payment callback processing failed for provider {ProviderName}. FailureType: {FailureType}.",
                providerName,
                exception.GetType().Name);
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                Error("callback_processing_failed", "Payment callback could not be processed."));
        }
    }

    private static async Task<byte[]> ReadRawBodyAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        if (request.ContentLength > MaximumCallbackBodyBytes)
        {
            throw new CallbackBodyTooLargeException();
        }

        await using var body = new MemoryStream();
        var buffer = new byte[8192];
        while (true)
        {
            var read = await request.Body.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                return body.ToArray();
            }

            if (body.Length + read > MaximumCallbackBodyBytes)
            {
                throw new CallbackBodyTooLargeException();
            }

            await body.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
        }
    }

    private static string ToPublicState(PaymentCallbackApplicationState state) =>
        state switch
        {
            PaymentCallbackApplicationState.Applied => "applied",
            PaymentCallbackApplicationState.Failed => "pending_reconciliation",
            PaymentCallbackApplicationState.ProviderRejected => "rejected",
            _ => "received"
        };

    private static PaymentCallbackErrorResponse Error(string code, string message) =>
        new() { Code = code, Message = message };

    private sealed class CallbackBodyTooLargeException : Exception;
}
