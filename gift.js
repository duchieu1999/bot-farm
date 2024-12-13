const cron = require('node-cron');

// Danh sách các câu chào buổi sáng ngẫu nhiên
const morningGreetings = [
  "Chúc buổi sáng vui vẻ! Ai muốn thử vận may nào",
  "Sáng nay thật tuyệt! Ai muốn nhận quà không",
  "Chúc mọi người một buổi sáng tươi sáng! Ai sẽ nhận quà hôm nay?",
  "Chào buổi sáng những quẩy thủ! Nắng đã lên, gió đã thổi, ai còn chăn ấm nệm êm thì mau thức dậy nào!",
"Bùm chíu bùm chíu! Buổi sáng hân hoan đã đến rồi! Lắc lư nào các chiến binh, quẩy tung nóc nhà thôi!",
"Cà phê sữa đá, bánh mì nóng hổi! Buổi sáng tuyệt vời thế này không quẩy thì quẩy lúc nào?",
"Tí tách tí tách, chuông báo thức reo vang! Nhanh chóng nào quẩy team, ngày mới hứa hẹn nhiều niềm vui đây!",
"Hôm nay trời xanh mây trắng, chim hót líu lo. Thích hợp vô cùng để quẩy hết mình nào các chiến binh!",
"Đã đến giờ nạp năng lượng cho ngày mới! Quẩy tung nóc nhà với những ly trà sữa mát lạnh nào!",
"Bỏ qua mọi muộn phiền, chào đón ngày mới với nụ cười rạng rỡ! Cùng quẩy lên nào các quẩy thủ ơi!",
"Sáng nay ai dậy sớm nhất? Nhận ngay phần quà đặc biệt từ quẩy team nhé!",
"Cùng nhau quẩy hết mình, biến ngày mới thành ngày tuyệt vời nhất nào!",
"Lắc lư theo tiếng nhạc, phiêu theo điệu nhảy. Buổi sáng quẩy hăng say, cả ngày vui vẻ!",
"Bánh mì nóng hổi, giòn tan ai mua không? Nhanh tay lên nào, quẩy team đợi hụt hẫng lắm đây!",
"Cà phê sữa đá, trà đá mát lạnh ai gọi? Sáng nay quẩy hăng say nào các chiến binh!",
"Mở TikTok lên nào, bao nhiêu clip hài hước đang chờ chúng ta quẩy tưng bừng đây!",
"Sáng dậy chán cơm rồi thì sao? Bún chả, phở bò, bánh mì kẹp thịt, ai thèm gì quẩy team gọi ship ngay!",
"Trời ơi, trúng thưởng rồi! Hôm nay ai may mắn nhất nhỉ? quẩy team lì xì cho người may mắn nào!",
"Sáng nay ai dậy sớm nhất? Nhận ngay phần quà bí mật từ quẩy team nhé!",
"Chào ngày mới, Cùng nhau quẩy nào! Hôm nay quẩy team quyết tâm phá đảo mọi thử thách!",
"Team ơi sáng đi học cẩn thận kẻo đụng độ crush đi học chung nhé! Mau quẩy cho đẹp trai xinh gái nào!",
"Chào buổi sáng, lát đi đâu đừng quên đeo khẩu trang khi ra ngoài nhé! Quẩy team chung tay bảo vệ sức khỏe cộng đồng!",
"Sáng nay ai quẩy hăng say nhất? Tối nay được quẩy team đãi kem nhé!",
"Sáng nay trời đẹp thế này, không quẩy thì phí cả một ngày! Ra ngoài hít thở không khí nào!",
"Nhạc nào, playlist nào? Cùng nhau quẩy tung nóc nhà với những giai điệu sôi động nào!",
"Ai còn ngủ nướng? Dậy mau quẩy nào! Hôm nay có bao nhiêu niềm vui đang chờ đón!",
"Buổi sáng vui vẻ, sáng nay muốn quẩy kiểu gì? Đi phượt, đi cafe, hay tụ tập chơi game? Chia sẻ với cả nhóm nào!",
"Chào ngày mới, cùng nhau quẩy hết mình, xả stress sau những giờ học tập và làm việc căng thẳng!",
"Chúc một buổi sáng quẩy vui vẻ, tinh thần sẽ phấn chấn, học tập và làm việc cũng hiệu quả hơn!",
];

// Đặt lại trạng thái hàng ngày
function resetDailyGiftStatus(DailyGiftStatus) {
  cron.schedule(
    '28 6 * * *',
    async () => {
      await DailyGiftStatus.updateMany(
        {}, 
        { $set: { dailyGiftClaims: [], giftWonToday: false } }
      );
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
    }
  );
}

// Gửi tin nhắn chào buổi sáng
function sendMorningMessage(bot) {
  const chatId = -1002103270166; // ID nhóm cần gửi tin nhắn

  cron.schedule(
    '30 6 * * *',
    () => {
      const inlineKeyboard = {
        inline_keyboard: [
          [
            {
              text: 'Nhận lộc may mắn hôm nay',
              callback_data: 'lucky_gift',
            },
          ],
        ],
      };

      const morningGreeting = morningGreetings[
        Math.floor(Math.random() * morningGreetings.length)
      ];

      bot.sendMessage(chatId, morningGreeting, {
        reply_markup: inlineKeyboard,
      });
    },
    {
      timezone: 'Asia/Ho_Chi_Minh',
    }
  );
}

// Xử lý khi người dùng nhận phần quà
async function handleGiftClaim(bot, callbackQuery, BangCong2, DailyGiftStatus) {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const fullName = `${callbackQuery.from.first_name} ${callbackQuery.from.last_name || ''}`;

  const today = new Date().toLocaleDateString();

  // Truy xuất trạng thái từ MongoDB
  let dailyStatus = await DailyGiftStatus.findOne({ date: today });

  if (!dailyStatus) {
    dailyStatus = await DailyGiftStatus.create({
      date: today,
      dailyGiftClaims: [],
      giftWonToday: false,
    });
  }

  if (dailyStatus.dailyGiftClaims.includes(userId)) {
    bot.answerCallbackQuery(callbackQuery.id, {
      text: "Bạn đã thử nhận lộc hôm nay rồi!",
      show_alert: true,
    });
    return;
  }

  if (dailyStatus.giftWonToday) {
    bot.answerCallbackQuery(callbackQuery.id, {
      text: "Đã có người nhận được lộc hôm nay rồi, hãy thử vận may vào ngày mai.",
      show_alert: true,
    });
    return;
  }

  // Cập nhật trạng thái trong bộ nhớ và MongoDB
  dailyStatus.dailyGiftClaims.push(userId);

  const isWinner = Math.random() < 0.20;

  if (isWinner) {
    dailyStatus.giftWonToday = true;

    // Tạo số ngẫu nhiên từ 400 đến 1000
const randomAmount = 400 + Math.random() * (1000 - 400);

// Làm tròn đến hàng chục
const prize = Math.round(randomAmount / 10) * 10;


    bot.answerCallbackQuery(callbackQuery.id, {
      text: `Chúc mừng! Bạn đã trúng ${prize}vnđ lộc 🎉`,
      show_alert: true,
    });

    await BangCong2.create({
      userId,
      groupId: chatId,
      date: today,
      ten: fullName,
      giftWon: true,
      prizeAmount: prize,
    });

    await dailyStatus.save(); // Lưu trạng thái cập nhật

    bot.sendMessage(chatId, `Chúc mừng ${fullName} đã nhận được lộc may mắn hôm nay với ${prize}vnđ và được cộng vào bảng công!`);
  } else {
    bot.answerCallbackQuery(callbackQuery.id, {
      text: "Rất tiếc! Bạn không trúng lộc hôm nay, hãy thử lại vào ngày mai.",
      show_alert: true,
    });
  }

  await dailyStatus.save(); // Đảm bảo trạng thái được lưu
}

module.exports = {
  resetDailyGiftStatus,
  sendMorningMessage,
  handleGiftClaim,
};
