-- CreateTable
CREATE TABLE `ReferralMessage` (
    `id` VARCHAR(191) NOT NULL,
    `referralId` VARCHAR(191) NOT NULL,
    `senderType` VARCHAR(191) NOT NULL,
    `senderUserId` VARCHAR(191) NULL,
    `senderName` VARCHAR(191) NOT NULL,
    `body` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readAt` DATETIME(3) NULL,

    INDEX `ReferralMessage_referralId_createdAt_idx`(`referralId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ReferralMessage` ADD CONSTRAINT `ReferralMessage_referralId_fkey` FOREIGN KEY (`referralId`) REFERENCES `Referral`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
