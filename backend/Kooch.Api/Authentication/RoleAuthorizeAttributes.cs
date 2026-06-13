using Microsoft.AspNetCore.Authorization;

namespace Kooch.Api.Authentication;

public sealed class SuperAdminAuthorizeAttribute() : AuthorizeAttribute(AuthorizationPolicies.SuperAdmin);

public sealed class AdminAuthorizeAttribute() : AuthorizeAttribute(AuthorizationPolicies.AdminUsers);

public sealed class OwnerAuthorizeAttribute() : AuthorizeAttribute(AuthorizationPolicies.OwnerUsers);
