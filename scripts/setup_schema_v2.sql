-- SQL Migration Script for SaaS Transition (V2)
-- Execute this in Supabase SQL Editor

-- 1. Users / User Profiles
-- 1. Users / User Profiles
CREATE TABLE IF NOT EXISTS user_profiles (
    wa_number TEXT PRIMARY KEY,
    nama_user TEXT,
    nama TEXT, -- Added for compatibility
    timezone TEXT DEFAULT 'Asia/Jakarta',
    currency TEXT DEFAULT 'IDR',
    plan TEXT DEFAULT 'free',
    subscription_status TEXT DEFAULT 'active',
    authcode TEXT, -- Added for dashboard auth
    authcode_requested BOOLEAN DEFAULT FALSE, -- Added
    last_active TIMESTAMPTZ DEFAULT NOW(), -- Added
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Transaksi (Aligned with mature codebase)
CREATE TABLE IF NOT EXISTS transaksi (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wa_number TEXT REFERENCES user_profiles(wa_number),
    deskripsi TEXT,
    nama_toko TEXT, -- Legacy support
    judul TEXT, -- Legacy support
    nama_user TEXT, -- Legacy support
    nominal BIGINT NOT NULL,
    kategori TEXT DEFAULT 'Lain-lain',
    sub_kategori TEXT,
    tipe TEXT CHECK (tipe IN ('masuk', 'keluar')),
    confidence_ai INT DEFAULT 0,
    status_validasi TEXT, -- Legacy support
    sumber_dokumen TEXT DEFAULT 'whatsapp',
    catatan TEXT, -- Legacy support
    tanggal DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure columns exist if table was already created by old V2 script
ALTER TABLE transaksi ADD COLUMN IF NOT EXISTS nama_user TEXT;
ALTER TABLE transaksi ADD COLUMN IF NOT EXISTS judul TEXT;
ALTER TABLE transaksi ADD COLUMN IF NOT EXISTS nama_toko TEXT;
ALTER TABLE transaksi ADD COLUMN IF NOT EXISTS catatan TEXT;
ALTER TABLE transaksi ADD COLUMN IF NOT EXISTS status_validasi TEXT;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transaksi_wa_number ON transaksi(wa_number);
CREATE INDEX IF NOT EXISTS idx_transaksi_tanggal ON transaksi(tanggal);
CREATE INDEX IF NOT EXISTS idx_transaksi_kategori ON transaksi(kategori);

-- 3. AI Keywords (Self-Learning Hub)
CREATE TABLE IF NOT EXISTS ai_keywords (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    keyword TEXT UNIQUE,
    kategori TEXT,
    sub_kategori TEXT,
    confidence_weight FLOAT DEFAULT 1.0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. KNN Dataset (For similarity classification)
CREATE TABLE IF NOT EXISTS knn_dataset (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nama_toko TEXT,
    keyword_utama TEXT,
    kategori TEXT,
    sub_kategori TEXT,
    sumber TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Monthly Budgets (user_budgets)
CREATE TABLE IF NOT EXISTS user_budgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wa_number TEXT REFERENCES user_profiles(wa_number) ON DELETE CASCADE,
  bulan TEXT NOT NULL,
  budget BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wa_number, bulan)
);

-- 6. Category Budgets (budget_tracker)
CREATE TABLE IF NOT EXISTS budget_tracker (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wa_number TEXT REFERENCES user_profiles(wa_number),
    kategori TEXT NOT NULL,
    limit_amount BIGINT NOT NULL,
    periode TEXT DEFAULT 'bulanan',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(wa_number, kategori)
);

-- 7. User Categories (Custom categories)
CREATE TABLE IF NOT EXISTS user_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wa_number TEXT REFERENCES user_profiles(wa_number),
    nama TEXT NOT NULL, -- Matched to code
    emoji TEXT DEFAULT '🏷️',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(wa_number, nama)
);

-- 8. Prediction Logs (AI pattern analysis results)
CREATE TABLE IF NOT EXISTS prediction_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wa_number TEXT REFERENCES user_profiles(wa_number),
    kategori TEXT,
    predicted_time TIME,
    confidence INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_profile_modtime ON user_profiles;
CREATE TRIGGER update_user_profile_modtime
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE PROCEDURE update_modified_column();

-- TABEL LOGIN CODES (OTP)
CREATE TABLE IF NOT EXISTS login_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wa_number TEXT NOT NULL,
    code TEXT NOT NULL,
    expired_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_codes_wa ON login_codes(wa_number);
