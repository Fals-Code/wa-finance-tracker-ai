-- SQL Migration Script for SaaS Transition (V2)
-- Execute this in Supabase SQL Editor

-- 1. Users / User Profiles
CREATE TABLE IF NOT EXISTS user_profiles (
    wa_number TEXT PRIMARY KEY,
    nama_user TEXT,
    timezone TEXT DEFAULT 'Asia/Jakarta',
    currency TEXT DEFAULT 'IDR',
    plan TEXT DEFAULT 'free',
    subscription_status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Transaksi (Refined)
CREATE TABLE IF NOT EXISTS transaksi (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wa_number TEXT REFERENCES user_profiles(wa_number),
    deskripsi TEXT,
    nama_toko TEXT,
    nominal BIGINT NOT NULL,
    kategori TEXT DEFAULT 'Lain-lain',
    sub_kategori TEXT,
    tipe TEXT CHECK (tipe IN ('masuk', 'keluar')),
    confidence_ai INT DEFAULT 0,
    sumber_dokumen TEXT DEFAULT 'whatsapp',
    tanggal DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

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
    keyword TEXT,
    kategori TEXT,
    sub_kategori TEXT
);

-- 5. Budget Tracker (Per-category limits)
CREATE TABLE IF NOT EXISTS budget_tracker (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wa_number TEXT REFERENCES user_profiles(wa_number),
    kategori TEXT NOT NULL,
    limit_amount BIGINT NOT NULL,
    periode TEXT DEFAULT 'bulanan',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(wa_number, kategori)
);

-- 6. User Categories (Custom categories)
CREATE TABLE IF NOT EXISTS user_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wa_number TEXT REFERENCES user_profiles(wa_number),
    nama_kategori TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(wa_number, nama_kategori)
);

-- 7. Prediction Logs (AI pattern analysis results)
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

CREATE TRIGGER update_user_profile_modtime
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW
    EXECUTE PROCEDURE update_modified_column();
