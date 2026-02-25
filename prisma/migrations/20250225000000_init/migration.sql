-- CreateTable
CREATE TABLE IF NOT EXISTS "kv" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "kv_pkey" PRIMARY KEY ("key")
);
