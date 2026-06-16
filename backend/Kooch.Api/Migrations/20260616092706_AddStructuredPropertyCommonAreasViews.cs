using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Kooch.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddStructuredPropertyCommonAreasViews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PropertyCommonAreas",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    SortOrder = table.Column<int>(type: "int", nullable: false),
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
                    table.PrimaryKey("PK_PropertyCommonAreas", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PropertyCommonAreas_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PropertyViews",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PropertyId = table.Column<int>(type: "int", nullable: false),
                    ViewType = table.Column<int>(type: "int", nullable: false),
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
                    table.PrimaryKey("PK_PropertyViews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PropertyViews_Properties_PropertyId",
                        column: x => x.PropertyId,
                        principalTable: "Properties",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.Sql("""
                INSERT INTO PropertyCommonAreas
                    (PropertyId, Name, Description, SortOrder, CreatedAtUtc, IsDeleted)
                SELECT PropertyId, Title, NULLIF(Content, ''), SortOrder, SYSUTCDATETIME(), 0
                FROM PropertyDescriptionSections
                WHERE SectionType = 1 AND IsDeleted = 0 AND Content <> ''
                """);

            migrationBuilder.Sql("""
                UPDATE PropertyDescriptionSections
                SET IsDeleted = 1, DeletedAtUtc = SYSUTCDATETIME()
                WHERE SectionType IN (1, 2) AND IsDeleted = 0
                """);

            migrationBuilder.CreateIndex(
                name: "IX_PropertyCommonAreas_PropertyId_SortOrder",
                table: "PropertyCommonAreas",
                columns: new[] { "PropertyId", "SortOrder" });

            migrationBuilder.CreateIndex(
                name: "IX_PropertyViews_PropertyId_ViewType",
                table: "PropertyViews",
                columns: new[] { "PropertyId", "ViewType" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PropertyCommonAreas");

            migrationBuilder.DropTable(
                name: "PropertyViews");
        }
    }
}
