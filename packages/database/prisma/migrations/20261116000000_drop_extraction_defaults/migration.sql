-- Align the migrated schema with prisma/schema.prisma: these columns are
-- filled by the application, so they must not carry database defaults.
ALTER TABLE "ExtractionResult"
ALTER COLUMN "extractedText" DROP DEFAULT,
ALTER COLUMN "model" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;
