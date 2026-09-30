using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWalletHolds : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WalletHolds",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WalletAccountId = table.Column<int>(type: "int", nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    Status = table.Column<int>(type: "int", nullable: false),
                    ExpiresAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ConsumedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ReleasedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    ExpiredAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
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
                    table.PrimaryKey("PK_WalletHolds", x => x.Id);
                    table.UniqueConstraint("AK_WalletHolds_Id_WalletAccountId", x => new { x.Id, x.WalletAccountId });
                    table.CheckConstraint("CK_WalletHolds_Amount", "[Amount] > 0");
                    table.CheckConstraint("CK_WalletHolds_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.CheckConstraint("CK_WalletHolds_State", "([Status] = 0 AND [ConsumedAtUtc] IS NULL AND [ReleasedAtUtc] IS NULL AND [ExpiredAtUtc] IS NULL) OR ([Status] = 1 AND [ConsumedAtUtc] IS NOT NULL AND [ConsumedAtUtc] < [ExpiresAtUtc] AND [ReleasedAtUtc] IS NULL AND [ExpiredAtUtc] IS NULL) OR ([Status] = 2 AND [ReleasedAtUtc] IS NOT NULL AND [ReleasedAtUtc] < [ExpiresAtUtc] AND [ConsumedAtUtc] IS NULL AND [ExpiredAtUtc] IS NULL) OR ([Status] = 3 AND [ExpiredAtUtc] IS NOT NULL AND [ExpiredAtUtc] >= [ExpiresAtUtc] AND [ConsumedAtUtc] IS NULL AND [ReleasedAtUtc] IS NULL)");
                    table.ForeignKey(
                        name: "FK_WalletHolds_WalletAccounts_WalletAccountId",
                        column: x => x.WalletAccountId,
                        principalTable: "WalletAccounts",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "WalletHoldAllocations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WalletHoldId = table.Column<int>(type: "int", nullable: false),
                    WalletLotId = table.Column<int>(type: "int", nullable: false),
                    WalletAccountId = table.Column<int>(type: "int", nullable: false),
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
                    table.PrimaryKey("PK_WalletHoldAllocations", x => x.Id);
                    table.CheckConstraint("CK_WalletHoldAllocations_Amount", "[Amount] > 0");
                    table.CheckConstraint("CK_WalletHoldAllocations_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.ForeignKey(
                        name: "FK_WalletHoldAllocations_WalletHolds_WalletHoldId_WalletAccountId",
                        columns: x => new { x.WalletHoldId, x.WalletAccountId },
                        principalTable: "WalletHolds",
                        principalColumns: new[] { "Id", "WalletAccountId" });
                    table.ForeignKey(
                        name: "FK_WalletHoldAllocations_WalletLots_WalletLotId_WalletAccountId",
                        columns: x => new { x.WalletLotId, x.WalletAccountId },
                        principalTable: "WalletLots",
                        principalColumns: new[] { "Id", "WalletAccountId" });
                });

            migrationBuilder.CreateIndex(
                name: "IX_WalletHoldAllocations_WalletHoldId_WalletAccountId",
                table: "WalletHoldAllocations",
                columns: new[] { "WalletHoldId", "WalletAccountId" });

            migrationBuilder.CreateIndex(
                name: "IX_WalletHoldAllocations_WalletHoldId_WalletLotId",
                table: "WalletHoldAllocations",
                columns: new[] { "WalletHoldId", "WalletLotId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WalletHoldAllocations_WalletLotId_WalletAccountId",
                table: "WalletHoldAllocations",
                columns: new[] { "WalletLotId", "WalletAccountId" });

            migrationBuilder.CreateIndex(
                name: "IX_WalletHolds_WalletAccountId_Status_ExpiresAtUtc",
                table: "WalletHolds",
                columns: new[] { "WalletAccountId", "Status", "ExpiresAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WalletHoldAllocations");

            migrationBuilder.DropTable(
                name: "WalletHolds");
        }
    }
}
