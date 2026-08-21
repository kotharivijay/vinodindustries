-- Delivery-challan destination (city / party location). Nullable so legacy
-- challans are unaffected; auto-inherited from the previous challan on create.
ALTER TABLE "FinishDeliveryChallan" ADD COLUMN "destination" TEXT;
