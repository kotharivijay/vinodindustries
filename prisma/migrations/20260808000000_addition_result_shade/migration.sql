-- Per-round resulting shade: when an addition round shifts the colour to a
-- different shade, the operator records it here. The slip's effective shade
-- becomes the latest round that set resultShadeName; the original slip shade
-- is never overwritten.

ALTER TABLE "DyeingAddition" ADD COLUMN IF NOT EXISTS "resultShadeName" TEXT;
ALTER TABLE "DyeingAddition" ADD COLUMN IF NOT EXISTS "resultShadeDescription" TEXT;
