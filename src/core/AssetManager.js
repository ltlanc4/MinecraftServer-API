const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class AssetManager {
    /**
     * Khởi tạo trình quản lý tài nguyên
     * @param {string} modsDir - Đường dẫn thư mục chứa Mods
     * @param {string} manifestPath - Đường dẫn file server-manifest.json
     * @param {string} downloadsDir - Đường dẫn thư mục chứa bản cập nhật Launcher
     */
    constructor(modsDir, manifestPath, downloadsDir) {
        this.modsDir = modsDir;
        this.manifestPath = manifestPath;
        this.downloadsDir = downloadsDir;
        this.currentLauncherInfo = { version: "1.0.0", downloadUrl: "" };
        this.initDirectories();
    }

    /**
     * Tạo các thư mục cần thiết nếu chưa có
     */
    initDirectories() {
        if (!fs.existsSync(this.modsDir)) fs.mkdirSync(this.modsDir, { recursive: true });
        if (!fs.existsSync(this.downloadsDir)) fs.mkdirSync(this.downloadsDir, { recursive: true });
    }

    /**
     * Quét thư mục Mods, băm MD5 và ghi ra file manifest
     */
    syncManifest() {
        try {
            const files = fs.readdirSync(this.modsDir);
            const actualModFiles = files.filter(file => path.extname(file).toLowerCase() === '.jar');

            const modsData = actualModFiles.map(fileName => {
                const filePath = path.join(this.modsDir, fileName);
                const fileBuffer = fs.readFileSync(filePath);
                const hashSum = crypto.createHash('md5').update(fileBuffer).digest('hex');
                return { Name: fileName, Hash: hashSum };
            });

            const manifest = {
                version: process.env.MC_VERSION,
                loader: process.env.MC_LOADER,
                loader_version: process.env.MC_LOADER_VERSION,
                server_ip: process.env.SERVER_IP,
                server_port: process.env.SERVER_PORT,
                mods: modsData 
            };

            fs.writeFileSync(this.manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
            console.log(`🔄 [Auto-Sync] Đã đồng bộ Manifest: Băm MD5 cho ${actualModFiles.length} Mods.`);
        } catch (error) {
            console.error('❌ Lỗi đồng bộ manifest:', error.message);
        }
    }

    /**
     * Quét thư mục Downloads để tìm bản cập nhật Launcher (.zip) mới nhất
     */
    scanLauncherVersion() {
        try {
            const files = fs.readdirSync(this.downloadsDir);
            const zipFile = files.find(f => f.endsWith('.zip'));

            if (zipFile) {
                const cleanBaseName = zipFile.replace(/\.zip$/i, '');
                const versionMatch = cleanBaseName.match(/(\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9\.]+)?)/);
                const version = versionMatch ? versionMatch[1] : "1.0.0";

                this.currentLauncherInfo.version = version;
                this.currentLauncherInfo.downloadUrl = `http://${process.env.SERVER_API_IP}:${process.env.SERVER_API_PORT}/downloads/${zipFile}`;
            }
        } catch (error) {
            console.error("❌ Lỗi quét file Launcher:", error.message);
        }
    }

    /**
     * Bật cảm biến theo dõi sự thay đổi file trong các thư mục
     */
    startWatching() {
        let watchTimeout;
        fs.watch(this.modsDir, (eventType, filename) => {
            if (filename && filename.endsWith('.jar')) {
                clearTimeout(watchTimeout);
                watchTimeout = setTimeout(() => this.syncManifest(), 1000);
            }
        });

        let launcherWatchTimeout;
        fs.watch(this.downloadsDir, (eventType, filename) => {
            if (filename && filename.endsWith('.zip')) {
                clearTimeout(launcherWatchTimeout);
                launcherWatchTimeout = setTimeout(() => this.scanLauncherVersion(), 1000);
            }
        });
    }
}

module.exports = { AssetManager };