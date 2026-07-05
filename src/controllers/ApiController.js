const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

// Nạp Type Definitions từ các Class khác để JSDoc nhận diện
/** @typedef {import('../core/DatabaseManager')} DatabaseManager */
/** @typedef {import('../core/EmailService')} EmailService */
/** @typedef {import('../core/AssetManager')} AssetManager */
/** @typedef {import('../core/WebSocketManager')} WebSocketManager */
/** @typedef {import('express').Express} Express */
/** @typedef {import('express').Request} Request */
/** @typedef {import('express').Response} Response */

class ApiController {
    /**
     * Khởi tạo bộ điều hướng API
     * @param {DatabaseManager} dbManager 
     * @param {EmailService} emailService 
     * @param {AssetManager} assetManager 
     * @param {WebSocketManager} wsManager 
     * @param {string} skinsDir - Đường dẫn thư mục lưu Skin
     */

    constructor(dbManager, emailService, assetManager, wsManager, skinsDir) {
        this.db = dbManager;
        this.emailService = emailService;
        this.assetManager = assetManager;
        this.wsManager = wsManager;
        this.skinsDir = skinsDir;
    }

    /**
     * Khai báo các đường dẫn API cho ứng dụng Express
     * @param {Express} app - Thể hiện của Express App
     */
    registerRoutes(app) {
        app.get('/auth/server-info', this.getServerInfo.bind(this));
        app.get('/auth/launcher-version', this.getLauncherVersion.bind(this));
        app.post('/auth/register', this.register.bind(this));
        app.post('/auth/login', this.login.bind(this));
        app.post('/auth/forgot-password', this.forgotPassword.bind(this));
        app.post('/auth/reset-password', this.resetPassword.bind(this));
        app.post('/auth/change-password', this.changePassword.bind(this));
        app.post('/auth/request-email-change', this.requestEmailChange.bind(this));
        app.post('/auth/request-password-otp', this.requestPasswordOtp.bind(this));
        app.post('/auth/change-email', this.changeEmail.bind(this));
        app.post('/auth/upload-skin', this.uploadSkin.bind(this));
    }

    /**
     * Trả về thông tin phiên bản Game và Mods
     * @param {Request} req 
     * @param {Response} res 
     */
    getServerInfo(req, res) {
        try {
            const manifest = JSON.parse(fs.readFileSync(this.assetManager.manifestPath, 'utf8'));
            res.json({ success: true, ...manifest, totalMods: manifest.mods.length });
        } catch (err) {
            res.status(500).json({ success: false, message: 'Lỗi đọc cấu hình máy chủ!' });
        }
    }

    /**
     * Trả về thông tin phiên bản Launcher mới nhất
     * @param {Request} req 
     * @param {Response} res 
     */
    getLauncherVersion(req, res) {
        res.json(this.assetManager.currentLauncherInfo);
    }

    /**
     * Lưu trữ thông tin tài khoản đăng nhập của người dùng
     * @param {Request} req 
     * @param {Response} res 
     */
    async register(req, res) {
        const { username, email, password } = req.body;
        try {
            if (await this.db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, email])) {
                return res.json({ success: false, message: 'Tài khoản hoặc Email đã tồn tại!' });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            await this.db.run('INSERT INTO users (uuid, username, email, password) VALUES (?, ?, ?, ?)', [uuidv4(), username, email, hashedPassword]);
            res.json({ success: true, message: 'Đăng ký thành công!' });
        } catch (err) { res.json({ success: false, message: 'Lỗi server hệ thống!' }); }
    }

    /**
     * Lấy thông tin tài khoản đăng nhập của người dùng
     * @param {Request} req 
     * @param {Response} res 
     */
    async login(req, res) {
        const { username, password } = req.body;
        try {
            const user = await this.db.get('SELECT * FROM users WHERE username = ?', [username]);
            if (!user || !(await bcrypt.compare(password, user.password))) {
                return res.json({ success: false, message: 'Sai tài khoản hoặc mật khẩu!' });
            }
            res.json({ success: true, token: 'fake-token', username: user.username, uuid: user.uuid });
        } catch (err) { res.json({ success: false, message: 'Lỗi máy chủ đăng nhập!' }); }
    }

    /**
     * Gửi mã OTP thay đổi mật khẩu đăng nhập của người dùng
     * @param {Request} req 
     * @param {Response} res 
     */
    async forgotPassword(req, res) {
        const { username, email } = req.body;
        try {
            const user = await this.db.get('SELECT * FROM users WHERE username = ? AND email = ?', [username, email]);
            if (!user) return res.json({ success: false, message: 'Thông tin tài khoản không chính xác!' });
            
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            await this.db.run('UPDATE users SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?', [otp, Date.now() + 15 * 60 * 1000, user.id]);
            
            const html = this.emailService.generateTemplate('Khôi phục mật khẩu', username, 'Đây là mã OTP đặt lại mật khẩu của bạn:', otp, 'Mã này có hiệu lực trong 15 phút. Tuyệt đối không giao mã cho người lạ.');
            await this.emailService.sendMail(email, '🔑 Mã OTP Khôi Phục Mật Khẩu', html);
            
            res.json({ success: true, message: 'Mã OTP đã gửi thành công!' });
        } catch (err) { res.status(500).json({ success: false, message: 'Lỗi dịch vụ gửi mail!' }); }
    }

    /**
     * Khôi phục mật khẩu đăng nhập của người dùng
     * @param {Request} req 
     * @param {Response} res 
     */
    async resetPassword(req, res) {
        const { username, otp, newPassword } = req.body;
        try {
            const user = await this.db.get('SELECT * FROM users WHERE username = ?', [username]);
            if (!user || user.reset_otp !== otp) return res.json({ success: false, message: 'Mã OTP không hợp lệ!' });
            
            const hashedNewPassword = await bcrypt.hash(newPassword, 10);
            await this.db.run('UPDATE users SET password = ?, reset_otp = NULL WHERE id = ?', [hashedNewPassword, user.id]);
            res.json({ success: true, message: 'Đặt lại mật khẩu thành công!' });
        } catch (err) { res.json({ success: false, message: 'Lỗi hệ thống reset!' }); }
    }

    /**
     * Thay đổi mật khẩu đăng nhập của người dùng
     * @param {Request} req 
     * @param {Response} res 
     */
    async changePassword(req, res) {
        const { username, oldPassword, newPassword } = req.body;
        try {
            const user = await this.db.get('SELECT * FROM users WHERE username = ?', [username]);
            if (!user || !(await bcrypt.compare(oldPassword, user.password))) {
                return res.json({ success: false, message: 'Mật khẩu cũ không đúng!' });
            }
            const hashedNewPassword = await bcrypt.hash(newPassword, 10);
            await this.db.run('UPDATE users SET password = ? WHERE id = ?', [hashedNewPassword, user.id]);
            res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
        } catch (err) { res.json({ success: false, message: 'Lỗi server!' }); }
    }

    /**
     * Yêu cầu thay đổi email khôi phục của người dùng
     * @param {Request} req 
     * @param {Response} res 
     */
    async requestEmailChange(req, res) {
        const { username, newEmail } = req.body;
        try {
            const user = await this.db.get('SELECT * FROM users WHERE username = ?', [username]);
            if (!user) return res.json({ success: false, message: 'Không tìm thấy tài khoản!' });

            if (await this.db.get('SELECT * FROM users WHERE email = ?', [newEmail])) {
                return res.json({ success: false, message: 'Email này đã được tài khoản khác sử dụng!' });
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            await this.db.run('UPDATE users SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?', [otp, Date.now() + 15 * 60 * 1000, user.id]);

            const html = this.emailService.generateTemplate('Xác minh thay đổi Email', username, `Bạn yêu cầu đổi Email khôi phục sang địa chỉ mới: <strong>${newEmail}</strong>. Nhập mã OTP dưới đây để hoàn tất:`, otp, 'Mã này có hiệu lực trong 15 phút. Tuyệt đối giữ bảo mật.');
            await this.emailService.sendMail(user.email, '✉️ Xác minh thay đổi Email khôi phục', html);
            
            res.json({ success: true, message: 'OTP xác nhận đã gửi đến Email gốc!' });
        } catch (err) { res.status(500).json({ success: false, message: 'Lỗi gửi mail xác minh!' }); }
    }

    /**
     * Yêu cầu gửi mã OTP thay đổi mật khẩu đăng nhập của người dùng
     * @param {Request} req 
     * @param {Response} res 
     */
    async requestPasswordOtp(req, res) {
        const { username, oldPassword } = req.body;
        try {
            const user = await this.db.get('SELECT * FROM users WHERE username = ?', [username]);
            if (!user) return res.json({ success: false, message: 'Tài khoản không tồn tại!' });

            if (!(await bcrypt.compare(oldPassword, user.password))) {
                return res.json({ success: false, message: 'Mật khẩu hiện tại không chính xác!' });
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            await this.db.run('UPDATE users SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?', [otp, Date.now() + 15 * 60 * 1000, user.id]);

            const html = this.emailService.generateTemplate('Xác nhận đổi mật khẩu', username, `Yêu cầu đổi mật khẩu bảo mật của bạn đang chờ phê duyệt. Dưới đây là mã OTP:`, otp, 'Mã chỉ có hiệu lực trong 15 phút.');
            await this.emailService.sendMail(user.email, '🔑 Mã OTP Xác Nhận Đổi Mật Khẩu', html);
            
            res.json({ success: true, message: 'OTP đã gửi đến Email gốc của bạn!' });
        } catch (err) {
            res.status(500).json({ success: false, message: 'Lỗi gửi mail hệ thống!' });
        }
    }

    /**
     * Thay đổi email khôi phục của người dùng
     * @param {Request} req 
     * @param {Response} res 
     */
    async changeEmail(req, res) {
        const { username, newEmail, otp } = req.body;
        try {
            const user = await this.db.get('SELECT * FROM users WHERE username = ? AND reset_otp = ?', [username, otp]);
            if (!user) return res.json({ success: false, message: 'Mã OTP không hợp lệ hoặc đã hết hạn!' });
            
            await this.db.run('UPDATE users SET email = ?, reset_otp = NULL WHERE id = ?', [newEmail, user.id]);
            res.json({ success: true, message: 'Cập nhật Email khôi phục thành công!' });
        } catch (err) { res.json({ success: false, message: 'Lỗi hệ thống đồng bộ!' }); }
    }

    /**
     * Lưu trữ ảnh Skin người dùng và phát sóng WebSocket
     * @param {Request} req 
     * @param {Response} res 
     */
    async uploadSkin(req, res) {
        const { username, skinBase64 } = req.body;
        try {
            if (!skinBase64) return res.json({ success: false, message: 'Dữ liệu skin không hợp lệ!' });

            const user = await this.db.get('SELECT * FROM users WHERE username = ?', [username]);
            if (!user) return res.json({ success: false, message: 'Không tìm thấy tài khoản!' });

            const skinBuffer = Buffer.from(skinBase64, 'base64');
            const skinPath = path.join(this.skinsDir, `${username}.png`);
            fs.writeFileSync(skinPath, skinBuffer);
            
            // KÍCH HOẠT WEBSOCKET PHÁT SÓNG ĐỒNG BỘ ẢO LẬP TỨC
            this.wsManager.broadcastSkinUpdate(username);

            res.json({ success: true, message: 'Cập nhật Skin thành công! Các máy khách đang tự động vẽ lại...' });
        } catch (err) {
            res.status(500).json({ success: false, message: 'Lỗi lưu trữ skin tại máy chủ!' });
        }
    }
}

module.exports = { ApiController };