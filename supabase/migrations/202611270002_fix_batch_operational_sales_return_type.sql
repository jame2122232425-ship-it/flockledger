create or replace function public.get_batch_operational_sales(
  p_farm_id uuid,
  p_batch_id uuid
)
returns table (birds_sold bigint, live_weight_sold_kg numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_farm_member(p_farm_id) then
    raise exception 'Farm membership required.' using errcode = '42501';
  end if;
  return query
  select
    coalesce((
      select sum(sale.birds_sold + coalesce(adjustment.birds_sold_delta, 0))::bigint
      from public.sales sale
      left join (
        select farm_id, sale_id, sum(birds_sold_delta)::bigint as birds_sold_delta
        from public.sale_adjustments
        group by farm_id, sale_id
      ) adjustment on adjustment.farm_id = sale.farm_id and adjustment.sale_id = sale.id
      where sale.farm_id = p_farm_id and sale.batch_id = p_batch_id
    ), 0::bigint)
    + coalesce((
      select sum(correction.birds_sold_delta)::bigint
      from public.corrections correction
      where correction.farm_id = p_farm_id
        and correction.batch_id = p_batch_id
        and correction.source_table = 'sales'
    ), 0::bigint),
    coalesce((
      select sum(sale.total_weight_kg + coalesce(adjustment.live_weight_sold_kg_delta, 0))
      from public.sales sale
      left join (
        select farm_id, sale_id,
               sum(live_weight_sold_kg_delta) as live_weight_sold_kg_delta
        from public.sale_adjustments
        group by farm_id, sale_id
      ) adjustment on adjustment.farm_id = sale.farm_id and adjustment.sale_id = sale.id
      where sale.farm_id = p_farm_id and sale.batch_id = p_batch_id
    ), 0)
    + coalesce((
      select sum(correction.live_weight_sold_kg_delta)
      from public.corrections correction
      where correction.farm_id = p_farm_id
        and correction.batch_id = p_batch_id
        and correction.source_table = 'sales'
    ), 0);
end;
$$;

revoke all on function public.get_batch_operational_sales(uuid, uuid) from public, anon;
grant execute on function public.get_batch_operational_sales(uuid, uuid) to authenticated;
