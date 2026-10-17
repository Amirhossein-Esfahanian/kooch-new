using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddWelcomeGiftCampaigns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WelcomeGiftCampaigns",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Title = table.Column<string>(type: "nvarchar(150)", maxLength: 150, nullable: false),
                    Amount = table.Column<decimal>(type: "decimal(18,2)", precision: 18, scale: 2, nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: false),
                    EndDate = table.Column<DateOnly>(type: "date", nullable: false),
                    MaxRecipients = table.Column<int>(type: "int", nullable: false),
                    GrantedCount = table.Column<int>(type: "int", nullable: false, defaultValue: 0),
                    ValidityDays = table.Column<int>(type: "int", nullable: false),
                    IsActive = table.Column<bool>(type: "bit", nullable: false),
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
                    table.PrimaryKey("PK_WelcomeGiftCampaigns", x => x.Id);
                    table.CheckConstraint("CK_WelcomeGiftCampaigns_Amount", "[Amount] > 0");
                    table.CheckConstraint("CK_WelcomeGiftCampaigns_DateRange", "[StartDate] <= [EndDate]");
                    table.CheckConstraint("CK_WelcomeGiftCampaigns_Quota", "[MaxRecipients] > 0 AND [GrantedCount] >= 0 AND [GrantedCount] <= [MaxRecipients]");
                    table.CheckConstraint("CK_WelcomeGiftCampaigns_ValidityDays", "[ValidityDays] >= 1");
                });

            migrationBuilder.CreateIndex(
                name: "IX_WelcomeGiftCampaigns_IsActive_StartDate_EndDate",
                table: "WelcomeGiftCampaigns",
                columns: new[] { "IsActive", "StartDate", "EndDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WelcomeGiftCampaigns");
        }
    }
}
