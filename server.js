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
}

// ================= HÀM TẠO TEMPLATE EMAIL CHUNG =================
function generateEmailTemplate(title, username, mainContent, otp, note) {
    return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #1e1e24; padding: 40px 15px; margin: 0;">
        <div style="max-width: 550px; margin: 0 auto; background: #2b2b36; border-radius: 12px; overflow: hidden; box-shadow: 0 8px 20px rgba(0,0,0,0.5);">
            <div style="background: linear-gradient(135deg, #F36895 0%, #d14a75 100%); padding: 25px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 2px; text-transform: uppercase;">OtonashiRei MC Server</h1>
            </div>
            <div style="padding: 35px 30px;">
                <h2 style="color: #ffffff; margin-top: 0; font-size: 20px;">${title}</h2>
                <p style="color: #b3b3b3; font-size: 16px; line-height: 1.6;">Xin chào <strong style="color: #F36895;">${username}</strong>,</p>
                <p style="color: #b3b3b3; font-size: 16px; line-height: 1.6;">${mainContent}</p>
                <div style="text-align: center; margin: 35px 0;">
                    <span style="display: inline-block; background-color: rgba(243, 104, 149, 0.1); border: 2px dashed #F36895; color: #F36895; font-size: 38px; font-weight: bold; letter-spacing: 12px; padding: 15px 35px; border-radius: 8px;">
                        ${otp}
                    </span>
                </div>
                <div style="background-color: rgba(255, 193, 7, 0.1); border-left: 4px solid #ffc107; padding: 15px; border-radius: 0 8px 8px 0; margin-bottom: 25px;">
                    <p style="color: #ffc107; font-size: 14px; margin: 0; line-height: 1.5;">
                        <strong>⚠️ Lưu ý bảo mật:</strong> ${note}
                    </p>
                </div>
                <hr style="border: none; border-top: 1px solid #3f3f4e; margin: 30px 0;">
                <p style="color: #666666; font-size: 12px; text-align: center; margin: 0; line-height: 1.5;">
                    Đây là email tự động từ hệ thống OtonashiRei.<br>Vui lòng không trả lời email này.
                </p>
            </div>
        </div>
    </div>`;
}

// ================= HÀM ĐỒNG BỘ MANIFEST =================
function syncManifest() {
    try {
        const files = fs.readdirSync(MODS_DIR);
        const actualModFiles = files.filter(file => path.extname(file).toLowerCase() === '.jar');
        const SERVER_IP = process.env.SERVER_IP || "127.0.0.1";
        const SERVER_PORT = process.env.SERVER_PORT || 25565;
        let manifest = { version: "26.1.2", loader: "Fabric", loader_version: "0.19.2", server_ip: SERVER_IP, server_port: SERVER_PORT, mods: actualModFiles };
        fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
    } catch (error) { console.error('❌ Lỗi đồng bộ manifest:', error.message); }
}
syncManifest();

// ================= EMAIL & DATABASE =================
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const db = new sqlite3.Database('./database.sqlite');
db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE, username TEXT UNIQUE, email TEXT UNIQUE, password TEXT, reset_otp TEXT, reset_otp_expiry INTEGER)`);

const dbGet = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this) }));

// ================= API ENDPOINTS =================

app.get('/auth/server-info', (req, res) => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    res.json({ success: true, ...manifest, totalMods: manifest.mods.length });
});

app.post('/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        if (await dbGet('SELECT * FROM users WHERE username = ? OR email = ?', [username, email])) return res.json({ success: false, message: 'Tài khoản/Email đã tồn tại!' });
        await dbRun('INSERT INTO users (uuid, username, email, password) VALUES (?, ?, ?, ?)', [uuidv4(), username, email, await bcrypt.hash(password, 10)]);
        res.json({ success: true, message: 'Đăng ký thành công!' });
    } catch (err) { res.json({ success: false, message: 'Lỗi server!' }); }
});

app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || !(await bcrypt.compare(password, user.password))) return res.json({ success: false, message: 'Sai tài khoản/mật khẩu!' });
        res.json({ success: true, token: 'fake-token', username: user.username, uuid: user.uuid });
    } catch (err) { res.json({ success: false, message: 'Lỗi server!' }); }
});

// FORGOT PASSWORD
app.post('/auth/forgot-password', async (req, res) => {
    const { username, email } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ? AND email = ?', [username, email]);
        if (!user) return res.json({ success: false, message: 'Thông tin không khớp!' });
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await dbRun('UPDATE users SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?', [otp, Date.now() + 15 * 60 * 1000, user.id]);
        await transporter.sendMail({
            from: `"OtonashiRei MC Server" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '🔑 Mã OTP Khôi Phục',
            html: generateEmailTemplate('Khôi phục mật khẩu', username, 'Đây là mã OTP để đặt lại mật khẩu:', otp, 'Có hiệu lực 15 phút.')
        });
        res.json({ success: true, message: 'OTP đã gửi!' });
    } catch (err) { res.status(500).json({ success: false, message: 'Lỗi gửi mail!' }); }
});

app.post('/auth/reset-password', async (req, res) => {
    const { username, otp, newPassword } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || user.reset_otp !== otp) return res.json({ success: false, message: 'OTP sai!' });
        await dbRun('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(newPassword, 10), user.id]);
        res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
    } catch (err) { res.json({ success: false, message: 'Lỗi server!' }); }
});

// PROFILE API
app.post('/auth/change-password', async (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || !(await bcrypt.compare(oldPassword, user.password))) return res.json({ success: false, message: 'Mật khẩu cũ sai!' });
        await dbRun('UPDATE users SET password = ? WHERE id = ?', [await bcrypt.hash(newPassword, 10), user.id]);
        res.json({ success: true, message: 'Đổi mật khẩu thành công!' });
    } catch (err) { res.json({ success: false, message: 'Lỗi server!' }); }
});

app.post('/auth/request-email-change', async (req, res) => {
    const { username, newEmail } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await dbRun('UPDATE users SET reset_otp = ?, reset_otp_expiry = ? WHERE id = ?', [otp, Date.now() + 15 * 60 * 1000, user.id]);
        await transporter.sendMail({
            from: `"OtonashiRei MC Server" <${process.env.EMAIL_USER}>`,
            to: newEmail,
            subject: '✉️ Xác minh thay đổi Email',
            html: generateEmailTemplate('Xác minh thay đổi Email', username, 'Đây là mã OTP để xác nhận Email mới:', otp, 'Mã này chỉ có hiệu lực 15 phút.')
        });
        res.json({ success: true, message: 'OTP đã gửi!' });
    } catch (err) { res.status(500).json({ success: false, message: 'Lỗi gửi mail!' }); }
});

app.post('/auth/change-email', async (req, res) => {
    const { username, newEmail, otp } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ? AND reset_otp = ?', [username, otp]);
        if (!user) return res.json({ success: false, message: 'OTP sai!' });
        await dbRun('UPDATE users SET email = ?, reset_otp = NULL WHERE id = ?', [newEmail, user.id]);
        res.json({ success: true, message: 'Đổi Email thành công!' });
    } catch (err) { res.json({ success: false, message: 'Lỗi server!' }); }
});

app.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));