/**
 * Notification Scheduler for automated reports
 * Refactored to use Job Layer
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '../../user_settings.json');

class NotificationScheduler {
    constructor(dependencies) {
        this.client = dependencies.client;
        this.logger = dependencies.logger;
        this.jobs = dependencies.jobs;
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

    init() {
        this.logger.info('Initializing Scheduler Jobs');

        // 1. Daily Summary (21:00)
        cron.schedule('0 21 * * *', async () => {
            await this.broadcast('Daily Summary', async (wa) => {
                return await this.jobs.dailyReport.executeForUser(wa);
            });
        });

        // 2. Weekly Summary (Monday 07:00)
        cron.schedule('0 7 * * 1', async () => {
            await this.broadcast('Weekly Summary', async (wa) => {
                // weekly summary logic could be moved to a job too
                return null; // Placeholder
            });
        });

        // 3. Monthly Report (1st day 08:00)
        cron.schedule('0 8 1 * *', async () => {
            await this.broadcast('Monthly Report', async (wa) => {
                return await this.jobs.dailyReport.executeForUser(wa); // Or a specific monthly job
            });
        });

        // 4. Cleanup Job (Hourly)
        cron.schedule('0 * * * *', async () => {
            await this.jobs.cleanup.run();
        });
    }

    async broadcast(type, msgFn) {
        const settings = this.getUserSettings();
        const activeUsers = Object.keys(settings).filter(wa => settings[wa].notif_enabled);
        
        this.logger.info({ type, count: activeUsers.length }, 'Starting scheduled broadcast');
        
        for (const wa of activeUsers) {
            try {
                if (wa.endsWith('@g.us')) continue;
                const msg = await msgFn(wa);
                if (msg) {
                    await this.client.sendMessage(wa, msg);
                    await new Promise(r => setTimeout(r, 1000));
                }
            } catch (error) {
                this.logger.error({ type, wa, err: error.message }, 'Broadcast failed for user');
            }
        }
    }

    toggleNotif(wa, isEnabled) {
        const settings = this.getUserSettings();
        if (!settings[wa]) settings[wa] = {};
        settings[wa].notif_enabled = isEnabled;
        this.saveUserSettings(settings);
    }
}

module.exports = NotificationScheduler;
