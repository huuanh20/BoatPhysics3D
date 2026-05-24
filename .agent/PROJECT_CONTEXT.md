# Project Context: Đại Dương Chân Lý (MarineSim3D Quiz Edition)

Đại Dương Chân Lý là một dự án Web Game Quiz 3D thời gian thực (Realtime) được thiết kế đặc sắc phục vụ môn học **MLN313 (Chủ nghĩa xã hội khoa học)** với chủ đề trọng tâm: *"Phá Vỡ 5 Hiểu Lầm Về Chủ Nghĩa Xã Hội"*.

Trò chơi kết hợp giữa **câu hỏi tri thức lý luận sắc bén** và **mô phỏng vật lý đua thuyền 3D thời gian thực trên sóng biển**. Khi người chơi trả lời đúng, chiến thuyền của họ trên màn hình 3D (Three.js) sẽ tăng tốc vượt sóng tiến về phía trước.

---

## 🏗️ Architecture & Stack

Dự án sử dụng mô hình kiến trúc Client-Server hiện đại trên nền tảng Web:

```text
BoatPhysics3D/
├── frontend/                 # Giao diện người dùng & Trình chiếu 3D
│   ├── index.html            # Màn hình đua thuyền & trả lời của người chơi (User Screen)
│   ├── admin.html            # Mảng điều khiển trình chiếu lớn của ban tổ chức (Admin Screen)
│   ├── style.css             # CSS tùy biến thiết kế premium, hiệu ứng neon lấp lánh
│   ├── main.js               # Khởi tạo môi trường 3D Three.js, đại dương, đảo nhiệt đới
│   ├── client.js             # Logic điều khiển người chơi, âm thanh, tính điểm, chuỗi đúng
│   ├── admin.js              # Logic Admin điều phối phòng đấu, bảng vàng danh dự
│   ├── questions.js          # Bộ câu hỏi Triết học & CNXHKH sắc bén phản bác 5 hiểu lầm
│   └── ably-realtime.js      # Kết nối đồng bộ vị trí các thuyền qua Websocket Ably
│
├── backend/                  # API và dịch vụ Serverless điều phối
├── api/                      # Vercel Serverless Functions xử lý lưu trữ kỷ lục
└── vercel.json               # Cấu hình Deploy Vercel Serverless
```

### Công nghệ cốt lõi:
*   **Three.js (Web Audio/WebGL):** Dựng đại dương 3D, đảo nhiệt đới, hiệu ứng sóng biển vật lý và mô phỏng nổi (buoyancy) của các chiến thuyền.
*   **Ably Realtime SDK:** Websocket dịch vụ đồng bộ hóa tọa độ, tốc độ và trạng thái các thuyền đua của 30 người chơi cùng lúc lên màn hình Admin.
*   **Canvas Confetti:** Tạo hiệu ứng pháo hoa ăn mừng khi chiến thắng.

---

## 🎯 Các cơ chế game độc đáo (Socialism Gamification)

### 1. Vượt Sóng Sương Mù Lý Luận
*   Người chơi khởi hành từ *"Sương mù Hiểu lầm"* và phải vượt qua 15 câu hỏi lý luận sắc bén để tiến về *"Đại lộ Chân lý"*.
*   Mỗi câu trả lời đúng sẽ kích hoạt động cơ đẩy thuyền lướt sóng Three.js tiến nhanh về đích.

### 2. Hệ thống Vật phẩm Hỗ trợ (Gamified Power-ups)
*   **Radar Chân Lý (Smart Radar):** Loại bỏ ngay 2 đáp án sai (50/50).
*   **Động Cơ Phản Lực (Turbo Boost):** Mở khóa khi đạt chuỗi đúng **Streak x3**, giúp thuyền tiến nhanh thêm 1 câu.
*   **Lá Chắn Sao Vàng (Victory Shield):** Mở khóa khi đạt chuỗi **Streak x5**, chặn đứng 1 lần trả lời sai giúp giữ nguyên máu và chuỗi thắng.

### 3. Góc Nhận Thức "Sự Thật Là..." (Educational Explanations)
*   Khi trả lời xong mỗi câu hỏi, một bảng giải thích tri thức hiện ra phân tích sâu sắc, khoa học để đập tan các luận điệu hiểu lầm về CNXH, giúp học sinh tiếp thu kiến thức môn MLN313 cực kỳ sâu sắc ngay tại buổi thuyết trình.

---

## ⚙️ Cấu hình môi trường & Ably Key
*   Sử dụng Ably API Key để kết nối kênh Websocket thời gian thực.
*   Lưu trữ kỷ lục cao nhất (Hall of Fame) thông qua Vercel API backend kết nối cơ sở dữ liệu.
