# SCANNER

SCANNER là máy quét tài liệu PWA dành cho gia đình: mở ứng dụng, camera bật ngay, đưa giấy vào viền xanh và bấm một nút lớn. Ứng dụng tự tìm mép giấy, nắn phối cảnh, tăng độ rõ, rồi lưu ảnh hoặc nhiều trang thành PDF.

- Ba chế độ: **Màu / Xám / Đen trắng**
- Chia sẻ ảnh qua bảng Chia sẻ của iPhone (Zalo, Messenger… nếu đã cài)
- Ghép, đổi thứ tự nhiều trang và xuất một PDF
- Thư viện IndexedDB chỉ nằm trên thiết bị; không tài khoản, cloud, quảng cáo, OCR hay theo dõi
- Hoạt động ngoại tuyến sau lần tải đầu tiên. Camera cần được cấp quyền.

## Mẹ cài trên iPhone

1. Mở địa chỉ HTTPS của SCANNER bằng **Safari**.
2. Bấm nút **Chia sẻ** (hình vuông có mũi tên đi lên).
3. Kéo xuống và chọn **Thêm vào Màn hình chính**.
4. Bấm **Thêm**, sau đó mở biểu tượng SCANNER và chọn **Cho phép Camera**.

Lần mở đầu có dòng “Đang tải bộ quét…” vì trình duyệt tải OpenCV.js; tệp này được service worker lưu lại cho những lần sau.

## Chạy tại máy

Yêu cầu Node.js 20+:

```bash
npm install
npm run dev
```

Mở địa chỉ Vite in ra. `localhost` được trình duyệt coi là môi trường an toàn; khi mở từ điện thoại qua địa chỉ LAN, camera cần **HTTPS**. Kiểm tra bản phát hành:

```bash
npm run build
npm run preview
```

## Triển khai miễn phí về sau (không thực hiện trong repo này)

Chạy `npm run build`; thư mục cần phát hành là `dist/`.

- **Cloudflare Pages:** kết nối repository, build command `npm run build`, output `dist`.
- **GitHub Pages:** dùng GitHub Actions để cài dependency, build và phát hành `dist`. Nếu phát hành dưới đường dẫn repository thay vì tên miền gốc, đặt `base` tương ứng trong `vite.config.js` và điều chỉnh manifest `scope/start_url`.

Cả hai dịch vụ cung cấp HTTPS, điều kiện bắt buộc của camera ngoài `localhost`. Sau triển khai, thử trên Safari iPhone: camera sau, thao tác Share với file, cài vào Màn hình chính và mở lại khi ngoại tuyến.

## English (short)

SCANNER is a camera-first, Vietnamese family document-scanning PWA. It detects paper edges with jscanify/OpenCV.js, corrects perspective, applies Color/Gray/B&W filters, shares or saves images, builds multi-page PDFs, and keeps its gallery locally in IndexedDB. Install from iPhone Safari via **Share → Add to Home Screen**. No accounts, uploads, OCR, analytics, or trackers.
