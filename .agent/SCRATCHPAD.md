# AI Memory Scratchpad (SCRATCHPAD.md - Đại Dương Chân Lý Edition)

Sử dụng file này để lưu trữ mục tiêu hiện tại, các tác vụ đã hoàn thành, các lựa chọn kiến trúc và các vấn đề chưa giải quyết để duy trì tính nhất quán trên toàn bộ phiên làm việc của AI OS.

---

## 🎯 Active Goal
Cấu trúc hóa, bảo trì và nâng cấp game Quiz 3D thời gian thực **"Đại Dương Chân Lý"** (Phá vỡ 5 hiểu lầm về CNXHKH môn MLN313) sử dụng Three.js, Ably Realtime Websockets và Vercel Serverless.

---

## 📅 Project Progress Checklist

### Phase 1: Planning & AI OS Setup
- [x] Khởi tạo thư mục dự án và nạp hệ thống AI OS `.agent/` cùng `.cursorrules`
- [x] Tùy biến `PROJECT_CONTEXT.md` mô tả nghiệp vụ 3D đua thuyền và 5 hiểu lầm về CNXHKH
- [x] Đồng bộ hóa `SCRATCHPAD.md` cho bối cảnh dự án mới
- [ ] Giới thiệu cho thuyền trưởng (User) mở Active Workspace mới tại thư mục `BoatPhysics3D`

### Phase 2: Code Review & Optimization
- [ ] Đọc và phân tích logic đại dương 3D Three.js tại `frontend/main.js` để tìm cơ hội cải tiến hiệu năng
- [ ] Phân tích logic Websocket Ably tại `frontend/ably-realtime.js` kiểm tra độ trễ đồng bộ
- [ ] Kiểm tra và chuẩn hóa bộ câu hỏi đập tan 5 hiểu lầm về CNXH tại `frontend/questions.js`

### Phase 3: Premium UI/UX Polish
- [ ] Tối ưu hóa hiệu ứng vật lý nổi của thuyền (Buoyancy) cho mượt mà hơn khi sóng đập mạnh
- [ ] Thêm hiệu ứng pháo hoa, lấp lánh (Confetti) đặc sắc hơn ở màn hình thắng cuộc
- [ ] Tinh chỉnh âm thanh (Quốc ca Việt Nam, nhạc nền gaming) tự động tải mượt mà không chặn trình duyệt

---

## 🧠 Architectural Decisions & Context
*   **Three.js Engine:** Khởi tạo cảnh quan đảo nhiệt đới 3D, nước biển động, tạo tương tác sóng thời gian thực cho thuyền di chuyển tiến lên dựa trên câu trả lời đúng.
*   **Ably Broker:** Sử dụng Ably làm trung gian gửi nhận tin nhắn thời gian thực qua giao thức pub/sub để vẽ vị trí các thuyền đua trên màn hình máy chiếu Admin.
*   **Immersive Audio:** Nhúng nhạc nền và hiệu ứng âm thanh sống động kích thích trải nghiệm thi đua trong lớp học.
