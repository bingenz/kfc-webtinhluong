# Ca Làm — KFC Web tính lương

Ứng dụng tiếng Việt ưu tiên điện thoại, hỗ trợ giao diện sáng/tối ghi nhớ theo thiết bị: ghi ca theo vị trí, tính lương theo ngày áp dụng, đối chiếu lương nhận hàng tháng, tài khoản và quyền chia sẻ chỉ đọc.

## Công nghệ

- React 19 + TypeScript, Vinext/Vite và các thành phần giao diện Radix.
- Supabase Auth + PostgreSQL + RLS.
- Cloudflare Workers phục vụ giao diện và API cấu hình công khai.
- GitHub lưu mã nguồn; có quy trình kiểm tra tự động.

## Chạy ở máy cá nhân

Yêu cầu Node.js 22.13 trở lên và npm.

```bash
npm ci
npm run dev
```

Chưa kết nối Supabase: ứng dụng hiển thị rõ chế độ lưu trên thiết bị. Không có dữ liệu mẫu hoặc đăng nhập giả. Sau khi đăng nhập, sổ trên thiết bị không tự chuyển sang tài khoản; người dùng phải chủ động chọn chuyển dữ liệu khi tài khoản chưa có sổ.

## Supabase

Áp dụng SQL trong `supabase/migrations/` vào một dự án dành riêng cho ứng dụng. Lược đồ gồm:

- `profiles`: tên hiển thị/username có thể tìm kiếm bởi người đã đăng nhập; không chứa email.
- `ledgers`: một sổ JSONB có phiên bản cho mỗi chủ sở hữu, gồm vị trí, lịch sử lương, quy tắc, ngày lễ, ca, điều chỉnh, thực nhận, kỳ đã chốt.
- `ledger_shares`: chủ sổ cấp/thu hồi quyền xem toàn bộ sổ cho người khác; không có quyền sửa.
- `save_ledger`: ghi nguyên tử với revision dự kiến để tránh ghi đè từ hai thiết bị.
- `search_profiles`: tìm tên/username tối thiểu 2 ký tự, tối đa 20 kết quả.

Tất cả bảng đều bật RLS và có GRANT tường minh. Chức năng ghi đặc quyền nằm trong schema riêng, kiểm tra `auth.uid()`, chỉ được truy cập qua hàm wrapper có quyền giới hạn. Không sử dụng service-role key ở trình duyệt. Hệ thống là sổ tự theo dõi, không phải hệ thống phê duyệt bảng lương do doanh nghiệp quản lý: chủ tài khoản được sửa sổ của mình.

Thiết lập biến môi trường ở Worker:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

API `/api/config` chỉ trả URL và khóa publishable (hoặc legacy anon); không dùng khóa bí mật. Thêm URL web thật vào Supabase Authentication → URL Configuration, cả Site URL và Redirect URLs. Bật nhà cung cấp email/password. Nếu đăng ký xác nhận email phục vụ nhiều người, cấu hình SMTP phù hợp giới hạn gửi của Supabase; không tự tắt xác nhận email để né giới hạn.

## Triển khai Cloudflare từ GitHub

Dùng **Cloudflare Workers**, vì bản này có API `/api/config` và build Worker sẵn.

1. Tạo Worker kết nối repository này trong Workers & Pages.
2. Lệnh build: `npm run build`.
3. Lệnh deploy: `npx wrangler deploy --config dist/server/wrangler.json --keep-vars`.
4. Thêm hai biến Supabase ở phần Settings → Variables and Secrets của Worker. Dùng giá trị publishable, không dùng service-role.
5. Thêm tên miền Worker vào danh sách redirect của Supabase Auth rồi kiểm tra đăng ký, xác nhận email và đăng nhập.

Tên Worker mặc định là `ca-lam`, có thể đổi `name` ở `localBindingConfig` trong `vite.config.ts` trước khi triển khai vào tài khoản riêng. Build và mã nguồn đều tương thích với hạ tầng Sites; `.openai/hosting.json` trong bản GitHub không gắn với danh tính Site riêng của phiên xây dựng.

## Triển khai tự động đã chuẩn bị

Workflow `.github/workflows/cloudflare.yml` kiểm tra và triển khai vào Worker `kfc-webtinhluong` khi main thay đổi. Khi chưa có quyền Cloudflare, workflow báo rõ chưa triển khai và không tạo tài nguyên.

Thiết lập một lần tại repository → Settings → Secrets and variables → Actions → Secrets:

- `CLOUDFLARE_API_TOKEN`: token theo mẫu **Edit Cloudflare Workers**, giới hạn đúng tài khoản triển khai.
- `CLOUDFLARE_ACCOUNT_ID`: Account ID của tài khoản đó.

Sau đó mở Actions → **Triển khai Cloudflare** → **Run workflow** trên main. Lần cập nhật tiếp theo sẽ tự triển khai nếu kiểm tra đạt. Không bật thêm gói trả phí. URL Worker xuất hiện trong log triển khai. Cuối cùng thêm URL này vào Supabase Auth → URL Configuration để email xác nhận/khôi phục quay lại đúng web.

`deployment/supabase-public.json` đã chứa URL và **publishable key công khai** của dự án dành cho ứng dụng; quyền dữ liệu vẫn do Supabase Auth và RLS kiểm soát. Không đặt secret/service-role key vào file này. Có thể thay dự án bằng Actions variables `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`; tên Worker có thể đổi bằng `CLOUDFLARE_WORKER_NAME`. Token Cloudflare chỉ được lưu trong Actions secrets, không đưa vào mã nguồn hoặc tin nhắn.

Tham khảo: [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

## Quy tắc nghiệp vụ

- Mỗi ca có ngày, vị trí, giờ vào/ra, phút làm, đơn giá và các hệ số đã lưu tại thời điểm nhập.
- Ca không qua đêm và không trùng giờ. Hai ca liền nhau được phép.
- Cook khởi tạo 25.500đ/h, Lobby 23.500đ/h theo thông tin yêu cầu; Cash chưa có lương, phải cấu hình trước khi nhập.
- Cook kết thúc đúng 22:00 được phụ cấp 15.000đ tối đa một lần/ngày. Vị trí, giờ kết thúc và số tiền được cấu hình theo ngày áp dụng.
- Hệ số ngày lễ được nhập theo chính sách thực tế, không tự suy đoán theo luật. Mặc định nhân cả phụ cấp; có thể tắt trong Cài đặt.
- Đơn giá/rule mới không tự thay ca cũ. Chỉ sửa ghi chú giữ snapshot; sửa giờ/ngày/vị trí tính lại. “Tính lại kỳ” yêu cầu xác nhận và chỉ áp dụng kỳ chưa chốt.
- Làm tròn một lần ở tổng từng ca, cộng các ca vào ngày/tháng. Đơn vị và hướng làm tròn có cấu hình.
- Kỳ mặc định hết tháng, nhận ngày 5 tháng sau. Có thể đổi ngày chốt và ngày nhận; khi thay ngày chốt, đầu kỳ nối tiếp cuối kỳ trước để không lặp/mất ngày.
- Kỳ đã chốt lưu tổng dự kiến, khoảng công và ngày nhận; muốn sửa ca hoặc khoản điều chỉnh phải mở lại.
- Thực nhận có thể gồm nhiều lần và thuộc kỳ lương được chọn, không phụ thuộc tháng chuyển khoản.

## Kiểm tra

```bash
npm test
npx tsc --noEmit
npm run build
```

Bộ kiểm tra gồm nghiệp vụ lương và kiểm tra PostgreSQL bằng PGlite với ba người dùng: chỉ chủ được ghi, chia sẻ chỉ đọc, thu hồi quyền, chống ghi đè revision và chặn anonymous. Các kiểm tra PostgreSQL cục bộ không thay thế xác minh Supabase đang triển khai; cần chạy advisors và kiểm tra đăng nhập/chia sẻ trên dự án thật sau khi kết nối.

## Giới hạn hiện tại

- Chưa hỗ trợ ca qua đêm theo phạm vi đã thống nhất.
- Tìm kiếm người dùng và đồng bộ cần kết nối mạng.
- Dữ liệu trên thiết bị phụ thuộc trình duyệt; nên chuyển vào tài khoản sau khi đã kết nối.
- Sổ lưu dưới dạng JSONB nguyên tử, giới hạn 5 MB/sổ. Khi quy mô lớn hơn, chuyển ca và kỳ lương sang các bảng riêng.
