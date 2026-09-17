CREATE OR REPLACE FUNCTION assert_production_batch_generation_mode_sku_count(target_batch_id integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  mode_value "production_generation_mode";
  source_value "production_source_mode";
  item_count integer;
BEGIN
  SELECT "generation_mode", "source_mode" INTO mode_value, source_value
  FROM "production_batches"
  WHERE "id" = target_batch_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*) INTO item_count
  FROM "production_batch_items"
  WHERE "production_batch_id" = target_batch_id;

  IF source_value = 'uploaded_images' THEN
    IF item_count < 1 OR item_count > 500 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'production_batches_generation_mode_sku_count',
        MESSAGE = format('Image-to-Video Batch %s must contain 1 to 500 images; found %s.', target_batch_id, item_count);
    END IF;
    RETURN;
  END IF;

  IF mode_value = 'single' AND item_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'production_batches_generation_mode_sku_count',
      MESSAGE = format('Single generation Batch %s must contain exactly one SKU; found %s.', target_batch_id, item_count);
  END IF;
  IF mode_value = 'bulk' AND item_count < 3 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'production_batches_generation_mode_sku_count',
      MESSAGE = format('Batch production %s must contain at least three SKU; found %s.', target_batch_id, item_count);
  END IF;
END;
$$;
