// GỌI DOTENV NGAY DÒNG ĐẦU TIÊN ĐỂ NẠP BIẾN MÔI TRƯỜNG
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
app.use('/fabric', express.static(path.join(__dirname, 'fabric')));

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

        let manifest = {
            version: "26.1.2", 
            loader: "Fabric",
            loader_version: "0.19.2", 
            mods: []
        };

        let needsUpdate = false;

        if (fs.existsSync(MANIFEST_PATH)) {
            const rawData = fs.readFileSync(MANIFEST_PATH, 'utf8');
            if (rawData.trim() !== '') {
                manifest = JSON.parse(rawData);
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
    console.warn('Tính năng gửi mã OTP Quên mật khẩu sẽ không hoạt động.');
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
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this) });
});

// ================= API ENDPOINTS =================

app.get('/auth/server-info', (req, res) => {
    try {
        if (!fs.existsSync(MANIFEST_PATH)) {
            return res.json({ success: false, message: 'Không tìm thấy tệp manifest!' });
        }

        const rawData = fs.readFileSync(MANIFEST_PATH, 'utf8');
        const manifest = JSON.parse(rawData);

        res.json({
            success: true,
            version: manifest.version,
            loader: manifest.loader,
            loader_version: manifest.loader_version,
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
            from: `"Minecraft Server" <${EMAIL_USER}>`,
            to: email,
            subject: 'Mã khôi phục mật khẩu Launcher',
            html: `<h2>OTP: ${otp}</h2>`
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

// ================= THIẾT LẬP EMAIL =================
const EMAIL_USER = 'email_cua_ban@gmail.com'; 
const EMAIL_PASS = 'abcd efgh ijkl mnop';      

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
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this) });
});

// ================= API ENDPOINTS =================

app.get('/auth/server-info', (req, res) => {
    try {
        if (!fs.existsSync(MANIFEST_PATH)) {
            return res.json({ success: false, message: 'Không tìm thấy tệp manifest!' });
        }

        const rawData = fs.readFileSync(MANIFEST_PATH, 'utf8');
        const manifest = JSON.parse(rawData);

        res.json({
            success: true,
            version: manifest.version,
            loader: manifest.loader,
            loader_version: manifest.loader_version,
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

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = Date.now() + 15 * 60 * 1000;

        await dbRun('UPDATE users SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?', [otp, expiry, user.id]);

        const mailOptions = {
            from: `"Minecraft Server" <${EMAIL_USER}>`,
            to: email,
            subject: 'Mã khôi phục mật khẩu Launcher',
            html: `<h2>OTP: ${otp}</h2>`
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Mã OTP đã được gửi!' });
    } catch (err) { res.json({ success: false, message: 'Lỗi khi gửi email!' }); }
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
            version: "26.1.2", 
            loader: "Fabric",
            loader_version: "0.19.2",
            mods: []
        };

        let needsUpdate = false;

        // 2. Kiểm tra tệp manifest
        if (fs.existsSync(MANIFEST_PATH)) {
            const rawData = fs.readFileSync(MANIFEST_PATH, 'utf8');
            if (rawData.trim() !== '') {
                manifest = JSON.parse(rawData);
            }

            // Mảng mod đang được ghi trong file
            const currentMods = manifest.mods || [];

            // Thuật toán kiểm tra mảng: Số lượng phải bằng nhau và chứa đủ các phần tử
            const isMatching = actualModFiles.length === currentMods.length && 
                               actualModFiles.every(mod => currentMods.includes(mod));

            // Nếu không khớp (thiếu/thừa file), đánh dấu cần cập nhật
            if (!isMatching) {
                needsUpdate = true;
            }
        } else {
            // Nếu chưa có file manifest -> Đánh dấu bắt buộc tạo mới
            needsUpdate = true; 
        }

        // 3. Tiến hành cập nhật và lưu trữ nếu có sự thay đổi
        if (needsUpdate) {
            manifest.mods = actualModFiles; // Gán lại mảng bằng danh sách thực tế
            fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
            console.log(`🔄 [Auto-Sync] Đã đồng bộ Manifest: Cập nhật thành ${actualModFiles.length} Modpacks.`);
        }
    } catch (error) {
        console.error('❌ Lỗi đồng bộ manifest:', error.message);
    }
}

// Chạy đồng bộ một lần khi vừa khởi động Server
syncManifest();

// Theo dõi thư mục mods, cập nhật ngay khi có người copy/xóa file
let watchTimeout;
fs.watch(MODS_DIR, (eventType, filename) => {
    if (filename && filename.endsWith('.jar')) {
        clearTimeout(watchTimeout);
        watchTimeout = setTimeout(() => {
            syncManifest();
        }, 1000);
    }
});

// ================= THIẾT LẬP EMAIL =================
const EMAIL_USER = 'email_cua_ban@gmail.com'; 
const EMAIL_PASS = 'abcd efgh ijkl mnop';      

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
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this) });
});

// ================= API ENDPOINTS =================

// API: TRẢ VỀ DỮ LIỆU MANIFEST CHO LAUNCHER
app.get('/auth/server-info', (req, res) => {
    try {
        if (!fs.existsSync(MANIFEST_PATH)) {
            return res.json({ success: false, message: 'Không tìm thấy tệp manifest!' });
        }

        const rawData = fs.readFileSync(MANIFEST_PATH, 'utf8');
        const manifest = JSON.parse(rawData);

        res.json({
            success: true,
            version: manifest.version,
            loader: manifest.loader,
            totalMods: manifest.mods.length,
            mods: manifest.mods
        });
    } catch (error) {
        res.json({ success: false, message: 'Lỗi đọc dữ liệu manifest!' });
    }
});

// ĐĂNG KÝ
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

// ĐĂNG NHẬP
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

// QUÊN MẬT KHẨU - GỬI OTP
app.post('/auth/forgot-password', async (req, res) => {
    const { username, email } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ? AND email = ?', [username, email]);
        if (!user) return res.json({ success: false, message: 'Thông tin tài khoản/email không khớp!' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = Date.now() + 15 * 60 * 1000;

        await dbRun('UPDATE users SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?', [otp, expiry, user.id]);

        const mailOptions = {
            from: `"Minecraft Server" <${EMAIL_USER}>`,
            to: email,
            subject: 'Mã khôi phục mật khẩu Launcher',
            html: `<h2>OTP: ${otp}</h2>`
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'Mã OTP đã được gửi!' });
    } catch (err) { res.json({ success: false, message: 'Lỗi khi gửi email!' }); }
});

// QUÊN MẬT KHẨU - ĐẶT LẠI MẬT KHẨU
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
