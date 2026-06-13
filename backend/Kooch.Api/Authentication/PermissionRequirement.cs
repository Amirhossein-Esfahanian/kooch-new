using Kooch.Api.Entities;
using Microsoft.AspNetCore.Authorization;

namespace Kooch.Api.Authentication;

public sealed record PermissionRequirement(PermissionKey PermissionKey) : IAuthorizationRequirement;
