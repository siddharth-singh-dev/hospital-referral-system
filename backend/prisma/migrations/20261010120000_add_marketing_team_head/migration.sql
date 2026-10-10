-- AlterTable
ALTER TABLE `MarketingPerson` ADD COLUMN `headId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `MarketingPerson` ADD CONSTRAINT `MarketingPerson_headId_fkey` FOREIGN KEY (`headId`) REFERENCES `StaffUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
