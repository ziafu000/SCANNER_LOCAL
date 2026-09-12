# SCANNER

SCANNER là máy quét tài liệu PWA dành cho gia đình: mở ứng dụng, camera bật ngay, đưa giấy vào khung hình và bấm một nút lớn. Ứng dụng tự tìm mép giấy, kể cả biên lai nhỏ hoặc tờ giấy ở xa; khi viền xanh xuất hiện, ảnh chụp sẽ được cắt theo viền đó để bạn xem lại, xác nhận thêm vào giỏ hoặc chụp lại. Nếu không tìm được mép giấy, ứng dụng cho phép chỉnh lại bốn góc rồi xem lại trang trước khi xác nhận. Trong giỏ, bạn có thể xem ảnh toàn màn hình, đặt tên tài liệu, đổi thứ tự các trang rồi lưu và xuất PDF. Chế độ xem tài liệu trong thư viện cũng hỗ trợ xem từng trang toàn màn hình.

- Ba chế độ: **Màu / Xám / Đen trắng**
- Xem lại ảnh đã cắt để xác nhận thêm vào giỏ hoặc chụp lại; hỗ trợ chỉnh bốn góc khi cần
- Xem toàn màn hình từng trang trong giỏ và khi mở tài liệu từ thư viện
- Đặt tên tài liệu, ghép, đổi thứ tự nhiều trang và xuất một PDF
- Tài liệu trong thư viện IndexedDB chỉ nằm trên thiết bị; không tài khoản, tải tài liệu lên cloud, quảng cáo hay OCR. Ứng dụng dùng Vercel Web Analytics để thống kê lượt sử dụng.
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

SCANNER is a camera-first, Vietnamese family document-scanning PWA. It detects paper edges with jscanify/OpenCV.js, corrects perspective, applies Color/Gray/B&W filters, lets users review and confirm or retake each scan, supports manual corner adjustment, and exports named multi-page PDFs. Cart and gallery-document thumbnails open in a fullscreen preview. Its gallery stays local in IndexedDB, and documents are not uploaded to cloud storage. Install from iPhone Safari via **Share → Add to Home Screen**. There are no accounts, ads, or OCR; the app uses Vercel Web Analytics for usage statistics.
