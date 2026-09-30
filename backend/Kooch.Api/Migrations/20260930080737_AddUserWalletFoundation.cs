using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddUserWalletFoundation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WalletAccounts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    Currency = table.Column<string>(type: "nvarchar(3)", maxLength: 3, nullable: false),
                    RowVersion = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false),
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
                    table.PrimaryKey("PK_WalletAccounts", x => x.Id);
                    table.CheckConstraint("CK_WalletAccounts_CurrencyLength", "[Currency] LIKE '___'");
                    table.CheckConstraint("CK_WalletAccounts_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.ForeignKey(
                        name: "FK_WalletAccounts_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "WalletLots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WalletAccountId = table.Column<int>(type: "int", nullable: false),
                    SourceType = table.Column<int>(type: "int", nullable: false),
                    IsWithdrawable = table.Column<bool>(type: "bit", nullable: false),
                    ExpiresAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    SourceReference = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Reason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
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
                    table.PrimaryKey("PK_WalletLots", x => x.Id);
                    table.UniqueConstraint("AK_WalletLots_Id_WalletAccountId", x => new { x.Id, x.WalletAccountId });
                    table.CheckConstraint("CK_WalletLots_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.CheckConstraint("CK_WalletLots_Source", "([SourceType] = 0 AND [IsWithdrawable] = 1) OR ([SourceType] = 1 AND [IsWithdrawable] = 0)");
                    table.ForeignKey(
                        name: "FK_WalletLots_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_WalletLots_WalletAccounts_WalletAccountId",
                        column: x => x.WalletAccountId,
                        principalTable: "WalletAccounts",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "WalletEntries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    WalletAccountId = table.Column<int>(type: "int", nullable: false),
                    WalletLotId = table.Column<int>(type: "int", nullable: false),
                    Direction = table.Column<int>(type: "int", nullable: false),
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
                    table.PrimaryKey("PK_WalletEntries", x => x.Id);
                    table.CheckConstraint("CK_WalletEntries_Amount", "[Amount] > 0");
                    table.CheckConstraint("CK_WalletEntries_Direction", "[Direction] IN (0, 1)");
                    table.CheckConstraint("CK_WalletEntries_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.ForeignKey(
                        name: "FK_WalletEntries_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_WalletEntries_WalletAccounts_WalletAccountId",
                        column: x => x.WalletAccountId,
                        principalTable: "WalletAccounts",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_WalletEntries_WalletLots_WalletLotId_WalletAccountId",
                        columns: x => new { x.WalletLotId, x.WalletAccountId },
                        principalTable: "WalletLots",
                        principalColumns: new[] { "Id", "WalletAccountId" });
                });

            migrationBuilder.CreateIndex(
                name: "IX_WalletAccounts_UserId_Currency",
                table: "WalletAccounts",
                columns: new[] { "UserId", "Currency" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WalletEntries_CreatedByUserId",
                table: "WalletEntries",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_WalletEntries_WalletAccountId",
                table: "WalletEntries",
                column: "WalletAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_WalletEntries_WalletLotId_WalletAccountId",
                table: "WalletEntries",
                columns: new[] { "WalletLotId", "WalletAccountId" });

            migrationBuilder.CreateIndex(
                name: "IX_WalletLots_CreatedByUserId",
                table: "WalletLots",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_WalletLots_WalletAccountId_ExpiresAtUtc",
                table: "WalletLots",
                columns: new[] { "WalletAccountId", "ExpiresAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WalletEntries");

            migrationBuilder.DropTable(
                name: "WalletLots");

            migrationBuilder.DropTable(
                name: "WalletAccounts");
        }
    }
}
