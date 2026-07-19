using System.ComponentModel.DataAnnotations;
using Kooch.Api.Entities;

namespace Kooch.Api.Dtos.Admin;

public enum PreviousOwnerTransferAction
{
    DeactivateMembership,
    Demote
}

public class AdminTransferPropertyOwnershipRequest
{
    [Range(1, int.MaxValue)]
    public int? NewOwnerId { get; set; }

    public AdminPropertyOwnerAccountRequest? NewOwner { get; set; }

    public PreviousOwnerTransferAction PreviousOwnerAction { get; set; } = PreviousOwnerTransferAction.DeactivateMembership;

    public PropertyUserRole? PreviousOwnerRole { get; set; }
}
