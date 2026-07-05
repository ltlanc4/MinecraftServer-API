const { Server } = require('ws');

class WebSocketManager {
    /**
     * Khởi tạo máy chủ WebSocket
     * @param {Server} httpServer - Thể hiện của HTTP Server để đính kèm WebSocket
     */
    constructor(httpServer) {
        this.wss = new Server({ server: httpServer });
        this.initEvents();
    }

    /**
     * Lắng nghe sự kiện kết nối của Client
     */
    initEvents() {
        this.wss.on('connection', (ws) => {
            console.log('🔌 [WebSocket] Một Game Client vừa kết nối thành công!');
        });
    }

    /**
     * Phát sóng tín hiệu (Broadcast) yêu cầu tải lại Skin đến toàn bộ các máy trạm
     * @param {string} username - Tên người chơi vừa đổi Skin
     */
    broadcastSkinUpdate(username) {
        const payload = JSON.stringify({ action: 'update_skin', username: username });
        this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
        console.log(`📢 [WebSocket] Phát sóng lệnh tải lại Skin cho: ${username}`);
    }
}

module.exports = { WebSocketManager };