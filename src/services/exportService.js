/**
 * Export Service for generating XLSX files via Python script
 */

const { execFile } = require('child_process');
const path = require('path');

class ExportService {
    constructor(supabaseClient, logger) {
        this.supabase = supabaseClient;
        this.logger = logger;
    }

    async generateExportXLSX(waNumber, outPath) {
        this.logger.info({ waNumber, outPath }, 'Preparing data for XLSX export');
        
        const { data, error } = await this.supabase
            .from('transaksi')
            .select('tanggal,judul,nama_toko,nominal,tipe,kategori,sub_kategori,catatan')
            .eq('wa_number', waNumber)
            .order('tanggal', { ascending: false });

        if (error || !data || data.length === 0) {
            this.logger.warn({ waNumber, err: error?.message }, 'No data found for export');
            return false;
        }

        const payload = JSON.stringify({ rows: data, outpath: outPath });

        return new Promise((resolve, reject) => {
            const scriptPath = path.join(__dirname, '../../gen_xlsx.py');
            const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
            
            this.logger.debug({ pythonCmd, scriptPath }, 'Executing Python export script');
            
            const proc = execFile(pythonCmd, [scriptPath], (err, stdout, stderr) => {
                if (err) { 
                    this.logger.error({ err: stderr || err.message }, 'Python XLSX generation failed');
                    return reject(err); 
                }
                this.logger.info({ waNumber }, 'XLSX export generated successfully');
                resolve(true);
            });
            proc.stdin.write(payload);
            proc.stdin.end();
        });
    }
}

module.exports = ExportService;
