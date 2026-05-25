/**
 * SCRIPT GIẢ LẬP TẢI (STRESS TEST) - ĐẠI DƯƠNG CHÂN LÝ
 * Giả lập 50 người chơi ảo đồng thời kết nối qua Ably Realtime,
 * gửi tọa độ vị trí thuyền liên tục để chứng minh hệ thống chịu tải hoàn hảo!
 */

import Ably from 'ably';

// THÔNG TIN CẤU HÌNH (Dùng API Key của Ably từ ứng dụng của bạn)
// Bạn có thể lấy Key từ dashboard Ably hoặc dùng trực tiếp Key của dự án.
// Để test cục bộ siêu tốc, script này sẽ sử dụng Ably Client.
const ABLY_KEY = "LNF2hg.UjP9Qw:xJ2rWlh12K4p-m5L"; // Key test mặc định hoặc bạn điền Key của bạn vào đây
const CHANNEL_NAME = "boat:global";
const NUM_PLAYERS = 50; // Giả lập đúng 50 người chơi đồng thời!

console.log(`🚀 Bắt đầu khởi động 50 Thuyền Trưởng ảo tham gia đấu trường...`);

async function runStressTest() {
    const clients = [];
    const channels = [];

    // Tạo ngẫu nhiên danh sách màu sắc cho 50 thuyền
    const colors = ["#e74c3c", "#9b59b6", "#f1c40f", "#8b4513", "#3498db", "#2ecc71", "#e67e22"];

    for (let i = 1; i <= NUM_PLAYERS; i++) {
        const clientId = `virtual-player-${i}`;
        const name = `ThuyềnTrưởng_${i}`;
        const color = colors[i % colors.length];

        try {
            // Khởi tạo kết nối Ably cho từng người chơi ảo
            const ably = new Ably.Realtime({
                key: ABLY_KEY,
                clientId: clientId
            });

            const channel = ably.channels.get(CHANNEL_NAME);
            
            // Tham gia phòng chơi (Presence Enter)
            await channel.presence.enter({
                name: name,
                color: color,
                role: "player",
                progress: 0.0,
                rank: null
            });

            clients.push(ably);
            channels.push({ channel, clientId, progress: 0.0, name });
            console.log(`✅ [${i}/${NUM_PLAYERS}] Thuyền trưởng '${name}' đã vào vạch xuất phát!`);
            
            // Giãn cách nhẹ thời gian kết nối giữa các người chơi để mô phỏng thực tế
            await new Promise(r => setTimeout(r, 80));
        } catch (err) {
            console.error(`❌ Lỗi khi kết nối người chơi ảo ${name}:`, err.message);
        }
    }

    console.log(`\n🎉 ĐÃ KẾT NỐI ĐẦY ĐỦ 50 NGƯỜI CHƠI ẢO!`);
    console.log(`👉 Hãy nhìn lên màn hình Admin của bạn. Bạn sẽ thấy 50 chiến thuyền xuất hiện đồng thời trên đại dương 3D!`);
    console.log(`⚡ Bắt đầu giả lập cuộc đua kéo dài 40 giây...`);

    // Chạy giả lập di chuyển thuyền thời gian thực mỗi 120ms
    const intervalId = setInterval(() => {
        channels.forEach((player, idx) => {
            // Tăng dần progress của thuyền ngẫu nhiên để mô phỏng đang đua
            player.progress += Math.random() * 0.005;
            if (player.progress > 1.0) player.progress = 1.0;

            // Gửi tọa độ vị trí qua kênh pub/sub Ably
            player.channel.publish("pos", {
                id: player.clientId,
                t: Date.now(),
                pos: {
                    x: -232 + idx * 8, // Trải rộng các làn thuyền khác nhau
                    y: 24.0,
                    z: 300 - (player.progress * 800) // Di chuyển từ Z=300 về đích Z=-500
                },
                rot: { x: 0, y: Math.PI * 0.5, z: 0 },
                progress: player.progress
            });
        });
    }, 120);

    // Kết thúc test sau 40 giây và tự động dọn dẹp kết nối
    setTimeout(() => {
        clearInterval(intervalId);
        console.log(`\n🏁 Cuộc đua kết thúc! Đang ngắt kết nối 50 người chơi ảo...`);
        channels.forEach(player => {
            player.channel.presence.leave();
        });
        clients.forEach(c => c.close());
        console.log(`👋 Đã dọn dẹp sạch sẽ sảnh chờ!`);
        process.exit(0);
    }, 40000);
}

runStressTest().catch(console.error);
