// Bắt buộc nạp cấu hình môi trường ngay dòng đầu tiên
require('dotenv').config({
    path: '/etc/MinecraftServer-API/.env'
});

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Nhập các Class từ kiến trúc thư mục
const { DatabaseManager } = require('./src/core/DatabaseManager');
const { EmailService } = require('./src/core/EmailService');
const { AssetManager } = require('./src/core/AssetManager');
const { WebSocketManager } = require('./src/core/WebSocketManager');
const { ApiController } = require('./src/controllers/ApiController');

class AppServer {
    /**
     * Cấu hình và lắp ráp toàn bộ hệ thống máy chủ
     */
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.PORT = process.env.SERVER_API_PORT || 3000;
        
        // Khởi tạo thư mục tĩnh
        this.skinsDir = path.join(__dirname, 'skins');
        if (!fs.existsSync(this.skinsDir)) fs.mkdirSync(this.skinsDir, { recursive: true });

        // Nạp các Module hướng đối tượng (Inject Dependencies)
        this.dbManager = new DatabaseManager('./database.sqlite');
        this.emailService = new EmailService();
        this.assetManager = new AssetManager(
            path.join(__dirname, 'mods'),
            path.join(__dirname, 'server-manifest.json'),
            path.join(__dirname, 'downloads')
        );
        this.wsManager = new WebSocketManager(this.server);
        this.apiController = new ApiController(
            this.dbManager, 
            this.emailService, 
            this.assetManager, 
            this.wsManager, 
            this.skinsDir
        );

        this.configureMiddleware();
        this.configureRoutes();
    }

    /**
     * Cấu hình các bộ lọc và đường dẫn thư mục công khai (Middleware)
     */
    configureMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        
        // Khai báo public files
        this.app.use('/mods', express.static(this.assetManager.modsDir));
        this.app.use('/downloads', express.static(this.assetManager.downloadsDir));
        
        // 🟢 ĐÃ FIX: Chèn thêm cấu hình chặn Cache mạng cho thư mục skins
        this.app.use('/skins', express.static(this.skinsDir, {
            setHeaders: (res, path, stat) => {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }));
    }

    /**
     * Định tuyến API thông qua Controller
     */
    configureRoutes() {
        this.apiController.registerRoutes(this.app);
    }

    /**
     * Kích hoạt máy chủ, đồng bộ tài nguyên và mở port
     */
    bootstrap() {
        // Đồng bộ dữ liệu ban đầu
        this.assetManager.syncManifest();
        this.assetManager.scanLauncherVersion();
        
        // Bật cảm biến file
        this.assetManager.startWatching();
        
        // Chạy HTTP và WebSocket trên cùng một máy chủ (Port)
        this.server.listen(this.PORT, () => {
            console.log(`\n🚀 [OOP-Server] Hệ thống API (HTTP & WebSocket) đang vận hành tại port ${this.PORT}`);
            console.log(`🛑 Nhấn Ctrl + C để dừng và ngắt tài nguyên.\n`);
        });
    }
}

module.exports = { AppServer };