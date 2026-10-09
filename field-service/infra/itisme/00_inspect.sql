-- Read-only: values the KooChang procedures must match (collation for Thai text in varchar columns,
-- how the legacy program fills HQ / PaymentCond / PONo). No customer names, tax ids or amounts are read.
SET NOCOUNT ON;
USE ITISME;
PRINT '=== COLLATION ===';
SELECT DATABASEPROPERTYEX('ITISME','Collation') AS database_collation;
SELECT t.name AS tbl, c.name AS col, c.collation_name
FROM sys.tables t JOIN sys.columns c ON c.object_id=t.object_id
WHERE t.name IN ('Invoice','InvoiceDetail','Receipt','Customer') AND c.collation_name IS NOT NULL
ORDER BY t.name, c.column_id;

PRINT '=== CODE VALUES ===';
SELECT 'Customer.HQ' AS col, HQ AS v, COUNT(*) AS n FROM dbo.Customer GROUP BY HQ;
SELECT 'Company.HQ' AS col, HQ AS v, COUNT(*) AS n FROM dbo.Company GROUP BY HQ;
SELECT 'Customer.BranchNo' AS col, BranchNo AS v, COUNT(*) AS n FROM dbo.Customer WHERE LEN(BranchNo) <= 5 GROUP BY BranchNo;
SELECT TOP 10 'Invoice.PaymentCond' AS col, PaymentCond AS v, COUNT(*) AS n FROM dbo.Invoice GROUP BY PaymentCond ORDER BY COUNT(*) DESC;
SELECT 'Invoice.PONo' AS col, CASE WHEN PONo = '' THEN '(empty)' WHEN PONo = '-' THEN '-' ELSE '(text)' END AS v, COUNT(*) AS n
FROM dbo.Invoice GROUP BY CASE WHEN PONo = '' THEN '(empty)' WHEN PONo = '-' THEN '-' ELSE '(text)' END;
SELECT 'Invoice.Ref' AS col, CASE WHEN Ref = '' THEN '(empty)' WHEN Ref = '-' THEN '-' ELSE '(text)' END AS v, COUNT(*) AS n
FROM dbo.Invoice GROUP BY CASE WHEN Ref = '' THEN '(empty)' WHEN Ref = '-' THEN '-' ELSE '(text)' END;
SELECT 'Invoice.DocDate has time' AS col, CASE WHEN CAST(DocDate AS time) = '00:00' THEN 'midnight' ELSE 'with time' END AS v, COUNT(*) AS n
FROM dbo.Invoice GROUP BY CASE WHEN CAST(DocDate AS time) = '00:00' THEN 'midnight' ELSE 'with time' END;
SELECT 'Invoice.Subtotal+Vat=NetPrice' AS col, CASE WHEN ABS(Subtotal - ISNULL(Discount,0) + ISNULL(Vat,0) - ISNULL(NetPrice,0)) < 0.01 THEN 'yes' ELSE 'no' END AS v, COUNT(*) AS n
FROM dbo.Invoice GROUP BY CASE WHEN ABS(Subtotal - ISNULL(Discount,0) + ISNULL(Vat,0) - ISNULL(NetPrice,0)) < 0.01 THEN 'yes' ELSE 'no' END;
SELECT 'Customer PK' AS col, i.name AS v, 1 AS n FROM sys.indexes i WHERE i.object_id = OBJECT_ID('dbo.Customer') AND i.is_primary_key = 1;
