using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddVerifiedStayGuestReviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Do not silently merge or delete historical reviews, including soft-deleted rows.
            migrationBuilder.Sql("""
                IF EXISTS (SELECT [ReservationId] FROM [Reviews] WHERE [ReservationId] IS NOT NULL
                    GROUP BY [ReservationId] HAVING COUNT_BIG(*) > 1)
                    THROW 51000, 'Review migration blocked: duplicate historical ReservationId values require explicit review.', 1;
                """);
            migrationBuilder.DropIndex(
                name: "IX_Reviews_ReservationId",
                table: "Reviews");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Review_DetailedRatings",
                table: "Reviews");

            migrationBuilder.AddColumn<int>(
                name: "ComfortRating",
                table: "Reviews",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FacilitiesRating",
                table: "Reviews",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ModerationStatus",
                table: "Reviews",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RatingSum",
                table: "Reviews",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "Revision",
                table: "Reviews",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_ReservationId",
                table: "Reviews",
                column: "ReservationId",
                unique: true,
                filter: "[ReservationId] IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Review_DetailedRatings",
                table: "Reviews",
                sql: "([CleanlinessRating] IS NULL OR [CleanlinessRating] BETWEEN 1 AND 10) AND ([LocationRating] IS NULL OR [LocationRating] BETWEEN 1 AND 10) AND ([StaffRating] IS NULL OR [StaffRating] BETWEEN 1 AND 10) AND ([ValueRating] IS NULL OR [ValueRating] BETWEEN 1 AND 10)");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Review_VerifiedScores",
                table: "Reviews",
                sql: "([RatingSum] IS NULL AND [ModerationStatus] IS NULL AND [ComfortRating] IS NULL AND [FacilitiesRating] IS NULL) OR ([RatingSum] IS NOT NULL AND [ReservationId] IS NOT NULL AND [ModerationStatus] IS NOT NULL AND [ModerationStatus] IN (0, 1, 2) AND [Revision] >= 1 AND [CleanlinessRating] IS NOT NULL AND [StaffRating] IS NOT NULL AND [ComfortRating] IS NOT NULL AND [FacilitiesRating] IS NOT NULL AND [LocationRating] IS NOT NULL AND [ValueRating] IS NOT NULL AND [CleanlinessRating] BETWEEN 1 AND 10 AND [StaffRating] BETWEEN 1 AND 10 AND [ComfortRating] BETWEEN 1 AND 10 AND [FacilitiesRating] BETWEEN 1 AND 10 AND [LocationRating] BETWEEN 1 AND 10 AND [ValueRating] BETWEEN 1 AND 10 AND [RatingSum] = [CleanlinessRating] + [StaffRating] + [ComfortRating] + [FacilitiesRating] + [LocationRating] + [ValueRating] AND ([IsPublished] = 0 OR [ModerationStatus] = 1))");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                IF EXISTS (SELECT 1 FROM [Reviews] WHERE [RatingSum] IS NOT NULL OR [ModerationStatus] IS NOT NULL
                    OR [ComfortRating] IS NOT NULL OR [FacilitiesRating] IS NOT NULL OR [Revision] <> 0)
                    THROW 51001, 'Review rollback blocked: verified review history must not be discarded.', 1;
                """);
            migrationBuilder.DropIndex(
                name: "IX_Reviews_ReservationId",
                table: "Reviews");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Review_DetailedRatings",
                table: "Reviews");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Review_VerifiedScores",
                table: "Reviews");

            migrationBuilder.DropColumn(
                name: "ComfortRating",
                table: "Reviews");

            migrationBuilder.DropColumn(
                name: "FacilitiesRating",
                table: "Reviews");

            migrationBuilder.DropColumn(
                name: "ModerationStatus",
                table: "Reviews");

            migrationBuilder.DropColumn(
                name: "RatingSum",
                table: "Reviews");

            migrationBuilder.DropColumn(
                name: "Revision",
                table: "Reviews");

            migrationBuilder.CreateIndex(
                name: "IX_Reviews_ReservationId",
                table: "Reviews",
                column: "ReservationId");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Review_DetailedRatings",
                table: "Reviews",
                sql: "([CleanlinessRating] IS NULL OR [CleanlinessRating] BETWEEN 1 AND 5) AND ([LocationRating] IS NULL OR [LocationRating] BETWEEN 1 AND 5) AND ([StaffRating] IS NULL OR [StaffRating] BETWEEN 1 AND 5) AND ([ValueRating] IS NULL OR [ValueRating] BETWEEN 1 AND 5)");
        }
    }
}
