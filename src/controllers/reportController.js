const MSG = require('../constants/messages');
const { setState, resetState } = require('../utils/stateManager');

class ReportController {
    constructor(services, logger) {
        this.transactionService = services.transaction;
        this.db = services.db;
        this.logger = logger;
    }

    async showLaporan(msg, from) {
        this.logger.info({ from }, 'Generating monthly report');
        const report = await this.transactionService.getLaporan(from);
        return msg.reply(report);
    }

    async showSaldo(msg, from) {
        this.logger.info({ from }, 'Checking balance and summary');
        const saldo = await this.transactionService.getSaldo(from);
        return msg.reply(saldo);
    }

    async showRiwayat(msg, from) {
        this.logger.info({ from }, 'Fetching transaction history');
        const history = await this.transactionService.getRiwayat(from);
        return msg.reply(history);
    }

    async handleDetailPick(msg, from, text, cur) {
        const idx = parseInt(text) - 1;
        if (isNaN(idx) || idx < 0 || idx >= (cur.data.rows?.length || 0)) {
            return msg.reply('❌ Pilihan tidak valid. Balas nomor yang tersedia.');
        }
        
        const trxId = cur.data.rows[idx].id;
        this.logger.debug({ from, trxId }, 'Showing transaction detail');
        
        const detail = await this.db.getTransactionDetail(from, trxId);
        
        if (!detail) {
            resetState(from);
            return msg.reply('❌ Transaksi tidak ditemukan atau sudah dihapus.\n\nKetik *menu* untuk kembali.');
        }
        
        setState(from, 'await_detail_view', { trx: detail });
        return msg.reply(MSG.detailTrx(detail));
    }
}

module.exports = ReportController;
