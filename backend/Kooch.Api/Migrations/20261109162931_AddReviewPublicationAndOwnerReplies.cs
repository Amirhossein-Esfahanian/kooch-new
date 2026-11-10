using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddReviewPublicationAndOwnerReplies : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "UnpublicationReason",
                table: "Reviews",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ReviewOwnerReplies",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    ReviewId = table.Column<int>(type: "int", nullable: false),
                    Body = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: false),
                    ModerationStatus = table.Column<int>(type: "int", nullable: false),
                    Revision = table.Column<int>(type: "int", nullable: false),
                    SubmittedByUserId = table.Column<int>(type: "int", nullable: false),
                    RejectionReason = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    ModeratedByUserId = table.Column<int>(type: "int", nullable: true),
                    ModeratedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
                    PublishedBody = table.Column<string>(type: "nvarchar(2000)", maxLength: 2000, nullable: true),
                    PublishedRevision = table.Column<int>(type: "int", nullable: true),
                    PublishedAtUtc = table.Column<DateTime>(type: "datetime2", nullable: true),
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
                    table.PrimaryKey("PK_ReviewOwnerReplies", x => x.Id);
                    table.CheckConstraint("CK_ReviewOwnerReplies_State", "[Revision] >= 1 AND [ModerationStatus] IN (0,1,2) AND LEN(LTRIM(RTRIM([Body]))) > 0 AND (([PublishedBody] IS NULL AND [PublishedRevision] IS NULL AND [PublishedAtUtc] IS NULL) OR ([PublishedBody] IS NOT NULL AND [PublishedRevision] IS NOT NULL AND [PublishedRevision] >= 1 AND [PublishedRevision] <= [Revision] AND [PublishedAtUtc] IS NOT NULL))");
                    table.ForeignKey(
                        name: "FK_ReviewOwnerReplies_Reviews_ReviewId",
                        column: x => x.ReviewId,
                        principalTable: "Reviews",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReviewOwnerReplies_Users_ModeratedByUserId",
                        column: x => x.ModeratedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_ReviewOwnerReplies_Users_SubmittedByUserId",
                        column: x => x.SubmittedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReviewOwnerReplies_ModeratedByUserId",
                table: "ReviewOwnerReplies",
                column: "ModeratedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ReviewOwnerReplies_ReviewId",
                table: "ReviewOwnerReplies",
                column: "ReviewId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ReviewOwnerReplies_SubmittedByUserId",
                table: "ReviewOwnerReplies",
                column: "SubmittedByUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReviewOwnerReplies");

            migrationBuilder.DropColumn(
                name: "UnpublicationReason",
                table: "Reviews");
        }
    }
}
