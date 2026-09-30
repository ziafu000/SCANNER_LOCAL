-- ==============================================================================
-- SCANNER PWA - Supabase Database Schema & Migration
-- Quản lý xác thực người dùng (Auth) và Quota lượt quét (user_quotas)
-- ==============================================================================

-- 1. Bảng lưu trữ hạn mức và số lượt quét của người dùng
create table if not exists public.user_quotas (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  scans_limit integer not null default 20,
  scans_used integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Bật Row Level Security (RLS)
alter table public.user_quotas enable row level security;

-- 2. Chính sách bảo mật RLS
-- Người dùng chỉ có quyền xem quota của chính mình (chỉ đọc).
-- Việc trừ và cập nhật lượt quét chỉ được thực hiện thông qua hàm RPC bảo mật (consume_scan).
drop policy if exists "Users can view their own quota" on public.user_quotas;
create policy "Users can view their own quota"
  on public.user_quotas
  for select
  using (auth.uid() = id);

-- Không cho phép client cập nhật trực tiếp bảng user_quotas
drop policy if exists "Users can update their own quota" on public.user_quotas;

-- 3. Trigger tự động cấp 20 lượt quét mặc định khi người dùng mới đăng ký
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_quotas (id, email, scans_limit, scans_used, created_at, updated_at)
  values (new.id, new.email, 20, 0, timezone('utc'::text, now()), timezone('utc'::text, now()))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. RPC Function: Trừ 1 lượt quét an toàn (Atomic consume scan)
-- Ngăn ngừa race condition và đảm bảo không vượt quá quota_limit
create or replace function public.consume_scan()
returns json as $$
declare
  v_user_id uuid;
  v_quota record;
  v_remaining integer;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return json_build_object(
      'success', false,
      'error', 'unauthorized',
      'message', 'Yêu cầu đăng nhập để sử dụng tính năng này.'
    );
  end if;

  -- Lock hàng tương ứng để đảm bảo tính atomic
  select scans_limit, scans_used
  into v_quota
  from public.user_quotas
  where id = v_user_id
  for update;

  -- Nếu chưa có bản ghi (ví dụ user tạo trước khi có trigger), tạo mới
  if not found then
    insert into public.user_quotas (id, email, scans_limit, scans_used, created_at, updated_at)
    values (v_user_id, auth.jwt() ->> 'email', 20, 1, timezone('utc'::text, now()), timezone('utc'::text, now()))
    returning scans_limit, scans_used into v_quota;

    return json_build_object(
      'success', true,
      'scans_limit', v_quota.scans_limit,
      'scans_used', v_quota.scans_used,
      'remaining', v_quota.scans_limit - v_quota.scans_used
    );
  end if;

  -- Kiểm tra nếu đã hết lượt quét
  if v_quota.scans_used >= v_quota.scans_limit then
    return json_build_object(
      'success', false,
      'error', 'quota_exceeded',
      'scans_limit', v_quota.scans_limit,
      'scans_used', v_quota.scans_used,
      'remaining', 0,
      'message', 'Bạn đã sử dụng hết số lượt quét cho phép.'
    );
  end if;

  -- Trừ 1 lượt quét
  update public.user_quotas
  set scans_used = scans_used + 1,
      updated_at = timezone('utc'::text, now())
  where id = v_user_id
  returning scans_limit, scans_used into v_quota;

  v_remaining := v_quota.scans_limit - v_quota.scans_used;

  return json_build_object(
    'success', true,
    'scans_limit', v_quota.scans_limit,
    'scans_used', v_quota.scans_used,
    'remaining', v_remaining
  );
end;
$$ language plpgsql security definer;

-- 5. RPC Function: Lấy thông tin quota người dùng hiện tại
create or replace function public.get_user_quota()
returns json as $$
declare
  v_user_id uuid;
  v_quota record;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    return json_build_object(
      'success', false,
      'error', 'unauthorized'
    );
  end if;

  select scans_limit, scans_used
  into v_quota
  from public.user_quotas
  where id = v_user_id;

  if not found then
    -- Tự động khởi tạo nếu chưa có
    insert into public.user_quotas (id, email, scans_limit, scans_used, created_at, updated_at)
    values (v_user_id, auth.jwt() ->> 'email', 20, 0, timezone('utc'::text, now()), timezone('utc'::text, now()))
    returning scans_limit, scans_used into v_quota;
  end if;

  return json_build_object(
    'success', true,
    'scans_limit', v_quota.scans_limit,
    'scans_used', v_quota.scans_used,
    'remaining', greatest(0, v_quota.scans_limit - v_quota.scans_used)
  );
end;
$$ language plpgsql security definer;
