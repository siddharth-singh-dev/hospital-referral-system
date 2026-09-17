-- AlterTable
-- Adds CARD_REVIEW as a new status ahead of PENDING: a marketing-submitted lead that came
-- with a card photo (Ayushman/CGHS/etc.) now sits here until reception verifies the card,
-- rather than landing straight in PENDING.
ALTER TABLE `Referral` MODIFY COLUMN `status` ENUM('CARD_REVIEW', 'PENDING', 'ARRIVED', 'CREDITED', 'REJECTED') NOT NULL DEFAULT 'PENDING';
