require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

// MỞ CỔNG TẢI FILE STATIC
app.use('/mods', express.static(path.join(__dirname, 'mods')));

const PORT = process.env.PORT || 3000;

// ================= THIẾT LẬP THƯ MỤC VÀ MANIFEST =================
const MODS_DIR = path.join(__dirname, 'mods');
const MANIFEST_PATH = path.join(__dirname, 'server-manifest.json');

if (!fs.existsSync(MODS_DIR)) {
    fs.mkdirSync(MODS_DIR, { recursive: true });
    console.log('📁 Đã tạo thư mục "mods" trống. Hãy bỏ file mod (.jar) vào đây.');
}

// ================= HÀM ĐỒNG BỘ THÔNG MINH (SMART SYNC) =================
function syncManifest() {
    try {
        const files = fs.readdirSync(MODS_DIR);
        const actualModFiles = files.filter(file => path.extname(file).toLowerCase() === '.jar');

        // BỔ SUNG CẤU HÌNH IP VÀ PORT CỦA SERVER MINECRAFT TẠI ĐÂY 👇
        const SERVER_IP = process.env.SERVER_IP;
        const SERVER_PORT = process.env.SERVER_PORT;
        let manifest = {
            version: "26.1.2",
            loader: "Fabric",
            loader_version: "0.19.2",
            server_ip: SERVER_IP, // Đổi thành IP máy chủ Minecraft của bạn (LAN hoặc WAN)
            server_port: SERVER_PORT,     // Cổng mặc định của Minecraft Server
            mods: []
        };

        let needsUpdate = false;

        if (fs.existsSync(MANIFEST_PATH)) {
            const rawData = fs.readFileSync(MANIFEST_PATH, 'utf8');
            if (rawData.trim() !== '') {
                manifest = JSON.parse(rawData);
            }

            // Đảm bảo file cũ nếu thiếu thuộc tính server_ip/port thì sẽ tự động bổ sung cập nhật
            if (manifest.server_ip !== SERVER_IP || manifest.server_port !== SERVER_PORT) {
                manifest.server_ip = SERVER_IP;
                manifest.server_port = SERVER_PORT;
                needsUpdate = true;
            }

            const currentMods = manifest.mods || [];
            const isMatching = actualModFiles.length === currentMods.length &&
                actualModFiles.every(mod => currentMods.includes(mod));

            if (!isMatching) {
                needsUpdate = true;
            }
        } else {
            needsUpdate = true;
        }

        if (needsUpdate) {
            manifest.mods = actualModFiles;
            fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
            console.log(`🔄 [Auto-Sync] Đã đồng bộ Manifest: Cập nhật thành ${actualModFiles.length} Mods.`);
        }
    } catch (error) {
        console.error('❌ Lỗi đồng bộ manifest:', error.message);
    }
}

syncManifest();

let watchTimeout;
fs.watch(MODS_DIR, (eventType, filename) => {
    if (filename && filename.endsWith('.jar')) {
        clearTimeout(watchTimeout);
        watchTimeout = setTimeout(() => {
            syncManifest();
        }, 1000);
    }
});

// ================= THIẾT LẬP EMAIL (DÙNG .ENV) =================
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

if (!EMAIL_USER || !EMAIL_PASS) {
    console.warn('⚠️ CẢNH BÁO: Chưa cấu hình EMAIL_USER hoặc EMAIL_PASS trong file .env!');
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

// ================= QUẢN LÝ SECRET KEY =================
let SECRET_KEY = '';
const secretFilePath = './secret.key';
if (fs.existsSync(secretFilePath)) {
    SECRET_KEY = fs.readFileSync(secretFilePath, 'utf8').trim();
} else {
    SECRET_KEY = crypto.randomBytes(64).toString('hex');
    fs.writeFileSync(secretFilePath, SECRET_KEY, 'utf8');
}

// ================= DATABASE =================
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('❌ Lỗi database:', err.message);
});

db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    reset_otp TEXT,
    reset_otp_expiry INTEGER
)`);

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this) });
});

// ================= API ENDPOINTS =================

app.get('/auth/server-info', (req, res) => {
    try {
        if (!fs.existsSync(MANIFEST_PATH)) {
            return res.json({ success: false, message: 'Không tìm thấy tệp manifest!' });
        }

        const rawData = fs.readFileSync(MANIFEST_PATH, 'utf8');
        const manifest = JSON.parse(rawData);

        // Trả thêm thông tin IP và Port về cho Launcher C# nhận diện
        res.json({
            success: true,
            version: manifest.version,
            loader: manifest.loader,
            loader_version: manifest.loader_version,
            server_ip: manifest.server_ip || "127.0.0.1",
            server_port: manifest.server_port || 25565,
            totalMods: manifest.mods.length,
            mods: manifest.mods
        });
    } catch (error) {
        res.json({ success: false, message: 'Lỗi đọc dữ liệu manifest!' });
    }
});

app.post('/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const existingUser = await dbGet('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);
        if (existingUser) return res.json({ success: false, message: 'Tài khoản hoặc Email đã tồn tại!' });

        const hashedPassword = await bcrypt.hash(password, 10);
        await dbRun('INSERT INTO users (uuid, username, email, password) VALUES (?, ?, ?, ?)', [uuidv4(), username, email, hashedPassword]);
        res.json({ success: true, message: 'Đăng ký thành công!' });
    } catch (err) { res.json({ success: false, message: 'Lỗi server!' }); }
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.json({ success: false, message: 'Tài khoản hoặc mật khẩu sai!' });
        }
        const token = jwt.sign({ id: user.uuid, name: user.username }, SECRET_KEY, { expiresIn: '7d' });
        res.json({ success: true, token, username: user.username, uuid: user.uuid });
    } catch (err) { res.json({ success: false, message: 'Lỗi server!' }); }
});

app.post('/auth/forgot-password', async (req, res) => {
    const { username, email } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ? AND email = ?', [username, email]);
        if (!user) return res.json({ success: false, message: 'Thông tin tài khoản/email không khớp!' });

        if (!EMAIL_USER || !EMAIL_PASS) {
            return res.json({ success: false, message: 'Máy chủ chưa được cấu hình Email gửi đi!' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = Date.now() + 15 * 60 * 1000;

        await dbRun('UPDATE users SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?', [otp, expiry, user.id]);

        const mailOptions = {
            // ĐÃ ĐỔI TÊN NGƯỜI GỬI Ở DÒNG NÀY 👇
            from: `"OtonashiRei MC Server" <${EMAIL_USER}>`,
            
            to: email,
            subject: '🔑 Mã OTP Khôi Phục Mật Khẩu',
            html: `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #1e1e24; padding: 40px 15px; margin: 0;">
                <div style="max-width: 550px; margin: 0 auto; background: #2b2b36; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 20px rgba(0,0,0,0.5);">
                    
                    <div style="background: linear-gradient(135deg, #F36895 0%, #d14a75 100%); padding: 25px; text-align: center;">
                        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 2px; text-transform: uppercase;">OtonashiRei MC Server</h1>
                    </div>
                    
                    <div style="padding: 35px 30px;">
                        <h2 style="color: #ffffff; margin-top: 0; font-size: 20px;">Yêu cầu khôi phục mật khẩu</h2>
                        <p style="color: #b3b3b3; font-size: 16px; line-height: 1.6;">Xin chào <strong style="color: #F36895;">${user.username}</strong>,</p>
                        <p style="color: #b3b3b3; font-size: 16px; line-height: 1.6;">Hệ thống vừa nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn. Dưới đây là mã xác nhận (OTP) của bạn:</p>
                        
                        <div style="text-align: center; margin: 35px 0;">
                            <span style="display: inline-block; background-color: rgba(243, 104, 149, 0.1); border: 2px dashed #F36895; color: #F36895; font-size: 38px; font-weight: bold; letter-spacing: 12px; padding: 15px 35px; border-radius: 8px;">
                                ${otp}
                            </span>
                        </div>
                        
                        <div style="background-color: rgba(255, 193, 7, 0.1); border-left: 4px solid #ffc107; padding: 15px; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                            <p style="color: #ffc107; font-size: 14px; margin: 0; line-height: 1.5;">
                                <strong>⚠️ Lưu ý bảo mật:</strong> Mã này chỉ có hiệu lực trong <strong>15 phút</strong>. Tuyệt đối không chia sẻ mã này cho bất kỳ ai, kể cả quản trị viên máy chủ.
                            </p>
                        </div>
                        
                        <hr style="border: none; border-top: 1px solid #3f3f4e; margin: 30px 0;">
                        
                        <p style="color: #666666; font-size: 12px; text-align: center; margin: 0; line-height: 1.5;">
                            Đây là email tự động từ hệ thống quản lý tài khoản OtonashiRei.<br>Vui lòng không trả lời email này.
                        </p>
                    </div>
                </div>
            </div>
            `
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Mã OTP đã được gửi!' });
    } catch (err) {
        console.error("Lỗi gửi mail:", err);
        res.json({ success: false, message: 'Lỗi khi gửi email! Vui lòng kiểm tra lại cấu hình.' });
    }
});

app.post('/auth/reset-password', async (req, res) => {
    const { username, otp, newPassword } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || user.reset_otp !== otp || Date.now() > user.reset_otp_expiry) {
            return res.json({ success: false, message: 'Mã OTP không đúng hoặc đã hết hạn!' });
        }

        const hashedNewPassword = await bcrypt.hash(newPassword, 10);
        await dbRun('UPDATE users SET password = ?, reset_otp = NULL, reset_otp_expiry = NULL WHERE id = ?', [hashedNewPassword, user.id]);
        res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
    } catch (err) { res.json({ success: false, message: 'Lỗi server!' }); }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server đang chạy tại: http://localhost:${PORT}`);
    console.log(`🛑 Nhấn Ctrl + C để dừng.\n`);
});