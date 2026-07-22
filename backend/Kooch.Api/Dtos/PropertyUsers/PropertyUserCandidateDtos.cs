using System.ComponentModel.DataAnnotations;

namespace Kooch.Api.Dtos.PropertyUsers;

public enum PropertyUserCandidateOutcome
{
    CanContinue,
    AlreadyMember,
    Unavailable
}

public sealed class PropertyUserCandidateRequest
{
    [Required, MaxLength(30)]
    public string Mobile { get; set; } = string.Empty;
}

public sealed class PropertyUserCandidateResponse
{
    public PropertyUserCandidateOutcome Outcome { get; set; }
    public bool RequiresUserCreation { get; set; }
    public string? MaskedName { get; set; }
}
