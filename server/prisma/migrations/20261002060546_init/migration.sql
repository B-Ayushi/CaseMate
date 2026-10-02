-- CreateTable
CREATE TABLE `lawyers` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `barCouncilNumber` VARCHAR(50) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `passwordResetTokenHash` VARCHAR(191) NULL,
    `passwordResetExpiresAt` DATETIME(3) NULL,
    `defaultHourlyRatePaise` INTEGER NOT NULL DEFAULT 0,
    `emailEnabled` BOOLEAN NOT NULL DEFAULT true,
    `smsEnabled` BOOLEAN NOT NULL DEFAULT true,
    `dayBeforeEnabled` BOOLEAN NOT NULL DEFAULT true,
    `twoHourEnabled` BOOLEAN NOT NULL DEFAULT true,
    `dailySummaryEnabled` BOOLEAN NOT NULL DEFAULT true,
    `dailySummaryTime` CHAR(5) NOT NULL DEFAULT '07:00',
    `missingOutcomeNudgeEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `lawyers_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `clients` (
    `id` VARCHAR(191) NOT NULL,
    `lawyerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `email` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `preferredContact` ENUM('PHONE', 'WHATSAPP', 'EMAIL') NOT NULL DEFAULT 'PHONE',
    `languages` VARCHAR(191) NULL,
    `hourlyRatePaise` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `clients_lawyerId_name_idx`(`lawyerId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_notes` (
    `id` VARCHAR(191) NOT NULL,
    `lawyerId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `notedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `text` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `client_notes_lawyerId_idx`(`lawyerId`),
    INDEX `client_notes_clientId_notedAt_idx`(`clientId`, `notedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cases` (
    `id` VARCHAR(191) NOT NULL,
    `lawyerId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `caseNumber` VARCHAR(100) NOT NULL,
    `caseType` VARCHAR(191) NULL,
    `courtName` VARCHAR(191) NOT NULL,
    `courtroom` VARCHAR(100) NULL,
    `judge` VARCHAR(191) NULL,
    `opposingParty` VARCHAR(191) NULL,
    `opposingCounsel` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `status` ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
    `emailReminderOverride` BOOLEAN NULL,
    `smsReminderOverride` BOOLEAN NULL,
    `dayBeforeReminderOverride` BOOLEAN NULL,
    `twoHourReminderOverride` BOOLEAN NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `cases_lawyerId_status_idx`(`lawyerId`, `status`),
    INDEX `cases_clientId_idx`(`clientId`),
    UNIQUE INDEX `cases_lawyerId_caseNumber_key`(`lawyerId`, `caseNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hearings` (
    `id` VARCHAR(191) NOT NULL,
    `lawyerId` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `purpose` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `status` ENUM('SCHEDULED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `outcome` ENUM('ADJOURNED', 'HEARD', 'ORDER_RESERVED', 'DISPOSED', 'OTHER') NULL,
    `outcomeNotes` TEXT NULL,
    `timeSpentMinutes` INTEGER NULL,
    `loggedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hearings_lawyerId_scheduledAt_idx`(`lawyerId`, `scheduledAt`),
    INDEX `hearings_caseId_scheduledAt_idx`(`caseId`, `scheduledAt`),
    INDEX `hearings_status_scheduledAt_idx`(`status`, `scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reminders` (
    `id` VARCHAR(191) NOT NULL,
    `lawyerId` VARCHAR(191) NOT NULL,
    `hearingId` VARCHAR(191) NULL,
    `summaryDate` DATE NULL,
    `type` ENUM('DAY_BEFORE', 'TWO_HOUR', 'DAILY_SUMMARY', 'MISSING_OUTCOME') NOT NULL,
    `channel` ENUM('EMAIL', 'SMS') NOT NULL,
    `sendAt` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NULL,
    `lastError` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `reminders_status_sendAt_idx`(`status`, `sendAt`),
    INDEX `reminders_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `reminders_lawyerId_status_idx`(`lawyerId`, `status`),
    UNIQUE INDEX `reminders_hearingId_type_channel_sendAt_key`(`hearingId`, `type`, `channel`, `sendAt`),
    UNIQUE INDEX `reminders_lawyerId_type_channel_summaryDate_key`(`lawyerId`, `type`, `channel`, `summaryDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `time_entries` (
    `id` VARCHAR(191) NOT NULL,
    `lawyerId` VARCHAR(191) NOT NULL,
    `caseId` VARCHAR(191) NOT NULL,
    `hearingId` VARCHAR(191) NULL,
    `workDate` DATE NOT NULL,
    `minutes` INTEGER NOT NULL,
    `description` TEXT NOT NULL,
    `ratePaise` INTEGER NOT NULL,
    `amountPaise` INTEGER NOT NULL,
    `invoiceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `time_entries_lawyerId_workDate_idx`(`lawyerId`, `workDate`),
    INDEX `time_entries_lawyerId_invoiceId_idx`(`lawyerId`, `invoiceId`),
    INDEX `time_entries_caseId_workDate_idx`(`caseId`, `workDate`),
    INDEX `time_entries_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` VARCHAR(191) NOT NULL,
    `lawyerId` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `number` VARCHAR(30) NOT NULL,
    `issueDate` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `totalPaise` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'PAID') NOT NULL DEFAULT 'DRAFT',
    `sentAt` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `invoices_lawyerId_status_dueDate_idx`(`lawyerId`, `status`, `dueDate`),
    INDEX `invoices_lawyerId_issueDate_idx`(`lawyerId`, `issueDate`),
    INDEX `invoices_clientId_idx`(`clientId`),
    UNIQUE INDEX `invoices_lawyerId_number_key`(`lawyerId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `clients` ADD CONSTRAINT `clients_lawyerId_fkey` FOREIGN KEY (`lawyerId`) REFERENCES `lawyers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_notes` ADD CONSTRAINT `client_notes_lawyerId_fkey` FOREIGN KEY (`lawyerId`) REFERENCES `lawyers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_notes` ADD CONSTRAINT `client_notes_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cases` ADD CONSTRAINT `cases_lawyerId_fkey` FOREIGN KEY (`lawyerId`) REFERENCES `lawyers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cases` ADD CONSTRAINT `cases_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hearings` ADD CONSTRAINT `hearings_lawyerId_fkey` FOREIGN KEY (`lawyerId`) REFERENCES `lawyers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hearings` ADD CONSTRAINT `hearings_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `cases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reminders` ADD CONSTRAINT `reminders_lawyerId_fkey` FOREIGN KEY (`lawyerId`) REFERENCES `lawyers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reminders` ADD CONSTRAINT `reminders_hearingId_fkey` FOREIGN KEY (`hearingId`) REFERENCES `hearings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_lawyerId_fkey` FOREIGN KEY (`lawyerId`) REFERENCES `lawyers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_caseId_fkey` FOREIGN KEY (`caseId`) REFERENCES `cases`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_hearingId_fkey` FOREIGN KEY (`hearingId`) REFERENCES `hearings`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_lawyerId_fkey` FOREIGN KEY (`lawyerId`) REFERENCES `lawyers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data rules Prisma cannot express in the schema (MySQL 8.0.16+ enforces CHECK constraints).

-- Only daily summaries carry a summaryDate, and every daily summary has one. Together with the
-- two unique keys on Reminder this makes duplicate reminders impossible.
ALTER TABLE `reminders` ADD CONSTRAINT `reminders_summaryDate_check`
  CHECK ((`type` = 'DAILY_SUMMARY') = (`summaryDate` IS NOT NULL));
ALTER TABLE `reminders` ADD CONSTRAINT `reminders_attempts_check` CHECK (`attempts` >= 0);

ALTER TABLE `hearings` ADD CONSTRAINT `hearings_timeSpentMinutes_check`
  CHECK (`timeSpentMinutes` IS NULL OR `timeSpentMinutes` >= 0);

ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_amounts_check`
  CHECK (`minutes` > 0 AND `ratePaise` >= 0 AND `amountPaise` >= 0);

ALTER TABLE `invoices` ADD CONSTRAINT `invoices_amounts_check`
  CHECK (`totalPaise` >= 0 AND `dueDate` >= `issueDate`);

ALTER TABLE `lawyers` ADD CONSTRAINT `lawyers_defaultHourlyRatePaise_check`
  CHECK (`defaultHourlyRatePaise` >= 0);
ALTER TABLE `lawyers` ADD CONSTRAINT `lawyers_dailySummaryTime_check`
  CHECK (`dailySummaryTime` REGEXP '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE `clients` ADD CONSTRAINT `clients_hourlyRatePaise_check`
  CHECK (`hourlyRatePaise` IS NULL OR `hourlyRatePaise` >= 0);
