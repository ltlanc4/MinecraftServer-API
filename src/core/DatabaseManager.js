const { Database } = require('sqlite3').verbose();

class DatabaseManager {
    /**
     * Khởi tạo trình quản lý cơ sở dữ liệu
     * @param {string} dbPath - Đường dẫn đến file SQLite (VD: './database.sqlite')
     */
    constructor(dbPath) {
        this.db = new Database(dbPath);
        this.initTables();
    }

    /**
     * Tạo bảng nếu chưa tồn tại
     */
    initTables() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT, 
                uuid TEXT UNIQUE, 
                username TEXT UNIQUE, 
                email TEXT UNIQUE, 
                password TEXT, 
                reset_otp TEXT, 
                reset_otp_expiry INTEGER
            )
        `);
    }

    /**
     * Truy vấn lấy một dòng dữ liệu (SELECT)
     * @param {string} sql - Câu lệnh SQL
     * @param {Array} params - Mảng các tham số truyền vào câu lệnh
     * @returns {Promise<any>}
     */
    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
        });
    }

    /**
     * Thực thi câu lệnh (INSERT, UPDATE, DELETE)
     * @param {string} sql - Câu lệnh SQL
     * @param {Array} params - Mảng các tham số truyền vào câu lệnh
     * @returns {Promise<any>}
     */
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function (err) {
                err ? reject(err) : resolve(this);
            });
        });
    }
}

module.exports = { DatabaseManager };