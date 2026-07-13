using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Kooch.Api.Exceptions;

namespace Kooch.Api.Filters;

public class ApiExceptionFilter : IExceptionFilter
{
    public void OnException(ExceptionContext context)
    {
        if (context.Exception is PropertyActivationException activationException)
        {
            context.Result = new ObjectResult(new
            {
                message = activationException.Message,
                completion = activationException.Completion
            })
            {
                StatusCode = StatusCodes.Status409Conflict
            };
            context.ExceptionHandled = true;
            return;
        }

        var statusCode = context.Exception switch
        {
            KeyNotFoundException => StatusCodes.Status404NotFound,
            UnauthorizedAccessException => StatusCodes.Status403Forbidden,
            InvalidOperationException => StatusCodes.Status409Conflict,
            ArgumentException => StatusCodes.Status400BadRequest,
            _ => 0
        };

        if (statusCode == 0)
        {
            return;
        }

        context.Result = new ObjectResult(new { message = context.Exception.Message })
        {
            StatusCode = statusCode
        };
        context.ExceptionHandled = true;
    }
}
