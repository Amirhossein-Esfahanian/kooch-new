using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWalletWithdrawalPayoutExecution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "PaidAtUtc",
                table: "WalletWithdrawalRequests",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PaidByUserId",
                table: "WalletWithdrawalRequests",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PayoutMethod",
                table: "WalletWithdrawalRequests",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PayoutNote",
                table: "WalletWithdrawalRequests",
                type: "nvarchar(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PayoutReferenceNumber",
                table: "WalletWithdrawalRequests",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WalletWithdrawalAllocationId",
                table: "WalletEntries",
                type: "int",
                nullable: true);

            migrationBuilder.AddUniqueConstraint(
                name: "AK_WalletWithdrawalAllocations_Id_WalletAccountId_WalletLotId",
                table: "WalletWithdrawalAllocations",
                columns: new[] { "Id", "WalletAccountId", "WalletLotId" });

            migrationBuilder.CreateIndex(
                name: "IX_WalletWithdrawalRequests_PaidByUserId",
                table: "WalletWithdrawalRequests",
                column: "PaidByUserId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_WalletWithdrawalRequests_PayoutFacts",
                table: "WalletWithdrawalRequests",
                sql: "([Status] = 2 AND [PaidAtUtc] IS NOT NULL AND [PaidByUserId] IS NOT NULL AND [PayoutMethod] IN (0, 1, 2) AND [PayoutReferenceNumber] IS NOT NULL) OR ([Status] <> 2 AND [PaidAtUtc] IS NULL AND [PaidByUserId] IS NULL AND [PayoutMethod] IS NULL AND [PayoutReferenceNumber] IS NULL AND [PayoutNote] IS NULL)");

            migrationBuilder.CreateIndex(
                name: "IX_WalletEntries_WalletWithdrawalAllocationId",
                table: "WalletEntries",
                column: "WalletWithdrawalAllocationId",
                unique: true,
                filter: "[WalletWithdrawalAllocationId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_WalletEntries_WalletWithdrawalAllocationId_WalletAccountId_WalletLotId",
                table: "WalletEntries",
                columns: new[] { "WalletWithdrawalAllocationId", "WalletAccountId", "WalletLotId" });

            migrationBuilder.AddCheckConstraint(
                name: "CK_WalletEntries_WithdrawalDebit",
                table: "WalletEntries",
                sql: "[WalletWithdrawalAllocationId] IS NULL OR [Direction] = 1");

            migrationBuilder.AddForeignKey(
                name: "FK_WalletEntries_WalletWithdrawalAllocations_WalletWithdrawalAllocationId_WalletAccountId_WalletLotId",
                table: "WalletEntries",
                columns: new[] { "WalletWithdrawalAllocationId", "WalletAccountId", "WalletLotId" },
                principalTable: "WalletWithdrawalAllocations",
                principalColumns: new[] { "Id", "WalletAccountId", "WalletLotId" });

            migrationBuilder.AddForeignKey(
                name: "FK_WalletWithdrawalRequests_Users_PaidByUserId",
                table: "WalletWithdrawalRequests",
                column: "PaidByUserId",
                principalTable: "Users",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_WalletEntries_WalletWithdrawalAllocations_WalletWithdrawalAllocationId_WalletAccountId_WalletLotId",
                table: "WalletEntries");

            migrationBuilder.DropForeignKey(
                name: "FK_WalletWithdrawalRequests_Users_PaidByUserId",
                table: "WalletWithdrawalRequests");

            migrationBuilder.DropIndex(
                name: "IX_WalletWithdrawalRequests_PaidByUserId",
                table: "WalletWithdrawalRequests");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WalletWithdrawalRequests_PayoutFacts",
                table: "WalletWithdrawalRequests");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_WalletWithdrawalAllocations_Id_WalletAccountId_WalletLotId",
                table: "WalletWithdrawalAllocations");

            migrationBuilder.DropIndex(
                name: "IX_WalletEntries_WalletWithdrawalAllocationId",
                table: "WalletEntries");

            migrationBuilder.DropIndex(
                name: "IX_WalletEntries_WalletWithdrawalAllocationId_WalletAccountId_WalletLotId",
                table: "WalletEntries");

            migrationBuilder.DropCheckConstraint(
                name: "CK_WalletEntries_WithdrawalDebit",
                table: "WalletEntries");

            migrationBuilder.DropColumn(
                name: "PaidAtUtc",
                table: "WalletWithdrawalRequests");

            migrationBuilder.DropColumn(
                name: "PaidByUserId",
                table: "WalletWithdrawalRequests");

            migrationBuilder.DropColumn(
                name: "PayoutMethod",
                table: "WalletWithdrawalRequests");

            migrationBuilder.DropColumn(
                name: "PayoutNote",
                table: "WalletWithdrawalRequests");

            migrationBuilder.DropColumn(
                name: "PayoutReferenceNumber",
                table: "WalletWithdrawalRequests");

            migrationBuilder.DropColumn(
                name: "WalletWithdrawalAllocationId",
                table: "WalletEntries");
        }
    }
}
