-- KooChang objects in ITISME (run on ITISME_TEST first):
--   sqlcmd ... -v DB=ITISME_TEST -i 02_koochang_objects.sql
-- Adds only new objects; existing tables and rows are not changed. Safe to run again (CREATE OR ALTER / IF NOT EXISTS).
--
-- dbo.sp_NextDocNo        next IV / R / CN / C number, locked until the caller's transaction ends.
--                         The legacy program should call it too; until then its own MAX+1 can still collide
--                         in the same second, and the primary key refuses the second insert.
-- dbo.KooChangCustomer    which ITISME customers belong to which KooChang shop; KooChang only updates those.
-- dbo.CreditNote(+Detail) ใบลดหนี้ (new: the legacy program has none yet).
-- dbo.sp_KC_IssueReceipt  IV + InvoiceDetail + R for one KooChang payment, in one transaction, once per Ref.
-- dbo.sp_KC_IssueCreditNote  CN against a KooChang R, once per Ref, never more than the receipt.
-- dbo.sp_KC_Company       company header for the PDF.
SET NOCOUNT ON;
USE [$(DB)];
GO

IF OBJECT_ID('dbo.KooChangCustomer') IS NULL
CREATE TABLE dbo.KooChangCustomer (
  CustomerID varchar(10) NOT NULL CONSTRAINT PK_KooChangCustomer PRIMARY KEY,
  OrganizationID uniqueidentifier NOT NULL CONSTRAINT UQ_KooChangCustomer_Org UNIQUE,
  CreatedAt datetime NOT NULL CONSTRAINT DF_KooChangCustomer_CreatedAt DEFAULT (GETDATE())
);
GO

IF OBJECT_ID('dbo.CreditNote') IS NULL
CREATE TABLE dbo.CreditNote (
  DocNo varchar(20) NOT NULL CONSTRAINT PK_CreditNote PRIMARY KEY,
  DocDate datetime NOT NULL,
  CustomerID varchar(10) NOT NULL,
  InvoiceNo varchar(20) NULL,            -- ใบแจ้งหนี้เดิม
  ReceiptNo varchar(20) NOT NULL,        -- ใบเสร็จรับเงิน/ใบกำกับภาษีเดิมที่ลดหนี้
  ReceiptDate datetime NOT NULL,
  Ref varchar(20) NOT NULL,              -- KooChang refund reference (blank for legacy-made notes)
  Reason nvarchar(250) NOT NULL,         -- เหตุที่ลดหนี้
  OriginalAmount numeric(18,2) NOT NULL, -- มูลค่าตามใบกำกับเดิม (ก่อน VAT, หลังใบลดหนี้ก่อนหน้า)
  CorrectAmount numeric(18,2) NOT NULL,  -- มูลค่าที่ถูกต้อง
  Difference numeric(18,2) NOT NULL,     -- ผลต่าง (ก่อน VAT)
  Vat numeric(18,2) NOT NULL,
  NetPrice numeric(18,2) NOT NULL,       -- ผลต่าง + VAT = เงินที่คืน
  EmployeeID nvarchar(40) NULL,
  LastUpdate datetime NULL,
  CONSTRAINT CK_CreditNote_Amounts CHECK (Difference > 0 AND CorrectAmount >= 0 AND NetPrice = Difference + Vat)
);
GO
IF OBJECT_ID('dbo.CreditNoteDetail') IS NULL
CREATE TABLE dbo.CreditNoteDetail (
  DocNo varchar(20) NOT NULL CONSTRAINT FK_CreditNoteDetail_CreditNote REFERENCES dbo.CreditNote(DocNo),
  Seq smallint NOT NULL,
  ProductName nvarchar(1000) NULL,
  Qty numeric(18,2) NULL,
  Price numeric(18,2) NULL,
  NetPrice numeric(18,2) NULL,
  CONSTRAINT PK_CreditNoteDetail PRIMARY KEY (DocNo, Seq)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CreditNote_ReceiptNo')
  CREATE INDEX IX_CreditNote_ReceiptNo ON dbo.CreditNote (ReceiptNo);
GO

-- Next number for @Kind in the month of @DocDate (Buddhist year): IV6910 + 0001, R6910 + 0001, CN6910 + 0001,
-- or the next customer id C0000166 (@DocDate ignored). Must run inside the transaction that inserts the row:
-- UPDLOCK + HOLDLOCK keep the month's range locked until that transaction ends, so two callers never get the
-- same number.
CREATE OR ALTER PROCEDURE dbo.sp_NextDocNo
  @Kind varchar(2), @DocDate datetime, @DocNo varchar(20) OUTPUT
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF @@TRANCOUNT = 0 THROW 51000, 'sp_NextDocNo must run inside the transaction that inserts the document', 1;
  DECLARE @Prefix varchar(10), @Last varchar(20), @Seq int;
  IF @Kind = 'C'
  BEGIN
    SELECT @Last = MAX(CustomerID) FROM dbo.Customer WITH (UPDLOCK, HOLDLOCK)
      WHERE CustomerID LIKE 'C[0-9][0-9][0-9][0-9][0-9][0-9][0-9]';
    SET @Seq = ISNULL(CAST(RIGHT(@Last, 7) AS int), 0) + 1;
    IF @Seq > 9999999 THROW 51002, 'Customer ids are used up', 1;
    SET @DocNo = 'C' + RIGHT('000000' + CAST(@Seq AS varchar(7)), 7);
    RETURN;
  END
  SET @Prefix = @Kind + RIGHT(CAST(YEAR(@DocDate) + 543 AS varchar(4)), 2) + RIGHT('0' + CAST(MONTH(@DocDate) AS varchar(2)), 2);
  IF @Kind = 'IV'
    SELECT @Last = MAX(DocNo) FROM dbo.Invoice WITH (UPDLOCK, HOLDLOCK) WHERE DocNo LIKE @Prefix + '[0-9][0-9][0-9][0-9]';
  ELSE IF @Kind = 'R'
    SELECT @Last = MAX(DocNo) FROM dbo.Receipt WITH (UPDLOCK, HOLDLOCK) WHERE DocNo LIKE @Prefix + '[0-9][0-9][0-9][0-9]';
  ELSE IF @Kind = 'CN'
    SELECT @Last = MAX(DocNo) FROM dbo.CreditNote WITH (UPDLOCK, HOLDLOCK) WHERE DocNo LIKE @Prefix + '[0-9][0-9][0-9][0-9]';
  ELSE
    THROW 51001, 'Unknown document kind', 1;
  SET @Seq = ISNULL(CAST(RIGHT(@Last, 4) AS int), 0) + 1;
  IF @Seq > 9999 THROW 51002, 'Document numbers for this month are used up', 1;
  SET @DocNo = @Prefix + RIGHT('000' + CAST(@Seq AS varchar(4)), 4);
END
GO

-- One KooChang payment → ใบแจ้งหนี้ (IV) + ใบเสร็จรับเงิน/ใบกำกับภาษี (R), dated the payment date.
-- @Gross is the amount paid (VAT included, as KooChang prices are); VAT is taken out the way the legacy
-- documents do it: Subtotal = ROUND(@Gross * 100 / 107, 2), Vat = @Gross - Subtotal. The item line keeps the
-- VAT-included price, like the legacy form.
-- Calling again with the same @Ref returns the documents already made (@Existing = 1) and writes nothing,
-- so a retry after a lost reply never issues twice. The shop's customer row is created on its first
-- document and updated with the latest buyer details on later ones (only rows listed in KooChangCustomer).
CREATE OR ALTER PROCEDURE dbo.sp_KC_IssueReceipt
  @OrganizationID uniqueidentifier,
  @Ref varchar(20),
  @DocDate date,
  @BuyerName nvarchar(1000),
  @TaxID nvarchar(13) = NULL,
  @HQ char(1) = NULL,                 -- '1' สำนักงานใหญ่, '0' สาขา, NULL ไม่ระบุ (บุคคลธรรมดา)
  @BranchNo nvarchar(5) = NULL,
  @Address nvarchar(1000) = NULL,
  @Phone nvarchar(100) = NULL,
  @Email nvarchar(100) = NULL,
  @ItemName nvarchar(1000),
  @Gross numeric(18,2),
  @Remark nvarchar(150) = NULL,
  @ReceiptRemark nvarchar(50) = NULL,
  @InvoiceNo varchar(20) OUTPUT,
  @ReceiptNo varchar(20) OUTPUT,
  @CustomerID varchar(10) OUTPUT,
  @Subtotal numeric(18,2) OUTPUT,
  @Vat numeric(18,2) OUTPUT,
  @Existing bit OUTPUT
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF NULLIF(LTRIM(RTRIM(@Ref)), '') IS NULL THROW 51010, 'Ref is required', 1;
  IF @Gross IS NULL OR @Gross <= 0 THROW 51011, 'Gross must be positive', 1;
  IF NULLIF(LTRIM(RTRIM(@BuyerName)), '') IS NULL THROW 51012, 'Buyer name is required', 1;
  DECLARE @When datetime = CAST(@DocDate AS datetime), @Lock nvarchar(255) = N'KooChang:' + @Ref, @rc int;
  SET @Existing = 0;
  BEGIN TRANSACTION;
  EXEC @rc = sp_getapplock @Resource = @Lock, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000;
  IF @rc < 0 THROW 51013, 'Could not lock the reference', 1;

  SELECT @InvoiceNo = DocNo, @ReceiptNo = ReceiptNo, @CustomerID = CustomerID, @Subtotal = Subtotal, @Vat = Vat
    FROM dbo.Invoice WHERE Ref = @Ref AND EmployeeID = 'KOOCHANG';
  IF @InvoiceNo IS NOT NULL
  BEGIN
    SET @Existing = 1;
    COMMIT TRANSACTION;
    RETURN;
  END

  SELECT @CustomerID = CustomerID FROM dbo.KooChangCustomer WITH (UPDLOCK, HOLDLOCK) WHERE OrganizationID = @OrganizationID;
  IF @CustomerID IS NULL
  BEGIN
    EXEC dbo.sp_NextDocNo 'C', @When, @CustomerID OUTPUT;
    INSERT INTO dbo.Customer (CustomerID, CustomerName, TaxID, HQ, BranchNo, Address, Phone, Email)
      VALUES (@CustomerID, @BuyerName, @TaxID, @HQ, @BranchNo, @Address, @Phone, @Email);
    INSERT INTO dbo.KooChangCustomer (CustomerID, OrganizationID) VALUES (@CustomerID, @OrganizationID);
  END
  ELSE
    UPDATE dbo.Customer SET CustomerName = @BuyerName, TaxID = @TaxID, HQ = @HQ, BranchNo = @BranchNo,
      Address = @Address, Phone = @Phone, Email = @Email
    WHERE CustomerID = @CustomerID;

  SET @Subtotal = ROUND(@Gross * 100 / 107, 2);
  SET @Vat = @Gross - @Subtotal;
  EXEC dbo.sp_NextDocNo 'IV', @When, @InvoiceNo OUTPUT;
  EXEC dbo.sp_NextDocNo 'R', @When, @ReceiptNo OUTPUT;

  INSERT INTO dbo.Invoice (DocNo, DocDate, CustomerID, PONo, ReceiptNo, Ref, PaymentCond, DueDate, Remark, PaymentType,
    Subtotal, Discount, Vat, NetPrice, EmployeeID, LastUpdate)
  VALUES (@InvoiceNo, @When, @CustomerID, '', @ReceiptNo, @Ref, '0', @When, @Remark, '1',
    @Subtotal, 0, @Vat, @Gross, 'KOOCHANG', GETDATE());
  INSERT INTO dbo.InvoiceDetail (DocNo, Seq, ProductName, Qty, Price, NetPrice)
  VALUES (@InvoiceNo, 1, @ItemName, 1, @Gross, @Gross);
  INSERT INTO dbo.Receipt (DocNo, DocDate, CustomerID, InvoiceNo, Ref, Remark, PaymentType,
    Subtotal, Discount, Vat, NetPrice, EmployeeID, LastUpdate)
  VALUES (@ReceiptNo, @When, @CustomerID, @InvoiceNo, @Ref, @ReceiptRemark, NULL,
    @Subtotal, 0, @Vat, @Gross, 'KOOCHANG', GETDATE());
  COMMIT TRANSACTION;
END
GO

-- ใบลดหนี้ for money KooChang refunded against one of its receipts. @Gross is the amount refunded (VAT
-- included). OriginalAmount is the receipt's value before VAT less earlier credit notes; the total credited
-- never exceeds the receipt. Same @Ref again returns the existing note (@Existing = 1).
CREATE OR ALTER PROCEDURE dbo.sp_KC_IssueCreditNote
  @Ref varchar(20),
  @ReceiptNo varchar(20),
  @DocDate date,
  @Reason nvarchar(250),
  @ItemName nvarchar(1000),
  @Gross numeric(18,2),
  @CreditNoteNo varchar(20) OUTPUT,
  @OriginalAmount numeric(18,2) OUTPUT,
  @CorrectAmount numeric(18,2) OUTPUT,
  @Difference numeric(18,2) OUTPUT,
  @Vat numeric(18,2) OUTPUT,
  @ReceiptDate datetime OUTPUT,
  @Existing bit OUTPUT
AS
BEGIN
  SET NOCOUNT ON; SET XACT_ABORT ON;
  IF NULLIF(LTRIM(RTRIM(@Ref)), '') IS NULL THROW 51020, 'Ref is required', 1;
  IF @Gross IS NULL OR @Gross <= 0 THROW 51021, 'Gross must be positive', 1;
  IF NULLIF(LTRIM(RTRIM(@Reason)), '') IS NULL THROW 51022, 'Reason is required', 1;
  DECLARE @When datetime = CAST(@DocDate AS datetime), @Lock nvarchar(255) = N'KooChang:' + @Ref, @rc int,
    @CustomerID varchar(10), @InvoiceNo varchar(20), @ReceiptSubtotal numeric(18,2), @ReceiptNet numeric(18,2),
    @CreditedSubtotal numeric(18,2), @CreditedNet numeric(18,2);
  SET @Existing = 0;
  BEGIN TRANSACTION;
  EXEC @rc = sp_getapplock @Resource = @Lock, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000;
  IF @rc < 0 THROW 51023, 'Could not lock the reference', 1;

  SELECT @CreditNoteNo = DocNo, @OriginalAmount = OriginalAmount, @CorrectAmount = CorrectAmount, @Difference = Difference,
         @Vat = Vat, @ReceiptDate = ReceiptDate
    FROM dbo.CreditNote WHERE Ref = @Ref AND EmployeeID = 'KOOCHANG';
  IF @CreditNoteNo IS NOT NULL
  BEGIN
    SET @Existing = 1;
    COMMIT TRANSACTION;
    RETURN;
  END

  SELECT @CustomerID = CustomerID, @InvoiceNo = InvoiceNo, @ReceiptDate = DocDate, @ReceiptSubtotal = Subtotal, @ReceiptNet = NetPrice
    FROM dbo.Receipt WITH (UPDLOCK) WHERE DocNo = @ReceiptNo AND EmployeeID = 'KOOCHANG';
  IF @CustomerID IS NULL THROW 51024, 'Receipt not found or not issued by KooChang', 1;
  SELECT @CreditedSubtotal = ISNULL(SUM(Difference), 0), @CreditedNet = ISNULL(SUM(NetPrice), 0)
    FROM dbo.CreditNote WITH (UPDLOCK, HOLDLOCK) WHERE ReceiptNo = @ReceiptNo;
  IF @CreditedNet + @Gross > @ReceiptNet THROW 51025, 'Credit would exceed the receipt', 1;

  SET @OriginalAmount = @ReceiptSubtotal - @CreditedSubtotal;
  -- The last credit that empties the receipt takes exactly what is left, so rounding never leaves 0.01 behind.
  SET @Difference = CASE WHEN @CreditedNet + @Gross = @ReceiptNet THEN @OriginalAmount ELSE ROUND(@Gross * 100 / 107, 2) END;
  SET @Vat = @Gross - @Difference;
  SET @CorrectAmount = @OriginalAmount - @Difference;
  EXEC dbo.sp_NextDocNo 'CN', @When, @CreditNoteNo OUTPUT;

  INSERT INTO dbo.CreditNote (DocNo, DocDate, CustomerID, InvoiceNo, ReceiptNo, ReceiptDate, Ref, Reason,
    OriginalAmount, CorrectAmount, Difference, Vat, NetPrice, EmployeeID, LastUpdate)
  VALUES (@CreditNoteNo, @When, @CustomerID, @InvoiceNo, @ReceiptNo, @ReceiptDate, @Ref, @Reason,
    @OriginalAmount, @CorrectAmount, @Difference, @Vat, @Gross, 'KOOCHANG', GETDATE());
  INSERT INTO dbo.CreditNoteDetail (DocNo, Seq, ProductName, Qty, Price, NetPrice)
  VALUES (@CreditNoteNo, 1, @ItemName, 1, @Gross, @Gross);
  COMMIT TRANSACTION;
END
GO

-- Seller details for the PDF header (one row).
CREATE OR ALTER PROCEDURE dbo.sp_KC_Company
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP 1 CompanyName, CompanyNameEng, TaxID, HQ, BranchNo, Address, Road, District, Aumpher, Province, Zipcode,
    Phone, Fax, AddressEng, RoadEng, DistrictEng, AumpherEng, ProvinceEng
  FROM dbo.Company;
END
GO
PRINT 'KooChang objects ready in ' + DB_NAME();
