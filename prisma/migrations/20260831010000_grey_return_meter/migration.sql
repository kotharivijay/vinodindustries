-- Despatch metres on a grey-return line, typed by the operator at return time.
-- Grey moves by than AND metres; finished PC-job challans deliberately carry no
-- meter (app/api/delivery-challan/route.ts writes it null), so this stays
-- grey-return only. It is copied onto FinishDeliveryChallanLine.meter, which
-- already exists, so it reaches the challan print, PDF and report for free.

ALTER TABLE "GreyReturnLot" ADD COLUMN "meter" DOUBLE PRECISION;
