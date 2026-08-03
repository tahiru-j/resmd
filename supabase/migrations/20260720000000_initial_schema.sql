-- Initial schema for resmd
-- Run this in the Supabase SQL editor for a fresh project.

-- ─── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT,
  ai_usage_this_month  INTEGER NOT NULL DEFAULT 0,
  ai_usage_reset_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.resumes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT 'My Resume',
  raw_content     TEXT NOT NULL DEFAULT '',
  template_id     TEXT NOT NULL DEFAULT 'minimal',
  cloned_from_id  UUID REFERENCES public.resumes(id) ON DELETE SET NULL,
  is_public       BOOLEAN NOT NULL DEFAULT FALSE,
  public_slug     TEXT UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rating      SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  message     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_model_stats (
  model_id              TEXT PRIMARY KEY,
  provider              TEXT NOT NULL,
  use_count             INTEGER NOT NULL DEFAULT 0,
  last_used             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suggestions_accepted  INTEGER NOT NULL DEFAULT 0,
  suggestions_rejected  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.mcp_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.user_providers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  adapter_type  TEXT NOT NULL,
  base_url      TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_preview   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Auto-create profile on signup ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── RPC Functions ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.increment_model_use(p_model TEXT, p_provider TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ai_model_stats (model_id, provider, use_count, last_used)
  VALUES (p_model, p_provider, 1, NOW())
  ON CONFLICT (model_id) DO UPDATE SET
    use_count = ai_model_stats.use_count + 1,
    last_used = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.track_suggestion(
  p_model   TEXT,
  p_provider TEXT,
  p_action  TEXT,
  p_count   INTEGER DEFAULT 1
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ai_model_stats (model_id, provider, use_count, last_used,
    suggestions_accepted, suggestions_rejected)
  VALUES (
    p_model, p_provider, 0, NOW(),
    CASE WHEN p_action = 'accepted' THEN p_count ELSE 0 END,
    CASE WHEN p_action = 'rejected' THEN p_count ELSE 0 END
  )
  ON CONFLICT (model_id) DO UPDATE SET
    last_used = NOW(),
    suggestions_accepted = ai_model_stats.suggestions_accepted +
      CASE WHEN p_action = 'accepted' THEN p_count ELSE 0 END,
    suggestions_rejected = ai_model_stats.suggestions_rejected +
      CASE WHEN p_action = 'rejected' THEN p_count ELSE 0 END;
END;
$$;

-- ─── Row Level Security ───────────────────────────────────────────────────────
-- The app uses the service role key which bypasses RLS.
-- These policies allow users to read their own data if accessed via anon key.

ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resumes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_model_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_providers ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Users can view own profile"   ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- resumes
CREATE POLICY "Users can manage own resumes" ON public.resumes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public resumes are readable"  ON public.resumes FOR SELECT USING (is_public = TRUE);

-- mcp_keys
CREATE POLICY "Users can manage own mcp keys" ON public.mcp_keys FOR ALL USING (auth.uid() = user_id);

-- user_providers
CREATE POLICY "Users can manage own providers" ON public.user_providers FOR ALL USING (auth.uid() = user_id);

-- feedback (insert only for authenticated users, no read)
CREATE POLICY "Users can insert feedback" ON public.feedback FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
