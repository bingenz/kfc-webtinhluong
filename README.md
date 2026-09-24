# ShiftTrack — Theo dõi giờ làm và kỳ lương

ShiftTrack là ứng dụng tiếng Việt ưu tiên điện thoại để ghi ca, tính lương theo rule/rate có hiệu lực, chốt/đối soát kỳ lương và đồng bộ một sổ riêng tư với Supabase. Ứng dụng không còn Friends, Chat, Nhật ký/Feed hay trang Profile xã hội. Tính năng cộng tác duy nhất là **Chia sẻ**: người dùng đăng nhập có thể đưa mã riêng cho người dùng khác để cấp quyền xem toàn bộ lịch làm và sổ lương ở chế độ **read-only**.

Trang lịch có ba chế độ tách biệt: lịch làm, lịch học và lịch rảnh. Lịch học hỗ trợ buổi đơn hoặc lặp hằng tuần với ngoại lệ từng buổi; dữ liệu này không tham gia tính lương. Lịch rảnh kết hợp ca làm và buổi học của bản thân với tối đa năm chủ sổ đã chia sẻ, rồi hiển thị các khoảng cả nhóm cùng rảnh từ 60 phút trong 07:00–23:00.

## Công nghệ

- React 19 + TypeScript, Vinext/Vite và các thành phần Radix/shadcn.
- Supabase Auth + PostgreSQL + RLS.
- Cloudflare Workers phục vụ frontend và API `/api/config` chỉ công bố cấu hình Supabase public.
- npm + `package-lock.json`; Node.js 22.13 trở lên.

## Chạy ở máy cá nhân

```bash
npm ci
npm run dev
```

Không có Supabase config, ứng dụng vẫn dùng **local mode** bằng `localStorage`. Không commit `.env`, service-role key, Cloudflare token hoặc credential vào repository.

## Data lifecycle: thiết bị và tài khoản

Ứng dụng luôn biết sổ hiện tại đến từ đâu: `local`, `cloud`, `shared` hoặc trạng thái chuyển tiếp. Khi logout, request cloud đang chạy bị hủy/đánh dấu stale, state account bị bỏ và giao diện lập tức nạp lại sổ local của thiết bị. Vì vậy cloud ledger không thể vô tình bị ghi vào `localStorage` sau logout.

Khi login:

- Cloud trống + thiết bị có dữ liệu: chọn **Chuyển dữ liệu thiết bị lên tài khoản** hoặc **Bắt đầu tài khoản mới**. Bắt đầu mới không xóa local ledger.
- Local và cloud đều có dữ liệu: chọn dùng cloud, dùng thiết bị, hoặc **Gộp**. Merge chỉ thêm record khác ID; cùng ID nhưng nội dung khác bị báo conflict thay vì silent overwrite.
- Trước thao tác có thể overwrite, app lưu backup local có timestamp.
- JSON local bị hỏng không bị tự xóa. Recovery UI cho phép thử lại, tải raw JSON lỗi, phục hồi backup hoặc reset thiết bị sau confirmation.

## Supabase và migration

Áp dụng migration theo đúng thứ tự filename trong `supabase/migrations/`. Migration hiện tại cuối cùng là:

```text
202609240001_study_schedules.sql
```

Migration chia sẻ `202609160001_shifttrack_sharing_cleanup.sql`:

- không rewrite `public.ledgers`;
- ghi nhận số ledger và số phần tử shifts/rates/settlements/adjustments/payments trước cleanup, rồi abort transaction nếu các count lõi thay đổi;
- xóa runtime objects của Friends/Chat/Journal/Profile social/notifications và bucket `social-media` khi Storage tồn tại;
- giữ `profiles` ở dạng identity tối thiểu cho auth/ownership;
- tạo `share_identities`, `share_grants`, rate-limit log và RPC cho ensure/rotate/redeem/revoke;
- đổi RLS `ledgers` để owner đọc sổ mình, viewer chỉ `SELECT` khi có active grant;
- không cấp cho viewer đường mutation ledger của owner. `save_ledger` vẫn luôn scope write vào `auth.uid()`.

Migration `202609240001_study_schedules.sql` chỉ mở rộng validation của `save_ledger` cho ledger v2 có `studySchedules`; không rewrite payload hiện có và vẫn chấp nhận ledger v1 trong giai đoạn chuyển tiếp.

**Production safety:** trước khi áp dụng migration cleanup trên production, tạo Supabase backup/snapshot. Sau migration, đối chiếu row counts của ledger/shifts/rates/settlements/adjustments/payments và owner mapping. Nếu count giảm bất ngờ, rollback/restore snapshot và điều tra; không tiếp tục deploy.

## Chia sẻ read-only

Trong tab **Chia sẻ**:

1. Mỗi account có mã dạng `ST-XXXX-XXXX-XXXX-XXXX`, không dùng email hay raw auth UUID.
2. Người nhận phải đăng nhập rồi nhập mã để redeem; anonymous không thể dùng mã đọc payroll.
3. Grant cho phép xem toàn bộ lịch sử ledger của owner, gồm lịch làm, snapshot rate/rule, adjustments, payments, reconciliation và settlements.
4. Viewer không thể tạo/sửa/xóa ca, chỉnh lương, đối soát, chốt/mở kỳ, sửa settings hoặc cấp quyền thay owner. UI ẩn mutation và RLS/API vẫn chặn gọi trực tiếp.
5. Owner có thể revoke ngay. Trang shared revalidate quyền và không tiếp tục hiển thị cached owner ledger như đang authorized.
6. Rotate mã làm mã cũ hết hiệu lực nhưng không tự revoke grant đang tồn tại.

Mã plaintext chỉ được trả về cho chính owner qua RPC để có thể copy; lookup dùng code đã normalize + hash, và bảng identity không được grant trực tiếp cho client. Redeem có rate limit theo account và lỗi mã sai không expose email/UUID owner.

## Kỳ lương và locking

- Kỳ có thể **Chốt**, **Mở lại** và **Tính lại** khi còn mở.
- Chốt kỳ lưu settlement snapshot và khóa mọi ca trong phạm vi. Guard nằm trong business logic, không chỉ ở disabled button.
- Mở lại cần confirmation trước khi mutation trở lại khả dụng.
- `Đã tích lũy` chỉ tính ca đã kết thúc; adjustment của kỳ không bị coi là đã earned khi không có effective date. `Dự kiến` gồm ca còn lại + adjustment.
- Breakdown hiển thị lương theo giờ, phụ cấp đóng ca, phần tăng do ngày lễ, điều chỉnh và tổng dự kiến.
- Đối soát dùng nhãn `Thiếu`, `Dư` hoặc `Khớp hoàn toàn`.

## Quy tắc nghiệp vụ chính

- Mỗi ca có ngày, vị trí, giờ vào/ra, phút làm và snapshot rate/rule tại thời điểm tạo.
- Ca không qua đêm và không trùng giờ; hai ca liền nhau được phép.
- Vị trí active nhưng chưa có wage rate bị cảnh báo trước và không thể lưu ca.
- Rate/rule mới không tự tính lại ca lịch sử đã có snapshot.
- Trạng thái ca là `Sắp tới`, `Đang làm`, `Đã xong` theo timezone `Asia/Ho_Chi_Minh`.
- Kỳ chốt khóa edit/delete ở cả UI và helper nghiệp vụ.

## Cấu hình Worker

Chỉ dùng public/publishable Supabase values:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

`/api/config` từ chối `sb_secret_...` và JWT không có role `anon`. Không cần VAPID, webhook notification hay service-role key cho frontend của phiên bản này.

## Verification và CI parity

CI chạy test, lint, typecheck và build cho mọi pull request/push vào `main`. Mỗi deployment production dùng cùng các kiểm tra này trước khi đưa Worker lên Cloudflare.

## Kiểm tra

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Có thể chạy thêm:

```bash
npm run lint
npm audit
```

`npm test` gồm regression payroll/data-lifecycle và PostgreSQL security/schema bằng PGlite: migration cleanup phải giữ nguyên core counts; mã share sai/self bị chặn; A cấp quyền B; B đọc được full ledger nhưng không mutation; C/anonymous không đọc; duplicate redeem không nhân grant; rotate/revoke có hiệu lực đúng; social tables biến mất.

PGlite kiểm tra migration/RLS cục bộ nhưng không thay thế verification production. Sau khi áp dụng migration vào Supabase thật, kiểm tra Auth/RLS và row counts bằng credential quản trị trong môi trường production; không đưa credential vào chat/source.

## Triển khai Cloudflare tự động từ GitHub

Ứng dụng chạy trên Cloudflare Worker `kfc-webtinhluong`; nguồn chính thức là GitHub, không deploy trực tiếp từ máy cá nhân. Workflow `.github/workflows/check.yml` có hai job tuần tự: `verify` chạy test/lint/typecheck/build cho mọi PR và push vào `main`; `Deploy production` chỉ chạy sau `verify` thành công trên `main`. Các deployment được xếp hàng để không bỏ qua commit đã merge, và không tạo preview cho PR.

Thiết lập một lần tại repository → Settings → Secrets and variables → Actions → Secrets:

- `CLOUDFLARE_API_TOKEN`: token **Edit Cloudflare Workers** giới hạn đúng tài khoản triển khai.
- `CLOUDFLARE_ACCOUNT_ID`: Account ID của tài khoản đó.

`main` yêu cầu pull request và status check `CI & Deploy Cloudflare / verify`; không cần reviewer thủ công. Merge PR sẽ tự deploy nếu toàn bộ kiểm tra đạt. Chọn **Run workflow** trên `main` để redeploy một commit khi cần. Không đưa token hay secret vào source.

Build thủ công:

```bash
npm run build
npx wrangler deploy --config dist/server/wrangler.json --keep-vars
```

Thêm domain Worker vào Supabase Authentication → URL Configuration. Không tự chạy destructive DB migration trong pipeline deploy nếu chưa có backup/verification step dành riêng cho database.

## Giới hạn kiến trúc

- Ledger vẫn là JSONB nguyên tử, `save_ledger` chặn payload lớn hơn khoảng 5 MB. Khi dữ liệu tiến gần giới hạn này nên tách shifts/payroll history thành bảng riêng thay vì tăng giới hạn im lặng.
- Chưa hỗ trợ ca qua đêm.
- Shared view cần mạng và session đăng nhập; không có public share link.
