using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWalletWithdrawalRequests : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WalletWithdrawalRequests",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WalletAccountId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    RequestedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WalletWithdrawalRequests", x => x.Id);
                    table.UniqueConstraint("AK_WalletWithdrawalRequests_Id_WalletAccountId", x => new { x.Id, x.WalletAccountId });
                    table.CheckConstraint("CK_WalletWithdrawalRequests_Amount", "[Amount] > 0");
                    table.CheckConstraint("CK_WalletWithdrawalRequests_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.CheckConstraint("CK_WalletWithdrawalRequests_Status", "[Status] IN (0, 1, 2, 3, 4)");
                    table.ForeignKey(
                        name: "FK_WalletWithdrawalRequests_WalletAccounts_WalletAccountId",
                        column: x => x.WalletAccountId,
                        principalTable: "WalletAccounts",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "WalletWithdrawalAllocations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WalletWithdrawalRequestId = table.Column<int>(type: "int", nullable: false),
                    WalletAccountId = table.Column<int>(type: "int", nullable: false),
                    WalletLotId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    UpdatedByUserId = table.Column<int>(type: "int", nullable: true),
                    DeletedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    DeletedByUserId = table.Column<int>(type: "int", nullable: true),
                    IsDeleted = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WalletWithdrawalAllocations", x => x.Id);
                    table.CheckConstraint("CK_WalletWithdrawalAllocations_Amount", "[Amount] > 0");
                    table.CheckConstraint("CK_WalletWithdrawalAllocations_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.ForeignKey(
                        name: "FK_WalletWithdrawalAllocations_WalletLots_WalletLotId_WalletAccountId",
                        columns: x => new { x.WalletLotId, x.WalletAccountId },
                        principalTable: "WalletLots",
                        principalColumns: new[] { "Id", "WalletAccountId" });
                    table.ForeignKey(
                        name: "FK_WalletWithdrawalAllocations_WalletWithdrawalRequests_WalletWithdrawalRequestId_WalletAccountId",
                        columns: x => new { x.WalletWithdrawalRequestId, x.WalletAccountId },
                        principalTable: "WalletWithdrawalRequests",
                        principalColumns: new[] { "Id", "WalletAccountId" });
                });

            migrationBuilder.CreateIndex(
                name: "IX_WalletWithdrawalAllocations_WalletLotId_WalletAccountId",
                table: "WalletWithdrawalAllocations",
                columns: new[] { "WalletLotId", "WalletAccountId" });

            migrationBuilder.CreateIndex(
                name: "IX_WalletWithdrawalAllocations_WalletWithdrawalRequestId_WalletAccountId",
                table: "WalletWithdrawalAllocations",
                columns: new[] { "WalletWithdrawalRequestId", "WalletAccountId" });

            migrationBuilder.CreateIndex(
                name: "IX_WalletWithdrawalAllocations_WalletWithdrawalRequestId_WalletLotId",
                table: "WalletWithdrawalAllocations",
                columns: new[] { "WalletWithdrawalRequestId", "WalletLotId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WalletWithdrawalRequests_WalletAccountId_Status_RequestedAtUtc",
                table: "WalletWithdrawalRequests",
                columns: new[] { "WalletAccountId", "Status", "RequestedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WalletWithdrawalAllocations");

            migrationBuilder.DropTable(
                name: "WalletWithdrawalRequests");
        }
    }
}
