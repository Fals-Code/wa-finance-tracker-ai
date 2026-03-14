/**
 * Notification Scheduler — PATCHED
 * Fix: tambah method checkNotif() yang hilang
 * Fix: hapus duplikat SETTINGS_FILE (was causing TS error 2451)
 */

const cron = require('node-cron');
const fs   = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../../user_settings.json');

class NotificationScheduler {
    constructor(dependencies) {
        this.client = dependencies.client;
        this.logger = dependencies.logger;
        this.jobs   = dependencies.jobs;
    }

    getUserSettings() {
        try {
            if (!fs.existsSync(SETTINGS_FILE)) return {};
            const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            this.logger.error({ err: e.message }, 'Error reading user_settings.json');
            return {};
        }
    }

    saveUserSettings(settings) {
        try {
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 4));
        } catch (e) {
            this.logger.error({ err: e.message }, 'Error writing user_settings.json');
        }
    }

    /**
     * ✅ FIX: method ini dipanggil messageHandler tapi sebelumnya tidak ada di class
     * Cek apakah notifikasi aktif untuk user tertentu
     */
    checkNotif(waNumber) {
        const settings = this.getUserSettings();
        return settings[waNumber]?.notif_enabled === true;
    }

    toggleNotif(wa, isEnabled) {
        const settings = this.getUserSettings();
        if (!settings[wa]) settings[wa] = {};
        settings[wa].notif_enabled = isEnabled;
        this.saveUserSettings(settings);
        this.logger.info({ wa, isEnabled }, 'Notif toggled');
        return isEnabled;
    }

    init() {
        this.logger.info('Initializing Scheduler Jobs');

        // 1. Daily Summary — setiap 21:00
        cron.schedule('0 21 * * *', async () => {
            await this.broadcast('Daily Summary', async (wa) => {
                return this.jobs?.dailyReport
                    ? await this.jobs.dailyReport.executeForUser(wa)
                    : null;
            });
        });

        // 2. Weekly Summary — Senin 07:00
        cron.schedule('0 7 * * 1', async () => {
            await this.broadcast('Weekly Summary', async (_wa) => null);
        });

        // 3. Monthly Report — Tgl 1 jam 08:00
        cron.schedule('0 8 1 * *', async () => {
            await this.broadcast('Monthly Report', async (wa) => {
                return this.jobs?.dailyReport
                    ? await this.jobs.dailyReport.executeForUser(wa)
                    : null;
            });
        });

        // 4. Cleanup — setiap jam
        cron.schedule('0 * * * *', async () => {
            if (this.jobs?.cleanup) await this.jobs.cleanup.run();
        });

        this.logger.info('Scheduler jobs initialized ✅');
    }

    async broadcast(type, msgFn) {
        const settings    = this.getUserSettings();
        const activeUsers = Object.keys(settings).filter(wa => settings[wa].notif_enabled);

        if (activeUsers.length === 0) return;
        this.logger.info({ type, count: activeUsers.length }, 'Starting broadcast');

        for (const wa of activeUsers) {
            try {
                if (wa.endsWith('@g.us')) continue;
                const text = await msgFn(wa);
                if (text) {
                    await this.client.sendMessage(wa, text);
                    await new Promise(r => setTimeout(r, 1000));
                }
            } catch (error) {
                this.logger.error({ type, wa, err: error.message }, 'Broadcast failed for user');
            }
        }
    }
}

module.exports = NotificationScheduler;