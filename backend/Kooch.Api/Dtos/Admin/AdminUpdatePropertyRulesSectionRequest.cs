using Kooch.Api.Dtos.Properties;

namespace Kooch.Api.Dtos.Admin;

public sealed class AdminUpdatePropertyRulesSectionRequest : UpdatePropertyRulesSectionRequest
{
    public bool? ShowGuestPhoneToPropertyUsers { get; set; }
}
