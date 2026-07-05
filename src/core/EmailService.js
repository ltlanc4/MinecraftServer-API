const { createTransport } = require('nodemailer');

class EmailService {
    /**
     * Khởi tạo dịch vụ gửi Email
     */
    constructor() {
        this.transporter = createTransport({
            service: 'gmail',
            auth: { 
                user: process.env.EMAIL_USER, 
                pass: process.env.EMAIL_PASS 
            }
        });
    }

    /**
     * Tạo giao diện HTML cho Email
     * @param {string} title - Tiêu đề chính trong nội dung mail
     * @param {string} username - Tên người dùng
     * @param {string} mainContent - Nội dung diễn giải
     * @param {string} otp - Mã OTP 6 số
     * @param {string} note - Dòng lưu ý bảo mật (chữ vàng)
     * @returns {string} Chuỗi HTML hoàn chỉnh
     */
    generateTemplate(title, username, mainContent, otp, note) {
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
                </div>
            </div>
        </div>`;
    }

    /**
     * Thực hiện gửi Email
     * @param {string} to - Địa chỉ email người nhận
     * @param {string} subject - Tiêu đề Email
     * @param {string} htmlContent - Nội dung HTML của Email
     * @returns {Promise<any>}
     */
    async sendMail(to, subject, htmlContent) {
        return this.transporter.sendMail({
            from: `"OtonashiRei MC Server" <${process.env.EMAIL_USER}>`,
            to: to,
            subject: subject,
            html: htmlContent
        });
    }
}

module.exports = { EmailService };