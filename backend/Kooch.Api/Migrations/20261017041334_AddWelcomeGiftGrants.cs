using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWelcomeGiftGrants : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WelcomeGiftGrants",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    CampaignId = table.Column<int>(type: "int", nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: false),
                    NationalCodeSnapshot = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    AmountSnapshot = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    ValidityDaysSnapshot = table.Column<int>(type: "int", nullable: false),
                    GrantedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    ExpiresAtUtc = table.Column<DateTime>(type: "datetime2", nullable: false),
                    WalletLotId = table.Column<int>(type: "int", nullable: false),
                    WalletEntryId = table.Column<int>(type: "int", nullable: false),
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
                    table.PrimaryKey("PK_WelcomeGiftGrants", x => x.Id);
                    table.CheckConstraint("CK_WelcomeGiftGrants_Amount", "[AmountSnapshot] > 0");
                    table.CheckConstraint("CK_WelcomeGiftGrants_Expiry", "[ExpiresAtUtc] > [GrantedAtUtc]");
                    table.CheckConstraint("CK_WelcomeGiftGrants_NotDeleted", "[IsDeleted] = 0 AND [DeletedAtUtc] IS NULL");
                    table.CheckConstraint("CK_WelcomeGiftGrants_ValidityDays", "[ValidityDaysSnapshot] >= 1");
                    table.ForeignKey(
                        name: "FK_WelcomeGiftGrants_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_WelcomeGiftGrants_WalletEntries_WalletEntryId",
                        column: x => x.WalletEntryId,
                        principalTable: "WalletEntries",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_WelcomeGiftGrants_WalletLots_WalletLotId",
                        column: x => x.WalletLotId,
                        principalTable: "WalletLots",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_WelcomeGiftGrants_WelcomeGiftCampaigns_CampaignId",
                        column: x => x.CampaignId,
                        principalTable: "WelcomeGiftCampaigns",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_WelcomeGiftGrants_CampaignId_NationalCodeSnapshot",
                table: "WelcomeGiftGrants",
                columns: new[] { "CampaignId", "NationalCodeSnapshot" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WelcomeGiftGrants_CampaignId_UserId",
                table: "WelcomeGiftGrants",
                columns: new[] { "CampaignId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WelcomeGiftGrants_UserId",
                table: "WelcomeGiftGrants",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_WelcomeGiftGrants_WalletEntryId",
                table: "WelcomeGiftGrants",
                column: "WalletEntryId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WelcomeGiftGrants_WalletLotId",
                table: "WelcomeGiftGrants",
                column: "WalletLotId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WelcomeGiftGrants");
        }
    }
}
