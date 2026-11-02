-- 翻譯 cache：content-addressed（hash = 來源內容 + promptVersion + model + srcLang + targetLangs）
-- 同一段原文唔會再 call 兩次 LLM；來源文字改動會自動 miss，唔需要 explicit invalidate。
CREATE TABLE IF NOT EXISTS translation_cache (
  hash char(64) PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  prompt_version smallint NOT NULL DEFAULT 1,
  hit_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_hit_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS translation_cache_last_hit_idx ON translation_cache (last_hit_at);
