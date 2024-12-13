const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const moment = require('moment-timezone');
const request = require('request');
const schedule = require('node-schedule');
const cron = require('node-cron'); // Thư viện để thiết lập cron jobs
const keep_alive = require('./keep_alive.js');
const { resetDailyGiftStatus, sendMorningMessage, handleGiftClaim } = require('./gift');
const { setupNewsSchedule, sendLatestNews } = require('./news.js');

// Kết nối tới MongoDB
mongoose.connect(
  'mongodb+srv://duchieufaryoung0:80E9gUahdOXmGKuy@cluster0.6nlv1cv.mongodb.net/telegram_bot_db?retryWrites=true&w=majority',
  { useNewUrlParser: true, useUnifiedTopology: true }
);
const db = mongoose.connection;

// Định nghĩa schema cho bảng công
const BangCongSchema = new mongoose.Schema({
  userId: Number,
  groupId: Number,
  date: Date,
  ten: String,
  quay: Number,
  keo: Number,
  bill: Number,
  anh: Number,
  tinh_tien: Number,
  da_tru: { type: Boolean, default: false },
  giftWon: { type: Boolean, default: false },
  prizeAmount: { type: Number, default: 0 },
  processedMessageIds: { type: [Number], default: [] }, // Thêm trường mới
  nhan_anh_bill: { type: Number, default: 0 } // Ensure default is 0
});

// Define the schema and model for Trasua
const trasuaSchema = new mongoose.Schema({
  userId: { type: Number, required: true }, // ID người dùng
  groupId: { type: Number, required: true }, // ID nhóm
  date: { type: String, required: true }, // Ngày ghi nhận
  ten: { type: String, required: true }, // Tên người dùng
  acc: { type: Number, default: 0 }, // Tổng số acc
  post: { type: Number, default: 0 }, // Tổng số bài đăng
  tinh_tien: { type: Number, default: 0 }, // Tổng tiền (gồm acc và bài đăng)
  caData: { // Chi tiết số acc theo từng ca
    Ca1: { type: Number, default: 0 }, // Acc trong Ca 1 (10h00)
    Ca2: { type: Number, default: 0 }, // Acc trong Ca 2 (12h00)
    Ca3: { type: Number, default: 0 }, // Acc trong Ca 3 (15h00)
    Ca4: { type: Number, default: 0 }, // Acc trong Ca 4 (18h30)
    Ca5: { type: Number, default: 0 }, // Acc trong Ca 5 (20h00)
  },
}, { minimize: false, timestamps: true }); // Timestamps thêm vào để dễ dàng quản lý thời gian

const Trasua = mongoose.model('Trasua', trasuaSchema);


//Định nghĩa schema cho thành viên
const MemberSchema = new mongoose.Schema({
  userId: { type: Number, unique: true },
  fullname: String,
  level: Number,
  previousQuay: Number,
  previousKeo: Number,
  levelPercent: Number,
  exp: { type: Number, default: 0 },
  consecutiveDays: { type: Number, default: 0 },
  lastSubmissionDate: { type: Date, default: null },
  lastConsecutiveUpdate: { type: Date, default: null }, // Thêm trường này
  assets: {
    quay: Number,
    keo: Number,
    vnd: Number
  },
  hasInteracted: { type: Boolean, default: false } // New field to track interaction
});

// Định nghĩa schema cho tin nhắn
const MessageSchema = new mongoose.Schema({
  messageId: Number,
  userId: Number,
  chatId: Number,
  text: String,
  date: { type: Date, default: Date.now }
});

// Định nghĩa schema cho nhiệm vụ hàng ngày
const DailyTaskSchema = new mongoose.Schema({
  userId: Number,
  date: Date,
  quayTask: Number,
  keoTask: Number,
  billTask: Number,
  completedQuay: { type: Boolean, default: false },
  completedKeo: { type: Boolean, default: false },
  completedBill: { type: Boolean, default: false }
  
});

// Add this to your schema definitions
const VipCardSchema = new mongoose.Schema({
  userId: Number,
  issueDate: { type: Date, default: Date.now },
  type: { type: String, enum: ['level_up', 'week', 'month'], required: true },
  validFrom: { type: Date, required: true },
  validUntil: { type: Date, required: true },
  expBonus: { type: Number, required: true },
  keoBonus: { type: Number, required: true },
  quayBonus: { type: Number, required: true },
  keoLimit: { type: Number, required: true },
  quayLimit: { type: Number, required: true }
});

// Create a model from the schema
const VipCard = mongoose.model('VipCard', VipCardSchema);

// Tạo model từ schema
const BangCong2 = mongoose.model('BangCong2', BangCongSchema);

// Định nghĩa schema cho trạng thái hàng ngày
const DailyGiftStatusSchema = new mongoose.Schema({
  date: String,
  dailyGiftClaims: [Number], // Danh sách các user đã nhận quà
  giftWonToday: { type: Boolean, default: false },
});

const DailyGiftStatus = mongoose.model('DailyGiftStatus', DailyGiftStatusSchema);
//Tạo model từ schema
const Member = mongoose.model('Member', MemberSchema);
const Message = mongoose.model('Message', MessageSchema);
const DailyTask = mongoose.model('DailyTask', DailyTaskSchema);

const token = '7150645082:AAH-N2VM6qx3iFEhK59YHx2e1oy3Bi1EzXc';
const url = 'https://bot-farm-twjg.onrender.com'; // URL của webhook
const port = process.env.PORT || 3000;


// Khởi tạo bot với chế độ webhook
const bot = new TelegramBot(token, { webHook: { port: port } });
// Thiết lập webhook của bạn
bot.setWebHook(`${url}/bot${token}`);

// Khởi tạo express server
const app = express();
app.use(bodyParser.json());

// Định nghĩa route cho webhook
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});


// Hàm để tự động load các file từ thư mục
function loadFiles() {
    // Load từ thư mục commands
    const commandsPath = path.join(__dirname, 'commands');
    if (fs.existsSync(commandsPath)) {
        fs.readdirSync(commandsPath).forEach((file) => {
            if (file.endsWith('.js')) {
                const filePath = path.join(commandsPath, file);
                const command = require(filePath);
                command(bot);
            }
        });
    }

// Load từ thư mục handlers
    const handlersPath = path.join(__dirname, 'handlers');
    if (fs.existsSync(handlersPath)) {
        fs.readdirSync(handlersPath).forEach((file) => {
            if (file.endsWith('.js')) {
                const filePath = path.join(handlersPath, file);
                const handler = require(filePath);
                handler(bot);
            }
        });
    }
}

// Gọi hàm để tải tất cả các file
loadFiles();

// Chuỗi cấmm
const bannedStringsRegex = /(ca\s?1|ca1|ca\s?2|Ca\s?2|Ca\s?1|Ca1|Ca\s?2|Ca2|C1|C2|c\s?1|c\s?2|C\s?1|C\s?2)\s*/gi;

// Thiết lập cron job để xóa dữ liệu bảng công của 2 ngày trước, ngoại trừ bảng công có groupId -1002108234982
cron.schedule('0 0 * * *', async () => {
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 4);
  const formattedTwoDaysAgo = new Date(twoDaysAgo.toLocaleDateString());

  try {
    const result = await BangCong2.deleteMany({
      date: formattedTwoDaysAgo,
      groupId: { $ne: -1002108234982 }, // Loại trừ các bảng công với groupId này
    });
    console.log(`Đã xóa ${result.deletedCount} bảng công của ngày ${formattedTwoDaysAgo.toLocaleDateString()}`);
  } catch (error) {
    console.error("Lỗi khi xóa dữ liệu từ MongoDB:", error);
  }
});

// Hàm để xóa các thẻ VipCard đã hết hiệu lực
const deleteExpiredVipCards = async () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  await VipCard.deleteMany({ validUntil: { $lt: now } });
  console.log('Đã xóa các thẻ VIP đã hết hiệu lực.');
};

// Thiết lập công việc cron để chạy lúc 0h mỗi ngày
cron.schedule('0 0 * * *', deleteExpiredVipCards);


// Thiết lập cron job để xóa dữ liệu DailyTask của những ngày trước đó
cron.schedule('0 0 * * *', async () => {
  const currentDate = new Date().setHours(0, 0, 0, 0);

  try {
    const result = await DailyTask.deleteMany({
      $or: [
        { date: { $lt: currentDate } },
        { date: { $exists: false } }
      ]
    });
    console.log(`Đã xóa ${result.deletedCount} nhiệm vụ hàng ngày trước ngày ${new Date(currentDate).toLocaleDateString()}`);
  } catch (error) {
    console.error("Lỗi khi xóa dữ liệu từ MongoDB:", error);
  }
});



    




const accRegex3 = /xong\s*(\d+)\s*acc\s*(\d+)\s*nhóm/i;

// Đăng ký sự kiện cho bot
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Chỉ kiểm tra nếu là nhóm có ID
  if (chatId == -1002303292016) {

    // Kiểm tra nếu tin nhắn chứa từ khóa "xong (số) acc (số) nhóm"
    const messageContent = msg.text || msg.caption;
    if (messageContent && /xong\s*\d+\s*acc\s*\d+\s*nhóm/gi.test(messageContent)) {
      await processAccMessage3(msg); // Gọi hàm xử lý tin nhắn
    }
  }
});

async function processAccMessage3(msg) {
  const messageContent = msg.text || msg.caption;
  const accMatches = messageContent.match(accRegex3);
  const userId = msg.from.id;
  const groupId = msg.chat.id;

  if (!accMatches) return;

  const acc = parseInt(accMatches[1]);  // Số acc
  const groups = parseInt(accMatches[2]);  // Số nhóm

  // Nếu số acc lớn hơn 100, gửi thông báo nghịch linh tinh và không xử lý tiếp
  if (acc > 100) {
    bot.sendMessage(groupId, 'Nộp gian lận là xấu tính 😕', { reply_to_message_id: msg.message_id });
    return;
  }

   // Tính tiền dựa trên số nhóm
  let moneyPerAcc = 0;
  if (groups === 1) {
    moneyPerAcc = 2000;
  } else if (groups === 2) {
    moneyPerAcc = 4000;
  } else if (groups >= 3) {
    moneyPerAcc = 6000;
  } else {
    // Nếu số nhóm không hợp lệ, gửi thông báo lỗi
    bot.sendMessage(groupId, 'Số nhóm phải từ 1 đến 3 thôi nhé! 😅', { reply_to_message_id: msg.message_id });
    return;
  }

  // Tính tổng tiền
  let totalMoney = acc * moneyPerAcc;

  const currentDate = new Date().toLocaleDateString();
  const firstName = msg.from.first_name;
  const lastName = msg.from.last_name;
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  const randomEmoji = getRandomEmoji();
  const responseMessage = `Bài nộp của ${fullName} đã được ghi nhận với ${acc} Acc, ${groups} nhóm. Tổng tiền: ${totalMoney.toLocaleString()} VNĐ ${randomEmoji}🥳`;

  bot.sendMessage(groupId, responseMessage, { reply_to_message_id: msg.message_id }).then(async () => {
    let trasua = await Trasua.findOne({ userId, groupId, date: currentDate });

    if (!trasua) {
      trasua = await Trasua.create({
        userId,
        groupId,
        date: currentDate,
        ten: fullName,
        acc,
        tinh_tien: totalMoney,
      });
    } else {
      trasua.acc += acc;
      trasua.tinh_tien += totalMoney;
      await trasua.save();
    }
  });
}




// Đăng ký sự kiện cho bot
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Chỉ kiểm tra nếu là nhóm có ID
  if (chatId == -1002322022623) {

    // Kiểm tra nếu tin nhắn chứa từ khóa "xong (số) acc (số) nhóm"
    const messageContent = msg.text || msg.caption;
    if (messageContent && /xong\s*\d+\s*acc\s*\d+\s*nhóm/gi.test(messageContent)) {
      await processAccMessage10(msg); // Gọi hàm xử lý tin nhắn
    }
  }
});

async function processAccMessage10(msg) {
  const messageContent = msg.text || msg.caption;
  const accMatches = messageContent.match(accRegex5);
  const userId = msg.from.id;
  const groupId = msg.chat.id;

  if (!accMatches) return;

  const acc = parseInt(accMatches[1]);  // Số acc
  const groups = parseInt(accMatches[2]);  // Số nhóm

  // Nếu số acc lớn hơn 100, gửi thông báo nghịch linh tinh và không xử lý tiếp
  if (acc > 100) {
    bot.sendMessage(groupId, 'Nộp gian lận là xấu tính 😕', { reply_to_message_id: msg.message_id });
    return;
  }

   // Tính tiền dựa trên số nhóm
  let moneyPerAcc = 0;
  if (groups <= 3) {
    moneyPerAcc = 5000;
  } else if (groups === 4) {
    moneyPerAcc = 7000;
  } else if (groups === 5) {
    moneyPerAcc = 10000;
  } 
    else {
    // Nếu số nhóm khôn8g hợp lệ, gửi thông báo lỗi
    bot.sendMessage(groupId, 'Số nhóm phải từ 1 đến 3 thôi nhé! 😅', { reply_to_message_id: msg.message_id });
    return;
    }

    // Tính tổng tiền
  let totalMoney = acc * moneyPerAcc;

  const currentDate = new Date().toLocaleDateString();
  const firstName = msg.from.first_name;
  const lastName = msg.from.last_name;
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  const randomEmoji = getRandomEmoji();
  const responseMessage = `Bài nộp của ${fullName} đã được ghi nhận với ${acc} Acc, ${groups} nhóm. Tổng tiền: ${totalMoney.toLocaleString()} VNĐ ${randomEmoji}🥳`;

  bot.sendMessage(groupId, responseMessage, { reply_to_message_id: msg.message_id }).then(async () => {
    let trasua = await Trasua.findOne({ userId, groupId, date: currentDate });

    if (!trasua) {
      trasua = await Trasua.create({
        userId,
        groupId,
        date: currentDate,
        ten: fullName,
        acc,
        tinh_tien: totalMoney,
      });
    } else {
      trasua.acc += acc;
      trasua.tinh_tien += totalMoney;
      await trasua.save();
    }
  });
}


const accRegex5 = /xong\s*(\d+)\s*acc\s*(\d+)\s*nhóm/i;

// Đăng ký sự kiện cho bot
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Chỉ kiểm tra nếu là nhóm có ID
  if (chatId == -1002499533124) {

    // Kiểm tra nếu tin nhắn chứa từ khóa "xong (số) acc (số) nhóm"
    const messageContent = msg.text || msg.caption;
    if (messageContent && /xong\s*\d+\s*acc\s*\d+\s*nhóm/gi.test(messageContent)) {
      await processAccMessage5(msg); // Gọi hàm xử lý tin nhắn
    }
  }
});

async function processAccMessage5(msg) {
  const messageContent = msg.text || msg.caption;
  const accMatches = messageContent.match(accRegex5);
  const userId = msg.from.id;
  const groupId = msg.chat.id;

  if (!accMatches) return;

  const acc = parseInt(accMatches[1]);  // Số acc
  const groups = parseInt(accMatches[2]);  // Số nhóm

  // Nếu số acc lớn hơn 100, gửi thông báo nghịch linh tinh và không xử lý tiếp
  if (acc > 100) {
    bot.sendMessage(groupId, 'Nộp gian lận là xấu tính 😕', { reply_to_message_id: msg.message_id });
    return;
  }

   // Tính tiền dựa trên số nhóm
  let moneyPerAcc = 0;
  if (groups === 1) {
    moneyPerAcc = 3000;
  } else if (groups === 2) {
    moneyPerAcc = 5000;
  } else if (groups === 3) {
    moneyPerAcc = 7000;
  } 
    else if (groups === 5) {
    moneyPerAcc = 10000;
  } else {
    // Nếu số nhóm không hợp lệ, gửi thông báo lỗi
    bot.sendMessage(groupId, 'Số nhóm phải từ 1 đến 3 thôi nhé! 😅', { reply_to_message_id: msg.message_id });
    return;
  }

  // Tính tổng tiền
  let totalMoney = acc * moneyPerAcc;

  const currentDate = new Date().toLocaleDateString();
  const firstName = msg.from.first_name;
  const lastName = msg.from.last_name;
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  const randomEmoji = getRandomEmoji();
  const responseMessage = `Bài nộp của ${fullName} đã được ghi nhận với ${acc} Acc, ${groups} nhóm. Tổng tiền: ${totalMoney.toLocaleString()} VNĐ ${randomEmoji}🥳`;

  bot.sendMessage(groupId, responseMessage, { reply_to_message_id: msg.message_id }).then(async () => {
    let trasua = await Trasua.findOne({ userId, groupId, date: currentDate });

    if (!trasua) {
      trasua = await Trasua.create({
        userId,
        groupId,
        date: currentDate,
        ten: fullName,
        acc,
        tinh_tien: totalMoney,
      });
    } else {
      trasua.acc += acc;
      trasua.tinh_tien += totalMoney;
      await trasua.save();
    }
  });
}


//nhóm 5 ngày
const accRegex4 = /(\d+).*?acc/i; // Regex chỉ tìm số acc mà không cần từ "xong"
const billRegex4 = /(\d+).*?bill/i; // Regex tìm số bill

// Đăng ký sự kiện cho bot
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Chỉ kiểm tra nếu là nhóm có ID
  if (chatId == -1002312409314) {

    // Kiểm tra nếu tin nhắn chứa từ khóa "(số) acc" hoặc "(số) bill"
    const messageContent = msg.text || msg.caption;
    if (messageContent) {
      if (accRegex4.test(messageContent) || billRegex4.test(messageContent)) {
        await processAccMessage4(msg); // Gọi hàm xử lý tin nhắn
      } else {
        // Báo lỗi cú pháp
        bot.sendMessage(chatId, 'Bạn nộp sai cú pháp, hãy ghi đúng như sau: Số Acc làm, số Bill lên. Ví dụ: 1 acc 1 bill hoặc 1 acc', { reply_to_message_id: msg.message_id });
      }
    }
  }
});

async function processAccMessage4(msg) {
  const messageContent = msg.text || msg.caption;
  const accMatches = messageContent.match(accRegex4);
  const billMatches = messageContent.match(billRegex4);
  const userId = msg.from.id;
  const groupId = msg.chat.id;

  let acc = 0;
  let bill = 0;

  if (accMatches) {
    acc = parseInt(accMatches[1]); // Lấy số acc từ nhóm bắt được
  }
  
  if (billMatches) {
    bill = parseInt(billMatches[1]); // Lấy số bill từ nhóm bắt được
  }

  // Nếu số acc lớn hơn 20, gửi thông báo nghịch linh tinh và không xử lý tiếp
  if (acc > 30) {
    bot.sendMessage(groupId, 'Nộp gian lận là xấu tính 😕', { reply_to_message_id: msg.message_id });
    return;
  }

  const currentDate = new Date().toLocaleDateString();
  const firstName = msg.from.first_name;
  const lastName = msg.from.last_name;
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  let totalMoney = acc * 2500; // Tính tiền cho số Acc
  let billMoney = bill * 2000; // Tính tiền cho số Bill
  totalMoney += billMoney; // Cộng tiền từ bill vào tổng tiền

  const randomEmoji = getRandomEmoji();
  const responseMessage = `Bài nộp của ${fullName} đã được ghi nhận với ${acc} Acc và ${bill} Bill đang chờ kiểm tra ${randomEmoji}🥳`;

  bot.sendMessage(groupId, responseMessage, { reply_to_message_id: msg.message_id }).then(async () => {
    let trasua = await Trasua.findOne({ userId, groupId, date: currentDate });

    if (!trasua) {
      trasua = await Trasua.create({
        userId,
        groupId,
        date: currentDate,
        ten: fullName,
        acc,
        bill,
        tinh_tien: totalMoney,
      });
    } else {
      trasua.acc += acc;
      trasua.bill += bill;
      trasua.tinh_tien += totalMoney;
      await trasua.save();
    }
  });
}






// Regex để tìm số acc và ca
const accRegex = /(\d+)\s*[^a-zA-Z\d]*acc\b/gi;
const caRegex = /ca\s*(11h30|13h30|15h|18h30|20h)/gi;

// Regex để tìm bài đăng (chỉ số và chữ "b" hợp lệ)
const postRegex = /^\s*(\d+)\s*[bB]\s*$/gi;

// Xử lý sự kiện tin nhắn
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Chỉ xử lý tin nhắn trong nhóm cụ thể
  if (chatId == -1002496228650) {
    const messageContent = msg.text || msg.caption;
    if (messageContent) {
      // Kiểm tra nếu tin nhắn chứa từ "bỏ"
      const containsBo = /bỏ/gi.test(messageContent);
      if (containsBo) {
        return; // Bỏ qua nếu chứa từ "bỏ"
      }

      // Tìm các khớp acc, ca và bài đăng
      const accMatches = [...messageContent.matchAll(accRegex)];
      const caMatches = [...messageContent.matchAll(caRegex)];
      const postMatches = [...messageContent.matchAll(postRegex)];

      if (accMatches.length > 0 && caMatches.length > 0) {
        await processAccSubmission(msg, accMatches, caMatches); // Xử lý nộp acc
      } else if (postMatches.length > 0) {
        await processPostSubmission(msg, postMatches); // Xử lý bài đăng
      } else {
        // Thông báo lỗi cú pháp
        
      }
    }
  }
});

// Hàm xử lý bài nộp số acc
async function processAccSubmission(msg, accMatches, caMatches) {
  const userId = msg.from.id;
  const groupId = msg.chat.id;
  const currentDate = new Date().toLocaleDateString();
  const firstName = msg.from.first_name || '';
  const lastName = msg.from.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();

  let caData = {}; // Lưu số acc theo từng ca
  let totalAcc = 0;

  // Xử lý từng khớp ca và acc
  caMatches.forEach((caMatch) => {
    const caHour = caMatch[1].toLowerCase();
    const caKey = mapCaHourToKey(caHour);
    const accCount = accMatches.length > 0 ? parseInt(accMatches[0][1]) : 0;

    totalAcc += accCount;
    caData[caKey] = (caData[caKey] || 0) + accCount;
  });

  // Kiểm tra giới hạn số acc
  if (totalAcc > 30) {
    bot.sendMessage(
      groupId,
      'Nộp gian lận là xấu tính 😕',
      { reply_to_message_id: msg.message_id }
    );
    return;
  }

  // Tính tiền
  const totalMoney = totalAcc * 5000;
  const formattedMoney = totalMoney.toLocaleString('vi-VN', {
    style: 'currency',
    currency: 'VND',
  });

  // Thông báo
  const randomEmoji = getRandomEmoji();
  const responseMessage = `Bài nộp của ${fullName} đã được ghi nhận với ${Object.entries(caData)
    .map(([ca, count]) => `${ca}: ${count} Acc`)
    .join(', ')} đang chờ kiểm tra ${randomEmoji}🥳. Tổng tiền: +${formattedMoney}`;
  bot.sendMessage(groupId, responseMessage, { reply_to_message_id: msg.message_id });

  // Cập nhật vào cơ sở dữ liệu
  let trasua = await Trasua.findOne({ userId, groupId, date: currentDate });
  if (!trasua) {
    trasua = await Trasua.create({
      userId,
      groupId,
      date: currentDate,
      ten: fullName,
      caData,
      acc: totalAcc,
      tinh_tien: totalMoney,
    });
  } else {
    trasua.acc += totalAcc;
    trasua.tinh_tien += totalMoney;

    trasua.caData = trasua.caData || {};
    for (let [ca, count] of Object.entries(caData)) {
      trasua.caData[ca] = (trasua.caData[ca] || 0) + count;
    }
    await trasua.save();
  }
}


// Hàm xử lý bài đăng
async function processPostSubmission(msg, postMatches) {
  const userId = msg.from.id;
  const groupId = msg.chat.id;
  const currentDate = new Date().toLocaleDateString();
  const firstName = msg.from.first_name || '';
  const lastName = msg.from.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim();

  let totalPosts = 0;

  // Tính tổng số bài đăng, chỉ nhận số đúng trước "b"
  postMatches.forEach((postMatch) => {
  const number = parseInt(postMatch[1], 10);
  if (!isNaN(number)) {
    totalPosts += number;
  }
});


  // Không ghi nhận nếu không có bài hợp lệ
  if (totalPosts === 0) {
    bot.sendMessage(groupId, '⛔ Tin nhắn không hợp lệ! Vui lòng chỉ gửi định dạng như "1b", "2b",...', {
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  const totalMoney = totalPosts * 1000; // Mỗi bài đăng = 1.000 VNĐ
  const formattedMoney = totalMoney.toLocaleString('vi-VN', {
    style: 'currency',
    currency: 'VND',
  });

  // Thông báo
  const randomEmoji = getRandomEmoji();
  const responseMessage = `Bài nộp của ${fullName} đã được ghi nhận với ${totalPosts} bài đăng đang chờ kiểm tra ${randomEmoji}🥳. Tổng tiền: +${formattedMoney}`;
  bot.sendMessage(groupId, responseMessage, { reply_to_message_id: msg.message_id });

  // Cập nhật vào cơ sở dữ liệu
  let trasua = await Trasua.findOne({ userId, groupId, date: currentDate });
  if (!trasua) {
    trasua = await Trasua.create({
      userId,
      groupId,
      date: currentDate,
      ten: fullName,
      post: totalPosts,
      tinh_tien: totalMoney,
    });
  } else {
    trasua.post = (trasua.post || 0) + totalPosts;
    trasua.tinh_tien += totalMoney;
    await trasua.save();
  }
}


// Hàm ánh xạ giờ thành khóa ca
function mapCaHourToKey(hour) {
  switch (hour) {
    case '11h30':
      return 'Ca1';
    case '13h30':
      return 'Ca2';
    case '15h':
      return 'Ca3';
    case '18h30':
      return 'Ca4';
    case '20h':
      return 'Ca5';
    default:
      return 'Unknown';
  }
}

function getRandomEmoji() {
  const emojis = ['❤️', '💖', '💙', '💜', '💕', '💚', '🧡', '🤍', '💔', '🩷'];
  return emojis[Math.floor(Math.random() * emojis.length)];
}









// Nhóm 5 ngày
const accRegex7 = /(\d+).*?acc/i; // Regex chỉ tìm số acc mà không cần từ "xong"

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Chỉ kiểm tra nếu là nhóm có ID
  if (chatId == -1002247863313) {
    // Lấy nội dung tin nhắn
    const messageContent = msg.text || msg.caption;

    if (messageContent) {
      // Kiểm tra nếu tin nhắn chứa từ "Xong" (không phân biệt hoa thường)
      if (/xong/i.test(messageContent)) {
        // Kiểm tra nếu tin nhắn chứa số acc hợp lệ
        if (accRegex7.test(messageContent)) {
          await processAccMessage7(msg); // Gọi hàm xử lý tin nhắn
        }
      }
    }
  }
});



async function processAccMessage7(msg) {
  const messageContent = msg.text || msg.caption;
  const accMatches = messageContent.match(accRegex7);
  const userId = msg.from.id;
  const groupId = msg.chat.id;

  let acc = 0;

  if (accMatches) {
    acc = parseInt(accMatches[1]); // Lấy số acc từ nhóm bắt được
  }

  // Nếu số acc lớn hơn 30, gửi thông báo nghịch linh tinh và không xử lý tiếp
  if (acc > 30) {
    bot.sendMessage(groupId, 'Nộp gian lận là xấu tính 😕', { reply_to_message_id: msg.message_id });
    return;
  }

  const currentDate = new Date().toLocaleDateString();
  const firstName = msg.from.first_name;
  const lastName = msg.from.last_name;
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  let totalMoney = acc * 4000; // Tính tiền cho số Acc
  const formattedMoney = totalMoney.toLocaleString('vi-VN', { style: 'currency', currency: 'VND' });

  const randomEmoji = getRandomEmoji();
  const responseMessage = `Bài nộp của ${fullName} đã được ghi nhận với ${acc} Acc đang chờ kiểm tra ${randomEmoji}🥳.\nTổng tiền: +${formattedMoney}`;

  bot.sendMessage(groupId, responseMessage, { reply_to_message_id: msg.message_id }).then(async () => {
    let trasua = await Trasua.findOne({ userId, groupId, date: currentDate });

    if (!trasua) {
      trasua = await Trasua.create({
        userId,
        groupId,
        date: currentDate,
        ten: fullName,
        acc,
        tinh_tien: totalMoney,
      });
    } else {
      trasua.acc += acc;
      trasua.tinh_tien += totalMoney;
      await trasua.save();
    }
  });
}






async function generateReport(bot, chatId, days) {
  const dates = [];
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    dates.push(date.toLocaleDateString());
  }

  const groupName = 'BẢNG CÔNG NHÓM 5K';
  const url = 'https://quickchart.io/graphviz?format=png&layout=dot&graph=';
  let grandTotal = 0;
  const memberSummary = {}; // Tổng hợp dữ liệu từng thành viên
  const dailyImages = [];

  for (const dateStr of dates) {
    const bangCongList = await Trasua.find({ groupId: -1002496228650, date: dateStr });

    if (bangCongList.length === 0) {
      bot.sendMessage(chatId, `Chưa có bảng công nào được ghi nhận trong ngày ${dateStr}.`);
      continue;
    }

    let totalAmount = 50000;

    let content = bangCongList.map(entry => {
      const { caData = {}, post = 0, acc = 0, tinh_tien, ten } = entry;
      const ca = [caData.Ca1, caData.Ca2, caData.Ca3, caData.Ca4, caData.Ca5].map(ca => ca > 0 ? ca : '-');
      
      // Cập nhật dữ liệu tổng hợp từng thành viên
      if (!memberSummary[ten]) {
        memberSummary[ten] = { acc: 0, posts: 0, total: 0 };
      }
      memberSummary[ten].acc += acc;
      memberSummary[ten].posts += post;
      memberSummary[ten].total += tinh_tien;

      return `${ten}\t${ca.join('\t')}\t${post > 0 ? post : '-'}\t${acc}\t${tinh_tien.toLocaleString()} vnđ`;
    }).join('\n');

    bangCongList.forEach(entry => {
      totalAmount += entry.tinh_tien;
    });

    grandTotal += totalAmount;

    const graph = `
      digraph G {
        node [shape=plaintext];
        a [label=<
          <TABLE BORDER="2" CELLBORDER="1" CELLSPACING="0" CELLPADDING="8" STYLE="font-family: 'Montserrat', sans-serif; border: 3px solid black;">
            <TR><TD COLSPAN="9" ALIGN="CENTER" BGCOLOR="#1976D2" STYLE="font-size: 26px; font-weight: bold; color: white;">${groupName}<FONT POINT-SIZE="20">${dateStr}</FONT></TD></TR>
            <TR STYLE="background-color: #2196F3; color: white; font-weight: bold;">
              <TD>Tên</TD><TD>CA 1</TD><TD>CA 2</TD><TD>CA 3</TD><TD>CA 4</TD><TD>CA 5</TD><TD>Bài Đăng</TD><TD>Tổng ACC</TD><TD>Tiền Công</TD>
            </TR>
            ${content.split('\n').map(line => `<TR><TD>${line.split('\t').join('</TD><TD>')}</TD></TR>`).join('')}
            <TR STYLE="background-color: #2196F3; color: white; font-weight: bold;">
              <TD COLSPAN="8" ALIGN="LEFT">Quản Lý</TD><TD>50,000 vnđ</TD>
            </TR>
            <TR STYLE="background-color: #1976D2; color: white; font-weight: bold;">
              <TD COLSPAN="8" ALIGN="LEFT">Tổng Số Tiền</TD><TD>${totalAmount.toLocaleString()} vnđ</TD>
            </TR>
          </TABLE>
        >];
      }
    `;

    const imageUrl = `${url}${encodeURIComponent(graph)}`;
    dailyImages.push({ dateStr, imageUrl, totalAmount });
  }

  for (const { dateStr, imageUrl } of dailyImages) {
    await bot.sendPhoto(chatId, imageUrl, {
      caption: `Bảng Công Nhóm "${groupName}" Ngày ${dateStr}`,
    });
  }

  // Bảng tổng kết tổng tiền
  const summaryContent = Object.entries(memberSummary)
    .map(([name, data]) => `<TR><TD>${name}</TD><TD>${data.acc}</TD><TD>${data.posts}</TD><TD>${data.total.toLocaleString()} vnđ</TD></TR>`)
    .join('');

  const totalGraph = `
    digraph G {
      node [shape=plaintext];
      a [label=<
        <TABLE BORDER="2" CELLBORDER="1" CELLSPACING="0" CELLPADDING="8" STYLE="font-family: 'Montserrat', sans-serif; border: 3px solid black;">
          <TR><TD COLSPAN="4" ALIGN="CENTER" BGCOLOR="#1976D2" STYLE="font-size: 24px; font-weight: bold; color: white;">Tổng Tiền ${days} Ngày</TD></TR>
          <TR STYLE="background-color: #2196F3; color: white; font-weight: bold;">
            <TD>Tên</TD><TD>Tổng ACC</TD><TD>Bài Đăng</TD><TD>Tổng Số Tiền</TD>
          </TR>
          ${summaryContent}
          <TR STYLE="background-color: #1976D2; color: white; font-weight: bold;">
            <TD COLSPAN="3" ALIGN="LEFT">Tổng Cộng</TD><TD>${grandTotal.toLocaleString()} vnđ</TD>
          </TR>
        </TABLE>
      >];
    }
  `;

  const totalImageUrl = `${url}${encodeURIComponent(totalGraph)}`;
  await bot.sendPhoto(chatId, totalImageUrl, {
    caption: `Tổng Kết Tiền Công Trong ${days} Ngày`,
  });
}

// Lệnh /333
bot.onText(/\/333/, async (msg) => {
  const chatId = msg.chat.id;
  await generateReport(bot, chatId, 3);
});

// Lệnh /444
bot.onText(/\/444/, async (msg) => {
  const chatId = msg.chat.id;
  await generateReport(bot, chatId, 4);
});


// Tạo menu chọn thành viên và chỉnh sửa ACC
bot.onText(/\/editacc/, async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Lấy danh sách thành viên độc nhất từ database
    const members = await Trasua.distinct('ten', { groupId: -1002496228650 });
    
    // Tạo keyboard với các nút chọn thành viên
    const keyboard = [];
    for (let i = 0; i < members.length; i += 2) {
      const row = [];
      row.push({ text: members[i], callback_data: `select_member:${members[i]}` });
      if (members[i + 1]) {
        row.push({ text: members[i + 1], callback_data: `select_member:${members[i + 1]}` });
      }
      keyboard.push(row);
    }

    await bot.sendMessage(chatId, 'Chọn thành viên cần chỉnh sửa ACC:', {
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    bot.sendMessage(chatId, 'Có lỗi xảy ra: ' + error.message);
  }
});

// Xử lý khi chọn thành viên
bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;

  if (data.startsWith('select_member:')) {
    const member = data.split(':')[1];
    
    // Lấy 7 ngày gần nhất
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      dates.push(date.toLocaleDateString());
    }

    // Tạo keyboard chọn ngày
    const dateKeyboard = dates.map(date => [{
      text: date,
      callback_data: `select_date:${member}:${date}`
    }]);

    await bot.editMessageText('Chọn ngày cần chỉnh sửa:', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: dateKeyboard
      }
    });
  }
  
  else if (data.startsWith('select_date:')) {
    const [, member, date] = data.split(':');
    
    // Tạo keyboard chọn ca
    const caKeyboard = [
      [
        { text: 'Ca 1', callback_data: `select_ca:${member}:${date}:1` },
        { text: 'Ca 2', callback_data: `select_ca:${member}:${date}:2` },
        { text: 'Ca 3', callback_data: `select_ca:${member}:${date}:3` }
      ],
      [
        { text: 'Ca 4', callback_data: `select_ca:${member}:${date}:4` },
        { text: 'Ca 5', callback_data: `select_ca:${member}:${date}:5` }
      ]
    ];

    await bot.editMessageText(`Chỉnh sửa ACC của ${member} ngày ${date}\nChọn ca cần chỉnh sửa:`, {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: caKeyboard
      }
    });
  }
  
  else if (data.startsWith('select_ca:')) {
    const [, member, date, ca] = data.split(':');
    
    // Lưu thông tin vào session để đợi người dùng nhập số ACC mới
    sessions[chatId] = { member, date, ca };
    
    await bot.editMessageText(
      `Chỉnh sửa ACC của ${member} ngày ${date} Ca ${ca}\n` +
      'Vui lòng nhập số ACC mới:',
      {
        chat_id: chatId,
        message_id: messageId
      }
    );
    
    // Chuyển bot sang chế độ đợi nhập ACC
    await bot.sendMessage(chatId, 'Nhập số ACC mới (chỉ nhập số):');
  }
});

// Xử lý nhập số ACC mới
const sessions = {};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // Kiểm tra xem có đang trong session chỉnh sửa ACC không
  if (sessions[chatId]) {
    const { member, date, ca } = sessions[chatId];
    
    // Kiểm tra input có phải là số không
    if (!/^\d+$/.test(text)) {
      return bot.sendMessage(chatId, 'Vui lòng chỉ nhập số!');
    }
    
    const newAcc = parseInt(text);
    
    try {
      // Tìm và cập nhật bảng công
      const bangCong = await Trasua.findOne({
        groupId: -1002496228650,
        date: date,
        ten: member
      });

      if (!bangCong) {
        return bot.sendMessage(chatId, 'Không tìm thấy bảng công phù hợp');
      }

      // Lưu giá trị cũ
      const oldAcc = bangCong.caData[`Ca${ca}`] || 0;

      // Cập nhật giá trị mới
      bangCong.caData[`Ca${ca}`] = newAcc;
      
      // Tính lại tổng ACC
      bangCong.acc = Object.values(bangCong.caData).reduce((sum, val) => sum + (val || 0), 0);
      
      // Tính lại tiền công
      bangCong.tinh_tien = bangCong.acc * 2000 + bangCong.post * 5000;

      await bangCong.save();

      // Lưu lịch sử chỉnh sửa
      await new EditHistory({
        bangCongId: bangCong._id,
        editedBy: msg.from.username,
        oldValue: oldAcc,
        newValue: newAcc,
        caNumber: parseInt(ca)
      }).save();

      // Xóa session
      delete sessions[chatId];

      // Hiển thị kết quả
      await bot.sendMessage(
        chatId,
        `Đã cập nhật ACC của ${member} ngày ${date} Ca ${ca}\n` +
        `ACC cũ: ${oldAcc} -> ACC mới: ${newAcc}\n` +
        `Tổng ACC mới: ${bangCong.acc}\n` +
        `Tiền công mới: ${bangCong.tinh_tien.toLocaleString()} VNĐ`
      );

      // Hiển thị lại bảng công
      await generateReport(bot, chatId, 1);

    } catch (error) {
      bot.sendMessage(chatId, 'Có lỗi xảy ra: ' + error.message);
    }
  }
});






async function generateSchedule(bot, chatId) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString();

  // Lấy bảng công của ngày hôm qua
  const bangCongList = await Trasua.find({ groupId: -1002496228650, date: yesterdayStr });

  if (bangCongList.length === 0) {
    return bot.sendMessage(chatId, `Không tìm thấy bảng công của ngày ${yesterdayStr}.`);
  }

  // Định nghĩa các khung giờ đăng bài theo các ca
const timeRanges = [
{ start: '11:30', end: '11:30' }, //tương ứng ca 1
{ start: '13:30', end: '14:30' }, //tương ứng ca 2
{ start: '15:30', end: '18:00' }, //tương ứng ca 3
{ start: '18:50', end: '19:30' }, //tương ứng ca 4
];

  // Chuyển đổi thời gian sang phút
  function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Chuyển đổi phút sang định dạng thời gian
  function minutesToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  // Tạo danh sách tất cả các khoảng thời gian có thể
  let allPossibleTimes = [];
  timeRanges.forEach(range => {
    let currentMinute = timeToMinutes(range.start);
    const endMinute = timeToMinutes(range.end);
    
    while (currentMinute < endMinute) {
      allPossibleTimes.push(minutesToTime(currentMinute));
      // Thêm random 10-20 phút
      currentMinute += Math.floor(Math.random() * 11) + 10; // 10-20 phút
    }
  });

  // Xáo trộn mảng thời gian
  allPossibleTimes = allPossibleTimes.sort(() => Math.random() - 0.5);

  // Tạo lịch đăng bài dựa trên số acc cao nhất của mỗi thành viên
 
  let timeIndex = 0;

  for (const member of bangCongList) {
    const { caData = {}, ten } = member;
    
    // Tìm số acc cao nhất trong các ca của thành viên
    const maxAcc = Math.max(
      caData.Ca1 || 0,
      caData.Ca2 || 0,
      caData.Ca3 || 0,
      caData.Ca4 || 0,
      caData.Ca5 || 0
    );

    // Nếu thành viên có acc > 0, phân bổ số bài đăng tương ứng
    if (maxAcc > 0) {
      for (let i = 0; i < maxAcc; i++) {
        if (timeIndex < allPossibleTimes.length) {
          schedule.push({
            member: ten,
            time: allPossibleTimes[timeIndex]
          });
          timeIndex++;
        }
      }
    }
  }

  // Sắp xếp lịch theo thời gian
  schedule.sort((a, b) => {
    const timeA = timeToMinutes(a.time);
    const timeB = timeToMinutes(b.time);
    return timeA - timeB;
  });

  // Tạo và gửi bảng phân công
  const graph = `
    digraph G {
      node [shape=plaintext];
      a [label=<
        <TABLE BORDER="2" CELLBORDER="1" CELLSPACING="0" CELLPADDING="8" STYLE="font-family: 'Montserrat', sans-serif; border: 3px solid black;">
          <TR><TD COLSPAN="2" ALIGN="CENTER" BGCOLOR="#1976D2" STYLE="font-size: 24px; font-weight: bold; color: white;">Lịch Đăng Bài ${today.toLocaleDateString()}</TD></TR>
          <TR STYLE="background-color: #2196F3; color: white; font-weight: bold;">
            <TD>Thời Gian</TD><TD>Thành Viên</TD>
          </TR>
          ${schedule.map(item => 
            `<TR><TD>${item.time}</TD><TD>${item.member}</TD></TR>`
          ).join('')}
        </TABLE>
      >];
    }
  `;

  const url = 'https://quickchart.io/graphviz?format=png&layout=dot&graph=';
  const imageUrl = `${url}${encodeURIComponent(graph)}`;
  
  // Gửi ảnh vào group với message_thread_id
  await bot.sendPhoto(-1002496228650, imageUrl, {
    caption: `Lịch Đăng Bài Ngày ${today.toLocaleDateString()}`,
    message_thread_id: 42
  });
}


cron.schedule('0 9 * * *', async () => {
  try {
    console.log('Đang tạo và gửi lịch đăng bài tự động...');
    await generateSchedule(bot, -1002496228650); // Gọi trực tiếp với groupId
    console.log('Đã gửi lịch đăng bài thành công!');
  } catch (error) {
    console.error('Lỗi khi gửi lịch đăng bài tự động:', error);
  }
}, {
  scheduled: true,
  timezone: "Asia/Ho_Chi_Minh" // Đặt múi giờ Việt Nam
});

// Lệnh /chiabill
bot.onText(/\/dangbai/, async (msg) => {
  const chatId = msg.chat.id;
  await generateSchedule(bot, chatId);
});






// ID của nhóm và thread
const groupId44 = -1002496228650;
const topicId44 = 10;

// Lắng nghe lệnh /chaonha
bot.onText(/\/chaonha/, (msg) => {
  // Kiểm tra xem lệnh có được gửi từ đúng nhóm không
  if (msg.chat.id === groupId44) {
    bot.sendMessage(
      groupId44,
      `👋 Chào mừng mọi người đến với topic này!`,
      {
        message_thread_id: topicId44 // Gửi vào thread cụ thể
      }
    ).then(() => {
      console.log('✅ Lời chào đã được gửi!');
    }).catch((error) => {
      console.error('❌ Lỗi khi gửi lời chào:', error);
    });
  } else {
    bot.sendMessage(msg.chat.id, `Lệnh này chỉ hoạt động trong nhóm cụ thể.`);
  }
});
      

bot.onText(/\/13h/, async (msg) => {
  const chatId = msg.chat.id;

  // Lấy ngày hôm trước
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const formattedDate = yesterday.toLocaleDateString();

  // Tìm các bản ghi bảng công có groupId -1002336524767 trong ngày hôm trước
  const bangCongList = await Trasua.find({ groupId: -1002336524767, date: formattedDate });
  if (bangCongList.length === 0) {
    bot.sendMessage(chatId, 'Chưa có bảng công nào được ghi nhận trong ngày hôm qua.');
    return;
  }

  // Chuẩn bị dữ liệu cho bảng công
  let totalAmount = 50000; // Tiền quản lý
  let content = bangCongList.map(entry => `${entry.ten}\t${entry.acc}\t${entry.tinh_tien.toLocaleString()} vnđ`).join('\n');
  
  // Tính tổng tiền công
  bangCongList.forEach(entry => {
    totalAmount += entry.tinh_tien;
  });

  // Chuẩn bị URL của QuickChart với cấu trúc bảng
  const groupName = 'LAN LAN 19H';
  const dateStr = formattedDate;
  const url = 'https://quickchart.io/graphviz?format=png&layout=dot&graph=';
  const graph = `
    digraph G {
      node [shape=plaintext];
      a [label=<
        <TABLE BORDER="1" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4" STYLE="font-family: 'Arial', sans-serif; border: 1px solid black;">
          <TR><TD COLSPAN="4" ALIGN="CENTER" BGCOLOR="#FFCC00" STYLE="font-size: 16px; font-weight: bold;">${groupName} - ${dateStr}</TD></TR>
          <TR STYLE="font-weight: bold; background-color: #FFCC00;">
            <TD ALIGN="CENTER">Tên</TD>
            <TD ALIGN="CENTER">Acc</TD>
            <TD ALIGN="CENTER">Tiền công</TD>
          </TR>
          ${content.split('\n').map(line => `<TR><TD ALIGN="LEFT" STYLE="font-weight: bold;">${line.split('\t').join('</TD><TD ALIGN="CENTER">')}</TD></TR>`).join('')}
          <TR STYLE="font-weight: bold;">
            <TD COLSPAN="2" ALIGN="LEFT">Quản lý</TD>
            <TD ALIGN="CENTER">50,000 vnđ</TD>
          </TR>
          <TR STYLE="font-weight: bold;">
            <TD COLSPAN="2" ALIGN="LEFT">Tổng số tiền</TD>
            <TD ALIGN="CENTER">${totalAmount.toLocaleString()} vnđ</TD>
          </TR>
        </TABLE>
      >];
    }
  `;
  
  const imageUrl = `${url}${encodeURIComponent(graph)}`;
  
  // Gửi ảnh bảng công qua bot
  bot.sendPhoto(chatId, imageUrl, {
    caption: `Bảng Công Nhóm "LAN LAN 19H" Hôm Qua - ${formattedDate}`,
  });
});





 // Lệnh /thom để hiển thị bảng công tổng
bot.onText(/\/13hlan/, async (msg) => {
  const chatId = msg.chat.id;

  // Lấy ngày hôm trước
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const formattedDate = yesterday.toLocaleDateString();

  // Tìm các bản ghi bảng công có groupId -1002163768880 trong ngày hôm trước
  const bangCongList = await Trasua.find({ groupId: -1002312409314, date: formattedDate });
  if (bangCongList.length === 0) {
    bot.sendMessage(chatId, 'Chưa có bảng công nào được ghi nhận trong ngày hôm qua.');
    return;
  }

  let responseMessage = `BẢNG CÔNG NHÓM "LAN LAN 19H" HÔM QUA- ${yesterday.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}\n\n`;
  let totalMoney = 0;

  bangCongList.forEach(entry => {
    responseMessage += `${entry.ten}: ${entry.acc} Acc ${entry.tinh_tien.toLocaleString()} VNĐ\n\n`;
    totalMoney += entry.tinh_tien;
  });

  responseMessage += `Tổng tiền: ${totalMoney.toLocaleString()} VNĐ`;

  bot.sendMessage(chatId, responseMessage);
});


bot.onText(/\/han(homnay|homqua)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const command = match[1]; // Lấy giá trị homnay hoặc homqua từ lệnh

  // Xác định ngày tương ứng với lệnh
  let targetDate = new Date();
  let dateLabel = '';

  if (command === 'homqua') {
    targetDate.setDate(targetDate.getDate() - 1);
    dateLabel = 'HÔM QUA';
  } else if (command === 'homnay') {
    dateLabel = 'HÔM NAY';
  }

  const formattedDate = targetDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });

  // Tìm các bản ghi bảng công theo groupId
  const groupIds = [-1002397067352, -1002192201870, -1002295387259];
  
  let responseMessage = `BẢNG CÔNG NHÓM ZALO HÂN ${dateLabel} - ${formattedDate}\n\n`;
  let hasData = false;

  // Duyệt qua từng groupId
  for (const groupId of groupIds) {
    // Tìm dữ liệu bảng công theo groupId và ngày tương ứng
    const bangCongList = await Trasua.find({ groupId: groupId, date: targetDate.toLocaleDateString() });

    if (bangCongList.length > 0) {
      hasData = true;
      
      // Lấy thông tin tên nhóm từ Telegram
      let groupInfo;
      try {
        groupInfo = await bot.getChat(groupId);
      } catch (error) {
        console.error(`Không thể lấy thông tin nhóm cho groupId ${groupId}`, error);
        continue;
      }

      let groupName = groupInfo.title || `Nhóm ${groupId}`;
      responseMessage += `\n${groupName}\n`;

      let totalMoney = 0;
      
      // Hiển thị thông tin bảng công cho từng entry
      bangCongList.forEach(entry => {
        responseMessage += `${entry.ten}: ${entry.acc} Acc ${entry.tinh_tien.toLocaleString()} VNĐ\n\n`;
        totalMoney += entry.tinh_tien;
      });

      responseMessage += `Tổng tiền: ${totalMoney.toLocaleString()} VNĐ\n\n`;
    }
  }

  if (!hasData) {
    bot.sendMessage(chatId, `Chưa có bảng công nào được ghi nhận trong ${dateLabel.toLowerCase()}.`);
  } else {
    bot.sendMessage(chatId, responseMessage);
  }
});


// Regex để bắt số acc và số tiền
const accRegex11 = /(\d+)\s*[^a-zA-Z\d]*acc\b/gi;  // Bắt số acc
const moneyRegex = /[+]?(\d+(?:[.,]\d{3})*)/gi; // Bắt số tiền, bỏ đơn vị tiền

bot.onText(/Bỏ/, async (msg) => {
  if (!msg.reply_to_message || !msg.reply_to_message.text) {
    bot.sendMessage(msg.chat.id, 'Hãy trả lời lệnh từ tin nhắn ghi nhận bài nộp của bot để có thể trừ được bài nộp.');
    return;
  }

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username;
  const replyText = msg.reply_to_message.text;

  // Tìm số acc trong tin nhắn
  const accMatches = [...replyText.matchAll(accRegex11)];
  if (accMatches.length === 0) {
    bot.sendMessage(chatId, 'Không tìm thấy thông tin số acc trong tin nhắn.');
    return;
  }
  const acc = parseInt(accMatches[0][1]);

  // Tìm số tiền trong tin nhắn và xử lý
  let tinh_tien = 0;
  const moneyMatches = replyText.match(moneyRegex);
  if (moneyMatches) {
    // Lấy số cuối cùng trong danh sách (thường là tổng tiền)
    const moneyStr = moneyMatches[moneyMatches.length - 1];
    // Loại bỏ dấu phân cách hàng nghìn và chuyển thành số
    tinh_tien = parseInt(moneyStr.replace(/[.,]/g, ''));
  } else {
    bot.sendMessage(chatId, 'Không tìm thấy thông tin số tiền trong tin nhắn.');
    return;
  }

  // Tìm tên người dùng
  const tenMatch = replyText.match(/Bài nộp của ([^đ]+) đã được/);
  if (!tenMatch) {
    bot.sendMessage(chatId, 'Không tìm thấy tên người dùng trong tin nhắn.');
    return;
  }
  const ten = tenMatch[1].trim();

  // Lấy ngày từ tin nhắn của bot và định dạng
  const messageDate = new Date(msg.reply_to_message.date * 1000);
  const formattedDate = `${messageDate.getMonth() + 1}/${messageDate.getDate()}/${messageDate.getFullYear()}`;

  try {
    const regex = new RegExp(normalizeName(ten).split('').join('.*'), 'i');

    const trasua = await Trasua.findOne({
      groupId: chatId,
      ten: { $regex: regex },
      date: formattedDate
    });

    if (!trasua) {
      bot.sendMessage(chatId, `Không tìm thấy bản ghi để cập nhật cho ${ten}.`);
      return;
    }

    // Cập nhật bản ghi
    trasua.acc -= acc;
    trasua.tinh_tien -= tinh_tien;

    // Lưu bản ghi đã cập nhật
    await trasua.save();

    bot.sendMessage(chatId, `Trừ thành công cho ${ten}: Acc: -${acc}, Tiền: -${tinh_tien.toLocaleString()} VNĐ`);
  } catch (error) {
    console.error('Lỗi khi cập nhật dữ liệu:', error);
    bot.sendMessage(chatId, 'Đã xảy ra lỗi khi cập nhật dữ liệu.');
  }
});




bot.onText(/\/123456/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    // Xóa tất cả bản ghi có groupId tương ứng
    await Trasua.deleteMany({ groupId: chatId });

    bot.sendMessage(chatId, 'Đã xóa toàn bộ dữ liệu bảng công từ nhóm này.');
  } catch (error) {
    console.error('Lỗi khi xóa dữ liệu:', error);
    bot.sendMessage(chatId, 'Đã xảy ra lỗi khi xóa dữ liệu.');
  }
});


    
const addRegex = /thêm/i;
const bayNhomRegex = /bay\s*nhóm/i;
// Updated regex to handle mixed characters and special formats
const regex = /(\d+\s*(?:[qc()+]|quẩy|cộng|bill|ảnh|hình|video))/gi;

const EXCLUDED_CHAT_IDS = [
  -1002103270166, -1002397067352, -1002312409314, -1002496228650,
  -1002336524767, -1002295387259, -1002128975957, -1002322022623,
  -1002247863313, -1002192201870, -1002499533124,
  -1002303292016, -1002128975957
];

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  if (!EXCLUDED_CHAT_IDS.includes(chatId)) {
    const messageContent = msg.text || msg.caption;

    if (messageContent && /[@\[\]\/]/.test(messageContent)) {
      return;
    }

    if (messageContent) {
      // Handle "bay nhóm" case
      if (bayNhomRegex.test(messageContent)) {
        await processSubmission(msg, msg);
        return;
      }

      const matches = messageContent.match(regex);
      
      if (matches) {
        // Clean and normalize the message content
        const cleanMessage = normalizeContent(matches.join(''));
        const cleanOriginalMessage = normalizeContent(messageContent);
        
        // Compare normalized versions
        if (cleanMessage === cleanOriginalMessage) {
          await processSubmission(msg, msg);
        }
      } else if (msg.reply_to_message && addRegex.test(messageContent)) {
        const repliedMessage = msg.reply_to_message;
        const repliedMessageContent = repliedMessage.text || repliedMessage.caption;

        const replyMatches = repliedMessageContent.match(regex);
        if (replyMatches) {
          const cleanRepliedMessage = normalizeContent(replyMatches.join(''));
          const cleanOriginalRepliedMessage = normalizeContent(repliedMessageContent);
          
          if (cleanRepliedMessage === cleanOriginalRepliedMessage) {
            await processSubmission(msg, repliedMessage);
          }
        }
      }
    }
  }
});

function normalizeContent(content) {
  return content
    .toLowerCase()
    .replace(/\s+/g, '') // Remove spaces
    .replace(/[(),]/g, '') // Remove parentheses and commas
    .replace(/quẩy/g, 'q')
    .replace(/cộng/g, 'c')
    .replace(/\+/g, 'c');
    
}




async function processSubmission(msg, targetMsg) {
  const messageContent = targetMsg.text || targetMsg.caption;
  const matches = messageContent.match(regex);
  const userId = targetMsg.from.id;
  const groupId = targetMsg.chat.id;

  let quay = 0;
  let keo = 0;
  let bill = 0;
  let anh = 0;
  let video = 0; // Thêm biến video

  if (matches) {
    matches.forEach((match) => {
      const numberMatch = match.match(/\d+/); // Lấy số từ match
      const suffix = match.replace(/\d+\s*/, '').toLowerCase(); // Lấy từ loại

      if (numberMatch) { // Đảm bảo có số trong match
        const number = parseInt(numberMatch[0]);

        if (suffix === 'q' || suffix === 'quẩy') {
          quay += number;
        } else if (suffix === 'c' || suffix === 'cộng' || suffix === '+') {
          keo += number;
        } else if (suffix === 'bill') {
          bill += number;
        } else if (suffix === 'ảnh' || suffix === 'hình') {
          anh += number;
        } else if (suffix === 'video') { // Kiểm tra nếu là video
          video += number;
        }
      }
    });
  }

  const targetDate = new Date(targetMsg.date * 1000).toLocaleDateString();
  const submissionTime = new Date(targetMsg.date * 1000).toLocaleTimeString();
  const firstName = targetMsg.from.first_name;
  const lastName = targetMsg.from.last_name;
  const fullName = lastName ? `${firstName} ${lastName}` : firstName;

  // Xác định giá dựa trên groupId
  let pricePerQuay = 500;
  let pricePerKeo = 1000;
  let pricePerBill = 3000;
  let pricePerAnh = 3000;
  let pricePerVideo = 10000;

  // Tính giá keo dựa trên groupId
  switch (groupId) {
    case -1002186698265:
    case -1002300392959:
    case -1002350493572:
    case -1002259135527:
      pricePerKeo = 1500;
      break;
    case -1002360155473:
      pricePerKeo = 500;
      pricePerQuay = 1000;
      pricePerBill = 1500;
      pricePerAnh = 1500;
      break;
    case -1002113921526:
    case -1002230199552:
    case -1002449707024:
    case -1002479414582:
    case -1002168066817:
    case -1002278963130:
    case -1002392685048:
      pricePerKeo = 2000;
      break;
    case -1002129896837:
    case -1002457468797:
    case -1002383656659:
      pricePerKeo = 1000;
      pricePerQuay = 350;
      break;   
    default:
      pricePerKeo = 1000;
      pricePerQuay = 500;
  }

  const totalMoney = (quay * pricePerQuay) + (keo * pricePerKeo) + (bill * pricePerBill) + (anh * pricePerAnh) + (video * pricePerVideo);

  const randomEmoji = getRandomEmoji();
  const responseMessage = `Bài nộp của ${fullName} đã được ghi nhận với ${quay} quẩy, ${keo} cộng, ${bill} bill, ${anh} ảnh vào ngày ${targetDate} lúc ${submissionTime} đang chờ kiểm tra ${randomEmoji}🥳. Tổng tiền: +${totalMoney.toLocaleString()} VNĐ`;

  bot.sendMessage(groupId, responseMessage, { reply_to_message_id: msg.message_id }).then(async () => {
    let bangCong = await BangCong2.findOne({ userId, groupId, date: targetDate, submissionTime });

    if (!bangCong) {
      bangCong = await BangCong2.create({
        userId,
        groupId,
        date: targetDate,
        submissionTime,
        ten: fullName,
        quay,
        keo,
        bill,
        anh,
        video,
        tinh_tien: totalMoney,
        da_tru: false // Đánh dấu bài nộp ban đầu là chưa bị trừ
      });
    } else {
      bangCong.quay += quay;
      bangCong.keo += keo;
      bangCong.bill += bill;
      bangCong.anh += anh;
      bangCong.video += video;
      bangCong.tinh_tien += totalMoney;

      const member = await Member.findOne({ userId });
      // Tính toán hệ số giảm exp dựa trên levelPercent
      let expMultiplier = 1;
      if (member.levelPercent >= 100) {
        expMultiplier = 0.1; // Giảm còn 20% exp khi levelPercent >= 90%
      } else if (member.levelPercent >= 70) {
        expMultiplier = 0.4; // Giảm còn 40% exp khi levelPercent >= 70%
      } else if (member.levelPercent >= 50) {
        expMultiplier = 0.6; // Giảm còn 60% exp khi levelPercent >= 50%
      } else if (member.levelPercent >= 30) {
        expMultiplier = 0.8; // Giảm còn 80% exp khi levelPercent >= 30%
      }

      // Tính exp với hệ số giảm
      const baseExp = Math.floor(totalMoney / 400);
      const adjustedExp = Math.floor(baseExp * expMultiplier);
      member.exp += adjustedExp;

      member.levelPercent += Math.floor(adjustedExp / 10);

      await bangCong.save();
      await member.save();
    }

    await updateLevelPercent(userId);
    await updateMissionProgress(userId);
  });
}





      

const allowedGroupIds = [
  -1002230199552, -1002360155473, -1002246062598, -1002392685048, -1002457468797, -1002383656659, -1002168066817, -1002449707024, -1002479414582, -1002160116020, -1002259135527, -1002349272974, -1002312409314, -1002439441449, -1002178207739, -1002235474314, -1002186698265, -1002205826480,
  -1002311358141, -1002360155473, -1002317530934, -1002278963130, -1002481836552, -1002245725621, -1002350493572, -1002300392959, -1002113921526, -1002243393101, -1002311651580
];

bot.onText(/\/lan/, async (msg) => {
  const chatId = msg.chat.id;
  await sendAggregatedData2(chatId);
});

async function sendAggregatedData2(chatId) {
  try {
    // Tính ngày hôm qua
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1); // Điều chỉnh ngày hiện tại
    const startOfYesterday = new Date(yesterday.setHours(0, 0, 0, 0));
    const endOfYesterday = new Date(yesterday.setHours(23, 59, 59, 999));

    // Lấy bảng công của ngày hôm qua cho các nhóm trong allowedGroupIds
    const bangCongs = await BangCong2.find({
      date: { $gte: startOfYesterday, $lte: endOfYesterday },
      groupId: { $in: allowedGroupIds }, // Chỉ bao gồm các nhóm trong allowedGroupIds
    });

    if (bangCongs.length === 0) {
      bot.sendMessage(chatId, `Không có bảng công nào cho ngày ${yesterday.toLocaleDateString()}.`);
      return;
    }

    // Tạo bảng công phân loại theo ID nhóm và tính tổng tiền của mỗi thành viên
    const groupedByGroupId = {};
    const totalByMember = {}; // Tổng tiền của từng thành viên

    bangCongs.forEach((bangCong) => {
      const groupId = bangCong.groupId ? bangCong.groupId.toString() : '';
      if (!groupedByGroupId[groupId]) {
        groupedByGroupId[groupId] = [];
      }
      groupedByGroupId[groupId].push(bangCong);

      // Cộng dồn tổng tiền cho mỗi thành viên từ các nhóm
      if (bangCong.ten && bangCong.tinh_tien !== undefined) {
        if (!totalByMember[bangCong.ten]) {
          totalByMember[bangCong.ten] = 0;
        }
        totalByMember[bangCong.ten] += bangCong.tinh_tien;
      }
    });

    let response = '';

    // Tạo bảng công cho mỗi nhóm
    for (const groupId in groupedByGroupId) {
      if (!groupId) {
        continue;
      }

      const groupData = groupedByGroupId[groupId];

      // Lấy thông tin nhóm từ Telegram API
      let groupName;
      try {
        const chatInfo = await bot.getChat(groupId);
        groupName = chatInfo.title || `Nhóm ${groupId}`;
      } catch (error) {
        console.error(`Không thể lấy thông tin nhóm ${groupId}:`, error);
        groupName = `Nhóm ${groupId}`;
      }

      response += `Bảng công nhóm ${groupName} (${yesterday.toLocaleDateString()}):\n\n`;

      let totalGroupMoney = 0;
      let totalBills = 0;
      let totalImages = 0;

      groupData.forEach((bangCong) => {
        if (bangCong.tinh_tien !== undefined) {
          const formattedTien = bangCong.tinh_tien.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

          // Hiển thị số bill và ảnh chỉ khi chúng có giá trị lớn hơn 0
          let billInfo = '';
          let imageInfo = '';

          if (bangCong.bill > 0) {
            billInfo = `${bangCong.bill} bill\t`;
          }

          if (bangCong.anh > 0) {
            imageInfo = `${bangCong.anh} ảnh\t`;
          }

          response += `${bangCong.ten}\t\t${billInfo}${imageInfo}${bangCong.quay}q +\t${bangCong.keo}c\t${formattedTien}vnđ\n`;

          totalGroupMoney += bangCong.tinh_tien;
          totalBills += bangCong.bill;
          totalImages += bangCong.anh;
        }
      });

      const formattedTotal = totalGroupMoney.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      response += `Tổng tiền: ${formattedTotal}vnđ\n`;
      response += `Tổng bill: ${totalBills}\n`;
      response += `Tổng ảnh: ${totalImages}\n\n`;
    }

    // Tổng tiền của từng thành viên từ tất cả các nhóm
    response += `\nTổng tiền của từng thành viên từ tất cả các nhóm:\n`;
    for (const member in totalByMember) {
      const formattedTotalMember = totalByMember[member].toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      response += `${member}: ${formattedTotalMember}vnđ\n`;
    }

    // Kiểm tra độ dài response và gửi tin nhắn
    if (response.length > 4000) {
      const middle = Math.floor(response.length / 2);
      const splitIndex = response.lastIndexOf('\n', middle);

      const firstPart = response.substring(0, splitIndex).trim();
      const secondPart = response.substring(splitIndex).trim();

      bot.sendMessage(chatId, firstPart);
      bot.sendMessage(chatId, secondPart);
    } else {
      bot.sendMessage(chatId, response.trim());
    }
  } catch (error) {
    console.error('Lỗi khi truy vấn dữ liệu từ MongoDB:', error);
    bot.sendMessage(chatId, 'Đã xảy ra lỗi khi truy vấn dữ liệu từ cơ sở dữ liệu.');
  }
}

    

// Chức năng tự động gửi hình ảnh vào 9h sáng mỗi ngày (theo giờ Việt Nam)
cron.schedule('30 1 * * *', async () => { // 2 giờ UTC là 9 giờ sáng theo giờ Việt Nam
  const chatId = '-1002103270166';
  await processAndDistributeOtherTimesheets(chatId);
});



// Object to hold management fees for each groupId
const managementFees = {
  '-1002230199552': 100000,
  '-1002178207739': 50000,
  '-1002205826480': 50000, 
  '-1002235474314': 70000,
  '-1002360155473': 80000,
  '-1002457468797': 50000,
  '-1002168066817': 100000, 
  '-1002383656659': 50000, 
  "-1002392685048": 100000,
  '-1002311651580': 50000, 
  '-1002449707024': 70000, 
  '-1002186698265': 75000,
  '-1002439441449': 80000, 
  '-1002278963130': 100000,
  '-1002317530934': 50000,
  '-1002360155473': 80000,
  '-1002246062598': 50000,
  '-1002350493572': 75000,
  '-1002311358141': 50000,
  '-1002245725621': 50000,
  '-1002479414582': 90000, 
  '-1002481836552': 80000, 
  '-1002300392959': 75000,
  '-1002113921526': 90000,
  '-1002243393101': 50000,
  '-1002349272974': 80000, 
  '-1002259135527': 75000,
  '-1002160116020': 50000 
};

async function processAndDistributeTimesheets(chatId, isToday) {
 const targetDate = isToday ? new Date() : new Date(Date.now() - 86400000); // Today or Yesterday
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);
  const dateStr = `${targetDate.getDate()}/${targetDate.getMonth() + 1}/${targetDate.getFullYear()}`;


try {
    let totalAmountByUser = {}; // Đối tượng để lưu tổng số tiền của mỗi người dùng

    for (const groupId of allowedGroupIds) {
      const bangCongs = await BangCong2.find({
        date: { $gte: startOfDay, $lte: endOfDay },
        groupId: groupId
      });

      if (bangCongs.length === 0) {
        continue;
      }

      let totalAmount = 0;
      let content = bangCongs.map(bangCong => {
        totalAmount += bangCong.tinh_tien;
        totalAmountByUser[bangCong.ten] = (totalAmountByUser[bangCong.ten] || 0) + bangCong.tinh_tien;
        return `${bangCong.ten}\t${bangCong.quay}\t${bangCong.keo}\t${bangCong.bill || 0}\t${bangCong.anh || 0}\t${bangCong.tinh_tien}vnđ`;
      }).join('\n');

      // Add management fee for the groupId
      const managementFee = managementFees[groupId] || 0;
      totalAmount += managementFee;

      // Append management fee to the content
      content += `\nQuản lý\t-\t-\t-\t-\t${managementFee}vnđ`;

      const groupName = await fetchGroupTitle(groupId);
      const imageUrl = await generateTimesheetImage(content, groupName, totalAmount, dateStr);
      await bot.sendPhoto(chatId, imageUrl);
    }

    let totalAmountContent = '';
    for (const [userName, totalAmount] of Object.entries(totalAmountByUser)) {
      totalAmountContent += `<TR><TD ALIGN="LEFT" STYLE="font-weight: bold;">${userName}</TD><TD ALIGN="CENTER">${totalAmount}vnđ</TD></TR>`;
    }
    const totalAmountImageUrl = await generateSummaryImage(totalAmountContent, dateStr);
    await bot.sendPhoto(chatId, totalAmountImageUrl);

    if (!isToday) {
      const messages = [
        `Attention, attention! Bảng công (${dateStr}) nóng hổi vừa ra lò, ai chưa check điểm danh là lỡ mất cơ hội "ăn điểm" với sếp đó nha!`,
        `Bảng công (${dateStr}) - Phiên bản "limited edition", hãy nhanh tay "sưu tầm" trước khi hết hàng! ‍♀️‍♂️`,
      ];
      const randomMessage = messages[Math.floor(Math.random() * messages.length)];
      const message = await bot.sendMessage(chatId, randomMessage);
      await bot.pinChatMessage(chatId, message.message_id);
    }
  } catch (error) {
    console.error('Lỗi khi truy vấn dữ liệu từ MongoDB:', error);
    bot.sendMessage(chatId, 'Failed to create image.');
  }
}


async function generateTimesheetImage(content, groupName, totalAmount, dateStr) {
  const url = 'https://quickchart.io/graphviz?format=png&layout=dot&graph=';
  const graph = `
    digraph G {
      node [shape=plaintext];
      a [label=<
        <TABLE BORDER="1" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4" STYLE="font-family: 'Arial', sans-serif; border: 1px solid black;">
          <TR><TD COLSPAN="6" ALIGN="CENTER" BGCOLOR="#FFCC00" STYLE="font-size: 16px; font-weight: bold;">${groupName} - ${dateStr}</TD></TR>
          <TR STYLE="font-weight: bold; background-color: #FFCC00;">
            <TD ALIGN="CENTER">Tên</TD>
            <TD ALIGN="CENTER">Quẩy</TD>
            <TD ALIGN="CENTER">Cộng</TD>
            <TD ALIGN="CENTER">Bill</TD>
            <TD ALIGN="CENTER">Ảnh</TD>
            <TD ALIGN="CENTER">Tiền công</TD>
          </TR>
          ${content.split('\n').map(line => `<TR><TD ALIGN="LEFT" STYLE="font-weight: bold;">${line.split('\t').join('</TD><TD ALIGN="CENTER">')}</TD></TR>`).join('')}
          <TR STYLE="font-weight: bold;">
            <TD COLSPAN="3" ALIGN="LEFT">Tổng số tiền</TD>
            <TD ALIGN="CENTER">${totalAmount}vnđ</TD>
            <TD COLSPAN="2"></TD>
          </TR>
        </TABLE>
      >];
    }
  `;
  const imageUrl = `${url}${encodeURIComponent(graph)}`;
  return imageUrl;
}

async function generateSummaryImage(content, dateStr) {
  const url = 'https://quickchart.io/graphviz?format=png&layout=dot&graph=';
  const graph = `
    digraph G {
      node [shape=plaintext];
      a [label=<
        <TABLE BORDER="1" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4" STYLE="font-family: 'Arial', sans-serif; border: 1px solid black;">
          <TR><TD COLSPAN="2" ALIGN="CENTER" BGCOLOR="#FFCC00" STYLE="font-size: 16px; font-weight: bold;">Tổng số tiền của từng thành viên từ tất cả các nhóm ${dateStr}</TD></TR>
          ${content}
        </TABLE>
      >];
    }
  `;
  const imageUrl = `${url}${encodeURIComponent(graph)}`;
  return imageUrl;
}

async function fetchGroupTitle(groupId) {
  try {
    const chat = await bot.getChat(groupId);
    return chat.title;
  } catch (error) {
    console.error(`Error getting group name for ${groupId}:`, error);
    return `Nhóm ${groupId}`;
  }
}


bot.onText(/\/bangconglan/, async (msg) => {
  const chatId = msg.chat.id;
  await processAndDistributeTimesheets(chatId, false);
});

bot.onText(/\/homnaylan/, async (msg) => {
  const chatId = msg.chat.id;
  await processAndDistributeTimesheets(chatId, true);
});


bot.onText(/\/bangconghieu/, async (msg) => {
  const chatId = msg.chat.id;
  await processAndDistributeOtherTimesheets(chatId);
});

async function processAndDistributeOtherTimesheets(chatId) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfYesterday = new Date(yesterday);
  startOfYesterday.setHours(0, 0, 0, 0);
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);
  const dateStr = `${yesterday.getDate()}/${yesterday.getMonth() + 1}/${yesterday.getFullYear()}`;

  try {
    let totalAmountByUser = {}; // Đối tượng để lưu tổng số tiền của mỗi người dùng

    // Fetch all unique groupIds from the database
    const allGroupIds = await BangCong2.distinct('groupId', {
      date: { $gte: startOfYesterday, $lte: endOfYesterday }
    });

    // Filter out the allowedGroupIds
    const otherGroupIds = allGroupIds.filter(id => !allowedGroupIds.includes(id));

    for (const groupId of otherGroupIds) {
      const bangCongs = await BangCong2.find({
        date: { $gte: startOfYesterday, $lte: endOfYesterday },
        groupId: groupId
      });

      if (bangCongs.length === 0) {
        continue;
      }

      let totalAmount = 0;
      let content = bangCongs.map(bangCong => {
        totalAmount += bangCong.tinh_tien;
        totalAmountByUser[bangCong.ten] = (totalAmountByUser[bangCong.ten] || 0) + bangCong.tinh_tien;
        return `${bangCong.ten}\t${bangCong.quay}\t${bangCong.keo}\t${bangCong.bill || 0}\t${bangCong.anh || 0}\t${bangCong.tinh_tien}vnđ`;
      }).join('\n');

      const groupName = await fetchGroupTitle(groupId);
      const imageUrl = await generateTimesheetImage(content, groupName, totalAmount, dateStr);
      await bot.sendPhoto(chatId, imageUrl);
    }

    let totalAmountContent = '';
    for (const [userName, totalAmount] of Object.entries(totalAmountByUser)) {
      totalAmountContent += `<TR><TD ALIGN="LEFT" STYLE="font-weight: bold;">${userName}</TD><TD ALIGN="CENTER">${totalAmount}vnđ</TD></TR>`;
    }
    const totalAmountImageUrl = await generateSummaryImage(totalAmountContent, dateStr);
    await bot.sendPhoto(chatId, totalAmountImageUrl);

    const message = await bot.sendMessage(chatId, `Bảng công các nhóm khác (${dateStr}) đã được tạo và gửi thành công!`);
    await bot.pinChatMessage(chatId, message.message_id);
  } catch (error) {
    console.error('Lỗi khi truy vấn dữ liệu từ MongoDB:', error);
    bot.sendMessage(chatId, 'Failed to create images for other groups.');
  }
}





bot.onText(/\/tonghieu/, async (msg) => {
    const chatId = msg.chat.id;

    // Yêu cầu người dùng nhập số ngày
    const promptMessage = await bot.sendMessage(chatId, 'Hãy nhập số ngày muốn xem tổng bảng công (mặc định là 3 ngày):', {
        reply_markup: {
            force_reply: true,
        },
    });

    bot.onReplyToMessage(chatId, promptMessage.message_id, async (response) => {
        let numDays = parseInt(response.text.trim());
        if (isNaN(numDays) || numDays <= 0) {
            numDays = 3; // Mặc định nếu nhập sai hoặc không nhập
        }
        await processTotalTimesheet(chatId, numDays);
    });
});

async function processTotalTimesheet(chatId, numDays) {
    const today = new Date();
    const startDate = new Date();
    startDate.setDate(today.getDate() - numDays);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date();
    endDate.setDate(today.getDate() - 1);
    endDate.setHours(23, 59, 59, 999);

    try {
        let totalAmountByUser = {};

        // Lấy danh sách groupId
        const allGroupIds = await BangCong2.distinct('groupId', {
            date: { $gte: startDate, $lte: endDate },
        });

        // Loại bỏ groupId thuộc allowedGroupIds
        const filteredGroupIds = allGroupIds.filter(groupId => !allowedGroupIds.includes(groupId));

        for (const groupId of filteredGroupIds) {
            const bangCongs = await BangCong2.find({
                date: { $gte: startDate, $lte: endDate },
                groupId: groupId,
            });

            for (const bangCong of bangCongs) {
                totalAmountByUser[bangCong.ten] = (totalAmountByUser[bangCong.ten] || 0) + bangCong.tinh_tien;
            }
        }

        let totalAmountContent = '';
        for (const [userName, totalAmount] of Object.entries(totalAmountByUser)) {
            totalAmountContent += `<TR><TD ALIGN="LEFT" STYLE="font-weight: bold;">${userName}</TD><TD ALIGN="CENTER">${totalAmount}vnđ</TD></TR>`;
        }

        const dateRangeStr = `từ ${startDate.getDate()}/${startDate.getMonth() + 1}/${startDate.getFullYear()} đến ${endDate.getDate()}/${endDate.getMonth() + 1}/${endDate.getFullYear()}`;
        const totalAmountImageUrl = await generateSummaryImage(totalAmountContent, dateRangeStr);

        await bot.sendPhoto(chatId, totalAmountImageUrl);
        bot.sendMessage(chatId, `Tổng bảng công trong ${numDays} ngày qua đã được gửi thành công.`);
    } catch (error) {
        console.error('Lỗi khi xử lý tổng bảng công:', error);
        bot.sendMessage(chatId, 'Không thể tạo bảng tổng hợp. Vui lòng thử lại sau.');
    }
}





       
const kickbot = {
  "-1002039100507": "CỘNG ĐỒNG NẮM BẮT CƠ HỘI",
  "-1002308892005": "tet", 
  "-1002004082575": "Hội Nhóm",
  "-1002360155473": "dkdkk",
  "-1002457468797": "dososo",
  "-1002383656659": "idodw", 
  "-1002333438294": "erefeff",
  "-1002496228650": "djfdkf",
  "-1002123430691": "DẪN LỐI THÀNH CÔNG",
  "-1002143712364": "CÙNG NHAU CHIA SẺ",
  "-1002246062598": "guyi",
  "-1002278963130": "gugugu",
  "-1002122969493": "ugugi",
  "-1002094623131": "GUGID",
  "-1002317530934": "yuighu",
  "-1002360155473": "bgkir",
  "-1002128975957": "HƯỚNG TỚI TƯƠNG LAI",
  "-1002080535296": "TRAO ĐỔI CÔNG VIỆC 2",
  "-1002091101362": "TRAO ĐỔI CÔNG VIỆC 1", 
  "-1002129896837": "GROUP I MẠNH ĐỨC CHIA SẺ", 
  "-1002228252389": "ORMARKET community",
  "-1002103270166": "Tổng bank",
  "-1002128289933": "test",
  "-1002479414582": "ei292", 
  "-1002499533124": "ekfrek",
  "-1002449707024": "19dkfkw", 
  "-1002392685048": "hjjj",
  "-1002108234982": "community free",
  "-1002163768880": "tra sua",
  "-1002179104664": "Diễn đàn khởi nghiệp",
  "-1002198923074": "LÀM GIÀU CÙNG NHAU",
  "-1002208226506": "ABC",
  "-1002155928492": "acb",
  "-1002311651580": "lan lan 19h 18", 
  "-1002187729317": "sisiso",
  "-1002303292016": "ha",
  "-1002247863313": "thom",
  "-1002397067352": "han1",
  "-1002192201870": "han2",
  "-1002168066817": "dkdkdk", 
  "-1002295387259": "han3", 
  // Thêm các groupId mới
  "-1002230199552": "12h-19h 2k 1k/c 500đ/q bill 2k qli 100",
  "-1002178207739": "12-19h15 1k/c 500đ/q bill 3k Qli 50",
  "-1002350493572": "lan", 
  "-1002160116020": "lan39",
  "-1002259135527": "lan2829",
  "-1002349272974": "lancoa2", 
  "-1002481836552": "lan19h", 
  "-1002336524767": "lan 13h", 
  "-1002312409314": "17h50 lan", 
  "-1002205826480": "lan 11h15", 
  "-1002439441449": "lan 11h 13h 19h", 
  "-1002235474314": "11h30-19h30 1k/c 500đ/q bill 3k Qli 70",
  "-1002186698265": "10h45-19h45 11h-19h 1.5k/c 500đ/q bill 3k ảnh 2k qli 75",
  "-1002311358141": "13h10 1k/c 500d /q bill 3k Qli 50",
  "-1002245725621": "11h45-19h45 1k/c 500d /q bill 3k qli 50",
  "-1002300392959": "Combo giờ lam 1.5k/c 500đ/q bill 3k Qli 75",
  "-1002113921526": "11h-15h30-19h20 500/c bill 3k 500d/q qli 90",
  "-1002322022623": "erefieifier",
  "-1002243393101": "12h30-20h 1k/c 500đ/q Bill 3k qli 50"
};                                       
          
// Bảng tra cứu tên nhóm dựa trên ID nhóm
const groupNames = {
  "-1002039100507": "CỘNG ĐỒNG NẮM BẮT CƠ HỘI",
  "-1002004082575": "NÂNG CAO ĐỜI SỐNG",
  "-1002123430691": "DẪN LỐI THÀNH CÔNG",
  "-1002143712364": "CHIA SẺ KINH NGHIỆM",
  "-1002128975957": "HƯỚNG TỚI TƯƠNG LAI",
  "-1002080535296": "CÙNG NHAU CHIA SẺ",
  "-1002091101362": "TRAO ĐỔI CÔNG VIỆC 1", 
  "-1002129896837": "GROUP I MẠNH ĐỨC CHIA SẺ", 
  "-1002228252389": "CHIA SẺ NẮM BẮT CƠ HỘI",
  "-1002179104664": "Diễn đàn khởi nghiệp",
  "-1002198923074": "LÀM GIÀU CÙNG NHAU" 
};


// Tự động xóa bảng công từ 2 ngày trước vào 0h mỗi ngày
cron.schedule('0 0 * * *', async () => {
  await deleteOldData();
  console.log('Đã xóa các bản ghi bảng công từ 5 ngày trước và cũ hơn.');
});

async function deleteOldData() {
  try {
    // Tính ngày hôm kia
    const dayBeforeYesterday = new Date();
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 5);
    const endOfDayBeforeYesterday = new Date(dayBeforeYesterday.setHours(23, 59, 59, 999));

    // Xóa tất cả dữ liệu bảng công từ ngày hôm kia và các ngày trước đó
    const result = await BangCong2.deleteMany({
      date: { $lte: endOfDayBeforeYesterday }
    });

    console.log(`Đã xóa ${result.deletedCount} bản ghi bảng công từ ngày ${dayBeforeYesterday.toLocaleDateString()} trở về trước.`);
  } catch (error) {
    console.error('Lỗi khi xóa dữ liệu:', error);
  }
}





// Lệnh /reset để xóa bảng công của những ngày trước
bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    // Ngày hiện tại
    const currentDate = new Date().toLocaleDateString();
    
    // Xóa tất cả bảng công có ngày trước ngày hiện tại
    const result = await BangCong2.deleteMany({
      date: { $lt: currentDate },
      groupId: { $ne: -1002108234982 }, // Loại trừ nhóm có chatId -1002050799248
    });

    bot.sendMessage(chatId, `Đã xóa ${result.deletedCount} bảng công của những ngày trước.`);
  } catch (error) {
    console.error('Lỗi khi xóa bảng công:', error);
    bot.sendMessage(chatId, 'Đã xảy ra lỗi khi xóa bảng công. Vui lòng thử lại.');
  }
});



bot.onText(/\/edit (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username; // Lấy username của người dùng
    const input = match[1].split(',').map(item => item.trim());
    const ten = input[0];
    const quayInput = input[1];
    const keoInput = input[2];
    const date = input[3];

    if (!ten || !quayInput || !keoInput || !date) {
        bot.sendMessage(chatId, 'Sai cú pháp. Vui lòng nhập đúng định dạng: /edit tên thành viên, số quay, số keo, ngày/tháng');
        return;
    }

    // Kiểm tra xem người dùng có quyền sử dụng lệnh
    if (username === 'Hieu_ga') {
        // Người dùng này luôn có quyền sử dụng lệnh
    } else {
        const chatMember = await bot.getChatMember(chatId, userId);
        if (chatMember.status !== 'administrator' && chatMember.status !== 'creator') {
            bot.sendMessage(chatId, 'Chỉ có admin hoặc người dùng đặc biệt mới được phép sử dụng lệnh này.');
            return;
        }
    }

    const groupId = chatId;

    const [day, month] = date.split('/');
    const year = new Date().getFullYear();
    const entryDate = new Date(year, month - 1, day);

    try {
        // Tìm kiếm thành viên gần đúng
        const regex = new RegExp(ten.split('').join('.*'), 'i');
        const bangCong = await BangCong2.findOne({
            groupId: Number(groupId),
            ten: { $regex: regex },
            date: entryDate
        });

        if (!bangCong) {
            bot.sendMessage(chatId, `Không tìm thấy bản ghi để cập nhật cho ${ten.trim()} vào ngày ${date}.`);
            return;
        }

        const quayCurrent = bangCong.quay;
        const keoCurrent = bangCong.keo;
        const quayNew = Number(quayInput);
        const keoNew = Number(keoInput);

        bangCong.quay = quayCurrent - quayNew;
        bangCong.keo = keoCurrent - keoNew;
        bangCong.tinh_tien = (bangCong.quay * 500) + (bangCong.keo * 1000); // Giả định tính tiền công là tổng số quay và keo nhân 1000
        await bangCong.save();

        bot.sendMessage(chatId, `Cập nhật thành công cho ${ten.trim()} vào ngày ${date}.`);
    } catch (error) {
        console.error('Lỗi khi cập nhật dữ liệu:', error);
        bot.sendMessage(chatId, 'Lỗi khi cập nhật dữ liệu.');
    }
});









const normalizeName = (name) => {
  return name.replace(/[^\w\s]/gi, '').toLowerCase().trim();
};

bot.onText(/Trừ/, async (msg) => {
  if (!msg.reply_to_message || !msg.reply_to_message.text) {
   
    return;
  }

  // Lấy thông tin từ tin nhắn bot mà người dùng trả lời 
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username;

  const replyText = msg.reply_to_message.text;
  
  // Cập nhật regex để chỉ bắt các giá trị cần thiết
  const matched = replyText.match(/của (.+?) đã.*?(\d+) qu[aẩ]y.*?(\d+) c[ộô]ng.*?(\d+) bill.*?(\d+) [ảa]nh.*?vào (.*?) đ.*?([0-9,]+) VNĐ/is);

  if (!matched) {
    
    return;
  }

  // Lấy thông tin từ tin nhắn trả lời
  const ten = matched[1].trim();
  const quay = parseInt(matched[2]);
  const keo = parseInt(matched[3]);
  const bill = parseInt(matched[4]);
  const anh = parseInt(matched[5]);
  const submissionDateStr = matched[6];
  const totalMoney = parseInt(matched[7].replace(/,/g, ''));

  // Parse ngày giờ kiểu Mỹ (MM/DD/YYYY HH:mm AM/PM)
  const submissionDate = new Date(submissionDateStr);

  // Lấy ngày từ tin nhắn của bot (msg.reply_to_message.date)
  const messageDate = new Date(msg.reply_to_message.date * 1000);
  const normalizedMessageDate = new Date(messageDate.setHours(0, 0, 0, 0)); // Ngày không giờ phút giây

  try {
    // Tìm kiếm bản ghi thành viên dựa trên tên và ngày gửi tin nhắn của bot
    const regex = new RegExp(normalizeName(ten).split('').join('.*'), 'i');
    
    // Đảm bảo rằng truy vấn sẽ sử dụng ngày cụ thể, không phải khoảng thời gian
    const bangCong = await BangCong2.findOne({
      groupId: chatId,
      ten: { $regex: regex },
      date: normalizedMessageDate
    });

    if (!bangCong) {
      bot.sendMessage(chatId, `Không tìm thấy bản ghi để cập nhật cho ${ten.trim()}.`);
      return;
    }

    // Kiểm tra xem message id đã tồn tại trong processedMessageIds chưa
    const messageId = msg.reply_to_message.message_id;
    if (bangCong.processedMessageIds && bangCong.processedMessageIds.includes(messageId)) {
      bot.sendMessage(chatId, 'Trừ không thành công, bài nộp này đã trừ trước đó rồi.');
      return;
    }

    // Cập nhật số liệu dựa trên thông tin đã lấy
    bangCong.quay -= quay;
    bangCong.keo -= keo;
    bangCong.bill -= bill;
    bangCong.anh -= anh;
    bangCong.tinh_tien -= totalMoney;

    // Thêm message id vào mảng processedMessageIds
    if (!bangCong.processedMessageIds) {
      bangCong.processedMessageIds = [];
    }
    bangCong.processedMessageIds.push(messageId);

    // Lưu lại bản ghi đã chỉnh sửa
    await bangCong.save();

    bot.sendMessage(chatId, `Trừ thành công bài nộp này cho ${ten.trim()}.`);
  } catch (error) {
    console.error('Lỗi khi cập nhật dữ liệu:', error);
    bot.sendMessage(chatId, 'Đã xảy ra lỗi khi cập nhật dữ liệu.');
  }
});








attendanceSchema = new mongoose.Schema({
  ca: String,
  memberData: {
    type: Map,
    of: [{
      number: Number,
      userId: String
    }]
  },
  isLocked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const Attendance = mongoose.model('Attendance', attendanceSchema);

const billHistorySchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  ca: String,
  members: [{
    userId: String,
    name: String
  }]
});

const BillHistory = mongoose.model('BillHistory', billHistorySchema);

const timeSlots = [
  { time: '11:00', label: 'ca 11h30' },
  { time: '13:00', label: 'ca 13h30' },
  { time: '14:30', label: 'ca 15h00' }, 
  { time: '18:00', label: 'ca 18h30' },
  { time: '19:30', label: 'ca 20h00' }
];

const groupId = -1002496228650;
const adminIds = [7305842707];
const topicId = 19;

let billImagesCount = 0;
let billImages = [];
let upBillMembers = [];
let isWaitingForBills = false;
let currentCa = '';

cron.schedule('15 0 * * *', async () => {
  try {
    await Attendance.deleteMany({});
    await BillHistory.deleteMany({ date: { $lt: new Date() } });
    billImagesCount = 0;
    billImages = [];
    upBillMembers = [];
    isWaitingForBills = false;
    console.log('🔄 Reset completed at midnight!');
  } catch (error) {
    console.error('❌ Reset error:', error);
  }
});

timeSlots.forEach((slot, index) => {
  const [hour, minute] = slot.time.split(':').map(Number);

  schedule.scheduleJob({ hour, minute, tz: 'Asia/Ho_Chi_Minh' }, async () => {
    // Check and clean up previous unfinished attendance
    const previousCa = `ca_${index}`;
    if (index > 0) {
      const previousAttendance = await Attendance.findOne({ ca: previousCa });
      if (previousAttendance && !previousAttendance.isLocked) {
        await Attendance.deleteOne({ ca: previousCa });
        console.log(`🔄 Cleaned up unfinished attendance for ${previousCa}`);
      }
    }

    const label = slot.label;
    currentCa = `ca_${index + 1}`;

    // Reset bill-related variables
    billImagesCount = 0;
    billImages = [];
    upBillMembers = [];
    isWaitingForBills = false;

    const attendance = new Attendance({ ca: currentCa, memberData: new Map(), isLocked: false });
    await attendance.save();

    bot.sendMessage(groupId, `🔔 Điểm danh ${label}! Mọi người báo số thứ tự đi`);
  

    const messageHandler = async (msg) => {
      if (msg.chat.id !== groupId) return;

      try {
        const chatMember = await bot.getChatMember(groupId, msg.from.id);
        const isAdmin = adminIds.includes(msg.from.id) || 
                       ['creator', 'administrator'].includes(chatMember.status);

       // Modify the photo handler part in messageHandler function
if (isWaitingForBills && msg.photo && isAdmin) {
  const photoId = msg.photo[msg.photo.length - 1].file_id;
  
  // Check if this photo was already added
  if (!billImages.some(img => img.photoId === photoId)) {
    billImages.push({
      photoId: photoId,
      caption: msg.caption || ''
    });
    billImagesCount++;

   

    // Process bills only when exactly 3 photos are received
    if (billImagesCount === 3) {
      for (let i = 0; i < Math.min(3, upBillMembers.length); i++) {
        const member = upBillMembers[i];
        try {
          await bot.sendPhoto(groupId, billImages[i].photoId, {
            caption: `Bill ${timeSlots[parseInt(currentCa.split('_')[1]) - 1].label} của [${member.name}](tg://user?id=${member.userId}) - STT: ${member.number}\n`,
            parse_mode: 'Markdown',
            message_thread_id: topicId
          });
        } catch (error) {
          console.error('Lỗi gửi ảnh:', error);
        }
      }
      isWaitingForBills = false;
      billImagesCount = 0;
      billImages = [];
      bot.removeListener('message', messageHandler);
    }
  }
  return;
}

        let text = msg.text;
        let targetUserId;

        if (isAdmin && msg.reply_to_message) {
          targetUserId = msg.reply_to_message.from.id;
          const numberMatch = text.match(/\d+/g);
          if (!numberMatch) return;
          text = numberMatch.join(' ');
        }

        if (!text || !/^\d+([.,\s]+\d+)*$/.test(text)) return;

        const numbers = text.split(/[.,\s]+/)
       .map(Number)
       .filter(num => num >= 1 && num <= 15); // Only accept numbers 1-15

if (numbers.length === 0) return;
        const memberName = targetUserId ? 
          (msg.reply_to_message.from.first_name || msg.reply_to_message.from.username) :
          (msg.from.first_name || msg.from.username);
        const userId = targetUserId || msg.from.id;
        
        
        const currentAttendance = await Attendance.findOne({ ca: currentCa });
        if (!currentAttendance || currentAttendance.isLocked) return;

        const existingMembers = Array.from(currentAttendance.memberData.entries());
        const existingNumbers = new Set();
        
        for (const [name, data] of existingMembers) {
          if (name !== memberName) {
            data.forEach(item => existingNumbers.add(item.number));
          }
        }

        const duplicateNumbers = numbers.filter(num => existingNumbers.has(num));

        if (duplicateNumbers.length > 0) {
          for (const [name, data] of existingMembers) {
            if (name !== memberName) {
              const newData = data.filter(item => !duplicateNumbers.includes(item.number));
              if (newData.length === 0) {
                currentAttendance.memberData.delete(name);
              } else {
                currentAttendance.memberData.set(name, newData);
              }
            }
          }
        }

        const existingData = currentAttendance.memberData.get(memberName) || [];
        const existingNumbersSet = new Set(existingData.map(item => item.number));
        
        const newUniqueNumbers = numbers.filter(num => !existingNumbersSet.has(num));
        
        if (newUniqueNumbers.length > 0) {
          const newData = [
            ...existingData,
            ...newUniqueNumbers.map(num => ({
              number: num,
              userId: userId
            }))
          ];
          currentAttendance.memberData.set(memberName, newData);
          await currentAttendance.save();
        }

        const allNumbers = Array.from(currentAttendance.memberData.values())
          .flat()
          .map(item => item.number);

        if (allNumbers.length >= 15 && !currentAttendance.isLocked) {
          currentAttendance.isLocked = true;
          await currentAttendance.save();
          bot.sendMessage(groupId, `✅ Chốt điểm danh!`);

          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const todayHistory = await BillHistory.find({
            date: { $gte: today }
          });

          const { upBill, chucBillGroups } = await allocateNumbers(currentAttendance, todayHistory);
          
          const newBillHistory = new BillHistory({
            ca: currentCa,
            members: upBill.map(m => ({
              userId: m.userId,
              name: m.name
            }))
          });
          await newBillHistory.save();

          let response = '🎉 *PHÂN CHIA BILL*\n\n';
          response += '*🔸 Lên Bill:*\n';
          
          upBill.forEach(member => {
            upBillMembers.push(member);
            response += `   • STT ${member.number} - [${member.name}](tg://user?id=${member.userId})\n`;
          });

          response += '\n*🔸 Chúc Bill:*\n';
          chucBillGroups.forEach((group, idx) => {
            response += `   • Bill ${idx + 1}: ${group.map(m => m.number).join(', ')}\n`;
          });

          bot.sendMessage(groupId, response, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          });
          
          isWaitingForBills = true;
          bot.sendMessage(groupId, '📸 Chờ QTV gửi 3 ảnh để chia bill');
        }
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    };

    bot.on('message', messageHandler);
  });
});

// [Giữ nguyên các phần code khác ở trên]

async function allocateNumbers(attendance, todayHistory) {
  const membersByUser = new Map();
  
  attendance.memberData.forEach((numbers, name) => {
    numbers.forEach(item => {
      if (!membersByUser.has(item.userId)) {
        membersByUser.set(item.userId, {
          name: name,
          userId: item.userId,
          numbers: []
        });
      }
      membersByUser.get(item.userId).numbers.push(item.number);
    });
  });

  const allMembers = Array.from(membersByUser.values()).map(member => ({
    ...member,
    randomScore: Math.random()
  }));

  const todayBillMembers = new Set(
    todayHistory.flatMap(h => h.members.map(m => m.userId))
  );

  const notUpYet = allMembers.filter(m => !todayBillMembers.has(m.userId))
    .sort((a, b) => b.randomScore - a.randomScore);
  const upBefore = allMembers.filter(m => todayBillMembers.has(m.userId))
    .sort((a, b) => b.randomScore - a.randomScore);

  let selectedMembers;
  if (notUpYet.length >= 3) {
    selectedMembers = notUpYet.slice(0, 3);
  } else {
    selectedMembers = [
      ...notUpYet,
      ...upBefore.slice(0, 3 - notUpYet.length)
    ];
  }

  const upBill = selectedMembers.map(member => ({
    name: member.name,
    userId: member.userId,
    number: member.numbers[0]
  }));

  // Lấy tất cả các số còn lại (không lên bill)
  const remainingNumbers = [];
  attendance.memberData.forEach((numbers, name) => {
    numbers.forEach(item => {
      if (!upBill.some(u => u.number === item.number)) {
        remainingNumbers.push({
          name: name,
          number: item.number,
          userId: item.userId
        });
      }
    });
  });

  // Xáo trộn các số còn lại
  const shuffledRemaining = shuffleArray([...remainingNumbers]);
  
  // Khởi tạo 3 bill trống
  const chucBillGroups = [[], [], []];

  // Chia đều 12 số đầu tiên vào 3 bill, mỗi bill 4 số
  for (let i = 0; i < Math.min(12, shuffledRemaining.length); i++) {
    const billIndex = Math.floor(i / 4);
    chucBillGroups[billIndex].push(shuffledRemaining[i]);
  }

  // Nếu không đủ 12 số, thêm các số còn thiếu vào từng bill để đảm bảo mỗi bill có 4 số
  chucBillGroups.forEach((group, index) => {
    while (group.length < 4) {
      const remainingIndex = index * 4 + group.length;
      if (remainingIndex < shuffledRemaining.length) {
        group.push(shuffledRemaining[remainingIndex]);
      } else {
        // Nếu không còn số thật, thêm số 0 (trường hợp này không nên xảy ra trong thực tế)
        group.push({
          name: "N/A",
          number: 0,
          userId: "0"
        });
      }
    }
  });

  return {
    upBill,
    chucBillGroups
  };
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// [Giữ nguyên các phần code khác ở dưới]












bot.onText(/\/xoa/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    // Tính toán ngày cách đây 3 ngày
    const currentDate = new Date();
    const threeDaysAgo = new Date(currentDate);
    threeDaysAgo.setDate(currentDate.getDate() - 3);

    // Xóa tất cả bảng công của những ngày trước 3 ngày cho nhóm có chatId -1002050799248
    const result = await BangCong2.deleteMany({
      date: { $lt: threeDaysAgo },
      groupId: -1002108234982, // Chỉ xóa bảng công của nhóm này
    });

    bot.sendMessage(chatId, `Đã xóa ${result.deletedCount} bảng công của những ngày trước từ nhóm -1002050799248.`);
  } catch (error) {
    console.error('Lỗi khi xóa bảng công:', error);
    bot.sendMessage(chatId, 'Đã xảy ra lỗi khi xóa bảng công. Vui lòng thử lại.');
  }
});


bot.onText(/\/Delete(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;

  try {
    // Lấy số ngày từ lệnh
    const days = parseInt(match[1], 10);

    // Lấy ngày hiện tại
    const currentDate = new Date();
    // Trừ số ngày để lấy ngày của (số ngày) trước
    currentDate.setDate(currentDate.getDate() - days);
    const targetDate = currentDate.toLocaleDateString();

    // Xóa tất cả bảng công của những ngày từ (số ngày) trước trở đi cho nhóm có chatId -1002050799248
    const result = await BangCong2.deleteMany({
      date: { $lt: targetDate },
      groupId: -1002108234982, // Chỉ xóa bảng công của nhóm này
    });

    bot.sendMessage(chatId, `Đã xóa ${result.deletedCount} bảng công của những ngày từ ${days} ngày trước từ nhóm -1002050799248.`);
  } catch (error) {
    console.error('Lỗi khi xóa bảng công:', error);
    bot.sendMessage(chatId, 'Đã xảy ra lỗi khi xóa bảng công. Vui lòng thử lại.');
  }
});




// Lập lịch gửi bảng công tổng hợp vào 9h12 sáng hàng ngày theo giờ Việt Nam
cron.schedule('31 7 * * *', async () => {
  try {
    // Gửi bảng công tổng hợp vào groupId -1002128289933
    await sendAggregatedData(-1002128289933);
  } catch (error) {
    console.error("Lỗi khi gửi bảng công tổng hợp:", error);
  }
}, {
  scheduled: true,
  timezone: "Asia/Ho_Chi_Minh"
});


// Xử lý lệnh /homqua để hiển thị bảng công cho tất cả các nhóm
bot.onText(/\/homqua/, async (msg) => {
  const chatId = msg.chat.id;
  await sendAggregatedData(chatId);
});

async function sendAggregatedData(chatId) {
  try {
    // Tính ngày hôm qua
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const startOfYesterday = new Date(yesterday.setHours(0, 0, 0, 0));
    const endOfYesterday = new Date(yesterday.setHours(23, 59, 59, 999));
    // Lấy bảng công của ngày hôm qua, loại trừ nhóm có chatId -1002108234982
    const bangCongs = await BangCong2.find({
      date: { $gte: startOfYesterday, $lte: endOfYesterday },
      groupId: { $ne: -1002108234982 }, // Loại trừ nhóm này
    });

    if (bangCongs.length === 0) {
      bot.sendMessage(chatId, `Không có bảng công nào cho ngày ${yesterday.toLocaleDateString()}.`);
      return;
    }

    // Tạo bảng công phân loại theo ID nhóm
    const groupedByGroupId = {};
    bangCongs.forEach((bangCong) => {
      const groupId = bangCong.groupId ? bangCong.groupId.toString() : '';
      if (!groupedByGroupId[groupId]) {
        groupedByGroupId[groupId] = [];
      }
      groupedByGroupId[groupId].push(bangCong);
    });

    let response = '';

    // Tạo bảng công cho mỗi nhóm và kiểm tra xem user ID 5867504772 có trong nhóm hay không
    for (const groupId in groupedByGroupId) {
      if (!groupId) {
        continue;
      }

      // Kiểm tra xem user 5867504772 có trong nhóm không
      let isUserInGroup = false;
      try {
        const chatMembers = await bot.getChatMember(groupId, 5867504772);
        if (chatMembers && (chatMembers.status === 'member' || chatMembers.status === 'administrator' || chatMembers.status === 'creator')) {
          isUserInGroup = true;
        }
      } catch (error) {
        console.error(`Không thể lấy thông tin thành viên của nhóm ${groupId}:`, error);
      }

      if (!isUserInGroup) {
        continue; // Bỏ qua nhóm nếu user không có trong nhóm
      }

      const groupData = groupedByGroupId[groupId];

      // Lấy thông tin nhóm từ Telegram API
      let groupName;
      try {
        const chatInfo = await bot.getChat(groupId);
        groupName = chatInfo.title || `Nhóm ${groupId}`;
      } catch (error) {
        console.error(`Không thể lấy thông tin nhóm ${groupId}:`, error);
        groupName = `Nhóm ${groupId}`;
      }

      response += `Bảng công nhóm ${groupName} (${yesterday.toLocaleDateString()}):\n\n`;

      let totalGroupMoney = 0;

      groupData.forEach((bangCong) => {
        if (bangCong.tinh_tien !== undefined) {
          const formattedTien = bangCong.tinh_tien.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
          response += `${bangCong.ten}\t\t${bangCong.quay}q +\t${bangCong.keo}c\t${formattedTien}vnđ\n`;
          totalGroupMoney += bangCong.tinh_tien;
        }
      });

      const formattedTotal = totalGroupMoney.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
      response += `Tổng tiền: ${formattedTotal}vnđ\n\n`;
    }

    // Kiểm tra độ dài response và gửi tin nhắn
    if (response.length > 4000) {
      const middle = Math.floor(response.length / 2);
      const splitIndex = response.lastIndexOf('\n', middle);

      const firstPart = response.substring(0, splitIndex).trim();
      const secondPart = response.substring(splitIndex).trim();

      bot.sendMessage(chatId, firstPart);
      bot.sendMessage(chatId, secondPart);
    } else {
      bot.sendMessage(chatId, response.trim());
    }
  } catch (error) {
    console.error('Lỗi khi truy vấn dữ liệu từ MongoDB:', error);
    bot.sendMessage(chatId, 'Đã xảy ra lỗi khi truy vấn dữ liệu từ cơ sở dữ liệu.');
  }
}

      
const groupCodes = {
  "cđnbch": "-1002039100507",
  "kttn": "-1002004082575",
  "dltc": "-1002123430691",
  "csch": "-1002080535296",
  "cncs": "-1002143712364",
  "bđkn": "-1002128975957",
  "cncs": "-1002080535296",
  "tđcv1": "-1002091101362",
  "gimđcs": "-1002129896837",
  "cf": "-1002108234982",
  "csnbch": "-1002228252389", 
  "lgcn": "-4201367303",
  "cskn": "-1002143712364" 
};

const groups = {
  "-1002039100507": "BẢNG CÔNG NHÓM CỘNG ĐỒNG NẮM BẮT CƠ HỘI",
  "-1002004082575": "BẢNG CÔNG NHÓM NÂNG CAO ĐỜI SỐNG",
  "-1002123430691": "BẢNG CÔNG NHÓM DẪN LỐI THÀNH CÔNG",
  "-1002143712364": "NHÓM CHIA SẺ KINH NGHIỆM",
  "-1002128975957": "BẢNG CÔNG NHÓM BƯỚC ĐI KHỞI NGHIỆP",
  "-1002080535296": "NHÓM CÙNG NHAU CHIA SẺ",
  "-1002091101362": "BẢNG CÔNG NHÓM TRAO ĐỔI CÔNG VIỆC 1", 
  "-1002129896837": "BẢNG CÔNG NHÓM GROUP I MẠNH ĐỨC CHIA SẺ", 
  "-1002228252389": "BẢNG CÔNG NHÓM TECH GEEK UNITES", 
  "-1002179104664": "Diễn đàn khởi nghiệp",
  "-1002198923074": "CHIA SẺ KINH NGHIỆM TRẢI NGHIỆM" 
};


let excludedGroups = [];
let additionalGroupsByDate = {}; // Object to store additional groups by date

// Hàm parse group codes
function parseGroupCodes(text) {
  return text.split(',').map(code => code.trim().toLowerCase());
}



 // Cập nhật tự động tên nhóm vào đối tượng groups
bot.on('message', (msg) => {
  const chatId = msg.chat.id.toString();
  const chatTitle = msg.chat.title;

  const ignoredChatIds = ['-1002108234982', '-1002103270166', '-1002128289933'];

if (chatId && chatTitle && !ignoredChatIds.includes(chatId)) {
    groups[chatId] = chatTitle;
}
});



async function generateAndSendImages(chatId) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfYesterday = new Date(yesterday);
  startOfYesterday.setHours(0, 0, 0, 0);
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);
  const dateStr = `${yesterday.getDate()}/${yesterday.getMonth() + 1}`;

  try {
    let totalAmountByUser = {}; // Đối tượng để lưu tổng số tiền của mỗi người dùng
    const allGroups = [...Object.keys(groups), ...(additionalGroupsByDate[dateStr] || [])];

    for (const groupId of allGroups) {
      if (excludedGroups.includes(groupId)) continue; // Bỏ qua các nhóm trong danh sách loại trừ

      const groupName = groups[groupId] || `Nhóm ${groupId}`;
      const bangCongs = await BangCong2.find({
        date: { $gte: startOfYesterday, $lte: endOfYesterday },
        groupId: Number(groupId)
      });

      if (bangCongs.length === 0) {
        bot.sendMessage(chatId, `Không có dữ liệu bảng công cho ngày hôm qua cho nhóm ${groupName}.`);
        continue;
      }

      let totalAmount = 0;
      let content = bangCongs.map(bangCong => {
        totalAmount += bangCong.tinh_tien;
        totalAmountByUser[bangCong.ten] = (totalAmountByUser[bangCong.ten] || 0) + bangCong.tinh_tien;
        return `${bangCong.ten}\t${bangCong.quay}\t${bangCong.keo}\t${bangCong.tinh_tien}vnđ`;
      }).join('\n');

      const imageUrl = await createImage(content, groupName, totalAmount, dateStr);
      await bot.sendPhoto(chatId, imageUrl);
    }

    let totalAmountContent = '';
    for (const [userName, totalAmount] of Object.entries(totalAmountByUser)) {
      totalAmountContent += `<TR><TD ALIGN="LEFT" STYLE="font-weight: bold;">${userName}</TD><TD ALIGN="CENTER">${totalAmount}vnđ</TD></TR>`;
    }
    const totalAmountImageUrl = await createTotalAmountImage(totalAmountContent);
    await bot.sendPhoto(chatId, totalAmountImageUrl);

    const messages = [
            `Attention, attention! Bảng công (${dateStr}) nóng hổi vừa ra lò, ai chưa check điểm danh là lỡ mất cơ hội "ăn điểm" với sếp đó nha!`,
            `Chuông báo thức đã vang! ⏰⏰⏰ Bảng công (${dateStr}) đã có mặt, ai trễ hẹn là "ăn hành" với team trưởng Hieu Gà đó nha!`,           
`Quà tặng bất ngờ đây! Bảng công (${dateStr}) xinh xắn đã đến tay mọi người, ai check nhanh sẽ có quà ngon đó nha!`,
`Thám tử bảng công đã xuất hiện! ️‍♀️️‍♂️ Hãy nhanh chóng kiểm tra bảng công (${dateStr}) để tìm ra "bí ẩn" điểm số của bạn nào!`,
`Vinh danh những chiến binh cống hiến! Bảng công (${dateStr}) là minh chứng cho sự nỗ lực của bạn, hãy tự hào khoe chiến công với mọi người nhé!`,
`Nhảy đi nào các chiến binh! Bảng công (${dateStr}) sôi động đã có mặt, hãy cùng "phiêu" theo nhịp điệu quẩy nào!`,
`Học sinh ngoan đâu rồi điểm danh! ‍♀️‍♂️ Bảng công (${dateStr}) chính là bảng điểm "siêu cấp" để bạn đánh giá bản thân đó nha!`,
`Bếp trưởng đãi bảng công xin mời quý thực khách! Bảng công (${dateStr}) "đậm đà" hương vị thành công, mời mọi người thưởng thức!`,
`Quà tặng tri ân của Củ Khoai Nóng dành cho "quẩy thủ" xuất sắc! Bảng công (${dateStr}) là lời cảm ơn chân thành của công ty dành cho những ai đã cống hiến hết mình! ❤️❤️❤️`,
`Bùng nổ niềm vui với bảng công (${dateStr})! Hãy cùng nhau chúc mừng những thành công và tiếp tục tiến bước chinh phục những mục tiêu mới!`,
`Bảng công (${dateStr}) - Phiên bản "limited edition", hãy nhanh tay "sưu tầm" trước khi hết hàng! ‍♀️‍♂️`,
`Củ Khoai Nóng xin cảnh báo: Bảng công (${dateStr}) có thể gây nghiện, hãy cẩn thận khi sử dụng! ⚠️`,
`Bảng công (${dateStr}) - Phiên bản "limited edition", hãy nhanh tay "sưu tầm" trước khi hết hàng! ‍♀️‍♂️`,

        ];
    const randomMessage = messages[Math.floor(Math.random() * messages.length)];
    const message = await bot.sendMessage(chatId, randomMessage);
    await bot.pinChatMessage(chatId, message.message_id);
  } catch (error) {
    console.error('Lỗi khi truy vấn dữ liệu từ MongoDB:', error);
    bot.sendMessage(chatId, 'Failed to create image.');
  }
}

async function createImage(content, groupName, totalAmount, dateStr) {
  const url = 'https://quickchart.io/graphviz?format=png&layout=dot&graph=';
  const graph = `
    digraph G {
      node [shape=plaintext];
      a [label=<
        <TABLE BORDER="1" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4" STYLE="font-family: 'Arial', sans-serif; border: 1px solid black;">
          <TR><TD COLSPAN="4" ALIGN="CENTER" BGCOLOR="#FFCC00" STYLE="font-size: 16px; font-weight: bold;">${groupName} - ${dateStr}</TD></TR>
          <TR STYLE="font-weight: bold; background-color: #FFCC00;">
            <TD ALIGN="CENTER">Tên</TD>
            <TD ALIGN="CENTER">Quẩy</TD>
            <TD ALIGN="CENTER">Cộng</TD>
            <TD ALIGN="CENTER">Tiền công</TD>
          </TR>
                    ${content.split('\n').map(line => `<TR><TD ALIGN="LEFT" STYLE="font-weight: bold;">${line.split('\t').join('</TD><TD ALIGN="CENTER">')}</TD></TR>`).join('')}
          <TR STYLE="font-weight: bold;">
            <TD COLSPAN="3" ALIGN="LEFT">Tổng số tiền</TD>
            <TD ALIGN="CENTER">${totalAmount}vnđ</TD>
          </TR>
        </TABLE>
      >];
    }
  `;
  const imageUrl = `${url}${encodeURIComponent(graph)}`;
  return imageUrl;
}

async function createTotalAmountImage(content, dateStr) {
  const url = 'https://quickchart.io/graphviz?format=png&layout=dot&graph=';
  const graph = `
    digraph G {
      node [shape=plaintext];
      a [label=<
        <TABLE BORDER="1" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4" STYLE="font-family: 'Arial', sans-serif; border: 1px solid black;">
          <TR><TD COLSPAN="2" ALIGN="CENTER" BGCOLOR="#FFCC00" STYLE="font-size: 16px; font-weight: bold;">Tổng số tiền của từng thành viên từ tất cả các nhóm ${dateStr}</TD></TR>
          ${content}
        </TABLE>
      >];
    }
  `;
  const imageUrl = `${url}${encodeURIComponent(graph)}`;
  return imageUrl;
}

bot.onText(/\/anhbangcong/, async (msg) => {
  const chatId = msg.chat.id;
  await generateAndSendImages(chatId);
});


// Thay thế YOUR_API_KEY bằng API key OpenWeatherMap của bạn
const apiKey = '679360c3eef6d2165d3833d29b5eccf4';

// ChatId của nhóm bạn muốn gửi dự báo thời tiết
const chatId = -1002103270166;

// Bảng dịch các trạng thái thời tiết từ tiếng Anh sang tiếng Việt
const weatherDescriptions = {
  'clear sky': 'ngày nắng nóng, có nơi nắng nóng gay gắt 🌤️',
  'few clouds': 'ngày nắng nóng 🌤️',
  'scattered clouds': 'Có mây, trưa chiều trời hửng nắng ☁',
  'broken clouds': 'Có mây, trưa chiều trời hửng nắng ☁',
  'overcast clouds': 'Nhiều mây ☁',
  'shower rain': 'ngày mưa rào và rải rác có giông 🌫️',
  'rain': 'ngày có mưa rào và có giông vài nơi 🌫️',
  'thunderstorm': 'Cụ bộ có mưa to',
  'squall': 'Gió giật',
  'drizzle': 'mưa nhỏ',
  'light rain': 'ngày có lúc có mưa rào và rải rác có giông 🌫️',
  'moderate rain': 'có mưa vừa đến mưa to',
  'heavy rain': 'mưa to',
  'light thunderstorm': 'giông rải rác',
  'thunderstorm with heavy rain': 'mưa rào và giông vài nơi 🌫️',
  'heavy thunderstorm': 'có giông vài nơi',
  'cold': 'trời lạnh',
  'hot': 'có nắng nóng',
};

// Bảng ánh xạ để tránh trùng lặp câu từ
const stateMapping = {
  'ngày có lúc có mưa rào và rải rác có giông 🌫️': 'có mưa vừa, mưa to và có nơi có giông 🌫️',
  'ngày có mưa rào và có giông vài nơi 🌫️': 'có mưa rào và giông rải rác 🌫️',
  'trời nắng': 'trời quang đãng',
  'Có mây, trưa chiều trời hửng nắng ☁': 'trời quang',
  // (Thêm các ánh xạ khác nếu cần)
};

// Hàm lấy hướng gió dựa trên độ
function getWindDirection(deg) {
  if (deg >= 337.5 || deg < 22.5) return 'Bắc';
  if (deg >= 22.5 && deg < 67.5) return 'Đông Bắc';
  if (deg >= 67.5 && deg < 112.5) return 'Đông';
  if (deg >= 112.5 && deg < 157.5) return 'Đông Nam';
  if (deg >= 157.5 && deg < 202.5) return 'Nam';
  if (deg >= 202.5 && deg < 247.5) return 'Tây Nam';
  if (deg >= 247.5 && deg < 292.5) return 'Tây';
  if (deg >= 292.5 && deg < 337.5) return 'Tây Bắc';
}

// Hàm lấy cấp gió dựa trên tốc độ gió
function getWindSpeedLevel(windSpeed) {
  if (windSpeed < 2) return 1;
  if (windSpeed >= 2 && windSpeed < 5) return 2;
  if (windSpeed >= 5 && windSpeed < 10) return 3;
  if (windSpeed >= 10 && windSpeed < 17) return 4;
  if (windSpeed >= 17 && windSpeed < 25) return 5;
  if (windSpeed >= 25 && windSpeed < 33) return 6;
  if (windSpeed >= 33 && windSpeed < 42) return 7;
  if (windSpeed >= 42 && windSpeed < 52) return 8;
  if (windSpeed >= 52 && windSpeed < 63) return 9;
  if (windSpeed >= 63) return 10;
}

// Hàm lấy trạng thái thời tiết phổ biến nhất
function getMostCommonWeatherDescription(descriptions) {
  const count = descriptions.reduce((acc, desc) => {
    if (!acc[desc]) {
      acc[desc] = 1;
    } else {
      acc[desc] += 1;
    }
    return acc;
  }, {});

  let mostCommon = '';
  let maxCount = 0;

  for (const desc in count) {
    if (count[desc] > maxCount) {
      mostCommon = desc;
      maxCount = count[desc];
    }
  }

  return mostCommon;
}

// Hàm định dạng ngày theo chuẩn "ngày/tháng/năm"
function formatDate(date) {
  const formatter = new Intl.DateTimeFormat('vi-VN', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  });
  return formatter.format(date);
}

// Hàm chọn ảnh GIF dựa trên trạng thái thời tiết
function selectWeatherGif(morningDescription, eveningDescription) {
  const rainKeywords = ['ngày có lúc có mưa rào và rải rác có giông 🌫️', 'ngày có mưa rào và có giông vài nơi 🌫️', 'có mưa rào và giông rải rác 🌫️', 'có mưa vừa đến mưa to' ];
  const cloudKeywords = ['Có mây ☁️', 'Nhiều mây ☁', 'Nhiều mây ☁'];
  const sunKeywords = ['ngày nắng nóng 🌤️', 'ngày nắng nóng, có nơi nắng nóng gay gắt 🌤️', 'Có mây, trưa chiều trời hửng nắng ☁'];
  

  // Nếu buổi sáng hoặc buổi chiều tối có mưa rào, giông và có mây
  if ((rainKeywords.some(k => morningDescription.includes(k)) && sunKeywords.some(k => morningDescription.includes(k))) || 
      (rainKeywords.some(k => eveningDescription.includes(k)) && sunKeywords.some(k => eveningDescription.includes(k)))) {
    return 'https://iili.io/JrXfzI1.gif'; // GIF cho mưa và mây
  }

  // Nếu buổi sáng hoặc buổi chiều tối có nắng hoặc nắng nóng
  if (sunKeywords.some(k => morningDescription.includes(k)) || sunKeywords.some(k => eveningDescription.includes(k))) {
    return 'https://iili.io/JrXLVxS.gif'; // GIF cho trời nắng
  }

  // Nếu không có mưa rào và giông
  if (!rainKeywords.some(k => morningDescription.includes(k)) && !rainKeywords.some(k => eveningDescription.includes(k))) {
    return 'https://iili.io/JrXLVxS.gif'; // GIF cho thời tiết không mưa rào và giông
  }

  return null; // Không có GIF
}



// Hàm lấy dự báo thời tiết chi tiết cho Hà Nội
function getDailyWeatherForecast() {
  const url = `https://api.openweathermap.org/data/2.5/forecast?q=Hanoi,Vietnam&appid=${apiKey}&units=metric`;

  request(url, (error, response, body) => {
    if (error) {
      console.error('Lỗi khi kết nối tới OpenWeatherMap:', error);
      return;
    }

    const data = JSON.parse(body);
    const forecasts = data.list;

    // Lấy ngày hiện tại từ timestamp và định dạng thành "ngày/tháng/năm"
    const currentDate = formatDate(new Date(forecasts[0].dt * 1000));

    // Tìm nhiệt độ thấp nhất và cao nhất trong ngày
    const minTemp = Math.min(...forecasts.map(f => f.main.temp_min));
    const maxTemp = Math.max(...forecasts.map(f => f.main.temp_max));

    // Buổi sáng chỉ hiển thị tổng 2 trạng thái
    const morningForecasts = forecasts.slice(0, 4); // Dự báo buổi sáng
    
    // Trạng thái mây duy nhất
    const cloudTypes = ['Có mây ☁️', 'Nhiều mây ☁', 'Nhiều mây ☁'];
    const uniqueCloudDescription = morningForecasts
      .map(f => weatherDescriptions[f.weather[0].description] || f.weather[0].description)
      .find(desc => cloudTypes.includes(desc));

    // Trạng thái khác
    const otherDescriptions = morningForecasts
      .map(f => weatherDescriptions[f.weather[0].description] || f.weather[0].description)
      .filter(desc => !cloudTypes.includes(desc));

    // Chọn 1 trạng thái không phải mây
    const nonCloudDescription = otherDescriptions[0];

    // Tổng hợp trạng thái buổi sáng
    const morningDescriptions = [uniqueCloudDescription, nonCloudDescription].filter(Boolean).join(", ");

    // Lấy mô tả duy nhất buổi chiều tối đến đêm
    const eveningForecasts = forecasts.slice(4, 8);
    const eveningDescriptions = eveningForecasts.map(
      f => weatherDescriptions[f.weather[0].description] || f.weather[0].description
    );

    let mostCommonEveningDescription = getMostCommonWeatherDescription(eveningDescriptions);

    // Nếu trạng thái buổi chiều tối đến đêm trùng với buổi sáng, thay đổi nội dung
    if (morningDescriptions.includes(mostCommonEveningDescription)) {
      mostCommonEveningDescription = stateMapping[mostCommonEveningDescription] || mostCommonEveningDescription;
    }
    // Kiểm tra có mưa rào, mưa giông, mưa lớn không
    const hasRainyWeather = [...morningForecasts, ...eveningForecasts].some(f =>
      ['ngày có lúc có mưa rào và rải rác có giông 🌫️', 'ngày có mưa rào và có giông vài nơi 🌫️', 'có mưa rào và giông rải rác 🌫️'].includes(weatherDescriptions[f.weather[0].description] || f.weather[0].description)
    );

    // Tìm tốc độ gió cao nhất và thấp nhất trong ngày
    const minWindSpeed = Math.min(...forecasts.map(f => f.wind.speed));
    const maxWindSpeed = Math.max(...forecasts.map(f => f.wind.speed));

    const wind_direction = getWindDirection(forecasts[forecasts.length - 1].wind.deg);

    

    let forecastMessage = `Dự báo thời tiết ngày ${currentDate}, khu vực Hà Nội:\n`;

    

    
    forecastMessage += `\n ${morningDescriptions},`;
    forecastMessage += ` chiều tối và đêm ${mostCommonEveningDescription}.`;
    forecastMessage += ` Gió ${wind_direction} cấp ${getWindSpeedLevel(minWindSpeed)}-${getWindSpeedLevel(maxWindSpeed)}.`;

    // Nếu có các trạng thái mưa rào, giông bão, mưa lớn, thêm cảnh báo
    if (hasRainyWeather) {
      forecastMessage += ` ⛈️ Trong mưa giông có khả năng xảy ra lốc, sét, mưa đá và gió giật mạnh.`;
    }
    forecastMessage += ` Nhiệt độ từ ${Math.round(minTemp)}°C đến ${Math.round(maxTemp)}°C🌡️. Thời tiết như này không quẩy thì hơi phí!`;

    // Chọn ảnh GIF phù hợp
    const selectedGif = selectWeatherGif(morningDescriptions, mostCommonEveningDescription);

    // Nếu có ảnh GIF, gửi ảnh GIF thay vì hiển thị URL
    if (selectedGif) {
      bot.sendAnimation(chatId, selectedGif, { caption: forecastMessage });
    } else {
      bot.sendMessage(chatId, forecastMessage);
    }
  });
}
// Thiết lập cron để gọi hàm vào 7 giờ sáng theo múi giờ Việt Nam
cron.schedule('0 6 * * *', getDailyWeatherForecast, {
  timezone: "Asia/Ho_Chi_Minh", // Đặt múi giờ cho Việt Nam
});

// Thiết lập các cron jobs
resetDailyGiftStatus(DailyGiftStatus); // Truyền mô hình DailyGiftStatus
sendMorningMessage(bot);

// Xử lý callback từ Telegram
bot.on('callback_query', async (callbackQuery) => {
  await handleGiftClaim(bot, callbackQuery, BangCong2, DailyGiftStatus); // Truyền mô hình DailyGiftStatus
});

//news.js
// ChatId của nhóm
const groupChatId = -1002103270166; // Thay bằng ChatId của nhóm bạn

// Thiết lập lịch trình gửi tin nhắn vào nhóm
setupNewsSchedule(bot, groupChatId);



bot.onText(/\/reset/, async (msg) => {
  await resetKeywords();
  bot.sendMessage(msg.chat.id, "Đã reset trường keyword của tất cả các tin nhắn.");
});








//forum.js
// Lịch trình để xóa hết dữ liệu từ schema vào 0h00 hàng ngày
cron.schedule('0 0 * * *', async () => {
  try {
    // Xóa hết dữ liệu từ schema
    await Message.deleteMany({});
    console.log('Đã xóa hết dữ liệu từ schema Message.');
  } catch (error) {
    console.error('Lỗi khi xóa dữ liệu từ schema Message:', error);
  }
});

// Hàm lấy emoji rank dựa theo level
function getRankEmoji(level) {
  if (level >= 1 && level <= 2) return '🥚';
  if (level >= 3 && level < 5) return '🐣';
  if (level >= 5 && level < 7) return '🐥';
  if (level >= 8 && level <= 9) return '🐦';
  if (level >= 10 && level <= 11) return '🦜';
  if (level >= 12 && level <= 13) return '🦄';
  if (level >= 14 && level <= 15) return '🖤⃝🤍';
  if (level >= 16 && level <= 18) return '🤰🏻';
  if (level >= 19 && level <= 20) return '👶🏻';
  if (level >= 21 && level <= 23) return '🧛🏻';
  if (level >= 24 && level <= 26) return '🥷';
  if (level >= 27 && level <= 29) return '🧙‍♂️';
  if (level >= 30 && level <= 33) return '👹';
  if (level >= 34 && level <= 37) return '🕯🪦🕯';
  if (level >= 38 && level <= 41) return '🧟‍♀️🦇';
  if (level >= 42 && level <= 46) return '💀';
  if (level >= 47 && level <= 52) return '˚˖𓍢ִִ໋🌊🦈˚˖𓍢ִ✧˚';
  if (level >= 53 && level <= 55) return '💠VIP💠';
  if (level >= 56 && level <= 59) return '💎VIP💎';
  if (level >= 60 && level <= 64) return '🪩VIP🪩';
  if (level >= 65 && level <= 67) return '🩻VIP🩻';
  if (level >= 68 && level <= 70) return '🪬VIP🪬୧⍤⃝💐';
  if (level >= 71 && level <= 81) return '🥉CHIẾN THẦN⚔️🛡';
  if (level >= 82 && level <= 92) return '🥈Á THẦN🐉⚜️';
  if (level >= 93 && level <= 101) return '🪙VÔ ĐỊCH🐲👸';
  if (level >= 102 && level <= 114) return '👑 HUYỀN THOẠI🦋⃟🥀™️';
  if (level >= 115 && level <= 125) return '✨THẦN THOẠI✨'; // Mythical
  if (level >= 126 && level <= 160) return '🌌VUA VŨ TRỤ👾'; // Cosmic King
  if (level >= 161 && level <= 200) return '⚡THẦN CHỚP⚡'; // Thunder God
  if (level >= 201 && level <= 250) return '🔥PHƯỢNG HOÀNG🔥'; // Phoenix
  if (level >= 251 && level <= 300) return '🌟THIÊN THẦN🌟'; // Celestial Angel
  if (level >= 301 && level <= 350) return '🎇THẦN ÁNH SÁNG🎇'; // God of Light
  if (level >= 351 && level <= 400) return '🪐CHỦ NHÂN VŨ TRỤ🪐'; // Master of the Universe
  if (level > 400) return '🚀HUYỀN THOẠI VĨNH CỬU🚀';

  if (level >= 1000) return 'ﮩ٨ـﮩﮩ٨ـ🫀ﮩ٨ـﮩﮩ٨ـ🔑';
  return '';
}

// Hàm lấy emoji sao dựa theo phần trăm level
function getStarEmoji(levelPercent) {
  if (levelPercent < 25) return '★☆☆☆☆';
  if (levelPercent < 50) return '★★☆☆☆';
  if (levelPercent < 75) return '★★★☆☆';
  if (levelPercent < 90) return '★★★★☆';
  if (levelPercent < 100) return '★★★★★';
  if (levelPercent >= 100) return '✪✪✪✪✪';
  return '';
}

const replyKeyboard4 = {
  reply_markup: {
    keyboard: [
      [{ text: 'Xem tài khoản 🧾' }, { text: 'Nhiệm vụ hàng ngày 🪂' }],
      [{ text: 'Túi đồ 🎒' }, { text: 'Nhiệm vụ nguyệt trường kỳ 📜' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};






// Lệnh /start để tham gia bot
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const fullname = `${msg.from.first_name} ${msg.from.last_name || ''}`.trim();
  const opts = {
    reply_markup: {
    keyboard: [
      [{ text: 'Xem tài khoản 🧾' }, { text: 'Nhiệm vụ hàng ngày 🪂' }],
      [{ text: 'Túi đồ 🎒' }, { text: 'Nhiệm vụ nguyệt trường kỳ 📜' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};
      

  try {
    // Kiểm tra xem thành viên đã tồn tại chưa
    let member = await Member.findOne({ userId });

    if (!member) {
      // Tạo mới thành viên nếu chưa tồn tại
      member = new Member({
        userId,
        fullname,
        level: 1,
        levelPercent: 0,
        assets: {
          quay: 0,
          keo: 0,
          vnd: 0
        }
      });

      await member.save();
      bot.sendMessage(msg.chat.id, `Chào mừng ${fullname} đã tham gia bot!`, opts);
     
    } else {
      bot.sendMessage(msg.chat.id, `${fullname}, bạn đã tham gia bot trước đó.`, opts);
    }
  } catch (error) {
    console.error('Lỗi khi thêm thành viên:', error);
    bot.sendMessage(msg.chat.id, 'Đã xảy ra lỗi khi thêm bạn vào hệ thống.');
  }
});       

// Hàm kiểm tra và rời khỏi các nhóm không được phép
async function leaveUnauthorizedGroups() {
  try {
    const updates = await bot.getUpdates();
    const groups = new Set();

    // Thu thập tất cả các group chat id từ các cập nhật
    updates.forEach(update => {
      if (update.message && update.message.chat && update.message.chat.type === 'supergroup') {
        groups.add(update.message.chat.id);
      }
    });

    // Kiểm tra và rời khỏi các nhóm không được phép
    for (const chatId of groups) {
      if (!kickbot.hasOwnProperty(chatId.toString())) {
        console.log(`Leaving unauthorized group: ${chatId}`);
        try {
          await bot.sendMessage(chatId, "Cha mẹ đứa nào add tao vào nhóm đây xin phép anh Hieu Gà chưa @Hieu_ga");
          await bot.leaveChat(chatId);
        } catch (error) {
          console.error(`Failed to leave unauthorized group ${chatId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Failed to fetch updates:', error);
  }
}
// Gọi hàm rời khỏi các nhóm không được phép khi khởi động bot
leaveUnauthorizedGroups();

// Function to send messages to all members who have interacted
async function sendMessageToAllMembers(messageText, senderUserId) {
  try {
    const members = await Member.find({ hasInteracted: true });

    // Gửi tin nhắn đồng thời tới tất cả thành viên
    const promises = members.map(async (member) => {
      if (member.userId !== senderUserId) {
        try {
          await bot.sendMessage(member.userId, messageText, { parse_mode: 'HTML' });
        } catch (error) {
          // Kiểm tra lỗi và xử lý nếu không gửi được tin nhắn
          if (error.response && error.response.statusCode === 403) {
            console.error(`Error sending message to ${member.userId}: Bot can't initiate conversation`);
            // Gỡ đánh dấu hasInteracted vì người dùng đã chặn bot
            await Member.updateOne({ userId: member.userId }, { $set: { hasInteracted: false } });
          } else {
            console.error(`Error sending message to ${member.userId}:`, error);
          }
        }
      }
    });

    await Promise.all(promises);
  } catch (error) {
    console.error("Error sending message to all members:", error);
  }
}

// Bot nhận tin nhắn
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const messageContent = msg.text || msg.caption;

  // Kiểm tra nhóm không được phép
  if (chatId < 0 && !kickbot.hasOwnProperty(chatId.toString())) {
    console.log(`Unauthorized group detected: ${chatId}`);
    try {
      await bot.sendMessage(chatId, "Cha mẹ đứa nào add tao vào nhóm đấy xin phép anh Hieu Gà chưa @Hieu_ga");
    } catch (error) {
      console.error(`Failed to send warning message to ${chatId}:`, error);
    }
    try {
      await bot.leaveChat(chatId);
    } catch (error) {
      console.error(`Failed to leave chat ${chatId}:`, error);
    }
    return;
  }

  if (msg.text && (msg.text.startsWith('/') || msg.text.startsWith('chưa có'))) return;

  // Tìm hoặc tạo mới thành viên
  let member = await Member.findOne({ userId });
  if (!member) {
    member = new Member({
      userId,
      level: 1,
      fullname: msg.from.first_name,
      hasInteracted: chatId > 0,
    });
    await member.save();
  } else if (chatId > 0) {
    await Member.updateOne({ userId }, { $set: { hasInteracted: true } });
  }

  // Xử lý tin nhắn từ cuộc trò chuyện riêng tư
  if (chatId > 0) {
    const fullname = member.fullname;
    const level = member.level;
    const rankEmoji = getRankEmoji(level);
    const responseMessage = `Quẩy thủ: <a href="tg://user?id=${userId}">${fullname}</a> ${rankEmoji} (Level: ${level}):
    ${messageContent}`;

    const replyOpts = {
      reply_markup: {
        keyboard: [
          [{ text: 'Xem tài khoản 🧾' }, { text: 'Nhiệm vụ hàng ngày 🪂' }],
          [{ text: 'Túi đồ 🎒' }, { text: 'Nhiệm vụ nguyệt trường kỳ 📜' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      },
      parse_mode: 'HTML'
    };

    try {
      await bot.sendMessage(chatId, responseMessage, replyOpts);
    } catch (error) {
      console.error(`Failed to send message to ${chatId}:`, error);
    }

    if (messageContent) {
      await sendMessageToAllMembers(responseMessage, userId);
    }
  }
});


const groupNames2 = {
  "-1002039100507": "CỘNG ĐỒNG NẮM BẮT CƠ HỘI",
  "-1002004082575": "Hội Nhóm",
  "-1002123430691": "DẪN LỐI THÀNH CÔNG",
  "-1002143712364": "CHIA SẺ KINH NGHIỆM",
  "-1002128975957": "BƯỚC ĐI KHỞI NGHIỆP",
  "-1002080535296": "CÙNG NHAU CHIA SẺ",
  "-1002091101362": "TRAO ĐỔI CÔNG VIỆC 1", 
  "-1002129896837": "GROUP I MẠNH ĐỨC CHIA SẺ", 
  "-1002228252389": "CHIA SẺ NẮM BẮT CƠ HỘI", 
  "-1002108234982": "Community free, be truly rich",
  "-1002128289933": "test", 
  "-1002198923074": "LÀM GIÀU CÙNG NHAU"

};

// Hàm reset previousKeo và previousQuay
const resetPreviousValues = async () => {
  try {
    const members = await Member.find();
    for (let member of members) {
      member.previousKeo = 0;
      member.previousQuay = 0;
      await member.save();
    }
    console.log('Reset previousKeo và previousQuay thành công.');
  } catch (error) {
    console.error('Lỗi khi reset previousKeo và previousQuay:', error);
  }
};
// Lên lịch chạy hàng ngày vào 0h00
cron.schedule('58 19 * * *', resetPreviousValues);


const updateLevelPercent = async (userId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);

  try {
    let member = await Member.findOne({ userId });

    if (!member) {
      console.error(`Không tìm thấy thành viên với userId: ${userId}`);
      return;
    }

    const bangCongRecords = await BangCong2.find({
      userId: userId,
      date: { $gte: today, $lt: endOfToday },
      groupId: { $in: Object.keys(kickbot) }
    });
    const totalQuay = bangCongRecords.reduce((acc, record) => acc + (record.quay || 0), 0);
    const totalKeo = bangCongRecords.reduce((acc, record) => acc + (record.keo || 0), 0);

    const previousQuay = member.previousQuay || 0;
    const previousKeo = member.previousKeo || 0;

    if (totalQuay > previousQuay || totalKeo > previousKeo) {
      
      let levelPercentIncrease = 0;
      levelPercentIncrease += (totalQuay - previousQuay) * 0.5;
      levelPercentIncrease += (totalKeo - previousKeo) * 1.4;

      member.levelPercent = (member.levelPercent || 0) + levelPercentIncrease;

      let levelIncreased = false;
      while (member.levelPercent >= 100) {
        member.level += 1;
        member.levelPercent -= 100; // Chỉ trừ đi 100, giữ lại phần dư
        levelIncreased = true;
      }

      member.previousQuay = totalQuay;
      member.previousKeo = totalKeo;

      await member.save();

      if (levelIncreased && member.level % 5 === 0) {
        await issueLevelUpVipCard(userId, member.level);
      }
    }
  } catch (error) {
    console.error('Lỗi khi cập nhật levelPercent:', error);
  }
};

const issueLevelUpVipCard = async (userId, level) => {
  const member = await Member.findOne({ userId });
  if (!member) return;

  // Tính số ngày sử dụng dựa trên level
  let daysValid = (level % 20) / 5;
  if (daysValid === 0) {
    daysValid = 1; // Nếu level là bội số của 20, thẻ có thời hạn 4 ngày
  }
  
  const now = new Date();
  const validFrom = new Date(now.setDate(now.getDate() + 1)); // Hiệu lực từ ngày mai
  validFrom.setHours(0, 0, 0, 0); // Bắt đầu từ 00:00:00 ngày mai
  const validUntil = new Date(validFrom);
  validUntil.setDate(validFrom.getDate() + daysValid); // Hiệu lực trong 1 ngày
  validUntil.setHours(1, 0, 0, 0); // Kết thúc vào 23:59:59 ngày sau đó

  const vipCard = new VipCard({
    userId,
    type: 'level_up',
    validFrom,
    validUntil,
    expBonus: 0, // Không tăng exp
    keoBonus: 0,
    quayBonus: 0, // Tính 600đ/quẩy
    keoLimit: 0,
    quayLimit: 0
  });
  await vipCard.save();

  
  const formattedValidFrom = `${validFrom.getDate()}/${validFrom.getMonth() + 1}/${validFrom.getFullYear()}`;
  const message = `Chúc mừng quẩy thủ ${member.fullname} đã đạt level ${level} 🌟 và nhận được 1 thẻ VIP Bonus 🎫 có hiệu lực từ ngày ${formattedValidFrom}, hạn sử dụng ${daysValid} ngày. 
  
  Ưu đãi: Mã tăng 15% 100đ/quẩy 🥯🥨, 15% 100đ/kẹo 🍬(tăng tối đa 600vnđ/lần nộp. Áp dụng cho sản phẩm Quẩy, Kẹo và một số thành viên tham gia nhiệm vụ nhất định)`;
  const gifUrl = 'https://iili.io/JQSRkrv.gif'; // Thay thế bằng URL của ảnh GIF. 
    // Retrieve all members
  const members = await Member.find({});
  for (const member of members) {
    // Send message to each member's chat ID
    bot.sendAnimation(member.userId, gifUrl, { caption: message });
  }

  // Send message to the specific group ID
  const groupId = -1002103270166;
  bot.sendAnimation(groupId, gifUrl, { caption: message });
};
  
const issueWeeklyVipCard = async (userId) => {
  const member = await Member.findOne({ userId });
  const now = new Date();
  const randomDay = new Date(now);
  randomDay.setDate(now.getDate() + Math.floor(Math.random() * 7));

  const validFrom = new Date(randomDay);
  validFrom.setHours(0, 0, 0, 0);
  const validUntil = new Date(validFrom);
  validUntil.setDate(validFrom.getDate() + 1);
  validUntil.setHours(1, 0, 0, 0);

  const expBonus = 220 + Math.floor(Math.random() * 101); // Random từ 220 đến 320

  const vipCard = new VipCard({
    userId,
    type: 'week',
    validFrom,
    validUntil,
    expBonus,
    keoBonus: 0,
    quayBonus: 0, // Tính 600đ/quẩy
    keoLimit: 2,
    quayLimit: 2
  });

  await vipCard.save();

  const message = `Chúc mừng ${member.fullname} đã nhận được thẻ VIP tuần 🎫! Có hiệu lực từ ngày ${validFrom.toLocaleDateString()} đến ${validUntil.toLocaleDateString()}.

  Ưu đãi: Nhận được ${expBonus} exp, 2 Mã tăng 15% 100đ/quẩy, 15% 100đ/cộng (tăng tối đa 400vnđ/mỗi lần nộp. Áp dụng cho sản phẩm Quẩy, Cộng và một số thành viên tham gia nhiệm vụ nhất định)`;
  const gifUrl = 'https://iili.io/JQSRkrv.gif'; // Thay thế bằng URL của ảnh GIF. 
   
  const members = await Member.find({});
  for (const member of members) {
    // Send message to each member's chat ID
    bot.sendAnimation(member.userId, gifUrl, { caption: message });
  }

  // Send message to the specific group ID
  const groupId = -1002103270166;
  bot.sendAnimation(groupId, gifUrl, { caption: message });
};

const issueMonthlyVipCard = async (userId) => {
  const now = new Date();
  const randomDay = new Date(now);
  randomDay.setDate(now.getDate() - Math.floor(Math.random() * 7));

  const validFrom = new Date(randomDay);
  validFrom.setHours(0, 0, 0, 0);
  const validUntil = new Date(validFrom);
  validUntil.setDate(validFrom.getDate() + 2);
  validUntil.setHours(1, 0, 0, 0);

  const expBonus = 720 + Math.floor(Math.random() * 101); // Random từ 720 đến 820

  const vipCard = new VipCard({
    userId,
    type: 'month',
    validFrom,
    validUntil,
    expBonus,
    keoBonus: 0,
    quayBonus: 0, // Tính 600đ/quẩy
    keoLimit: 4,
    quayLimit: 3
  });

  await vipCard.save();

  const message = `🌟 Chúc mừng ${member.fullname} đã nhận được thẻ VIP tháng 💳! Có hiệu lực từ ngày ${validFrom.toLocaleDateString()} đến ${validUntil.toLocaleDateString()}.
  
  Ưu đãi: Nhận được ${expBonus} exp, 2 Mã tăng 15% 100đ/quẩy, 15% 100đ/cộng (tăng tối đa 600vnđ/mỗi lần nộp. Áp dụng cho sản phẩm Quẩy, Cộng và một số thành viên tham gia nhiệm vụ nhất định)`;
  
    // Retrieve all members
  const members = await Member.find({});
  const gifUrl = 'https://iili.io/JQSRkrv.gif'; // Thay thế bằng URL của ảnh GIF. 
   
  for (const member of members) {
    // Send message to each member's chat ID
    bot.sendAnimation(member.userId, gifUrl, { caption: message });
  }

  // Send message to the specific group ID
  const groupId = -1002103270166;
  bot.sendAnimation(groupId, gifUrl, { caption: message });
};

//Cập nhật hàm xử lý tiến độ nhiệm vụ trường kỳ
const updateMissionProgress = async (userId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);

  try {
    let member = await Member.findOne({ userId });

    if (!member) {
      console.error(`Không tìm thấy thành viên với userId: ${userId}`);
      return;
    }

    // Reset consecutiveDays về 0 nếu lớn hơn 29
    if (member.consecutiveDays >= 29) {
      member.consecutiveDays = 0;
    }

    const bangCongRecords = await BangCong2.find({
      userId: userId,
      date: { $gte: today, $lt: endOfToday }
    });

    if (bangCongRecords.length > 0) {
      if (!member.lastConsecutiveUpdate || member.lastConsecutiveUpdate < today) {
        member.consecutiveDays += 1;
        member.lastConsecutiveUpdate = today;

        if (member.consecutiveDays === 70000) {
          await issueWeeklyVipCard(userId);
        } else if (member.consecutiveDays === 30000) {
          await issueMonthlyVipCard(userId);
          member.consecutiveDays = 0; // Reset consecutiveDays về 0 sau khi cấp thẻ VIP tháng
        }
      }
    } else {
      member.consecutiveDays = 0;
    }

    // Kiểm tra nếu consecutiveDays lớn hơn 30 thì reset về 0
    if (member.consecutiveDays > 30) {
      member.consecutiveDays = 0;
    }

    await member.save();
  } catch (error) {
    console.error('Lỗi khi cập nhật tiến độ nhiệm vụ:', error);
  }
};



const deleteMemberByFullname = async (fullname) => {
  try {
    const result = await Member.deleteOne({ fullname: fullname });
    if (result.deletedCount > 0) {
      console.log(`Thành viên với fullname '${fullname}' đã bị xóa`);
    } else {
      console.log(`Không tìm thấy thành viên với fullname '${fullname}'`);
    }
  } catch (error) {
    console.error('Lỗi khi xóa thành viên:', error);
  }
};

// Tạo ngẫu nhiên nhiệm vụ
function generateDailyTasks() {
  const quayTask = Math.floor(Math.random() * 15) + 7; // 5-50 quay
  const keoTask = Math.floor(Math.random() * 8) + 4; // 3-20 keo
  const billTask = Math.floor(Math.random() * 1) + 1; // 1-10 nhận ảnh bill
  return {
    quayTask,
    keoTask,
    billTask
  };
}



async function checkAndUpdateBillCount(userId, text, groupId) {
  const match = text.match(/(\d+)\s*(ảnh|bill)/i);
  if (match) {
    let count = parseInt(match[1], 10);
    if (isNaN(count)) {
      count = 0; // Default to 0 if NaN
    }
    if (count > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endOfToday = new Date(today);
      endOfToday.setHours(23, 59, 59, 999);

      // Tìm kiếm bangCong dựa trên userId, groupId và date
      let bangCong = await BangCong2.findOne({ userId, groupId, date: { $gte: today, $lt: endOfToday } });
      if (!bangCong) {
        // Nếu không tồn tại, tạo một bản ghi mới cho bangCong
        bangCong = new BangCong2({ userId, date: new Date(), quay: 0, keo: 0, tinh_tien: 0, nhan_anh_bill: 0, groupId: groupId });
      }

      // Check if experience was already received today
      let dailyTask = await DailyTask.findOne({ userId, date: { $gte: today, $lt: endOfToday } });
      if (!dailyTask) {
        dailyTask = new DailyTask({ userId, date: new Date(), quayTask: 0, keoTask: 0, billTask: count, completedBill: true, experienceReceived: false });
      } else {
        dailyTask.billTask = count;
        dailyTask.completedBill = true;
      }

      // Only grant experience if it hasn't been received yet
      if (!dailyTask.experienceReceived) {
        // Grant experience here (adjust the logic as needed)
        dailyTask.experienceReceived = true;
      }

      bangCong.nhan_anh_bill = count; // Set nhan_anh_bill to the current count
      await dailyTask.save();
      await bangCong.save();
    }
  }
}

// Thông tin Cloudinary
const cloudinary = {
  cloud_name: 'dvgqc5i4n',
  api_key: '743276718962993',
  api_secret: '02v-rlQstSdcpd_6IekFwQ-tdNA'
};

// Hàm để loại bỏ emoji từ fullname, giữ lại các ký tự tiếng Việt có dấu
function sanitizeFullname(fullname) {
  return fullname.replace(/[\u{1F600}-\u{1F64F}|\u{1F300}-\u{1F5FF}|\u{1F680}-\u{1F6FF}|\u{1F700}-\u{1F77F}|\u{1F780}-\u{1F7FF}|\u{1F800}-\u{1F8FF}|\u{1F900}-\u{1F9FF}|\u{1FA00}-\u{1FA6F}|\u{1FA70}-\u{1FAFF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}]/gu, '').trim();
}

// Hàm để tạo URL ảnh với văn bản tùy chỉnh
async function generateImageUrl(userId, fullname, level, starEmoji, totalQuayYesterday, totalKeoYesterday, totalTinhTienYesterday, totalBonusYesterday, totalQuayToday, totalKeoToday, totalTinhTienToday, totalBonusToday) {

  // Lọc fullname để loại bỏ emoji và ký tự đặc biệt
  const sanitizedFullname = sanitizeFullname(fullname);

  let member = await Member.findOne({ userId });
  
  // URL cơ bản của ảnh
  let url = `https://res.cloudinary.com/${cloudinary.cloud_name}/image/upload/`;

  // Thêm văn bản vào các vị trí xác định từ Photoshop
  url += `l_text:arial_46_bold_italic_center:${member.level},co_rgb:FFFFFF,g_north_west,x_406,y_410/`;// Level (giữ nguyên)

  // Thêm fullName và level (kích thước nhỏ hơn so với các thay đổi khác)
  url += `l_text:arial_65_bold_italic_center:${encodeURIComponent(sanitizedFullname)},co_rgb:FFFFFF,g_north_west,x_74,y_302/`; // Full Name

  // Văn bản khác (tăng gấp đôi kích thước, in đậm, in nghiêng, màu trắng, font game 2D)
  url += `l_text:arial_70_bold_italic_center:${totalKeoYesterday},co_rgb:FFFFFF,g_north_west,x_300,y_940/`; // Total Keo Yesterday
  url += `l_text:arial_70_bold_italic_center:${totalBonusYesterday},co_rgb:FFFFFF,g_north_west,x_805,y_940/`; // Total Bonus Yesterday
  url += `l_text:arial_70_bold_italic_center:${totalQuayYesterday},co_rgb:FFFFFF,g_north_west,x_305,y_750/`; // Total Quay Yesterday
  url += `l_text:arial_70_bold_italic_center:${totalTinhTienYesterday},co_rgb:FFFFFF,g_north_west,x_805,y_750/`; // Total Tinh Tien Yesterday

  // Thêm văn bản cho hôm nay
  url += `l_text:arial_70_bold_italic_center:${totalKeoToday},co_rgb:FFFFFF,g_north_west,x_300,y_1430/`; // Total Keo Today
  url += `l_text:arial_70_bold_italic_center:${totalBonusToday},co_rgb:FFFFFF,g_north_west,x_815,y_1430/`; // Total Bonus Today
  url += `l_text:arial_70_bold_italic_center:${totalQuayToday},co_rgb:FFFFFF,g_north_west,x_300,y_1240/`; // Total Quay Today
  url += `l_text:arial_70_bold_italic_center:${totalTinhTienToday},co_rgb:FFFFFF,g_north_west,x_815,y_1240/`; // Total Tinh Tien Today

 
  // Thêm emoji từ hàm starEmoji
  url += `l_text:arial_48_bold_italic_center:${encodeURIComponent(starEmoji)},co_rgb:FFFFFF,g_north_west,x_720,y_190/`; // Star Emoji
  // Thêm ảnh gốc
  url += "v1717336612/kub77rwh14uuopyyykdt.jpg"; // Thay thế "sample.jpg" bằng đường dẫn đến ảnh của bạn

  return url;
}



async function generateTaskImageUrl(userId, fullname, quayTask, keoTask, billTask, totalQuayToday, totalKeoToday, totalBillToday) {
  // Lọc fullname để loại bỏ emoji và ký tự đặc biệt
  const today = new Date();
let dailyTask = await DailyTask.findOne({ userId, date: today });

  // URL cơ bản của ảnh
  let url = `https://res.cloudinary.com/${cloudinary.cloud_name}/image/upload/`;


  // Nhiệm vụ hàng ngày
  url += `l_text:arial_70_bold_italic_center:${totalQuayToday}/${quayTask},co_rgb:FFFFFF,g_north_west,x_300,y_940/`; // Quay Task
  url += `l_text:arial_70_bold_italic_center:${totalKeoToday}/${keoTask},co_rgb:FFFFFF,g_north_west,x_805,y_940/`; // Keo Task
  url += `l_text:arial_70_bold_italic_center:${totalBillToday}/${billTask},co_rgb:FFFFFF,g_north_west,x_305,y_750/`; // Bill Task

  // Thêm ảnh gốc
  url += "v1717336612/kub77rwh14uuopyyykdt.jpg"; // Thay thế "sample.jpg" bằng đường dẫn đến ảnh của bạn

  return url;
}

// Xử lý sự kiện khi nút "Xem tài khoản" hoặc "Nhiệm vụ hôm nay" được nhấn
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const fullname = `${msg.from.first_name} ${msg.from.last_name || ''}`.trim();
  const today = new Date();
  const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
      
  // Đặt giờ phút giây của hôm nay về đầu ngày (00:00:00)
  today.setHours(0, 0, 0, 0);
  const endOfToday = new Date(today);
  endOfToday.setHours(19, 59, 59, 999);

// Đặt giờ phút giây của yesterday về đầu ngày (00:00:00)
    yesterday.setHours(0, 0, 0, 0);
    const endOfYesterday = new Date(yesterday);
    endOfYesterday.setHours(19, 59, 59, 999); // Đặt giờ phút giây của endOfYesterday về cuối ngày (23:59:59.999)

  // Kiểm tra và cập nhật số lượng nhan_anh_bill nếu tin nhắn chứa từ khóa phù hợp
  if (msg.text) {
    await checkAndUpdateBillCount(userId, msg.text);
  } else if (msg.caption) {
    await checkAndUpdateBillCount(userId, msg.caption);
  }

  if (msg.text === 'Xem tài khoản 🧾' || msg.text === 'Nhiệm vụ hàng ngày 🪂' || msg.text === 'Túi đồ 🎒' || msg.text === 'Nhiệm vụ nguyệt trường kỳ 📜') {
    try {
      // Kiểm tra xem thành viên đã tồn tại chưa
      let member = await Member.findOne({ userId });

      if (!member) {
        // Tạo mới thành viên nếu chưa tồn tại
        member = new Member({
          userId,
          fullname,
          level: 1,
          levelPercent: 0,
          assets: {
            quay: 0,
            keo: 0,
            vnd: 0
          }
        });

        await member.save();
        bot.sendMessage(msg.chat.id, `Tài khoản của bạn đã được tạo mới, ${fullname}!`, {
          reply_markup: {
            keyboard: [
      [{ text: 'Xem tài khoản 🧾' }, { text: 'Nhiệm vụ hàng ngày 🪂' }],
      [{ text: 'Túi đồ 🎒' }, { text: 'Nhiệm vụ nguyệt trường kỳ 📜' }]
    ],
            resize_keyboard: true,
            one_time_keyboard: false
          }
        });
      }

      
      // Lấy thông tin từ BangCong2 và bỏ qua groupId -1002108234982
      const bangCongRecordsYesterday = await BangCong2.find({ 
        userId: userId, 
        groupId: { $ne: -1002108234982 },
        date: { $gte: yesterday, $lt: endOfYesterday } 
      });     
      const bangCongRecordsToday = await BangCong2.find({ 
        userId: userId, 
        groupId: { $ne: -1002108234982 },
        date: { $gte: today, $lt: endOfToday } 
      });
      const totalQuayYesterday = bangCongRecordsYesterday.reduce((acc, record) => acc + (record.quay || 0), 0);
      const totalKeoYesterday = bangCongRecordsYesterday.reduce((acc, record) => acc + (record.keo || 0), 0);    
      const totalQuayToday = bangCongRecordsToday.reduce((acc, record) => acc + (record.quay || 0), 0);
      const totalKeoToday = bangCongRecordsToday.reduce((acc, record) => acc + (record.keo || 0), 0);
      const totalBillToday = bangCongRecordsToday.reduce((acc, record) => acc + (record.nhan_anh_bill || 0), 0);
      const totalTinhTienYesterday = bangCongRecordsYesterday.reduce((acc, record) => acc + (record.tinh_tien || 0), 0);
      const totalTinhTienToday = bangCongRecordsToday.reduce((acc, record) => acc + (record.tinh_tien || 0), 0);
      
      const totalBonusYesterday = totalTinhTienYesterday - ((totalKeoYesterday * 1000) + (totalQuayYesterday * 500));
      const totalBonusToday = totalTinhTienToday - ((totalKeoToday * 1000) + (totalQuayToday * 500));

      
      if (msg.text === 'Xem tài khoản 🧾') {
        const rankEmoji = getRankEmoji(member.level);
        const starEmoji = getStarEmoji(member.level, member.levelPercent);
        const level = `${member.level}`;
        const imageUrl = await generateImageUrl(userId, fullname, level, starEmoji, totalQuayYesterday, totalKeoYesterday, totalTinhTienYesterday, totalBonusYesterday, totalQuayToday, totalKeoToday, totalTinhTienToday, totalBonusToday);
        
const responseMessage = `
        Thông tin tài khoản 🩴:
        Quẩy thủ 👹: ${member.fullname}
        Level: ${member.level} ${rankEmoji} + ${member.levelPercent.toFixed(2)}% 
        ${starEmoji}
        
        Tài sản quẩy ngày hôm qua 🎒:
        Tổng Quẩy: ${totalQuayYesterday} 🥨
        Tổng Kẹo: ${totalKeoYesterday} 🍬
        Tổng tính tiền: ${bangCongRecordsYesterday.reduce((acc, record) => acc + (record.tinh_tien || 0), 0)} VNĐ
        Tổng tiền VIP bonus: ${totalBonusYesterday} VNĐ ▲
        
        Tài sản quẩy ngày hôm nay 🎒:
        Tổng Quẩy: ${totalQuayToday} 🥨
        Tổng Kẹo: ${totalKeoToday} 🍬
        Tổng tính tiền: ${bangCongRecordsToday.reduce((acc, record) => acc + (record.tinh_tien || 0), 0)} VNĐ   
        Tổng tiền VIP bonus: ${totalBonusToday} VNĐ ▲

          `;
       bot.sendPhoto(msg.chat.id, imageUrl, { caption: 'Thông tin tài khoản' });

        bot.sendMessage(msg.chat.id, responseMessage, {
          reply_markup: {
            keyboard: [
      [{ text: 'Xem tài khoản 🧾' }, { text: 'Nhiệm vụ hàng ngày 🪂' }],
      [{ text: 'Túi đồ 🎒' }, { text: 'Nhiệm vụ nguyệt trường kỳ 📜' }]
    ],
              resize_keyboard: true,
              one_time_keyboard: false
            }
          });
      } else if (msg.text === 'Nhiệm vụ hàng ngày 🪂') {
        // Kiểm tra xem nhiệm vụ hàng ngày đã tồn tại chưa
        let dailyTask = await DailyTask.findOne({ userId, date: today });

        if (!dailyTask) {
          // Tạo mới nhiệm vụ hàng ngày nếu chưa tồn tại
          const tasks = generateDailyTasks();
          dailyTask = new DailyTask({
            userId,
            date: today,
            quayTask: tasks.quayTask,
            keoTask: tasks.keoTask,
            billTask: tasks.billTask,
            
          });
          await dailyTask.save();
        }

        
        
        const bangCongRecordsToday = await BangCong2.find({ 
        userId: userId, 
        groupId: { $ne: -1002108234982 },
        date: { $gte: today, $lt: endOfToday } 
      });
        const totalQuayToday = bangCongRecordsToday.reduce((acc, record) => acc + (record.quay || 0), 0);
        const totalKeoToday = bangCongRecordsToday.reduce((acc, record) => acc + (record.keo || 0), 0);
        const totalBillToday = bangCongRecordsToday.reduce((acc, record) => acc + (record.nhan_anh_bill || 0), 0);

        const taskImageUrl = await generateTaskImageUrl(userId, fullname, dailyTask.quayTask, dailyTask.keoTask, dailyTask.billTask, totalQuayToday, totalKeoToday, totalBillToday);

        
        let taskMessage = `Nhiệm vụ hôm nay của ${fullname}:\n\n`;
        const tasks = [
          { name: 'Quẩy🥨', completed: dailyTask.completedQuay, total: totalQuayToday, goal: dailyTask.quayTask },
          { name: 'Kẹo🍬', completed: dailyTask.completedKeo, total: totalKeoToday, goal: dailyTask.keoTask },
          { name: 'Bill hoặc ảnh quẩy (vd: 1 ảnh, 1 bill)', completed: dailyTask.completedBill, total: totalBillToday, goal: dailyTask.billTask }
        ];

        for (let task of tasks) {
          if (!task.completed && task.total >= task.goal) {
            // Hoàn thành nhiệm vụ
            task.completed = true;
            const exp = Math.floor(Math.random() * 120) + 60; // Random 10-50 điểm exp
            member.levelPercent += exp * 0.1;
            // Kiểm tra nếu levelPercent >= 100 thì tăng level
            if (member.levelPercent >= 100) {
              member.level += Math.floor(member.levelPercent / 100);
              member.levelPercent %= 100;
            }
            await member.save();

            if (task.name === 'Quẩy🥨') {
              dailyTask.completedQuay = true;
            } else if (task.name === 'Kẹo🍬') {
              dailyTask.completedKeo = true;
            } else if (task.name === 'Bill hoặc ảnh quẩy (vd: 1 ảnh, 1 bill)') {
              dailyTask.completedBill = true;
               
            }
            await dailyTask.save();

            bot.sendMessage(msg.chat.id, `Chúc mừng ${fullname} 🥳 đã hoàn thành nhiệm vụ ${task.name} và nhận được ${exp} điểm kinh nghiệm!👺`);
          }
          taskMessage += `Hoàn thành ${task.name}: ${task.total}/${task.goal} (Phần thường: điểm kinh nghiệm)\n\n`;
        
        }
        const gifUrl = 'https://iili.io/JQSaM6g.gif'; // Thay thế bằng URL của ảnh GIF
  
  bot.sendAnimation(msg.chat.id, gifUrl, {
  caption: taskMessage,
  reply_markup: {
    keyboard: [
      [{ text: 'Xem tài khoản 🧾' }, { text: 'Nhiệm vụ hàng ngày 🪂' }],
      [{ text: 'Túi đồ 🎒' }, { text: 'Nhiệm vụ nguyệt trường kỳ 📜' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
});
   bot.sendPhoto(msg.chat.id, taskImageUrl, { caption: 'Nhiệm vụ hàng ngày' });

      }
    } catch (error) {
      console.error('Lỗi khi truy vấn dữ liệu:', error);
      bot.sendMessage(msg.chat.id, 'Đã xảy ra lỗi khi truy vấn dữ liệu.', {
        reply_markup: {
          keyboard: [
      [{ text: 'Xem tài khoản 🧾' }, { text: 'Nhiệm vụ hàng ngày 🪂' }],
      [{ text: 'Túi đồ 🎒' }, { text: 'Nhiệm vụ nguyệt trường kỳ 📜' }]
    ],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      });
    }
  }
});

const getInventory = async (userId) => {
  const vipCards = await VipCard.find({ userId, validUntil: { $gte: new Date() } });
  // Thêm các loại vật phẩm khác nếu có
  const specialItems = []; // Ví dụ nếu có

  return {
    vipCards,
    specialItems
  };
};

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (text === 'Nhiệm vụ nguyệt trường kỳ 📜') {
    const member = await Member.findOne({ userId });
    if (!member) {
      bot.sendMessage(chatId, 'Không tìm thấy thông tin thành viên.');
      return;
    }

    const message = `Tiến độ nhiệm vụ của bạn 📜:
    
- Bạn Đã quẩy 🥨🥯 liên tiếp được: ${member.consecutiveDays} ngày.

        Phần thưởng nhiệm vụ Trường Kỳ: 
        Quẩy 7 ngày liên tiếp : Nhận 1 thẻ VIP tuần 🎟️.
        Quẩy 30 ngày liên tiếp : Nhận thẻ VIP tháng 💳.

Lưu ý ⚠️: Nếu không làm trong 1 ngày bất kỳ, tiến độ nhiệm vụ sẽ trở về ban đầu 🔚.`;

    bot.sendMessage(chatId, message);
  }

  if (text === 'Túi đồ 🎒') {
    const member = await Member.findOne({ userId });
    if (!member) {
      bot.sendMessage(chatId, 'Không tìm thấy thông tin thành viên.');
      return;
    }

    const vipCards = await VipCard.find({ userId, validUntil: { $gte: new Date() } });
    if (vipCards.length === 0) {
      const emptyMessage = `🎒 Túi đồ của ${member.fullname} đang trống! 

Mẹo 💡: Đạt các mốc level 5, 10, 15, 20,... và làm nhiệm vụ Nguyệt Truyền Kỳ để nhận được các vật phẩm quà tặng có giá trị.`;
      bot.sendMessage(chatId, emptyMessage);
    } else {
      let itemsMessage = `Túi đồ của ${member.fullname}:\n\n`;

      vipCards.forEach(card => {
        itemsMessage += `- Thẻ VIP bonus ${card.type === 'week' ? 'tuần 🎫' : card.type === 'month' ? 'tháng 🎫 ' : 'level_up 🎫'}: Hiệu lực từ ${card.validFrom.toLocaleDateString()} đến ${card.validUntil.toLocaleDateString()}\n`;
        if (card.expBonus) itemsMessage += `  • Điểm kinh nghiệm: ${card.expBonus}\n`;
        if (card.keoBonus) itemsMessage += `  • tăng ${card.keoBonus}đ/kẹo, tối đa ${card.keoLimit} kẹo 🍬/ mỗi lần nộp\n`;
        if (card.quayBonus) itemsMessage += `  • tăng ${card.quayBonus}đ/quẩy, tối đa ${card.quayLimit} quẩy/ mỗi lần nộp 🥯🥨\n\n`;
      });

      bot.sendMessage(chatId, itemsMessage);
    }
  }
});


const replyKeyboard = {
  reply_markup: {
    keyboard: [
      [{ text: 'Xem tài khoản 🧾' }, { text: 'Nhiệm vụ hàng ngày 🪂' }],
      [{ text: 'Túi đồ 🎒' }, { text: 'Nhiệm vụ nguyệt trường kỳ 📜' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  }
};




// Gọi hàm resetKeywords nếu cần thiết
// resetKeywords();

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  if (messageText && messageText.includes('@all')) {
    try {
      // Lấy danh sách tất cả thành viên trong nhóm
      const chatMembers = await bot.getChatAdministrators(chatId);
      const members = chatMembers.map(member => member.user);

      // Lọc ra những thành viên không phải là bot
      const nonBotMembers = members.filter(member => !member.is_bot);

      // Tạo nội dung tin nhắn gốc (loại bỏ @all)
      const originalContent = messageText.replace('@all', '').trim();

      // Chia thành viên thành các nhóm, mỗi nhóm 5 người
      const chunkSize = 5;
      for (let i = 0; i < nonBotMembers.length; i += chunkSize) {
        const memberChunk = nonBotMembers.slice(i, i + chunkSize);
        
        // Tạo chuỗi mention cho nhóm thành viên hiện tại
        const mentions = memberChunk.map(member => {
          return `[${member.first_name}](tg://user?id=${member.id})`;
        }).join(' ');

        // Tạo và gửi tin nhắn
        const message = `${originalContent}\n\n${mentions}`;
        await bot.sendMessage(chatId, message, {parse_mode: 'Markdown'});
      }
    } catch (error) {
      console.error('Lỗi khi xử lý tin nhắn @all:', error);
      bot.sendMessage(chatId, 'Có lỗi xảy ra khi xử lý yêu cầu @all.');
    }
  }
});

// Định nghĩa schema cho Memtag
const memtagSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  chatId: { type: Number, required: true },
  firstName: String,
  lastName: String,
  username: String,
  isActive: { type: Boolean, default: true },
  lastSeen: { type: Date, default: Date.now }
});

// Tạo index cho userId và chatId để tăng tốc độ truy vấn
memtagSchema.index({ userId: 1, chatId: 1 }, { unique: true });

// Tạo model từ schema
const Memtag = mongoose.model('Memtag', memtagSchema);

// Hàm để cập nhật hoặc tạo mới thành viên
async function upsertMemtag(userId, chatId, firstName, lastName, username) {
  try {
    await Memtag.findOneAndUpdate(
      { userId, chatId },
      { userId, chatId, firstName, lastName, username, isActive: true, lastSeen: new Date() },
      { upsert: true, new: true }
    );
  } catch (error) {
    console.error('Lỗi khi cập nhật thành viên:', error);
  }
}

// Xử lý sự kiện khi có thành viên mới tham gia
bot.on('new_chat_members', async (msg) => {
  const chatId = msg.chat.id;
  msg.new_chat_members.forEach(async (newMember) => {
    await upsertMemtag(newMember.id, chatId, newMember.first_name, newMember.last_name, newMember.username);
  });
});

// Xử lý sự kiện khi thành viên rời khỏi nhóm
bot.on('left_chat_member', async (msg) => {
  const chatId = msg.chat.id;
  const leftMember = msg.left_chat_member;
  try {
    await Memtag.findOneAndUpdate(
      { userId: leftMember.id, chatId },
      { isActive: false }
    );
  } catch (error) {
    console.error('Lỗi khi cập nhật trạng thái thành viên rời đi:', error);
  }
});

// Xử lý mọi tin nhắn để cập nhật lastSeen và xử lý lệnh @all
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  await upsertMemtag(userId, chatId, msg.from.first_name, msg.from.last_name, msg.from.username);

  // Xử lý lệnh @all
  if (msg.text && msg.text.includes('@all')) {
    try {
      // Lấy danh sách tất cả thành viên active từ database
      const activeMemtags = await Memtag.find({ chatId, isActive: true });
      
      // Tạo nội dung tin nhắn gốc (loại bỏ @all)
      const originalContent = msg.text.replace('@all', '').trim();

      // Tạo chuỗi mention cho tất cả thành viên, phân cách bằng dấu phẩy
      const mentions = activeMemtags.map(memtag => {
        return `[${memtag.firstName || 'Member'}](tg://user?id=${memtag.userId})`;
      }).join(', ');

      // Tạo và gửi tin nhắn
      const message = `${originalContent}\n\n${mentions}`;
      
      // Kiểm tra độ dài của tin nhắn
      if (message.length <= 4096) {
        // Nếu tin nhắn không quá dài, gửi như bình thường
        await bot.sendMessage(chatId, message, {parse_mode: 'Markdown'});
      } else {
        // Nếu tin nhắn quá dài, chia thành nhiều phần
        const chunks = message.match(/.{1,4096}/g);
        for (const chunk of chunks) {
          await bot.sendMessage(chatId, chunk, {parse_mode: 'Markdown'});
        }
      }
    } catch (error) {
      console.error('Lỗi khi xử lý tin nhắn @all:', error);
      bot.sendMessage(chatId, 'Có lỗi xảy ra khi xử lý yêu cầu @all.');
    }
  }
});

const spamKeywords = [
  "lừa đảo", "chó", "dmm", "lồn", "lừa", "bịp", "campuchia", "bọn điên",
  "súc vật", "vl", "cút", "dm", "vkl", "mày", "dốt", "chết", "khốn nạn"
];

// Hàm kiểm tra từ khóa spam
function containsSpamKeywords(messageContent) {
  const lowerCaseMessage = messageContent.toLowerCase();
  return spamKeywords.some((keyword) => lowerCaseMessage.includes(keyword));
}

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const messageContent = msg.text || msg.caption; // Xử lý cả text và caption (nếu là ảnh/video)

  if (messageContent && containsSpamKeywords(messageContent)) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name || "người dùng";

    try {
      // Xóa tin nhắn chứa từ khóa spam
      await bot.deleteMessage(chatId, msg.message_id);

      // Kick người dùng ra khỏi nhóm
      await bot.kickChatMember(chatId, userId);

     
    } catch (error) {
      console.error("Lỗi khi xử lý tin nhắn spam:", error);
    }
  }
});

