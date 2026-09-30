# SCANNER

SCANNER là máy quét tài liệu PWA dành cho gia đình: mở ứng dụng, camera bật ngay, đưa giấy vào khung hình và bấm một nút lớn. Ứng dụng tự tìm mép giấy, kể cả biên lai nhỏ, tờ giấy ở xa, nền có họa tiết phức tạp, khi có ngón tay giữ mép giấy, hoặc giấy sáng màu trên nền sáng và dưới bóng điện thoại; khi viền xanh xuất hiện, ảnh chụp sẽ được cắt theo viền đó để bạn xem lại, xác nhận thêm vào giỏ hoặc chụp lại. Nếu không tìm được mép giấy, ứng dụng cho phép chỉnh lại bốn góc rồi xem lại trang trước khi xác nhận. Trong giỏ, bạn có thể xem ảnh toàn màn hình, tải nhanh từng trang ảnh lẻ, đặt tên tài liệu, đổi thứ tự các trang rồi lưu vào Album ảnh (Apple Photos) hoặc xuất PDF. Chế độ xem tài liệu trong thư viện cũng hỗ trợ xem từng trang toàn màn hình, tải ảnh từng trang, lưu bộ ảnh vào Album ảnh hoặc xuất lại PDF.

- Ba chế độ: **Ảnh gốc / Xám rõ nét / Đen trắng**
- Xem lại ảnh đã cắt để xác nhận thêm vào giỏ hoặc chụp lại; hỗ trợ chỉnh bốn góc khi cần
- Xem toàn màn hình từng trang trong giỏ và khi mở tài liệu từ thư viện
- Đặt tên tài liệu, ghép, đổi thứ tự nhiều trang; xuất PDF hoặc lưu bộ ảnh JPEG vào Album ảnh (Apple Photos qua Web Share API); hỗ trợ nút tải nhanh từng trang lẻ
- Hỗ trợ khách dùng thử (tối đa 5 lượt quét qua bộ nhớ máy) và tài khoản người dùng (email/mật khẩu qua Supabase) với hạn mức lượt quét. Toàn bộ ảnh và tài liệu scan được lưu cục bộ trên thiết bị (IndexedDB) để bảo mật và riêng tư; không có quảng cáo hay OCR. Ứng dụng dùng Vercel Web Analytics để thống kê lượt sử dụng.
- Giao diện PWA có thể mở ngoại tuyến sau lần tải đầu tiên; bộ quét cần tải OpenCV.js riêng. Camera cần được cấp quyền.

## Mẹ cài trên iPhone

1. Mở địa chỉ HTTPS của SCANNER bằng **Safari**.
2. Bấm nút **Chia sẻ** (hình vuông có mũi tên đi lên).
3. Kéo xuống và chọn **Thêm vào Màn hình chính**.
4. Bấm **Thêm**, sau đó mở biểu tượng SCANNER và chọn **Cho phép Camera**.

Khi bộ quét chưa sẵn sàng, ứng dụng hiện “Đang tải bộ quét…” trong lúc trình duyệt tải OpenCV.js. Để tránh bộ nhớ đệm PWA quá lớn, service worker không lưu trước tệp này.

## Chạy tại máy

Yêu cầu Node.js 20+:

```bash
npm install
npm run dev
```

Mở địa chỉ Vite in ra. `localhost` được trình duyệt coi là môi trường an toàn; khi mở từ điện thoại qua địa chỉ LAN, camera cần **HTTPS**.

Để sử dụng tính năng tài khoản và đồng bộ hạn mức lượt quét, sao chép `.env.example` thành `.env` và cấu hình `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Khởi tạo bảng và hàm RPC trong Supabase theo `supabase/schema.sql`. Nếu không có biến môi trường, ứng dụng tự động chạy ở chế độ khách vãng lai (lưu hạn mức cục bộ).

Kiểm tra bản phát hành:

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

SCANNER is a camera-first, Vietnamese family document-scanning PWA. It detects paper edges with OpenCV.js even on noisy backgrounds or with finger occlusion, corrects perspective, applies Original/Sharpened Gray/B&W filters, lets users review and confirm or retake each scan, supports manual corner adjustment, exports named multi-page PDFs, and saves JPEG image sets to Apple Photos via Web Share API with quick single-page downloads. Cart and gallery-document thumbnails open in a fullscreen preview. Install from iPhone Safari via **Share → Add to Home Screen**. Supports guest trial (up to 5 free scans tracked in local storage) and user accounts (email/password via Supabase) with scan quota management. Scanned images and documents remain strictly on the device (IndexedDB) for privacy; there are no ads or OCR. The app uses Vercel Web Analytics for usage statistics.
