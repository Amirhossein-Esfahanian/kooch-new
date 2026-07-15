using Kooch.Api.Authentication;
using Kooch.Api.Entities;
using Xunit;

namespace Kooch.Api.Tests;

public sealed class AuthorizationRoleExtensionsTests
{
    [Theory]
    [InlineData(UserRole.SuperAdmin, true)]
    [InlineData(UserRole.AdminAssistant, true)]
    [InlineData(UserRole.Client, false)]
    [InlineData(UserRole.Owner, false)]
    [InlineData(UserRole.OwnerAssistant, false)]
    public void IsPlatformAdmin_RecognizesOnlyPlatformAdministratorRoles(
        UserRole role,
        bool expected)
    {
        Assert.Equal(expected, role.IsPlatformAdmin());
    }

    [Theory]
    [InlineData(UserRole.SuperAdmin, UserRole.SuperAdmin)]
    [InlineData(UserRole.AdminAssistant, UserRole.AdminAssistant)]
    [InlineData(UserRole.Client, UserRole.Client)]
    [InlineData(UserRole.Owner, UserRole.Client)]
    [InlineData(UserRole.OwnerAssistant, UserRole.Client)]
    public void ToCanonicalPlatformRole_NormalizesLegacyPropertyRoles(
        UserRole role,
        UserRole expected)
    {
        Assert.Equal(expected, role.ToCanonicalPlatformRole());
    }

    [Fact]
    public void IsPropertyRole_RecognizesEveryDefinedPropertyRole()
    {
        Assert.All(
            Enum.GetValues<PropertyUserRole>(),
            role => Assert.True(role.IsPropertyRole()));
    }

    [Fact]
    public void IsPropertyRole_RejectsUndefinedValues()
    {
        Assert.False(((PropertyUserRole)int.MaxValue).IsPropertyRole());
    }
}
