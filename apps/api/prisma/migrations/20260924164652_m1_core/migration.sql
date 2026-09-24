BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[DomainEvent] ADD [assetId] INT,
[customerId] INT,
[jobId] INT;

-- AlterTable
ALTER TABLE [dbo].[Tenant] ADD [jobSeq] INT NOT NULL CONSTRAINT [Tenant_jobSeq_df] DEFAULT 0;

-- CreateTable
CREATE TABLE [dbo].[Customer] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [tenantId] INT NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [phoneE164] VARCHAR(20),
    [notes] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Customer_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [deletedAt] DATETIME2,
    CONSTRAINT [Customer_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Customer_publicId_key] UNIQUE NONCLUSTERED ([publicId]),
    CONSTRAINT [Customer_tenantId_id_key] UNIQUE NONCLUSTERED ([tenantId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[Site] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [tenantId] INT NOT NULL,
    [customerId] INT NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [lat] FLOAT(53),
    [lng] FLOAT(53),
    [addressText] NVARCHAR(500),
    [notes] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Site_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [deletedAt] DATETIME2,
    CONSTRAINT [Site_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Site_publicId_key] UNIQUE NONCLUSTERED ([publicId]),
    CONSTRAINT [Site_tenantId_id_key] UNIQUE NONCLUSTERED ([tenantId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[AssetCategory] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [tenantId] INT NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [issueTypesJson] NVARCHAR(max) NOT NULL CONSTRAINT [AssetCategory_issueTypesJson_df] DEFAULT '[]',
    [sortOrder] INT NOT NULL CONSTRAINT [AssetCategory_sortOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AssetCategory_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [deletedAt] DATETIME2,
    CONSTRAINT [AssetCategory_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AssetCategory_publicId_key] UNIQUE NONCLUSTERED ([publicId]),
    CONSTRAINT [AssetCategory_tenantId_id_key] UNIQUE NONCLUSTERED ([tenantId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[Asset] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [tenantId] INT NOT NULL,
    [customerId] INT NOT NULL,
    [siteId] INT,
    [categoryId] INT,
    [brand] NVARCHAR(100),
    [model] NVARCHAR(100),
    [serialNumber] NVARCHAR(100),
    [installedAt] DATETIME2,
    [installedByMembershipId] INT,
    [warrantyStart] DATETIME2,
    [warrantyEnd] DATETIME2,
    [nextServiceDate] DATETIME2,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [Asset_status_df] DEFAULT 'ACTIVE',
    [primaryMediaId] INT,
    [fieldSourcesJson] NVARCHAR(max) NOT NULL CONSTRAINT [Asset_fieldSourcesJson_df] DEFAULT '{}',
    [notes] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Asset_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [deletedAt] DATETIME2,
    CONSTRAINT [Asset_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Asset_publicId_key] UNIQUE NONCLUSTERED ([publicId]),
    CONSTRAINT [Asset_tenantId_id_key] UNIQUE NONCLUSTERED ([tenantId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[Job] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [tenantId] INT NOT NULL,
    [jobNo] VARCHAR(20) NOT NULL,
    [assetId] INT,
    [customerId] INT NOT NULL,
    [siteId] INT,
    [source] VARCHAR(10) NOT NULL,
    [issueType] NVARCHAR(100),
    [issueNote] NVARCHAR(2000),
    [status] VARCHAR(20) NOT NULL,
    [assignedMembershipId] INT,
    [outcomeJson] NVARCHAR(max),
    [returnNote] NVARCHAR(2000),
    [scheduledFor] DATETIME2,
    [assignedAt] DATETIME2,
    [acceptedAt] DATETIME2,
    [onTheWayAt] DATETIME2,
    [arrivedAt] DATETIME2,
    [startedAt] DATETIME2,
    [completedAt] DATETIME2,
    [cancelledAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Job_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Job_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Job_publicId_key] UNIQUE NONCLUSTERED ([publicId]),
    CONSTRAINT [Job_tenantId_id_key] UNIQUE NONCLUSTERED ([tenantId],[id]),
    CONSTRAINT [Job_tenantId_jobNo_key] UNIQUE NONCLUSTERED ([tenantId],[jobNo])
);

-- CreateTable
CREATE TABLE [dbo].[PartUsed] (
    [id] INT NOT NULL IDENTITY(1,1),
    [tenantId] INT NOT NULL,
    [jobId] INT NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [spec] NVARCHAR(100),
    [qty] INT NOT NULL CONSTRAINT [PartUsed_qty_df] DEFAULT 1,
    [source] VARCHAR(10) NOT NULL CONSTRAINT [PartUsed_source_df] DEFAULT 'MANUAL',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PartUsed_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PartUsed_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PartRequest] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [tenantId] INT NOT NULL,
    [jobId] INT NOT NULL,
    [description] NVARCHAR(500),
    [mediaId] INT,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [PartRequest_status_df] DEFAULT 'REQUESTED',
    [requestedByMembershipId] INT NOT NULL,
    [resolvedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PartRequest_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PartRequest_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PartRequest_publicId_key] UNIQUE NONCLUSTERED ([publicId])
);

-- CreateTable
CREATE TABLE [dbo].[Media] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [tenantId] INT NOT NULL,
    [kind] VARCHAR(20) NOT NULL,
    [storageKey] VARCHAR(200) NOT NULL,
    [mime] VARCHAR(50) NOT NULL,
    [size] INT NOT NULL,
    [ownerType] VARCHAR(20),
    [ownerId] INT,
    [createdByMembershipId] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Media_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [deletedAt] DATETIME2,
    CONSTRAINT [Media_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Media_publicId_key] UNIQUE NONCLUSTERED ([publicId]),
    CONSTRAINT [Media_tenantId_id_key] UNIQUE NONCLUSTERED ([tenantId],[id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Customer_tenantId_phoneE164_idx] ON [dbo].[Customer]([tenantId], [phoneE164]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Customer_tenantId_displayName_idx] ON [dbo].[Customer]([tenantId], [displayName]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Site_tenantId_customerId_idx] ON [dbo].[Site]([tenantId], [customerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Asset_tenantId_customerId_idx] ON [dbo].[Asset]([tenantId], [customerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Asset_tenantId_serialNumber_idx] ON [dbo].[Asset]([tenantId], [serialNumber]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Asset_tenantId_nextServiceDate_idx] ON [dbo].[Asset]([tenantId], [nextServiceDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Job_tenantId_status_idx] ON [dbo].[Job]([tenantId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Job_tenantId_assignedMembershipId_status_idx] ON [dbo].[Job]([tenantId], [assignedMembershipId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Job_tenantId_assetId_idx] ON [dbo].[Job]([tenantId], [assetId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PartUsed_tenantId_jobId_idx] ON [dbo].[PartUsed]([tenantId], [jobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PartRequest_tenantId_status_idx] ON [dbo].[PartRequest]([tenantId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Media_tenantId_ownerType_ownerId_idx] ON [dbo].[Media]([tenantId], [ownerType], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DomainEvent_tenantId_assetId_occurredAt_idx] ON [dbo].[DomainEvent]([tenantId], [assetId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DomainEvent_tenantId_jobId_occurredAt_idx] ON [dbo].[DomainEvent]([tenantId], [jobId], [occurredAt]);

-- AddForeignKey
ALTER TABLE [dbo].[DomainEvent] ADD CONSTRAINT [DomainEvent_tenantId_jobId_fkey] FOREIGN KEY ([tenantId], [jobId]) REFERENCES [dbo].[Job]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DomainEvent] ADD CONSTRAINT [DomainEvent_tenantId_assetId_fkey] FOREIGN KEY ([tenantId], [assetId]) REFERENCES [dbo].[Asset]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DomainEvent] ADD CONSTRAINT [DomainEvent_tenantId_customerId_fkey] FOREIGN KEY ([tenantId], [customerId]) REFERENCES [dbo].[Customer]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Customer] ADD CONSTRAINT [Customer_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Site] ADD CONSTRAINT [Site_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Site] ADD CONSTRAINT [Site_tenantId_customerId_fkey] FOREIGN KEY ([tenantId], [customerId]) REFERENCES [dbo].[Customer]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AssetCategory] ADD CONSTRAINT [AssetCategory_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Asset] ADD CONSTRAINT [Asset_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Asset] ADD CONSTRAINT [Asset_tenantId_customerId_fkey] FOREIGN KEY ([tenantId], [customerId]) REFERENCES [dbo].[Customer]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Asset] ADD CONSTRAINT [Asset_tenantId_siteId_fkey] FOREIGN KEY ([tenantId], [siteId]) REFERENCES [dbo].[Site]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Asset] ADD CONSTRAINT [Asset_tenantId_categoryId_fkey] FOREIGN KEY ([tenantId], [categoryId]) REFERENCES [dbo].[AssetCategory]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Asset] ADD CONSTRAINT [Asset_tenantId_installedByMembershipId_fkey] FOREIGN KEY ([tenantId], [installedByMembershipId]) REFERENCES [dbo].[Membership]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Asset] ADD CONSTRAINT [Asset_tenantId_primaryMediaId_fkey] FOREIGN KEY ([tenantId], [primaryMediaId]) REFERENCES [dbo].[Media]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Job] ADD CONSTRAINT [Job_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Job] ADD CONSTRAINT [Job_tenantId_assetId_fkey] FOREIGN KEY ([tenantId], [assetId]) REFERENCES [dbo].[Asset]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Job] ADD CONSTRAINT [Job_tenantId_customerId_fkey] FOREIGN KEY ([tenantId], [customerId]) REFERENCES [dbo].[Customer]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Job] ADD CONSTRAINT [Job_tenantId_siteId_fkey] FOREIGN KEY ([tenantId], [siteId]) REFERENCES [dbo].[Site]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Job] ADD CONSTRAINT [Job_tenantId_assignedMembershipId_fkey] FOREIGN KEY ([tenantId], [assignedMembershipId]) REFERENCES [dbo].[Membership]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PartUsed] ADD CONSTRAINT [PartUsed_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PartUsed] ADD CONSTRAINT [PartUsed_tenantId_jobId_fkey] FOREIGN KEY ([tenantId], [jobId]) REFERENCES [dbo].[Job]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PartRequest] ADD CONSTRAINT [PartRequest_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PartRequest] ADD CONSTRAINT [PartRequest_tenantId_jobId_fkey] FOREIGN KEY ([tenantId], [jobId]) REFERENCES [dbo].[Job]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PartRequest] ADD CONSTRAINT [PartRequest_tenantId_requestedByMembershipId_fkey] FOREIGN KEY ([tenantId], [requestedByMembershipId]) REFERENCES [dbo].[Membership]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Media] ADD CONSTRAINT [Media_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Media] ADD CONSTRAINT [Media_tenantId_createdByMembershipId_fkey] FOREIGN KEY ([tenantId], [createdByMembershipId]) REFERENCES [dbo].[Membership]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
