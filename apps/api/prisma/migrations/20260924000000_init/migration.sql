BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[Tenant] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [settingsJson] NVARCHAR(max) NOT NULL CONSTRAINT [Tenant_settingsJson_df] DEFAULT '{}',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Tenant_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [deletedAt] DATETIME2,
    CONSTRAINT [Tenant_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Tenant_publicId_key] UNIQUE NONCLUSTERED ([publicId])
);

-- CreateTable
CREATE TABLE [dbo].[Account] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [passwordHash] NVARCHAR(255),
    [contactPhone] VARCHAR(20),
    [status] VARCHAR(20) NOT NULL CONSTRAINT [Account_status_df] DEFAULT 'ACTIVE',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Account_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Account_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Account_publicId_key] UNIQUE NONCLUSTERED ([publicId])
);

-- CreateTable
CREATE TABLE [dbo].[VerifiedPhone] (
    [phoneE164] VARCHAR(20) NOT NULL,
    [accountId] INT NOT NULL,
    [verifiedAt] DATETIME2 NOT NULL CONSTRAINT [VerifiedPhone_verifiedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [VerifiedPhone_pkey] PRIMARY KEY CLUSTERED ([phoneE164]),
    CONSTRAINT [VerifiedPhone_accountId_key] UNIQUE NONCLUSTERED ([accountId])
);

-- CreateTable
CREATE TABLE [dbo].[Membership] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [tenantId] INT NOT NULL,
    [accountId] INT NOT NULL,
    [role] VARCHAR(20) NOT NULL,
    [status] VARCHAR(20) NOT NULL CONSTRAINT [Membership_status_df] DEFAULT 'ACTIVE',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Membership_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [removedAt] DATETIME2,
    CONSTRAINT [Membership_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Membership_publicId_key] UNIQUE NONCLUSTERED ([publicId]),
    CONSTRAINT [Membership_tenantId_id_key] UNIQUE NONCLUSTERED ([tenantId],[id]),
    CONSTRAINT [Membership_tenantId_accountId_key] UNIQUE NONCLUSTERED ([tenantId],[accountId])
);

-- CreateTable
CREATE TABLE [dbo].[LineIdentity] (
    [id] INT NOT NULL IDENTITY(1,1),
    [lineChannelId] VARCHAR(50) NOT NULL,
    [lineUserId] VARCHAR(64) NOT NULL,
    [accountId] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [LineIdentity_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LineIdentity_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LineIdentity_lineChannelId_lineUserId_key] UNIQUE NONCLUSTERED ([lineChannelId],[lineUserId])
);

-- CreateTable
CREATE TABLE [dbo].[OtpChallenge] (
    [id] INT NOT NULL IDENTITY(1,1),
    [phoneE164] VARCHAR(20) NOT NULL,
    [purpose] VARCHAR(20) NOT NULL,
    [codeHash] VARCHAR(64) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [attempts] INT NOT NULL CONSTRAINT [OtpChallenge_attempts_df] DEFAULT 0,
    [consumedAt] DATETIME2,
    [requestIp] VARCHAR(64),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [OtpChallenge_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [OtpChallenge_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Invite] (
    [id] INT NOT NULL IDENTITY(1,1),
    [publicId] CHAR(26) NOT NULL,
    [tenantId] INT NOT NULL,
    [role] VARCHAR(20) NOT NULL,
    [tokenHash] VARCHAR(64) NOT NULL,
    [createdByMembershipId] INT NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [acceptedAt] DATETIME2,
    [acceptedMembershipId] INT,
    [revokedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Invite_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Invite_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Invite_publicId_key] UNIQUE NONCLUSTERED ([publicId]),
    CONSTRAINT [Invite_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash]),
    CONSTRAINT [Invite_tenantId_id_key] UNIQUE NONCLUSTERED ([tenantId],[id])
);

-- CreateTable
CREATE TABLE [dbo].[RefreshToken] (
    [id] INT NOT NULL IDENTITY(1,1),
    [accountId] INT NOT NULL,
    [tenantPublicId] CHAR(26),
    [tokenHash] VARCHAR(64) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RefreshToken_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [RefreshToken_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [RefreshToken_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[DomainEvent] (
    [id] INT NOT NULL IDENTITY(1,1),
    [tenantId] INT NOT NULL,
    [eventType] VARCHAR(50) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [DomainEvent_occurredAt_df] DEFAULT CURRENT_TIMESTAMP,
    [actorType] VARCHAR(20) NOT NULL,
    [actorId] CHAR(26),
    [subjectType] VARCHAR(30),
    [subjectId] CHAR(26),
    [metadataJson] NVARCHAR(max) NOT NULL CONSTRAINT [DomainEvent_metadataJson_df] DEFAULT '{}',
    CONSTRAINT [DomainEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [OtpChallenge_phoneE164_purpose_createdAt_idx] ON [dbo].[OtpChallenge]([phoneE164], [purpose], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [OtpChallenge_requestIp_createdAt_idx] ON [dbo].[OtpChallenge]([requestIp], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RefreshToken_accountId_idx] ON [dbo].[RefreshToken]([accountId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DomainEvent_tenantId_occurredAt_idx] ON [dbo].[DomainEvent]([tenantId], [occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DomainEvent_tenantId_subjectType_subjectId_idx] ON [dbo].[DomainEvent]([tenantId], [subjectType], [subjectId]);

-- AddForeignKey
ALTER TABLE [dbo].[VerifiedPhone] ADD CONSTRAINT [VerifiedPhone_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LineIdentity] ADD CONSTRAINT [LineIdentity_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Invite] ADD CONSTRAINT [Invite_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Invite] ADD CONSTRAINT [Invite_tenantId_createdByMembershipId_fkey] FOREIGN KEY ([tenantId], [createdByMembershipId]) REFERENCES [dbo].[Membership]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Invite] ADD CONSTRAINT [Invite_tenantId_acceptedMembershipId_fkey] FOREIGN KEY ([tenantId], [acceptedMembershipId]) REFERENCES [dbo].[Membership]([tenantId],[id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RefreshToken] ADD CONSTRAINT [RefreshToken_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[Account]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DomainEvent] ADD CONSTRAINT [DomainEvent_tenantId_fkey] FOREIGN KEY ([tenantId]) REFERENCES [dbo].[Tenant]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

