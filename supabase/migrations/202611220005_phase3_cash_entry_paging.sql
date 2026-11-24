create index if not exists cash_entries_farm_batch_page_idx
  on public.cash_entries (farm_id, batch_id, entry_date desc, created_at desc, id desc);

create index if not exists sales_farm_batch_lookup_idx
  on public.sales (farm_id, batch_id, id);

create or replace function public.get_batch_cash_entries_page(
  p_farm_id uuid,
  p_batch_id uuid,
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with entries as materialized (
    select c.id,
           c.farm_id,
           c.batch_id,
           c.sale_payment_id,
           c.entry_date,
           c.details,
           c.category,
           c.receipt_number,
           c.money_in_kes,
           c.money_out_kes,
           c.created_at
    from public.cash_entries c
    left join public.sale_payments p
      on p.id = c.sale_payment_id
     and p.farm_id = c.farm_id
    left join public.sales s
      on s.id = p.sale_id
     and s.farm_id = p.farm_id
    where c.farm_id = p_farm_id
      and (c.batch_id = p_batch_id or s.batch_id = p_batch_id)
  ),
  page_rows as (
    select *
    from entries
    order by entry_date desc, created_at desc, id desc
    limit greatest(1, least(coalesce(p_page_size, 50), 100))
    offset (greatest(1, least(coalesce(p_page, 1), 1000000)) - 1)
      * greatest(1, least(coalesce(p_page_size, 50), 100))
  )
  select jsonb_build_object(
    'data',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(p)
          order by p.entry_date desc, p.created_at desc, p.id desc
        )
        from page_rows p
      ),
      '[]'::jsonb
    ),
    'total',
    (select count(*) from entries)
  );
$$;

revoke all on function public.get_batch_cash_entries_page(uuid, uuid, integer, integer)
  from public;
grant execute on function public.get_batch_cash_entries_page(uuid, uuid, integer, integer)
  to authenticated;

notify pgrst, 'reload schema';
