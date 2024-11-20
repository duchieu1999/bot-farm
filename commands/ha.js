const mongoose = require('mongoose');

// Import model Trasua
const Trasua = mongoose.model('Trasua');

module.exports = (bot) => {
    bot.onText(/\/ha(homnay|homqua)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const command = match[1];

        // Xác định ngày cần lấy
        let targetDate = new Date();
        let dateLabel = '';

        if (command === 'homqua') {
            targetDate.setDate(targetDate.getDate() - 1);
            dateLabel = 'HÔM QUA';
        } else if (command === 'homnay') {
            dateLabel = 'HÔM NAY';
        }

        const formattedDate = targetDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });

        // Định nghĩa thông tin nhóm
        const groupNames = {
            "-1002247863313": "NHÓM HÀ 11H30 -14H-19H30-21H:",
            "-1002303292016": "NHÓM HÀ 11H30, 19H30:",
            "-1002499533124": "NHÓM HÀ PANLEN:"
        };

        // Kiểm tra nếu groupId tồn tại trong danh sách
        if (!groupNames.hasOwnProperty(chatId.toString())) {
            bot.sendMessage(chatId, "Nhóm này chưa được cấu hình để hiển thị bảng công.");
            return;
        }

        // Lấy dữ liệu bảng công chỉ của nhóm hiện tại
        const bangCongList = await Trasua.find({
            groupId: chatId,
            date: targetDate.toLocaleDateString()
        });

        if (bangCongList.length === 0) {
            bot.sendMessage(chatId, `Chưa có bảng công nào được ghi nhận trong ${dateLabel.toLowerCase()}.`);
            return;
        }

        // Tạo tin nhắn phản hồi
        let responseMessage = `BẢNG CÔNG ${dateLabel} - ${formattedDate}\n\n`;
        responseMessage += `${groupNames[chatId.toString()]}\n`;
        let totalMoney = 0;

        bangCongList.forEach(entry => {
            responseMessage += `${entry.ten}: ${entry.acc} Acc ${entry.tinh_tien.toLocaleString()} VNĐ\n`;
            totalMoney += entry.tinh_tien;
        });

        responseMessage += `Tổng tiền: ${totalMoney.toLocaleString()} VNĐ\n`;

        // Gửi tin nhắn
        bot.sendMessage(chatId, responseMessage);
    });
};
