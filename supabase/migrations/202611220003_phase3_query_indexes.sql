create index if not exists batches_farm_placed_page_idx
  on public.batches (farm_id, date_placed desc, id desc);

create index if not exists daily_records_farm_date_page_idx
  on public.daily_records (farm_id, record_date desc, id desc);

create index if not exists weight_records_farm_date_page_idx
  on public.weight_records (farm_id, record_date desc, id desc);

create index if not exists feed_deliveries_farm_date_page_idx
  on public.feed_deliveries (farm_id, delivery_date desc, id desc);

create index if not exists health_records_farm_date_page_idx
  on public.health_records (farm_id, record_date desc, id desc);

create index if not exists sales_farm_date_page_idx
  on public.sales (farm_id, sale_date desc, id desc);

create index if not exists cash_entries_farm_date_page_idx
  on public.cash_entries (farm_id, entry_date desc, id desc);

create index if not exists stock_movements_farm_date_page_idx
  on public.stock_movements (farm_id, movement_date desc, id desc);

create index if not exists assets_farm_purchase_page_idx
  on public.assets (farm_id, date_purchased desc, id desc);

create index if not exists corrections_farm_created_page_idx
  on public.corrections (farm_id, created_at desc, id desc);

create index if not exists sale_payments_farm_sale_idx
  on public.sale_payments (farm_id, sale_id);
